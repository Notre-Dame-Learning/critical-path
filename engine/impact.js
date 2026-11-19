// What mattered in a finished run: replay it from its record, test each situation answered the other
// way plus two habits, and rank the moves by how much they changed the outcome. Design: "Debrief game
// master" tab of the framework doc. sim.js is unchanged.
import * as S from './sim.js';
import { createGameAt } from './difficulty.js';

export const FUTURES = 30;
export const MIN_POINTS = 0.5;
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const PARTS = { scope: 'course complete', quality: 'quality', team: 'team morale', faculty: 'faculty trust', judgment: 'judgment' };

// ---------- record and replay ----------

// Everything needed to replay a run exactly: seed, answers (with hard-mode credit and conversation
// adjustments) and the weekly moves in order.
export function recordOf(state) {
  return {
    seed: state.seed, project: state.projectRef ?? state.project.id, mode: state.mode, difficulty: state.difficulty ?? 'standard',
    startWeek: state.startWeek,
    decisions: state.decisions.map((d) => {
      const talk = state.conversations?.find((c) => c.week === d.week && c.eventId === d.eventId);
      return {
        week: d.week, eventId: d.eventId, choiceId: d.choiceId, credit: d.credit,
        ...(talk ? { talk: { meter: talk.meter, who: talk.talkTo, meterAfter: talk.meterAfter, slipHours: talk.slipHours ?? 0, task: talk.commitTask } } : {}),
      };
    }),
    actions: state.actionsTaken.map((a) => ({ week: a.week, actionId: a.actionId, ...(a.who ? { who: a.who } : {}) })),
  };
}

// How the player answers a situation the record doesn't have (a replay on other luck brings up other
// situations): their own answer if they met it in another week, else the option whose credit is closest
// to their average judgment.
function styleChoice(record, event) {
  const seen = record.decisions.find((d) => d.eventId === event.id);
  if (seen && event.choices.some((c) => c.id === seen.choiceId)) return seen.choiceId;
  const avg = record.decisions.length ? record.decisions.reduce((s, d) => s + d.credit, 0) / record.decisions.length : 0.6;
  return event.choices.reduce((a, c) => (Math.abs(credit(c) - avg) < Math.abs(credit(a) - avg) ? c : a)).id;
}

// Replay a record. opts:
//   seed       other luck (default: the record's own)
//   choose     { [eventId]: choiceId } answers to change
//   actions    (week, moves) => moves, to change the weekly moves
//   untilWeek  stop at the start of that week, with its situation waiting (the replay offer)
export function replay({ world, project, deck }, record, { seed = record.seed, choose = {}, actions = null, untilWeek = null } = {}) {
  const g = createGameAt(S, { world, project, deck, seed, mode: record.mode, difficulty: record.difficulty });
  g.projectRef = project.id;
  let guard = 0;
  while (!g.over && guard++ < 80) {
    if (untilWeek !== null && g.week >= untilWeek) return g;
    const ev = S.currentEvent(g);
    if (ev) {
      const rec = record.decisions.find((d) => d.week === g.week && d.eventId === ev.id);
      const changed = choose[ev.id];
      const choiceId = changed ?? (rec ? rec.choiceId : styleChoice(record, ev));
      const exact = rec && !changed && seed === record.seed;
      S.chooseOption(g, choiceId, exact && rec.credit !== credit(ev.choices.find((c) => c.id === choiceId)) ? { credit: rec.credit } : {});
      if (exact && rec.talk) {
        if (rec.talk.meter === 'trust') g.team.faculty.trust = rec.talk.meterAfter;
        if (rec.talk.meter === 'morale') g.team[rec.talk.who].morale = rec.talk.meterAfter;
        if (rec.talk.slipHours) g.tasks.find((t) => t.id === rec.talk.task).effort += rec.talk.slipHours;
      }
    }
    let moves = record.actions.filter((a) => a.week === g.week);
    if (actions) moves = actions(g.week, moves);
    for (const m of moves) {
      if (g.actionPoints <= 0) break;
      S.takeAction(g, m.actionId, m.who);
    }
    S.advanceWeek(g);
  }
  return g;
}

export function replaysExactly(ctx, state) {
  const g = replay(ctx, recordOf(state));
  return JSON.stringify(g.result) === JSON.stringify(state.result) && g.decisions.length === state.decisions.length;
}

// ---------- candidate changes ----------

export function candidates(state) {
  const out = [];
  for (const d of state.decisions) {
    const ev = state.deck.find((e) => e.id === d.eventId);
    const sorted = [...ev.choices].sort((a, b) => credit(b) - credit(a));
    const best = sorted[0];
    const weakest = sorted.at(-1);
    const isBest = d.choiceId === best.id;
    const alt = isBest ? weakest : best;
    out.push({
      ref: `situation:${ev.id}`, kind: isBest ? 'kept' : 'missed', week: d.week, eventId: ev.id,
      title: S.say(state, ev.title), who: ev.who ?? null,
      playerDid: S.say(state, ev.choices.find((c) => c.id === d.choiceId).label), alternative: S.say(state, alt.label),
      choose: { [ev.id]: alt.id }, debrief: ev.debrief,
    });
  }
  const overtime = state.actionsTaken.filter((a) => a.actionId === 'overtime').length;
  if (overtime >= 2) {
    out.push({ ref: 'habit:no-overtime', kind: 'habit', title: 'Overtime', playerDid: `Asked for extra hours ${overtime} times`, alternative: 'A team check-in instead of each overtime ask',
      actions: (week, moves) => moves.map((m) => (m.actionId === 'overtime' ? { week, actionId: 'checkin' } : m)), concept: 'Sustainable pace' });
  }
  const weeks = state.log.length;
  const checks = state.actionsTaken.filter((a) => a.actionId === 'checkin' || a.actionId === 'qa-review').length;
  if (checks < weeks / 4) {
    const start = state.startWeek;
    out.push({ ref: 'habit:reviews', kind: 'habit', title: 'Internal reviews', playerDid: `${checks} check-ins or reviews in ${weeks} weeks`, alternative: 'An internal review every third week',
      actions: (week, moves) => {
        if ((week - start) % 3 !== 2) return moves;
        return moves.length ? [...moves.slice(0, -1), { week, actionId: 'qa-review' }] : [{ week, actionId: 'qa-review' }];
      }, concept: 'The rework cycle' });
  }
  return out;
}

// ---------- the report ----------

const meanScores = (games) => {
  const sum = { overall: 0, scope: 0, quality: 0, team: 0, faculty: 0, judgment: 0 };
  let on = 0;
  for (const g of games) {
    sum.overall += g.result.overall;
    for (const k of Object.keys(PARTS)) sum[k] += g.result.scores[k] ?? 0;
    if (g.result.launchedOnTime) on++;
  }
  const n = games.length || 1;
  return { ...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / n])), onTime: on / n };
};

// Rank the candidate moves by their effect on the overall score across many futures. For a kept move the
// points are what the player's call was worth (as played minus the weakest answer); for missed and habit
// moves, what the alternative would add. Top 3 with at least half a point; the biggest positive missed
// chance is the replay offer.
export function impactReport(ctx, state, { futures = FUTURES } = {}) {
  const record = recordOf(state);
  const exact = replaysExactly(ctx, state);
  const seeds = Array.from({ length: futures }, (_, i) => `${state.seed}:f${i}`);
  const asPlayed = meanScores(seeds.map((seed) => replay(ctx, record, { seed })));
  const scored = candidates(state).map((c) => {
    const alt = meanScores(seeds.map((seed) => replay(ctx, record, { seed, choose: c.choose, actions: c.actions })));
    const sign = c.kind === 'kept' ? -1 : 1;
    const delta = (k) => sign * (alt[k] - asPlayed[k]);
    // The scorecard part that moved most. Judgment is left out: it is the answer's own credit, not an effect.
    const part = ['scope', 'quality', 'team', 'faculty'].reduce((a, k) => (Math.abs(delta(k)) > Math.abs(delta(a)) ? k : a), 'scope');
    // Same future: the player's own seed with only this change, when the later situations still match.
    const same = replay(ctx, record, { choose: c.choose, actions: c.actions });
    const after = (g) => g.decisions.filter((d) => d.week > (c.week ?? 0)).map((d) => d.eventId);
    const a = after(same), b = after(state);
    const reshuffled = a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length;
    return {
      ...c,
      points: round(delta('overall'), 1),
      onTimeNow: Math.round(asPlayed.onTime * 100),
      onTimeAlt: Math.round(alt.onTime * 100),
      partMoved: PARTS[part], partPoints: round(delta(part), 1),
      sameFuture: reshuffled <= 2 ? { overall: same.result.overall, onTime: same.result.launchedOnTime, finishedWeek: same.result.finishedWeek } : null,
    };
  });
  const ranked = [...scored].sort((x, y) => y.points - x.points);
  const moves = ranked.filter((m) => m.points >= MIN_POINTS).slice(0, 3).map((m, i) => ({ ...m, rank: i + 1 }));
  const offer = ranked.find((m) => m.kind === 'missed' && m.points >= MIN_POINTS) ?? null;
  return { exact, futures, asPlayed: { overall: round(asPlayed.overall, 1), onTime: Math.round(asPlayed.onTime * 100) }, moves, all: scored, replayOffer: offer, record };
}

function round(x, d = 0) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
