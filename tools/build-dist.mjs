/* Baut das auslieferbare PWA-Bundle nach dist/.
   Nur index.html, garmin.js, manifest.json, sw.js und die Icons werden kopiert;
   Testwerkzeuge und Quellartefakte bleiben draußen. */
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const files = ['index.html', 'garmin.js', 'garmin-codec.js', 'garmin-ble.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png'];

await fs.mkdir(out, {recursive: true});
for (const file of files) await fs.rm(path.join(out, file), {force: true});

for (const file of files) {
  const bytes = await fs.readFile(path.join(root, file));
  await fs.writeFile(path.join(out, file), bytes);
  console.log(`${file.padEnd(14)} ${String(bytes.length).padStart(7)} Bytes  ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`);
}
console.log(`\nBundle: ${path.relative(process.cwd(), out)}/  (${files.length} Dateien)`);
