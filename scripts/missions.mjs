// Daily Mission staging report: every situation staged in every project that has it, and the on-time odds
// with the best answer and the worst, over the same 60 futures.
//   npm run missions               (add -- --runs 30 for a quicker pass)
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { stage, onTimeOdds, ODDS_MATTER } from '../engine/mission.js';
import { tracksOf, TRACK_LABEL } from '../engine/tracks.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(fs.readFileSync(new URL(p, root)));
const world = load('content/world.json');
const deck = load('content/scenarios/core-deck.json');
const projects = load('content/projects.json').projects.map((id) => load(`content/projects/${id}.json`));
const i = process.argv.indexOf('--runs');
const runs = i > 0 ? Number(process.argv[i + 1]) : 60;
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];

const t0 = Date.now();
let pairs = 0, staged = 0, matter = 0;
const byProject = {};
for (const project of projects) {
  const row = (byProject[project.title] = { staged: 0, best: 0, worst: 0 });
  for (const event of deck.events.filter((e) => !e.projects || e.projects.includes(project.id))) {
    pairs++;
    const g = stage({ world, project, deck, event, seed: `report:${event.id}` });
    const { primary } = tracksOf(event);
    if (!g) { console.log(`  not staged  ${project.id.padEnd(28)} ${event.id}`); continue; }
    staged++;
    row.staged++;
    const sorted = [...event.choices].sort((a, b) => credit(b) - credit(a));
    const play = (c) => { const s = structuredClone(g); S.chooseOption(s, c.id); return onTimeOdds(s, { runs, seed: 'report' }); };
    const best = play(sorted[0]);
    const worst = play(sorted.at(-1));
    row.best += best;
    row.worst += worst;
    if (best - worst >= ODDS_MATTER) matter++;
    console.log(`  week ${String(g.week).padStart(2)}  ${project.id.padEnd(28)} ${event.id.padEnd(24)} ${TRACK_LABEL[primary].padEnd(15)} best ${Math.round(best * 100)}%  worst ${Math.round(worst * 100)}%`);
  }
}
console.log(`\n${staged} of ${pairs} situation/project pairs stage; the best answer beats the worst by 10+ points in ${matter}.`);
for (const [title, r] of Object.entries(byProject)) {
  console.log(`${title.padEnd(42)} ${String(r.staged).padStart(2)} staged   best ${Math.round((100 * r.best) / r.staged)}%   worst ${Math.round((100 * r.worst) / r.staged)}%`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
