/* Erzeugt die Garmin-Workout-Dateien (.FIT) direkt aus dem Plan in index.html –
   für den Weg auf die Uhr, ohne dass die App vorher gehostet sein muss.
   Nutzung: npm run fit:export -- [--day UA] [--plan default] [--out dist/workouts] */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Decoder, Stream} from '@garmin/fitsdk';

globalThis.window = globalThis;
await import('../garmin.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function extractPlan(source, name) {
  const marker = `const ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Im Planquelltext fehlt ${name}.`);
  const open = source.indexOf('{', start);
  let depth = 0, inString = false, quote = '';
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {inString = true; quote = char; continue;}
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(source.slice(open, i + 1).replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'/g, '"'));
  }
  throw new Error(`Plan ${name} konnte nicht gelesen werden.`);
}

const planName = arg('plan', 'default');
const dayFilter = arg('day', '');
const outDir = path.resolve(root, arg('out', 'dist/workouts'));
const source = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const plan = extractPlan(source, planName === 'default' ? 'DEFAULT_PLAN' : 'HYROX_DEMO_PLAN');

await fs.mkdir(outDir, {recursive: true});
const withoutRest = process.argv.includes('--no-rest');
const suffix = withoutRest ? '-norest' : '';
console.log(`Plan: ${plan.name}\nAusgabe: ${path.relative(process.cwd(), outDir)}${withoutRest ? '\nOhne Ruhe-Schritte zwischen den Sätzen (Variante zum Testen auf der Uhr).' : ''}\n`);

let skipped = 0;
for (const day of plan.days) {
  if (dayFilter && day.code !== dayFilter) continue;
  let workout;
  try {
    workout = GarminAdapter.planToWorkout(day, [], {restSteps: !withoutRest});
  } catch (err) {
    console.log(`${day.code.padEnd(4)} übersprungen: ${err.message}`);
    skipped++;
    continue;
  }
  const bytes = GarminAdapter.workoutToFit(workout);
  const file = path.join(outDir, `ironlog-${String(day.code).toLowerCase()}${suffix}.fit`);
  await fs.writeFile(file, bytes);

  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  const integrity = decoder.checkIntegrity();
  const {messages, errors} = decoder.read();
  const unmapped = workout.exercises.filter(ex => !ex.mapped).map(ex => ex.name);
  console.log(
    `${day.code.padEnd(4)} ${String(day.name).padEnd(24)} ${String(bytes.length).padStart(5)} Bytes  ` +
    `Schritte: ${String(messages.workoutStepMesgs.length).padStart(2)}  CRC: ${integrity ? 'ok' : 'FEHLER'}  ` +
    `Decode-Fehler: ${errors.length}${unmapped.length ? `  eigene Übung: ${unmapped.join(', ')}` : ''}`
  );
  if (process.argv.includes('--verbose')) {
    messages.workoutStepMesgs.forEach((step, index) => {
      const detail = [
        step.durationType === 'time' ? `${step.durationValue / 1000} s` : step.durationType === 'reps' ? `${step.durationValue} Wdh.` : step.durationType,
        step.targetType === 'open' && step.targetValue ? `${step.targetValue}×` : '',
        step.intensity,
        step.exerciseName && step.exerciseName !== 'unknown' ? `Übung ${step.exerciseName}` : '',
        step.exerciseWeight ? `${step.exerciseWeight / 100} kg` : ''
      ].filter(Boolean).join('  ');
      console.log(`     ${String(index).padStart(2)}  ${String(step.wktStepName || '').padEnd(34)} ${detail}`);
    });
  }
}
console.log(`\n${skipped ? `${skipped} Tag(e) übersprungen. ` : ''}Import in Garmin Connect: Training & Planning → Workouts → Importieren, danach „Send to Device“.`);
