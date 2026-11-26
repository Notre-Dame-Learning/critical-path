// Estimate drill: the Daily Mission kind for the Estimating track. One task from a project's Build the
// Plan task bank: the owner quotes a range, past courses show what similar work actually took, and the
// player gives best / likely / worst hours. The project is then played forward 60 times and the range is
// scored on how many futures it caught and how much wider it was than it needed to be.
// Design: "Daily Mission" tab of the framework doc (Estimate drill). sim.js is unchanged.
import { playOnce } from './montecarlo.js';
import { taskBank } from './plan.js';
import { makeRng } from './rng.js';
import { TRACK_LABEL, levelOf } from './tracks.js';

export const DRILL_RUNS = 60;    // futures the answer is scored on
export const HISTORY_RUNS = 30;  // futures per past course in the evidence table
export const TARGET = 0.8;       // a good range catches 8 in 10 futures
export const MIN_EFFORT = 8;     // smaller tasks make poor drills: a quote 25% low is off by an hour or two
export const MIX = ['best', 'best', 'fixed', 'random']; // who plays the futures, in rotation
export const MIX_NOTE = 'played by ODL PMs of mixed experience (half play well, a quarter keep a fixed routine, a quarter click through)';
export const DEBRIEF = {
  concept: 'Estimating: ask for a range, then check it against what similar work actually took.',
  independent: 'Ask the person doing the work for best, likely and worst cases. Compare them with actuals from past courses, adjust for anyone who habitually quotes low, and allow for the rework that reviews will find. Plan on the likely figure and keep the gap as buffer.',
  escalateWhen: 'Only when the realistic range breaks a milestone. Then bring the range and two options.',
  sop: 'PM SOP: Design phase (timeline); Development phase pacing',
};

const round1 = (x) => Math.round(x * 10) / 10;
const quantile = (sorted, p) => sorted[Math.round(p * (sorted.length - 1))];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- actual hours ----------

// Hours each task really took in a finished (or stopped) game: hours worked on it (new work and fixes),
// plus what it still needs, plus any part moved to after launch (so a deferral doesn't look like a fast task).
export function taskActuals(g) {
  const spent = {};
  const fix = {};
  for (const e of g.log ?? []) {
    for (const list of Object.values(e.work ?? {})) {
      for (const w of list) {
        spent[w.task] = (spent[w.task] ?? 0) + w.new + w.fix;
        fix[w.task] = (fix[w.task] ?? 0) + w.fix;
      }
    }
  }
  const deferred = {};
  for (const d of g.v2?.deferred ?? []) deferred[d.task] = (deferred[d.task] ?? 0) + d.hours;
  return Object.fromEntries(g.tasks.map((t) => [t.id, {
    hours: round1((spent[t.id] ?? 0) + Math.max(0, t.effort - t.done) + t.known + (deferred[t.id] ?? 0)),
    fix: round1((fix[t.id] ?? 0) + t.known),
  }]));
}

const cache = new Map();

// Play `project` `runs` times (rotating through MIX) and collect each task's actual hours, sorted.
// Cached: the same arguments always give the same futures.
export function playFutures({ world, project, deck, runs = DRILL_RUNS, seed = 'drill', difficulty = 'standard' }) {
  const key = `${project.id}|${seed}|${runs}|${difficulty}`;
  if (cache.has(key)) return cache.get(key);
  const tasks = {};
  for (let i = 0; i < runs; i++) {
    const g = playOnce({ world, project, deck, seed: `${seed}:${i}`, policy: MIX[i % MIX.length], difficulty });
    for (const [id, a] of Object.entries(taskActuals(g))) {
      const t = (tasks[id] ??= { actual: [], fix: 0 });
      t.actual.push(a.hours);
      t.fix += a.fix / runs;
    }
  }
  for (const t of Object.values(tasks)) { t.actual.sort((a, b) => a - b); t.fix = round1(t.fix); }
  const out = { runs, tasks };
  cache.set(key, out);
  return out;
}

export function spread(actual) {
  return { p10: quantile(actual, 0.1), p50: quantile(actual, 0.5), p90: quantile(actual, 0.9), min: actual[0], max: actual.at(-1) };
}

// ---------- which tasks can be drilled ----------

// Team-owned tasks not yet started (a faculty partner's hours aren't the team's to estimate, and a task
// already under way is quoted for what's left), with enough hours to be worth a range.
export function drillTasks(project, world) {
  const byId = Object.fromEntries(project.tasks.map((t) => [t.id, t]));
  return taskBank(project, world).filter((b) => b.owner !== 'faculty' && !b.inherited && !b.started && byId[b.id].effort >= MIN_EFFORT);
}

const drillId = (projectId, taskId) => `drill:${projectId}:${taskId}`;
export const isDrill = (pick) => pick?.kind === 'drill';
// The pseudo-event a drill records XP against: all of it goes to Estimating.
export const drillEvent = (pick) => ({ id: pick.eventId, track: 'estimating', track2: null });

// "Post-production: rough cuts and final cut" → "Post-production"; "Front-end analysis (LD Milestone 1)" → "Front-end analysis".
export const shortName = (name) => name.split(':')[0].replace(/\s*\(.*\)\s*$/, '').trim();

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Today's drill in the unlocked projects: never drilled first, then the lowest best score; a task drilled
// in the last 7 days waits. Returns the pick fields, or null when every drill rested this week.
export function pickDrill(profile, { date, playerId = 'player', world, projects, difficulty = 'standard' }) {
  const rng = makeRng(`${playerId}:${date}:drill`);
  const best = profile?.bestCredit ?? {};
  const last = (id) => (profile?.missions ?? []).filter((m) => m.eventId === id).map((m) => m.date).sort().at(-1) ?? null;
  const cands = projects.flatMap((p) => drillTasks(p, world).map((b) => ({ project: p, task: b, id: drillId(p.id, b.id), r: rng.next() })))
    .filter((c) => { const d = last(c.id); return d === null || daysBetween(d, date) >= 7; })
    .sort((a, b) => Number(a.id in best) - Number(b.id in best) || (best[a.id] ?? 0) - (best[b.id] ?? 0) || a.r - b.r);
  const c = cands[0];
  if (!c) return null;
  const lvl = levelOf(profile?.xp?.estimating ?? 0);
  return {
    kind: 'drill', date, playerId, track: 'estimating', tier: 'primary', eventId: c.id, projectId: c.project.id, taskId: c.task.id,
    seed: `${playerId}:${date}:${c.id}`, difficulty, mode: 'standard',
    title: `Estimate: ${shortName(c.task.name)}`,
    reason: `${TRACK_LABEL.estimating} is your lowest track (L${lvl})`,
  };
}

// ---------- the brief ----------

function ownerOf(project, world, role) {
  return world.people.find((p) => p.id === project.team[role]) ?? null;
}

// Evidence rows: the same task on other courses (else the same role's nearest-sized tasks), up to 3,
// each with the owner's quote and what it took over HISTORY_RUNS futures.
export function history(projectId, taskId, { world, deck, projects, difficulty = 'standard' }) {
  const here = projects.find((p) => p.id === projectId);
  const task = here.tasks.find((t) => t.id === taskId);
  const others = projects.filter((p) => p.id !== projectId);
  let rows = others.flatMap((p) => drillTasks(p, world).filter((b) => b.id === taskId).map((b) => ({ p, b })));
  if (!rows.length) {
    const effort = (p, b) => p.tasks.find((t) => t.id === b.id).effort;
    rows = others.flatMap((p) => drillTasks(p, world).filter((b) => b.owner === task.owner).map((b) => ({ p, b })))
      .sort((x, y) => Math.abs(effort(x.p, x.b) - task.effort) - Math.abs(effort(y.p, y.b) - task.effort));
  }
  return rows.slice(0, 3).map(({ p, b }) => {
    const f = playFutures({ world, project: p, deck, runs: HISTORY_RUNS, seed: 'history', difficulty });
    const s = spread(f.tasks[b.id].actual);
    return { project: p.title, projectId: p.id, taskId: b.id, task: b.name, quotedBy: b.quotedBy, quote: b.quote, took: { p10: s.p10, p50: s.p50, p90: s.p90 } };
  });
}

// What the player sees before answering. ctx = { world, deck, projects }.
export function drillBrief(pick, ctx) {
  const project = ctx.projects.find((p) => p.id === pick.projectId);
  const bank = taskBank(project, ctx.world).find((b) => b.id === pick.taskId);
  const owner = ownerOf(project, ctx.world, bank.owner);
  const plan = ctx.plans?.[project.id]?.tasks?.[pick.taskId] ?? null;
  return {
    project: project.title, projectId: project.id, launchWeek: project.launchWeek,
    task: { id: bank.id, name: bank.name, phase: bank.phase, owner: bank.owner, weeks: plan ? [plan.start, plan.end] : null },
    person: owner ? { name: owner.name, short: owner.short ?? owner.name, role: owner.role, avatar: owner.avatar, traits: owner.traits ?? [] } : null,
    quote: bank.quote, optimistic: bank.optimistic,
    history: history(project.id, pick.taskId, { ...ctx, difficulty: pick.difficulty }),
  };
}

// ---------- scoring ----------

// Hours are given in whole numbers, so a range covers half an hour either side of its ends.
const catches = (actual, lo, hi) => actual.filter((x) => x >= lo - 0.5 && x <= hi + 0.5).length;

// Check a range the player typed: whole hours, best ≤ likely ≤ worst, 1–500.
export function checkRange(range) {
  const r = (range ?? []).map(Number);
  if (r.length !== 3 || r.some((x) => !Number.isFinite(x))) return 'Give all three numbers.';
  if (r.some((x) => x < 1 || x > 500 || Math.round(x) !== x)) return 'Use whole hours from 1 to 500.';
  if (!(r[0] <= r[1] && r[1] <= r[2])) return 'Best case ≤ most likely ≤ worst case.';
  return null;
}

// Score a [best, likely, worst] range against sorted actual hours:
// caught = futures inside the range; full marks for catching TARGET of them.
// width = how much wider than the fair range (10th to 90th percentile), as a share of the typical actual;
// up to 25% extra is free, then marks fall to a quarter at 100% extra. credit = cover × width.
export function scoreRange(range, hours) {
  const [lo, likely, hi] = range.map(Number);
  const actual = [...hours].sort((a, b) => a - b);
  const s = spread(actual);
  const n = actual.length;
  const fair = [Math.round(s.p10), Math.round(s.p90)];
  const caught = catches(actual, lo, hi);
  const extra = Math.max(0, (hi - lo + 1) - (fair[1] - fair[0] + 1)) / Math.max(1, s.p50);
  const coverPart = Math.min(1, caught / (TARGET * n));
  const widthPart = clamp(1.25 - extra, 0.25, 1);
  return {
    credit: Math.round(coverPart * widthPart * 100) / 100,
    caught, runs: n, coverPart: Math.round(coverPart * 100) / 100, widthPart: Math.round(widthPart * 100) / 100,
    extraHours: Math.max(0, (hi - lo) - (fair[1] - fair[0])), likelyOff: round1(likely - s.p50),
    fair, fairCaught: catches(actual, fair[0], fair[1]), ...s,
  };
}

// Why the futures differed from the owner's quote: up to three plain lines.
export function lessons(brief, score, fixMean) {
  const out = [];
  const who = brief.person?.short ?? 'The owner';
  const q = brief.quote[1];
  if (brief.optimistic && score.p50 >= q * 1.15) {
    const past = brief.history.filter((h) => h.quote[1] > 0).map((h) => h.took.p50 / h.quote[1]);
    const ratio = past.length ? past.reduce((a, b) => a + b, 0) / past.length : score.p50 / q;
    out.push(`${who} is an optimistic estimator: the quote said ${q} h and a typical future took ${round1(score.p50)} h. On the past courses above, the work took about ${Math.round((ratio - 1) * 100)}% more than ${who}'s likely figure.`);
  }
  if (fixMean >= Math.max(1, 0.05 * score.p50)) out.push(`About ${round1(fixMean)} h of each future went to fixing mistakes found later. A quote for the work rarely includes its rework.`);
  const width = (score.p90 - score.p10) / Math.max(1, score.p50);
  if (width >= 0.25) out.push(`Futures ranged from ${score.p10} to ${score.p90} h (10th to 90th percentile): rushed weeks, overtime and skipped reviews hide mistakes that come back as rework.`);
  else if (width < 0.1) out.push(`This task barely varied (${score.p10 === score.p90 ? `about ${score.p50} h in most futures` : `${score.p10} to ${score.p90} h`}), so a tight range was safe; a wide one only blurs the plan.`);
  return out;
}

// Play the project forward DRILL_RUNS times and score the range. ctx = { world, deck, projects, plans? }.
export function resolveDrill(pick, range, ctx, brief = drillBrief(pick, ctx)) {
  const err = checkRange(range);
  if (err) throw new Error(err);
  const project = ctx.projects.find((p) => p.id === pick.projectId);
  const f = playFutures({ world: ctx.world, project, deck: ctx.deck, runs: DRILL_RUNS, seed: `${pick.seed}:forward`, difficulty: pick.difficulty });
  const { actual, fix } = f.tasks[pick.taskId];
  const yours = scoreRange(range, actual);
  const quote = scoreRange(brief.quote, actual);
  return {
    kind: 'drill', eventId: pick.eventId, range: range.map(Number), credit: yours.credit, score: yours, quote: { range: brief.quote, caught: quote.caught, credit: quote.credit },
    actual, fixMean: fix, lessons: lessons(brief, yours, fix), debrief: DEBRIEF, tracks: { primary: 'estimating', secondary: null },
  };
}
