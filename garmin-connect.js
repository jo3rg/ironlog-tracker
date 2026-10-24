/* Garmin Connect's undocumented strength-workout JSON payload.
   Import it with a Connect-page tool such as Garmin Workout Importer; the
   static PWA cannot authenticate to connect.garmin.com itself. */
(function (root) {
  'use strict';

  const SPORT = { sportTypeId: 5, sportTypeKey: 'strength_training', displayOrder: 5 };
  const CATALOG = {
    'bankdrücken langhantel': ['BENCH_PRESS', 'BARBELL_BENCH_PRESS'],
    'schrägbankdrücken langhantel': ['BENCH_PRESS', 'INCLINE_BARBELL_BENCH_PRESS'],
    'kurzhantel schrägbank': ['BENCH_PRESS', 'INCLINE_DUMBBELL_BENCH_PRESS'],
    'schulterdrücken kurzhantel': ['SHOULDER_PRESS', 'OVERHEAD_DUMBBELL_PRESS'],
    'bizeps curl lh': ['CURL', 'BARBELL_BICEPS_CURL'],
    'hammer curl': ['CURL', 'HAMMER_CURL'],
    'trizeps pushdown': ['TRICEPS_EXTENSION', 'TRICEPS_PRESSDOWN'],
    'french press': ['TRICEPS_EXTENSION', 'EZ_BAR_OVERHEAD_TRICEPS_EXTENSION'],
    'rudern t-bar oder lh': ['ROW', 'BARBELL_ROW'],
    'langhantelrudern (pendlay)': ['ROW', 'BARBELL_ROW'],
    'klimmzüge (oder latzug breit)': ['PULL_UP', 'WIDE_GRIP_PULL_UP'],
    'klimmzüge': ['PULL_UP', 'PULL_UP'],
    'lat-pulldown eng (v-griff)': ['PULL_UP', 'CLOSE_GRIP_LAT_PULLDOWN'],
    'face pulls': ['ROW', 'FACE_PULL'],
    'kniebeugen langhantel': ['SQUAT', 'BARBELL_BACK_SQUAT'],
    'back squat': ['SQUAT', 'BARBELL_BACK_SQUAT'],
    'beinpresse': ['SQUAT', 'LEG_PRESS'],
    'kreuzheben konventionell': ['DEADLIFT', 'BARBELL_DEADLIFT'],
    'rumänisches kreuzheben': ['DEADLIFT', 'BARBELL_STRAIGHT_LEG_DEADLIFT'],
    'hip thrust langhantel': ['HIP_RAISE', 'BARBELL_HIP_THRUST_WITH_BENCH'],
    'plank': ['PLANK', 'PLANK'],
    'liegestütze': ['PUSH_UP', 'PUSH_UP'],
    'seitheben kurzhantel': ['LATERAL_RAISE', 'DUMBBELL_LATERAL_RAISE'],
  };
  const STEP = { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 };
  const REST = { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 };
  const REPEAT = { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 };
  const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 };
  const REPS = { conditionTypeId: 10, conditionTypeKey: 'reps', displayOrder: 10, displayable: true };
  const TIME = { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true };

  function normalizeName(name) {
    return String(name || '').trim().toLocaleLowerCase('de');
  }
  function number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function buildWorkout(day, history) {
    if (!day) throw new Error('Kein Trainingstag ausgewählt.');
    if (day.format && day.format !== 'standard') throw new Error('Connect-Export unterstützt nur Krafttrainingspläne.');
    if (!Array.isArray(day.exercises) || day.exercises.length === 0) throw new Error('Dieser Trainingstag enthält keine Übungen.');

    const steps = [];
    let order = 0;
    for (const ex of day.exercises) {
      const groupOrder = ++order;
      const name = String(ex.name || ex.id || '').trim();
      const mapped = CATALOG[normalizeName(name)];
      if (!mapped) throw new Error(`Keine Garmin-Connect-Übung für „${name}“ hinterlegt. Diesen Tag bitte im Connect-Workout-Builder anlegen.`);
      const sets = Math.max(1, Math.min(99, Math.floor(number(ex.sets, 1))));
      const rawReps = String(ex.reps || '8');
      const timed = /(?:time_s|time|duration)/i.test((ex.metrics || []).join(',')) || /s\s*$/i.test(rawReps);
      const target = Number((rawReps.match(/\d+/) || [])[0]) || (timed ? 45 : 8);
      const exercise = {
        type: 'ExecutableStepDTO', stepOrder: ++order, stepType: STEP,
        endCondition: timed ? TIME : REPS, endConditionValue: target,
        targetType: NO_TARGET, category: mapped[0], exerciseName: mapped[1]
      };
      exercise.description = [`IRON.LOG: ${name}`, String(ex.cues || '').trim()].filter(Boolean).join(' · ');
      const weight = latestWeight(history, ex);
      if (weight > 0) {
        exercise.weightValue = weight;
        exercise.weightUnit = { unitId: 8, unitKey: 'kilogram', factor: 1000 };
      }
      const children = [exercise];
      const rest = Math.max(0, Math.floor(number(ex.rest, 0)));
      if (rest > 0) children.push({
        type: 'ExecutableStepDTO', stepOrder: ++order, stepType: REST,
        endCondition: TIME, endConditionValue: rest, targetType: NO_TARGET
      });
      steps.push({
        type: 'RepeatGroupDTO', stepOrder: groupOrder, stepType: REPEAT,
        numberOfIterations: sets,
        endCondition: { conditionTypeId: 7, conditionTypeKey: 'iterations', displayOrder: 7, displayable: false },
        endConditionValue: sets, skipLastRestStep: true, smartRepeat: false, workoutSteps: children
      });
    }
    return {
      sportType: SPORT,
      workoutName: String(day.name || day.code || 'IRON.LOG').slice(0, 60),
      description: `IRON.LOG · Trainingstag ${day.code || ''}`.trim(),
      workoutSegments: [{ segmentOrder: 1, sportType: SPORT, workoutSteps: steps }]
    };
  }
  function latestWeight(history, exercise) {
    for (let i = (history || []).length - 1; i >= 0; i--) {
      const found = (history[i].exercises || []).find(item =>
        (exercise.id && item.id === exercise.id) || normalizeName(item.name) === normalizeName(exercise.name));
      if (found) for (let j = (found.sets || []).length - 1; j >= 0; j--) {
        const value = Number(found.sets[j].w);
        if (Number.isFinite(value) && value > 0) return value;
      }
    }
    return 0;
  }
  function downloadWorkout(day, history) {
    const payload = buildWorkout(day, history);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ironlog-${String(day.code || 'workout').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-connect.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { bytes: blob.size, payload };
  }

  root.GarminConnectAdapter = { buildWorkout, downloadWorkout };
})(typeof window !== 'undefined' ? window : globalThis);
