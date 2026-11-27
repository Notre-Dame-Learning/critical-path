// Spot the flaw: the Daily Mission kind for Planning, Risk and Capacity. One flaw from the Plan-flaw
// library is planted on a project's clean Build the Plan baseline; the player reviews the plan, flags the
// problem and names the fix. Scored with Critique scoring (engine/critique.js) without the verdict: found 10,
// severity 3, fix 7, flags on things that were fine -3 each (at most -9), out of 20.
// Then the plan as written and the plan with the fix are played forward on the same seeds.
// Design: "Daily Mission" tab of the framework doc (Spot the flaw). sim.js and plan.js are unchanged.
import * as C from './critique.js';
import { rankOf } from './progression.js';
import { makeRng } from './rng.js';
import { TRACK_LABEL, levelOf, tracksOf } from './tracks.js';

export const SPOT_TRACKS = ['planning', 'risk', 'capacity'];
export const FORWARD = { runs: 200, slice: 25, seed: 'spot' }; // per plan; the Critique screen plays 500
export const MAX = 20;
export const MATTERS = 0.05; // an on-time gap of 5+ points, or 10+ rework hours, shows in play

// Flaw ranks (content/flaws min_rank) against the career ladder: a flaw is offered at its rank and above.
const FLAW_RANK = { Coordinator: 0, PM: 1, 'Senior PM': 2 };
const PLAYER_RANK = { coordinator: 0, pm: 1, senior: 2, program: 2, director: 2 };

export const flawTrack = (flaw) => tracksOf({ id: `flaw:${flaw.id}`, track: flaw.skill_track }).primary;
const asList = (flaws) => (Array.isArray(flaws) ? flaws : Object.values(flaws ?? {}));
const spotId = (projectId, flawId) => `spot:${projectId}:${flawId}`;
export const isSpot = (pick) => pick?.kind === 'spot';
// The pseudo-event a spot records XP against: all of it goes to the flaw's own track.
export const spotEvent = (pick) => ({ id: pick.eventId, track: pick.track, track2: null });

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Every (project, flaw) pair a player could be given for `track`: the flaw feeds the track, is at or below
// the player's rank, applies to the project, and the project has a baseline to plant it on.
export function spotCandidates(profile, { track, flaws, projects, plans }) {
  const rank = PLAYER_RANK[rankOf(profile ?? {}).id] ?? 0;
  return projects.flatMap((p) => asList(flaws)
    .filter((f) => flawTrack(f) === track && (FLAW_RANK[f.min_rank] ?? 0) <= rank && C.flawApplies(f, p) && plans?.[p.id])
    .map((f) => ({ project: p, flaw: f, id: spotId(p.id, f.id) })));
}

// Today's spot for `track`: never-spotted first, then the lowest best score; a pair spotted in the last 7
// days rests. Returns the pick fields, or null when nothing is left.
export function pickSpot(profile, { date, playerId = 'player', track, flaws, projects, plans, difficulty = 'standard' }) {
  if (!SPOT_TRACKS.includes(track)) return null;
  const rng = makeRng(`${playerId}:${date}:spot`);
  const best = profile?.bestCredit ?? {};
  const last = (id) => (profile?.missions ?? []).filter((m) => m.eventId === id).map((m) => m.date).sort().at(-1) ?? null;
  const cands = spotCandidates(profile, { track, flaws, projects, plans })
    .map((c) => ({ ...c, r: rng.next() }))
    .filter((c) => { const d = last(c.id); return d === null || daysBetween(d, date) >= 7; })
    .sort((a, b) => Number(a.id in best) - Number(b.id in best) || (best[a.id] ?? 0) - (best[b.id] ?? 0) || a.r - b.r);
  const c = cands[0];
  if (!c) return null;
  return {
    kind: 'spot', date, playerId, track, tier: 'primary', eventId: c.id, projectId: c.project.id, flawId: c.flaw.id,
    seed: `${playerId}:${date}:${c.id}`, difficulty, mode: 'standard',
    title: `Spot the flaw: ${c.project.title}`,
    reason: `${TRACK_LABEL[track]} is your lowest track (L${levelOf(profile?.xp?.[track] ?? 0)})`,
  };
}

// ---------- the round ----------

const name = (project, id) => project.tasks.find((t) => t.id === id)?.name ?? id;
const person = (project, world, role) => (role === 'faculty' ? 'the faculty partner' : world.people.find((p) => p.id === project.team[role])?.short ?? role);
const weeks = (a, b) => (a === b ? `week ${a}` : `weeks ${a}–${b}`);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// Where the flaw sits in this plan, in words, read off the planted plan (the flaw files' detect signals
// name Intro to Psychology's tasks; this works on every baseline).
export function whereText(flaw, planted, baseline, project, world) {
  const plant = flaw.plant_by_project?.[project.id] ?? flaw.plant;
  const p = planted.tasks;
  switch (plant.op) {
    case 'remove_link':
      return `${name(project, plant.to)} no longer waits for ${name(project, plant.from)}: if the review runs late, the work planned for week ${p[plant.to].start} goes ahead without it`;
    case 'shift_to_launch':
      return `${list(plant.tasks.map((id) => name(project, id)))} now run up to launch in week ${planted.launchWeek}, with no free week before it`;
    case 'squeeze_reviews': {
      const w = Object.entries(planted.touchpoints).filter(([, s]) => s.includes('qa-review')).map(([k]) => Number(k));
      return `One internal review in the whole plan, in week ${w[0]}, the week before QA`;
    }
    case 'clear_risk_fields': {
      const hit = planted.risks.slice(0, plant.count).map((r) => `“${r.text}”`);
      return `${list(hit)} have no ${list(plant.fields)}`;
    }
    case 'compress': {
      const t = p[plant.task];
      const was = baseline.tasks[plant.task];
      const owner = project.tasks.find((x) => x.id === plant.task).owner;
      return `${name(project, plant.task)} is squeezed into ${weeks(t.start, t.end)} (it had ${was.end - was.start + 1}), which puts ${person(project, world, owner)} over 100% of usable hours`;
    }
    case 'clear_backups':
      return 'The Backup column is empty: no one is named to step in on any task, the critical path included';
    case 'remove_contact':
      return `No Friday summaries in the calendar${plant.gate ? ' and no director gate before QA' : ''}, so the faculty partner can go weeks without hearing from you`;
    case 'overlap': {
      const t = p[plant.task];
      const w = p[plant.with];
      return `${name(project, plant.task)} is planned from week ${t.start}, while ${name(project, plant.with)}, which it waits for, runs to week ${w.end}`;
    }
    default: return flaw.detect_signals?.[0] ?? '';
  }
}

// A one-flaw round in the shape engine/critique.js scores and the Critique screen plays.
export function spotRound(pick, { flaws, plans, projects, world }) {
  const byId = Object.fromEntries(asList(flaws).map((f) => [f.id, f]));
  const flaw = byId[pick.flawId];
  const project = projects.find((p) => p.id === pick.projectId);
  const baseline = plans[project.id];
  const planted = C.plantFlaw(baseline, flaw, project);
  const sample = { id: pick.eventId, rank: 'Spot the flaw', flaws: [flaw.id], key: { [flaw.id]: { where: whereText(flaw, planted.plan, baseline, project, world), fix: flaw.accepted_fixes[0] } } };
  return C.buildRound(sample, byId, baseline, project);
}

// ---------- scoring ----------

// Critique scoring without the verdict (the mission says there is exactly one problem), out of 20.
export function scoreSpot(round, result) {
  const f = result.flaws[0];
  const raw = f.total + result.falsePositivePoints;
  const credit = Math.round((Math.max(0, raw) / MAX) * 100) / 100;
  return {
    credit, raw, max: MAX, found: f.found, rightCategory: Boolean(f.rightCategory), points: f.points,
    falsePositives: result.falsePositives.length, falsePositivePoints: result.falsePositivePoints,
    track: flawTrack({ id: round.flaws[0].id, skill_track: round.flaws[0].skill_track }),
  };
}

// The headline for the result card.
export function spotHeadline(s, flawTitle) {
  if (!s.found) return `You missed it: ${flawTitle}.${s.falsePositives ? ` Your ${s.falsePositives === 1 ? 'flag was' : `${s.falsePositives} flags were`} on things that were fine.` : ''}`;
  const lost = [
    !s.rightCategory && 'what was wrong',
    s.points.severity < 3 && 'how serious it was',
    s.points.fix < 7 && (s.points.fix ? 'a partial fix' : 'the fix'),
    s.falsePositives && `${s.falsePositives === 1 ? 'a flag' : `${s.falsePositives} flags`} on things that were fine`,
  ].filter(Boolean);
  return lost.length ? `You found it; points went on ${list(lost)}.` : 'You found it, named it, judged it right and fixed it.';
}

// Whether fixing the flaw shows in play: an on-time gap of 5+ points or 10+ rework hours a run.
export const showsInPlay = (f) => Boolean(f) && (f.fixed.onTime - f.written.onTime >= MATTERS || f.written.rework - f.fixed.rework >= 10);
