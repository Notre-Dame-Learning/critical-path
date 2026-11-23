// Progression: XP on 8 skill tracks, track levels, the career ladder and achievements.
// Rules: "Progression" tab of the framework doc. Reads the finished game state only; sim.js is unchanged.
import * as S from './sim.js';
import { TRACKS, TRACK_LABEL, LEVELS, levelOf, tracksOf } from './tracks.js';
import { cleanPlayer } from './player.js';

export { TRACKS, TRACK_LABEL, LEVELS, levelOf };

// Habit XP by logged move. v1 ids (older runs) and weekly moves v2 ids; a meeting counts only when the
// player picked a focus (not the default status meeting).
export const HABIT_TRACK = {
  checkin: 'leadership', 'faculty-update': 'communication', 'qa-review': 'risk', 'working-session': 'stakeholders',
  meeting: 'stakeholders', 'status-update': 'communication', 'team-meeting': 'leadership',
};
export const PREVENT_XP = 8; // a situation headed off (weekly moves v2): XP on its primary track
const habitCount = (state, action) => state.actionsTaken.filter((a) => a.actionId === action && !(action === 'meeting' && a.focus === 'status')).length;
export const HABIT_CAP = 8; // XP per action per run

const PROJECT = {
  intro: 'intro-psych-online', documentary: 'ai-ethics-documentary', rescue: 'rescue-sustainable-business',
  a11y: 'a11y-sprint-ochem', ai: 'teaching-ai-microcourse', stats: 'stats-refresh-sprint', globalHealth: 'global-health-cases',
};
const onTimeIn = (profile, project, grade = null) => (profile.runs ?? []).some((r) => r.project === project && r.onTime && (!grade || 'AB'.includes(r.grade)));
const tracksAt = (profile, level) => TRACKS.filter((t) => levelOf(profile.xp?.[t] ?? 0) >= level).length;

// The career ladder: a rank needs its total XP and its gate. Unlocks apply only when locks are on.
export const RANKS = [
  { id: 'coordinator', label: 'Project Coordinator', xp: 0, gate: null, gateMet: () => true,
    unlocks: { projects: [PROJECT.intro, PROJECT.a11y, PROJECT.ai], modes: ['standard'], plan: [] } },
  { id: 'pm', label: 'Project Manager', xp: 200, gate: 'Launch Intro to Psychology on time with a B or better', gateMet: (p) => onTimeIn(p, PROJECT.intro, 'B'),
    unlocks: { projects: [PROJECT.documentary, PROJECT.stats, PROJECT.globalHealth], modes: [], plan: ['build'] } },
  { id: 'senior', label: 'Senior PM', xp: 600, gate: 'Launch the AI Ethics documentary on time; six of eight tracks at L2+', gateMet: (p) => onTimeIn(p, PROJECT.documentary) && tracksAt(p, 2) >= 6,
    unlocks: { projects: [PROJECT.rescue], modes: ['hard'], plan: ['critique'] } },
  { id: 'program', label: 'Program Manager', xp: 1200, gate: 'Launch the Rescue on time; pass a Critique round at Senior difficulty', gateMet: (p) => onTimeIn(p, PROJECT.rescue) && Boolean(p.critiquePassedAtSenior),
    unlocks: { projects: [], modes: [], plan: [] } },
  { id: 'director', label: 'Portfolio Director', xp: 2500, gate: 'Portfolio mode (not built yet)', gateMet: () => false,
    unlocks: { projects: [], modes: [], plan: [] } },
];

export const totalXp = (profile) => Math.round(TRACKS.reduce((s, t) => s + (profile?.xp?.[t] ?? 0), 0));

// The highest rank whose XP and gate are both met, climbing in order.
export function rankOf(profile) {
  let rank = RANKS[0];
  for (const r of RANKS.slice(1)) {
    if (totalXp(profile) >= r.xp && r.gateMet(profile ?? {})) rank = r;
    else break;
  }
  return rank;
}

export function nextRank(profile) {
  const i = RANKS.indexOf(rankOf(profile));
  const r = RANKS[i + 1];
  if (!r) return null;
  return { ...r, xpMet: totalXp(profile) >= r.xp, gateMet: r.gateMet(profile ?? {}) };
}

// What's open at a rank (cumulative). Ranks are recognition only unless locks are on.
export function unlocked(profile, { locks = false } = {}) {
  if (!locks) return { projects: Object.values(PROJECT), modes: ['standard', 'hard'], plan: ['build', 'critique'] };
  const upTo = RANKS.slice(0, RANKS.indexOf(rankOf(profile)) + 1);
  return { projects: upTo.flatMap((r) => r.unlocks.projects), modes: upTo.flatMap((r) => r.unlocks.modes), plan: upTo.flatMap((r) => r.unlocks.plan) };
}

// ---------- XP ----------

// Situation XP at a credit: 20 × credit on the primary track, 8 × credit on the secondary, hard mode × 1.5.
export function situationXp(event, credit, mode = 'standard') {
  const { primary, secondary } = tracksOf(event);
  const k = credit * (mode === 'hard' ? 1.5 : 1);
  const xp = {};
  if (primary) xp[primary] = round(20 * k);
  if (secondary) xp[secondary] = round(8 * k);
  return xp;
}

// XP from a finished run before situation improvements: scorecard and habits, plus each situation's best
// credit this run (stored × 1.5 in hard mode). applyRun pays situations only on improvement.
export function runXp(state) {
  const r = state.result;
  const s = r.scores;
  const xp = Object.fromEntries(TRACKS.map((t) => [t, 0]));
  xp.planning += s.scope / 10 + (r.launchedOnTime ? 10 : 0);
  xp.risk += s.quality / 10;
  xp.capacity += s.team / 10;
  xp.stakeholders += s.faculty / 10;
  for (const [action, track] of Object.entries(HABIT_TRACK)) xp[track] += Math.min(HABIT_CAP, habitCount(state, action));
  for (const id of state.v2?.prevented ?? []) {
    const ev = state.deck.find((e) => e.id === id);
    const { primary } = ev ? tracksOf(ev) : {};
    if (primary) xp[primary] += PREVENT_XP;
  }
  const best = {};
  for (const d of state.decisions) best[d.eventId] = Math.max(best[d.eventId] ?? 0, d.credit * (state.mode === 'hard' ? 1.5 : 1));
  for (const t of TRACKS) xp[t] = round(xp[t]);
  return { xp, situations: best };
}

// ---------- achievements ----------

const RIGHTS = ['release-form', 'ip-agreement', 'copyright-snag', 'stock-image-license'];
const SCOPE = ['script-too-long', 'interactive-request', 'last-minute-change'];
const event = (state, id) => state.deck.find((e) => e.id === id);
const isBest = (state, d) => S.bestChoice(event(state, d.eventId)).id === d.choiceId;
const count = (state, id) => state.actionsTaken.filter((a) => a.actionId === id).length;

export const ACHIEVEMENTS = [
  { id: 'bad-news-early', label: 'Bad News Early', why: 'Escalated with a recommendation where that was the best answer, 3+ weeks before launch',
    earned: (g) => g.decisions.some((d) => d.tier === 'escalate_plan' && isBest(g, d) && g.launchWeek - d.week >= 3) },
  { id: 'no-heroes', label: 'No Heroes', why: 'Launched on time with no overtime asks', earned: (g) => g.result.launchedOnTime && count(g, 'overtime') === 0 },
  { id: 'scope-surgeon', label: 'Scope Surgeon', why: 'Full credit on a scope request and launched on time',
    earned: (g) => g.result.launchedOnTime && g.decisions.some((d) => SCOPE.includes(d.eventId) && d.credit >= 0.95) },
  { id: 'clean-launch', label: 'Clean Launch', why: 'Finished a week early with quality 95+',
    earned: (g) => g.result.finishedWeek !== null && g.result.finishedWeek <= g.launchWeek - 1 && g.result.scores.quality >= 95 },
  { id: 'trusted-partner', label: 'Trusted Partner', why: 'Faculty trust 90+ at launch', earned: (g) => g.result.scores.faculty >= 90 },
  { id: 'steady-team', label: 'Steady Team', why: 'Team health 80+ at launch', earned: (g) => g.result.scores.team >= 80 },
  { id: 'paper-trail', label: 'Paper Trail', why: 'Full credit on every rights situation, at least two',
    earned: (g) => { const r = g.decisions.filter((d) => RIGHTS.includes(d.eventId)); return r.length >= 2 && r.every((d) => d.credit >= 0.95); } },
  { id: 'own-it', label: 'Own It', why: 'Five or more situations, every one resolved yourself (or escalated where that was best), judgment 90+',
    earned: (g) => g.decisions.length >= 5 && g.decisions.every((d) => d.tier === 'resolve' || (d.tier === 'escalate_plan' && isBest(g, d))) && (g.result.scores.judgment ?? 0) >= 90 },
  { id: 'early-warning', label: 'Early Warning', why: 'Headed off three or more situations before they came up',
    earned: (g) => (g.v2?.prevented?.length ?? 0) >= 3 },
  { id: 'rescuer', label: 'Rescuer', why: 'Launched the Rescue on time', earned: (g) => g.result.launchedOnTime && (g.projectRef ?? g.project.id) === PROJECT.rescue },
  { id: 'brooks-was-right', label: 'Brooks Was Right', why: 'Missed launch after asking for overtime 4+ times', earned: (g) => !g.result.launchedOnTime && count(g, 'overtime') >= 4 },
];

export const achievementsOf = (state) => ACHIEVEMENTS.filter((a) => a.earned(state)).map((a) => a.id);

// ---------- applying a run ----------

export function newProfile() {
  return { version: 1, xp: Object.fromEntries(TRACKS.map((t) => [t, 0])), bestCredit: {}, achievements: [], critiquePassedAtSenior: false, runs: [], missions: [], missionStreak: 0, planBest: {}, planRounds: [] };
}

// Add a finished run to the profile. Returns the new profile and what changed; a run already counted
// (same runId) changes nothing.
export function applyRun(profile, state) {
  if (!state.over || !state.result) throw new Error('The run is not finished.');
  const before = profile ?? newProfile();
  const id = state.runId ?? `${state.seed}:${state.projectRef ?? state.project.id}:${state.mode}:${state.difficulty ?? 'standard'}`;
  if ((before.runs ?? []).some((r) => r.id === id)) return { profile: before, gained: {}, total: 0, newBadges: [], promotion: null, levelUps: [], duplicate: true };
  const p = structuredClone({ ...newProfile(), ...before });
  const { xp, situations } = runXp(state);
  const gained = { ...xp };
  for (const [eventId, stored] of Object.entries(situations)) {
    const prev = p.bestCredit[eventId] ?? 0;
    if (stored <= prev) continue;
    const ev = event(state, eventId);
    const { primary, secondary } = tracksOf(ev);
    const gain = stored - prev;
    if (primary) gained[primary] = round((gained[primary] ?? 0) + 20 * gain);
    if (secondary) gained[secondary] = round((gained[secondary] ?? 0) + 8 * gain);
    p.bestCredit[eventId] = round(stored, 2);
  }
  const rankBefore = rankOf(p);
  const levelsBefore = Object.fromEntries(TRACKS.map((t) => [t, levelOf(p.xp[t] ?? 0)]));
  for (const t of TRACKS) p.xp[t] = round((p.xp[t] ?? 0) + (gained[t] ?? 0));
  const badges = achievementsOf(state);
  const newBadges = badges.filter((b) => !p.achievements.includes(b));
  p.achievements.push(...newBadges);
  const total = round(TRACKS.reduce((s, t) => s + (gained[t] ?? 0), 0));
  p.runs.push({ id, project: state.projectRef ?? state.project.id, mode: state.mode, difficulty: state.difficulty ?? 'standard', onTime: state.result.launchedOnTime, grade: state.result.grade, xp: total, badges, week: state.result.finishedWeek });
  const rankAfter = rankOf(p);
  return {
    profile: p, gained, total, newBadges,
    promotion: rankAfter !== rankBefore ? rankAfter.label : null,
    levelUps: TRACKS.filter((t) => levelOf(p.xp[t]) > levelsBefore[t]).map((t) => ({ track: t, level: levelOf(p.xp[t]) })),
    duplicate: false,
  };
}

// ---------- Build the Plan rounds ----------

// "Round score ÷ 10, split by check" (Progression tab): each part of the 100-point score goes to the track
// its check teaches. On-time odds is half Planning, half Estimating; each check that passes its 5 points to
// its flaw's track; team load to Capacity; the stakeholder plan to Stakeholders.
export const CHECK_TRACK = {
  links: 'planning', buffer: 'estimating', quality: 'planning', load: 'capacity',
  backup: 'leadership', risks: 'risk', sequence: 'planning', stakeholders: 'stakeholders',
};
// Until the player plans the touchpoint calendar, a stand-in calendar fills it (app/plan-submit.js), and the
// parts it decides earn no XP.
export const CALENDAR_CHECKS = ['quality', 'stakeholders'];

export function planXp(score, { standIn = false } = {}) {
  const pts = Object.fromEntries(TRACKS.map((t) => [t, 0]));
  pts.planning += score.parts.odds / 2;
  pts.estimating += score.parts.odds / 2;
  for (const c of score.checks) {
    if (c.status === 'fail' || (standIn && CALENDAR_CHECKS.includes(c.id))) continue;
    pts[CHECK_TRACK[c.id]] += 5;
  }
  pts.capacity += score.parts.load;
  if (!standIn) pts.stakeholders += score.parts.stakeholders;
  return Object.fromEntries(TRACKS.map((t) => [t, round(pts[t] / 10)]));
}

// Add a submitted plan to the profile. XP counts only what beats this project's best plan so far on each
// track, so resubmitting the same plan earns nothing. Plan rounds sit apart from runs: rank gates read runs.
export function applyPlanRound(profile, { project, score, standIn = false, at = null }) {
  const p = structuredClone({ ...newProfile(), ...(profile ?? {}) });
  p.planBest ??= {};
  p.planRounds ??= [];
  const xp = planXp(score, { standIn });
  const best = (p.planBest[project] ??= {});
  const gained = {};
  for (const t of TRACKS) {
    const gain = round(Math.max(0, xp[t] - (best[t] ?? 0)));
    if (gain > 0) { gained[t] = gain; best[t] = xp[t]; }
  }
  const rankBefore = rankOf(p);
  const levelsBefore = Object.fromEntries(TRACKS.map((t) => [t, levelOf(p.xp[t] ?? 0)]));
  for (const [t, g] of Object.entries(gained)) p.xp[t] = round((p.xp[t] ?? 0) + g);
  const total = round(Object.values(gained).reduce((s, g) => s + g, 0));
  p.planRounds.push({ project, mode: 'build', total: score.total, odds: round(score.odds.player, 3), standIn, xp: total, at });
  const rankAfter = rankOf(p);
  return {
    profile: p, xp, gained, total,
    promotion: rankAfter !== rankBefore ? rankAfter.label : null,
    levelUps: TRACKS.filter((t) => levelOf(p.xp[t]) > levelsBefore[t]).map((t) => ({ track: t, level: levelOf(p.xp[t]) })),
  };
}

// ---------- Critique the Plan ----------

// "Round score ÷ 10, split by check" for a Critique round: the score's XP goes to the skill tracks of the
// flaws, in proportion to the points each found flaw earned (found, severity, fix). Missed flaws earn
// nothing, so a review that finds nothing earns no XP, whatever the verdict.
const TRACK_ID = Object.fromEntries(Object.entries(TRACK_LABEL).map(([id, label]) => [label, id]));
export const CRITIQUE_PASS = 70; // a "passed" round (the Program Manager gate asks for one at Senior PM)

export function critiqueXp(result) {
  const pts = Object.fromEntries(TRACKS.map((t) => [t, 0]));
  const earned = result.flaws.reduce((s, f) => s + f.total, 0);
  if (earned <= 0) return pts;
  for (const f of result.flaws) {
    const t = TRACK_ID[f.skill_track] ?? String(f.skill_track ?? '').toLowerCase();
    if (t in pts) pts[t] += (result.score / 10) * (f.total / earned);
  }
  return Object.fromEntries(TRACKS.map((t) => [t, round(pts[t])]));
}

// Add a finished Critique round to the profile. As with plans, XP counts only what beats your best on the
// same round, and rounds sit apart from runs. A Senior PM round at CRITIQUE_PASS or better sets
// critiquePassedAtSenior, the Program Manager gate.
export function applyCritiqueRound(profile, { round: r, result, at = null }) {
  const p = structuredClone({ ...newProfile(), ...(profile ?? {}) });
  p.planBest ??= {};
  p.planRounds ??= [];
  const xp = critiqueXp(result);
  const best = (p.planBest[`critique:${r.id}`] ??= {});
  const gained = {};
  for (const t of TRACKS) {
    const gain = round(Math.max(0, xp[t] - (best[t] ?? 0)));
    if (gain > 0) { gained[t] = gain; best[t] = xp[t]; }
  }
  const rankBefore = rankOf(p);
  const levelsBefore = Object.fromEntries(TRACKS.map((t) => [t, levelOf(p.xp[t] ?? 0)]));
  for (const [t, g] of Object.entries(gained)) p.xp[t] = round((p.xp[t] ?? 0) + g);
  const passedSenior = /senior/i.test(r.rank ?? '') && result.score >= CRITIQUE_PASS;
  if (passedSenior) p.critiquePassedAtSenior = true;
  const total = round(Object.values(gained).reduce((s, g) => s + g, 0));
  p.planRounds.push({ project: r.project, mode: 'critique', round: r.id, total: result.score, found: result.flaws.filter((f) => f.found).length, of: result.flaws.length, xp: total, at });
  const rankAfter = rankOf(p);
  return {
    profile: p, xp, gained, total, passedSenior,
    promotion: rankAfter !== rankBefore ? rankAfter.label : null,
    levelUps: TRACKS.filter((t) => levelOf(p.xp[t]) > levelsBefore[t]).map((t) => ({ track: t, level: levelOf(p.xp[t]) })),
  };
}

// ---------- export code ----------

const toBase64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))));
const fromBase64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : decodeURIComponent(escape(atob(s))));

export function exportCode(profile) {
  return `CP1.${toBase64(JSON.stringify(profile))}`;
}

// A profile from a pasted code, or null if it isn't one.
export function importCode(code) {
  try {
    const m = /^CP1\.([A-Za-z0-9+/=\s]+)$/.exec(String(code ?? '').trim());
    if (!m) return null;
    const p = JSON.parse(fromBase64(m[1].replace(/\s/g, '')));
    if (p?.version !== 1 || typeof p.xp !== 'object' || !Array.isArray(p.runs)) return null;
    const clean = newProfile();
    for (const t of TRACKS) clean.xp[t] = Math.max(0, Number(p.xp[t]) || 0);
    for (const [k, v] of Object.entries(p.bestCredit ?? {})) if (Number.isFinite(v)) clean.bestCredit[k] = Math.min(1.5, Math.max(0, v));
    clean.achievements = (p.achievements ?? []).filter((a) => ACHIEVEMENTS.some((x) => x.id === a));
    clean.critiquePassedAtSenior = p.critiquePassedAtSenior === true;
    clean.runs = p.runs.filter((r) => r && typeof r.project === 'string').slice(-200);
    clean.missions = Array.isArray(p.missions) ? p.missions.slice(-400) : [];
    clean.missionStreak = Number(p.missionStreak) || 0;
    for (const [proj, best] of Object.entries(p.planBest ?? {})) {
      if (typeof best !== 'object' || !best) continue;
      clean.planBest[proj] = Object.fromEntries(TRACKS.filter((t) => Number.isFinite(best[t])).map((t) => [t, Math.min(10, Math.max(0, best[t]))]));
    }
    clean.planRounds = Array.isArray(p.planRounds) ? p.planRounds.filter((r) => r && typeof r.project === 'string').slice(-200) : [];
    const player = cleanPlayer(p.player);
    if (player) clean.player = player;
    return clean;
  } catch { return null; }
}

function round(x, d = 1) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
