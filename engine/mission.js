// Daily Mission: one situation from the deck, chosen for the player's weakest skill track, staged at the
// moment it comes up in a project, then played forward to show what the choice did.
// Design: "Daily Mission" tab of the framework doc. sim.js is unchanged.
import * as S from './sim.js';
import { createGameAt } from './difficulty.js';
import { goodHabits } from './montecarlo.js';
import { makeRng } from './rng.js';
import { TRACKS, TRACK_LABEL, levelOf, tracksOf } from './tracks.js';

export const MASTERED = 0.95;   // best credit at which a situation counts as mastered
export const BONUS_XP = 10;     // target-track bonus for a 0.8+ answer, once a day
export const ODDS_RUNS = 60;    // futures per answer
export const ODDS_MATTER = 0.1; // lead with launch odds when they moved this much
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const clone = (x) => structuredClone(x);

// ---------- tracks ----------

// Lowest level first, then lowest XP, then the fixed track order.
export function weakestTracks(profile) {
  const xp = (t) => profile?.xp?.[t] ?? 0;
  return [...TRACKS].sort((a, b) => levelOf(xp(a)) - levelOf(xp(b)) || xp(a) - xp(b) || TRACKS.indexOf(a) - TRACKS.indexOf(b));
}

// ---------- staging ----------

function triggerMet(state, trig) {
  const [lo, hi] = trig.weeks ?? [1, Infinity];
  if (state.week < lo || state.week > hi) return false;
  const r = trig.requires ?? {};
  const task = (id) => state.tasks.find((t) => t.id === id);
  for (const key of ['taskStarted', 'taskDone', 'taskNotDone']) if (r[key] && !task(r[key])) return false;
  if (r.taskStarted && task(r.taskStarted).startedWeek === null) return false;
  if (r.taskDone && !S.taskComplete(task(r.taskDone))) return false;
  if (r.taskNotDone && S.taskComplete(task(r.taskNotDone))) return false;
  return true;
}

const inProject = (event, project) => !event.projects || event.projects.includes(project.id);

// One steady week: answer any situation with its best choice, keep good habits, end the week.
function steadyWeek(g) {
  const ev = S.currentEvent(g);
  if (ev) S.chooseOption(g, S.bestChoice(ev).id);
  for (const a of goodHabits(g)) if (g.actionPoints > 0) S.takeAction(g, a);
  S.advanceWeek(g);
}

// Play the project as a steady PM (other situations live, answered well) until the mission's situation
// can come up with at least a week left before launch, then pause there with it pending.
// Returns null when the trigger is never reached.
export function stage({ world, project, deck, event, seed, difficulty = 'standard', mode = 'standard' }) {
  if (!inProject(event, project)) return null;
  const rest = { ...deck, events: deck.events.filter((e) => e.id !== event.id) };
  const g = createGameAt(S, { world, project, deck: rest, seed, difficulty, mode });
  let guard = 0;
  while (!g.over && guard++ < 80) {
    const other = S.currentEvent(g);
    if (other) S.chooseOption(g, S.bestChoice(other).id);
    if (g.week <= g.launchWeek - 1 && triggerMet(g, event.trigger ?? {})) {
      g.deck.push(event);
      g.pendingEvent = { id: event.id, week: g.week };
      g.firedEvents.push(event.id);
      g.lastEventWeek = g.week;
      g.mission = { eventId: event.id, projectId: project.id, stagedWeek: g.week };
      return g;
    }
    for (const a of goodHabits(g)) if (g.actionPoints > 0) S.takeAction(g, a);
    S.advanceWeek(g);
  }
  return null;
}

// ---------- picking today's mission ----------

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Today's mission for this player: the same all day (seeded by date and player id).
// ctx = { date: 'YYYY-MM-DD', playerId, world, deck, projects, unlocked?: [projectIds], difficulty?, mode? }
export function pickMission(profile, ctx) {
  const { date, playerId = 'player', world, deck, projects } = ctx;
  const unlocked = projects.filter((p) => !ctx.unlocked || ctx.unlocked.includes(p.id));
  const rng = makeRng(`${playerId}:${date}:mission`);
  const seed = `${playerId}:${date}`;
  const best = profile?.bestCredit ?? {};
  const missions = profile?.missions ?? [];
  const lastPlayed = (id) => missions.filter((m) => m.eventId === id).map((m) => m.date).sort().at(-1) ?? null;
  const recent = (id) => { const d = lastPlayed(id); return d !== null && daysBetween(d, date) < 7; };

  let order = weakestTracks(profile);
  // Rest a learned track: the last two missions hit it and both scored 0.8+.
  const [a, b] = missions.slice(-2);
  const resting = a && b && a.track === b.track && a.credit >= 0.8 && b.credit >= 0.8 ? a.track : null;
  if (resting) order = [...order.filter((t) => t !== resting), resting];

  for (const track of order) {
    for (const tier of ['primary', 'secondary']) {
      const tiebreak = new Map(deck.events.map((e) => [e.id, rng.next()]));
      const cands = deck.events
        .filter((e) => tracksOf(e)[tier] === track && unlocked.some((p) => inProject(e, p)))
        .filter((e) => (tier === 'primary' ? !((best[e.id] ?? 0) >= MASTERED && recent(e.id)) : (best[e.id] ?? 0) < MASTERED))
        .sort((x, y) => Number(x.id in best) - Number(y.id in best) || (best[x.id] ?? 0) - (best[y.id] ?? 0)
          || Number(recent(x.id)) - Number(recent(y.id)) || tiebreak.get(x.id) - tiebreak.get(y.id));
      for (const event of cands) {
        for (const project of rng.shuffle(unlocked.filter((p) => inProject(event, p)))) {
          const staged = stage({ world, project, deck, event, seed: `${seed}:${event.id}`, difficulty: ctx.difficulty, mode: ctx.mode });
          if (!staged) continue;
          const lvl = levelOf(profile?.xp?.[track] ?? 0);
          return {
            date, playerId, track, tier, eventId: event.id, projectId: project.id, seed: `${seed}:${event.id}`,
            stagedWeek: staged.week, difficulty: ctx.difficulty ?? 'standard', mode: ctx.mode ?? 'standard',
            reason: `${TRACK_LABEL[track]} is your ${track === order[0] ? 'lowest' : 'next-weakest'} track (L${lvl})${resting && weakestTracks(profile)[0] === resting ? `; ${TRACK_LABEL[resting]} is resting after two strong missions` : ''}`,
          };
        }
      }
    }
  }
  return null;
}

// Rebuild the staged game for a pick (deterministic from its seed).
export function setupMission(pick, { world, deck, projects }) {
  const project = projects.find((p) => p.id === pick.projectId);
  const event = deck.events.find((e) => e.id === pick.eventId);
  return stage({ world, project, deck, event, seed: pick.seed, difficulty: pick.difficulty, mode: pick.mode });
}

// What the player sees before choosing: where the project stands and the situation itself.
export function missionBriefing(g) {
  const ev = S.currentEvent(g);
  return {
    project: g.project.title, week: g.week, weeksLeft: g.launchWeek - g.week, launchWeek: g.launchWeek,
    schedule: S.scheduleStatus(g),
    morale: Object.fromEntries(S.STAFF.map((r) => [r, Math.round(g.team[r].morale)])),
    trust: Math.round(g.team.faculty.trust),
    phases: S.phaseProgress(g).map((p) => ({ phase: p.phase, pct: p.pct, status: p.status })),
    situation: { id: ev.id, title: S.say(g, ev.title), text: S.say(g, ev.text), who: ev.who ?? null },
    choices: S.choicesInOrder(g, ev).map((c) => ({ id: c.id, label: S.say(g, c.label) })),
  };
}

// ---------- playing forward ----------

const snapshot = (g) => ({
  trust: Math.round(g.team.faculty.trust),
  morale: Math.round(S.STAFF.reduce((s, r) => s + g.team[r].morale, 0) / S.STAFF.length),
  rework: Math.round(g.tasks.reduce((s, t) => s + t.hidden + t.known, 0) * 10) / 10,
});

// Share of `runs` futures from this state that launch on time. Future i is the same for every state.
export function onTimeOdds(state, { runs = ODDS_RUNS, seed = 'future' } = {}) {
  let on = 0;
  for (let i = 0; i < runs; i++) {
    const g = clone(state);
    g.rngState = makeRng(`${seed}:${i}`).state;
    let guard = 0;
    while (!g.over && guard++ < 80) steadyWeek(g);
    if (g.result.launchedOnTime) on++;
  }
  return on / runs;
}

// Resolve the mission: your choice and the best choice on the same random future, three weeks on
// (trust, morale, rework) and to launch (on-time odds over 60 futures). opts as sim.chooseOption
// ({ credit, response, feedback } in hard mode).
export function resolveMission(g, choiceId, opts = {}, { runs = ODDS_RUNS } = {}) {
  const ev = S.currentEvent(g);
  if (!ev || ev.id !== g.mission?.eventId) throw new Error('No mission situation is pending.');
  const bestId = S.bestChoice(ev).id;
  const branch = (id, o) => { const s = clone(g); return { state: s, outcome: S.chooseOption(s, id, o) }; };
  const yours = branch(choiceId, opts);
  const best = branch(bestId, {});
  const after3 = (s) => { const x = clone(s); for (let i = 0; i < 3 && !x.over; i++) steadyWeek(x); return snapshot(x); };
  const seed = `${g.seed}:forward`;
  const odds = { yours: onTimeOdds(yours.state, { runs, seed }), best: choiceId === bestId ? null : onTimeOdds(best.state, { runs, seed }) };
  if (odds.best === null) odds.best = odds.yours;
  const weeks3 = { yours: after3(yours.state), best: after3(best.state) };
  const { primary, secondary } = tracksOf(ev);
  return {
    eventId: ev.id, choiceId, bestId, credit: yours.outcome.credit, tier: yours.outcome.tier,
    outcome: yours.outcome.outcome, why: yours.outcome.why,
    bestLabel: choiceId === bestId ? null : S.say(g, S.bestChoice(ev).label), bestWhy: choiceId === bestId ? null : S.say(g, S.bestChoice(ev).why ?? ''),
    odds, oddsMatter: Math.abs(odds.best - odds.yours) >= ODDS_MATTER, weeks3,
    debrief: { concept: S.say(g, ev.debrief.concept), independent: S.say(g, ev.debrief.independent), escalateWhen: S.say(g, ev.debrief.escalateWhen), sop: ev.debrief.sop ?? null },
    tracks: { primary, secondary },
  };
}

// ---------- XP, history and streak ----------

// Situation XP (20 × credit primary, 8 × credit secondary, hard mode × 1.5), paid only on improvement
// over the best credit so far, plus a 10 XP bonus to the target track for a 0.8+ answer once a day.
export function missionXp(profile, { eventId, track, date, mode = 'standard' }, event, credit) {
  const { primary, secondary } = tracksOf(event);
  const stored = credit * (mode === 'hard' ? 1.5 : 1);
  const gain = Math.max(0, stored - (profile?.bestCredit?.[eventId] ?? 0));
  const xp = {};
  const add = (t, n) => { if (t && n > 0) xp[t] = Math.round(((xp[t] ?? 0) + n) * 10) / 10; };
  add(primary, 20 * gain);
  add(secondary, 8 * gain);
  const bonusToday = (profile?.missions ?? []).some((m) => m.date === date && m.bonus);
  const bonus = credit >= 0.8 && !bonusToday;
  if (bonus) add(track, BONUS_XP);
  return { xp, bonus, best: Math.max(stored, profile?.bestCredit?.[eventId] ?? 0) };
}

// Consecutive days with a mission, ending on `date` (or the day before, if today's isn't done yet).
export function streak(missions, date) {
  const days = new Set((missions ?? []).map((m) => m.date));
  let d = days.has(date) ? date : new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
  let n = 0;
  while (days.has(d)) { n++; d = new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10); }
  return n;
}

// A new profile with the mission recorded. The streak is shown but pays nothing.
export function recordMission(profile, pick, result, event) {
  const p = clone(profile ?? {});
  p.xp ??= {};
  p.bestCredit ??= {};
  p.missions ??= [];
  const gained = missionXp(p, pick, event, result.credit);
  for (const [t, n] of Object.entries(gained.xp)) p.xp[t] = Math.round(((p.xp[t] ?? 0) + n) * 10) / 10;
  p.bestCredit[pick.eventId] = gained.best;
  p.missions.push({ date: pick.date, eventId: pick.eventId, project: pick.projectId, track: pick.track, credit: result.credit, bonus: gained.bonus });
  p.missionStreak = streak(p.missions, pick.date);
  return { profile: p, gained };
}
