// Monte Carlo odds: play a project many times under a fixed policy and report how often it launches
// on time, with the scorecard averages. Used by `npm run odds` and by tests that guard the calibration.
// sim.js is unchanged: a policy is just the moves a player makes each week.
import * as S from './sim.js';
import { createGameAt } from './difficulty.js';
import { makeRng } from './rng.js';

const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];

// The habits a careful PM keeps: check-ins and working sessions, with a review and a Friday summary every
// third week.
export function goodHabits(state) {
  return state.week % 3 === 0 ? ['qa-review', 'faculty-update'] : ['checkin', 'working-session'];
}

// A policy answers situations and spends Action Points. rng is seeded per run.
export const POLICIES = {
  // Best answer to every situation and good habits every week.
  best: { label: 'Best play', choose: (ev) => [...ev.choices].sort((a, b) => credit(b) - credit(a))[0], act: goodHabits },
  // Good habits, no situations at all: what the plan alone allows.
  plan: { label: 'Plan only (no situations)', situations: false, choose: null, act: goodHabits },
  // Random answers and random moves: a player clicking through.
  random: {
    label: 'Random play',
    choose: (ev, rng) => ev.choices[Math.floor(rng.next() * ev.choices.length)],
    act: (state, rng) => Array.from({ length: state.actionPoints }, () => {
      const a = S.ACTIONS[Math.floor(rng.next() * S.ACTIONS.length)];
      return a.needsWho ? `${a.id}:${S.STAFF[Math.floor(rng.next() * S.STAFF.length)]}` : a.id;
    }),
  },
  // Waits out every situation (or takes the weakest answer) and never spends an Action Point.
  passive: { label: 'Passive play', choose: (ev) => ev.choices.find((c) => c.tier === 'ignore') ?? [...ev.choices].sort((a, b) => credit(a) - credit(b))[0], act: () => [] },
};

export function playOnce({ world, project, deck, seed, policy = 'best', difficulty = 'standard' }) {
  const pol = typeof policy === 'string' ? POLICIES[policy] : policy;
  if (!pol) throw new Error(`Unknown policy ${policy}`);
  const g = createGameAt(S, { world, project, deck: pol.situations === false ? { events: [] } : deck, seed, difficulty });
  const rng = makeRng(`${seed}:policy`);
  let guard = 0;
  while (!g.over && guard++ < 80) {
    const ev = S.currentEvent(g);
    if (ev) S.chooseOption(g, pol.choose(ev, rng, g).id);
    for (const move of pol.act(g, rng)) {
      if (g.actionPoints <= 0) break;
      const [id, who] = move.split(':');
      S.takeAction(g, id, who);
    }
    S.advanceWeek(g);
  }
  return g;
}

// n runs with seeds `${seed}:0..n-1`. Returns the on-time share, the finish-week spread and score averages.
export function runOdds({ world, project, deck, runs = 500, seed = 'mc', policy = 'best', difficulty = 'standard' }) {
  let onTime = 0;
  const finish = [];
  const sums = { overall: 0, scope: 0, quality: 0, team: 0, faculty: 0 };
  for (let i = 0; i < runs; i++) {
    const g = playOnce({ world, project, deck, seed: `${seed}:${i}`, policy, difficulty });
    const r = g.result;
    if (r.launchedOnTime) onTime++;
    if (r.finishedWeek) finish.push(r.finishedWeek);
    sums.overall += r.overall;
    for (const k of ['scope', 'quality', 'team', 'faculty']) sums[k] += r.scores[k];
  }
  const avg = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, Math.round(v / runs)]));
  finish.sort((a, b) => a - b);
  return {
    project: project.id, policy: typeof policy === 'string' ? policy : 'custom', difficulty, runs,
    onTime: onTime / runs, finished: finish.length / runs,
    medianFinish: finish.length ? finish[Math.floor(finish.length / 2)] : null,
    avg,
  };
}

// The calibration report: every project under every policy.
export function oddsReport({ world, projects, deck, runs = 500, seed = 'mc', policies = Object.keys(POLICIES), difficulty = 'standard' }) {
  return projects.flatMap((project) => policies.map((policy) => runOdds({ world, project, deck, runs, seed, policy, difficulty })));
}
