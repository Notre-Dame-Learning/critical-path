// On-time odds for every project under best, plan-only, random and passive play.
//   npm run odds                     500 runs each, Standard pace
//   npm run odds -- --runs 200 --difficulty story
import fs from 'node:fs';
import { oddsReport, POLICIES } from '../engine/montecarlo.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(fs.readFileSync(new URL(p, root)));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const world = load('content/world.json');
const deck = load('content/scenarios/core-deck.json');
const projects = load('content/projects.json').projects.map((id) => load(`content/projects/${id}.json`));
const runs = Number(arg('runs', 500));
const difficulty = arg('difficulty', 'standard');

const t0 = Date.now();
const rows = oddsReport({ world, projects, deck, runs, difficulty });
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
console.log(`On-time odds, ${runs} runs each, ${difficulty} pace\n`);
console.log(`${'Project'.padEnd(42)} ${'Policy'.padEnd(26)} On time  Median finish  Avg score`);
for (const r of rows) {
  const title = projects.find((p) => p.id === r.project).title;
  console.log(`${title.padEnd(42)} ${POLICIES[r.policy].label.padEnd(26)} ${pct(r.onTime).padEnd(8)} ${String(r.medianFinish ?? '—').padEnd(14)} ${r.avg.overall}`);
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
