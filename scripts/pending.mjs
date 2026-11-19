// Upload-queue checker: which of the build agent's code drops are in the repo?
// Run: node scripts/pending.mjs   (needs no packages; changes nothing)
// The order and file lists match the "Upload queue" tab in the framework doc.
// Drops 11-13 were committed straight to the repo on Nov 19, once push worked.
import { existsSync, readFileSync } from 'node:fs';

const drops = [
  { n: 1, date: 'Nov 5',  what: 'Build the Plan engine', files: ['engine/plan.js', 'content/plans'], script: 'plans', tests: 8 },
  { n: 2, date: 'Nov 7',  what: 'Critique plan flaws v2', files: ['content/flaws', 'content/critique-samples.json'], tests: 0 },
  { n: 3, date: 'Nov 10', what: 'Plan editor step 1', files: ['app/plan-edit.js', 'app/plan-layout.js'], tests: 10 },
  { n: 4, date: 'Nov 1',  what: 'Monte Carlo odds report', files: ['engine/montecarlo.js'], script: 'odds', tests: 4 },
  { n: 5, date: 'Nov 3',  what: 'Daily Mission generator', files: ['engine/mission.js'], script: 'missions', tests: 9 },
  { n: 6, date: 'Nov 4',  what: 'Three Estimating situations', check: () => countSituations() >= 33, files: ['content/scenarios/core-deck.json (33 situations)'], tests: 2 },
  { n: 7, date: 'Nov 6',  what: 'Hard-mode conversations', files: ['engine/conversation.js', 'content/stakeholders.json', 'content/conversations.json'], script: 'talks', tests: 7 },
  { n: 8, date: 'Nov 11', what: 'First-run coach', files: ['app/coach.js'], tests: 5 },
  { n: 9, date: 'Nov 12', what: 'Progression and profile', files: ['engine/progression.js', 'app/profile-view.js'], tests: 8 },
  { n: 10, date: 'Nov 14', what: 'AI debrief engine', files: ['engine/impact.js', 'engine/debrief-gm.js'], tests: 9 },
  { n: 11, date: 'Nov 17', what: 'Critique scoring', files: ['engine/critique.js'], tests: 11 },
  { n: 12, date: 'Nov 18', what: 'Story difficulty picker', files: ['engine/difficulty.js', 'app/difficulty-picker.js'], tests: 4 },
  { n: 13, date: 'Nov 19', what: 'Run codes on the start screen', files: ['app/run-code.js'], tests: 2 },
];

function countSituations() {
  try {
    const deck = JSON.parse(readFileSync('content/scenarios/core-deck.json', 'utf8'));
    const list = Array.isArray(deck) ? deck : deck.events || deck.situations || [];
    return list.length;
  } catch { return 0; }
}

let scripts = {};
try { scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts || {}; } catch {}

let expected = 14; // tests in v0.3 as uploaded Oct 29
const missing = [];
for (const d of drops) {
  const present = d.check ? d.check() : d.files.every((f) => existsSync(f));
  const scriptOk = !d.script || d.script in scripts;
  if (present) expected += d.tests;
  else missing.push(d);
  const mark = present ? (scriptOk ? 'in   ' : 'PART ') : 'MISS ';
  const note = present && !scriptOk ? `  (add "npm run ${d.script}" to package.json scripts)` : '';
  console.log(`${mark} ${String(d.n).padStart(2)}. ${d.date.padEnd(6)} ${d.what}${note}`);
}
console.log('');
console.log(missing.length ? `Next to upload: ${missing[0].n}. ${missing[0].date} zip (${missing[0].what}); ${missing.length} still missing.` : 'All drops are in.');
console.log(`npm test should report about ${expected} tests, all passing.`);
console.log('The Nov 2 progression prototype is replaced by the Nov 12 drop: skip it.');
