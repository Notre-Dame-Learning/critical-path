// Monte Carlo odds: play a project many times under a fixed policy and report how often it launches
// on time, with the scorecard averages. Used by `npm run odds` and by tests that guard the calibration.
// Runs use weekly moves v2 (engine/moves.js): a policy picks the meeting focus and spends Action Points.
import * as S from './sim.js';
import * as M from './moves.js';
import { createGameAt } from './difficulty.js';
import { makeRng } from './rng.js';

const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const rem = (t) => Math.max(0, t.effort - t.done) + t.known;
const openHours = (g, r) => g.tasks.filter((t) => t.owner === r && !S.taskComplete(t)).reduce((s, t) => s + rem(t), 0);

// v1's fixed rotation, kept for old policies and tests: legacy move ids run through moves.applyLegacy.
export function goodHabits(state) {
  return state.week % 3 === 0 ? ['qa-review', 'faculty-update'] : ['checkin', 'working-session'];
}

// Good play in v2: read the board. The meeting goes where the faculty partner's work is; moves answer the
// week's symptoms (a risk coming, behind pace, someone stretched or fixing problems, unreviewed work, news).
export function readTheBoard(g) {
  const offered = M.meetingOptions(g).map((o) => o.id);
  const recentWorkload = g.v2?.lastWorkload != null && g.week - g.v2.lastWorkload < 4;
  M.setMeetingFocus(g, ['sign-offs', 'work-session', 'show-finished', 'preview', 'workload', 'keep-short'].find((x) => offered.includes(x) && !(x === 'workload' && recentWorkload)) ?? offered[0]);
  const next = () => {
    const mv = M.moveOptions(g).filter((o) => o.affordable);
    const has = (id) => mv.some((o) => o.id === id);
    const st = S.scheduleStatus(g);
    const risk = mv.find((o) => o.kind === 'risk');
    if (risk) return risk.id;
    const backup = mv.find((o) => o.id.startsWith('backup:'));
    if (st.variance <= -1.5 && backup) return backup.id;
    if (st.variance <= -0.25) {
      const r = [...S.STAFF].sort((a, b) => openHours(g, b) - openHours(g, a))[0];
      const lastWeek = g.actionsTaken.some((a) => a.actionId === 'overtime' && a.who === r && a.week === g.week - 1);
      if (!g.weekFlags[`overtime-${r}`] && !lastWeek && g.team[r].morale > 50 && has(`overtime:${r}`)) return `overtime:${r}`;
    }
    for (const r of S.STAFF) {
      const known = g.tasks.filter((t) => t.owner === r).reduce((s, t) => s + t.known, 0);
      const last = g.v2?.lastCheckin?.[r];
      if ((g.team[r].morale < 60 || known >= 2 || last === undefined || g.week - last >= 4) && (last === undefined || g.week - last >= 2) && has(`checkin:${r}`)) return `checkin:${r}`;
    }
    const since = g.tasks.reduce((s, t) => s + Math.max(0, t.done - (g.v2?.workAtReview?.[t.id] ?? 0)), 0);
    if (since >= 15 && has('review')) return 'review';
    if ((!g.v2?.lastUpdate || g.week - g.v2.lastUpdate.week >= 2) && has('status-update')) return 'status-update';
    return null;
  };
  for (let i = 0; i < 4 && g.actionPoints > 0; i++) {
    const id = next();
    if (!id) break;
    M.takeMove(g, id);
  }
}

// The same meeting focus and moves every week, whatever is happening.
export function fixedPattern(meeting, moves) {
  return (g) => {
    const offered = M.meetingOptions(g).map((o) => o.id);
    M.setMeetingFocus(g, offered.includes(meeting) ? meeting : offered.includes('workload') ? 'workload' : offered[0]);
    for (const id of moves) if (M.moveOptions(g).some((o) => o.id === id && o.affordable)) M.takeMove(g, id);
  };
}

function randomWeek(g, rng) {
  const opts = M.meetingOptions(g);
  M.setMeetingFocus(g, opts[Math.floor(rng.next() * opts.length)].id);
  for (let i = 0; i < 3 && g.actionPoints > 0; i++) {
    const mv = M.moveOptions(g).filter((o) => o.affordable);
    if (!mv.length) break;
    M.takeMove(g, mv[Math.floor(rng.next() * mv.length)].id);
  }
}

const bestAnswer = (ev) => [...ev.choices].sort((a, b) => credit(b) - credit(a))[0];

// A policy answers situations and plays the week. rng is seeded per run. act may also return a list of
// v1 move ids (older policies), which run through moves.applyLegacy.
export const POLICIES = {
  // Best answer to every situation, and the week played by reading the board.
  best: { label: 'Best play', choose: bestAnswer, act: readTheBoard },
  // The same, with no situations at all: what the plan alone allows.
  plan: { label: 'Plan only (no situations)', situations: false, choose: null, act: readTheBoard },
  // Best answers, but the same meeting focus and moves every week.
  fixed: { label: 'Fixed weekly pattern', choose: bestAnswer, act: fixedPattern('work-session', ['checkin:ld', 'review']) },
  // Random answers, a random meeting focus and random moves: a player clicking through.
  random: { label: 'Random play', choose: (ev, rng) => ev.choices[Math.floor(rng.next() * ev.choices.length)], act: randomWeek },
  // Waits out every situation (or takes the weakest answer) and makes no moves; the routine still runs.
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
    const legacy = pol.act(g, rng);
    if (Array.isArray(legacy)) for (const move of legacy) { if (g.actionPoints <= 0) break; M.applyLegacy(g, move); }
    M.endWeek(g);
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
