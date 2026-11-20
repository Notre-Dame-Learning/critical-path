// What talking a situation through is worth: for each hard-mode conversation, 300 runs per project with
// best answers elsewhere, comparing an agreed outcome (rubric 8/10, concern uncovered) with a refused one
// (rubric 2/10). Prints on-time odds and the faculty trust / staff morale at launch.
//   npm run talks             (add -- --runs 100 for a quicker pass)
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { createGameAt } from '../engine/difficulty.js';
import * as M from '../engine/moves.js';
import { readTheBoard } from '../engine/montecarlo.js';
import { applyVerdict } from '../engine/conversation.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(fs.readFileSync(new URL(p, root)));
const world = load('content/world.json');
const deck = load('content/scenarios/core-deck.json');
const convs = load('content/conversations.json');
const projects = load('content/projects.json').projects.map((id) => load(`content/projects/${id}.json`));
const i = process.argv.indexOf('--runs');
const runs = i > 0 ? Number(process.argv[i + 1]) : 300;

const rubric = (n) => ({ curiosity: Math.min(2, n), clarity: Math.min(2, Math.max(0, n - 2)), options_and_tradeoffs: Math.min(2, Math.max(0, n - 4)), bad_news_early: Math.min(2, Math.max(0, n - 6)), respect_and_tone: Math.min(2, Math.max(0, n - 8)) });
const VERDICTS = {
  agreed: { outcome: 'agreed', rubric: { curiosity: 2, clarity: 2, options_and_tradeoffs: 2, bad_news_early: 1, respect_and_tone: 1 }, hidden_concern_revealed: true, commitments: [] },
  refused: { outcome: 'refused', rubric: rubric(2), hidden_concern_revealed: false, commitments: [] },
};

function play(project, conv, verdict, seed) {
  const g = createGameAt(S, { world, project, deck, seed, mode: 'hard' });
  let met = false;
  while (!g.over) {
    const ev = S.currentEvent(g);
    if (ev?.id === conv.eventId) { applyVerdict(g, conv, verdict, [{ from: 'player', text: '…' }]); met = true; }
    else if (ev) S.chooseOption(g, S.bestChoice(ev).id);
    readTheBoard(g);
    M.endWeek(g);
  }
  return { met, onTime: g.result.launchedOnTime, meter: conv.meter === 'trust' ? g.team.faculty.trust : conv.meter === 'morale' ? g.team[conv.talkTo].morale : null };
}

console.log(`Hard-mode conversations: agreed (8/10, concern uncovered) vs refused (2/10), ${runs} runs per project\n`);
for (const conv of convs.conversations) {
  for (const project of projects) {
    const ev = deck.events.find((e) => e.id === conv.eventId);
    if (ev.projects && !ev.projects.includes(project.id)) continue;
    const out = {};
    for (const [k, v] of Object.entries(VERDICTS)) {
      let met = 0, on = 0, meter = 0;
      for (let r = 0; r < runs; r++) { const x = play(project, conv, v, `talk:${r}`); if (x.met) { met++; if (x.onTime) on++; meter += x.meter ?? 0; } }
      out[k] = { met, on: met ? on / met : 0, meter: met ? meter / met : 0 };
    }
    const m = conv.meter ? `  ${conv.meter} ${Math.round(out.agreed.meter)} vs ${Math.round(out.refused.meter)}` : '';
    console.log(`${conv.eventId.padEnd(20)} ${project.id.padEnd(28)} came up ${String(out.agreed.met).padStart(3)}/${runs}   on time ${Math.round(out.agreed.on * 100)}% vs ${Math.round(out.refused.on * 100)}%${m}`);
  }
}
