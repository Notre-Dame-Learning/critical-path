// Critique the Plan: scoring a player's review against a round's answer key.
// Rules are the "Critique scoring" table in the framework doc (Plan-flaw library tab):
//   Found     10 per flaw  (right place + right category; right place, wrong category = 5)
//   Severity   3 per flaw  (exact 3, one level off 1)
//   Fix        7 per flaw  (accepted 7, partial 3, none 0)
//   Verdict   10           ("send_back" unless every planted flaw is low)
//   False positives -3 each, at most -9 (decoys included)
// Raw points are scaled to 0-100 against 20 per flaw + 10.
//
// Scoring needs no plan model. Planting flaws into a baseline plan (plantFlaw, buildRound), the plan with
// the player's fixes (fixedPlan) and playing both forward (forwardStats) use engine/plan.js.

import { makeRng } from './rng.js';
import { criticalPath, playPlan, loadReport } from './plan.js';

export const CATEGORIES = [
  'dependency', 'buffer', 'utilization', 'single_point_of_failure',
  'quality_squeeze', 'risk_ownership', 'parallelism', 'stakeholder',
];
export const SEVERITIES = ['low', 'medium', 'high'];
// The categories in plain words, as the Flag sheet offers them (Plan editor screen tab, Critique mode).
export const CATEGORY_LABEL = {
  dependency: 'A missing link',
  buffer: 'No buffer before launch',
  quality_squeeze: 'Reviews squeezed to the end',
  utilization: 'Someone overloaded',
  single_point_of_failure: 'One person with no backup',
  risk_ownership: 'A risk nobody owns',
  parallelism: 'Work started before its input was done',
  stakeholder: 'Stakeholders left out',
};
export const POINTS = {
  found: 10, foundWrongCategory: 5,
  severityExact: 3, severityNear: 1,
  fixAccepted: 7, fixPartial: 3,
  verdict: 10, falsePositive: -3, falsePositiveCap: -9,
};

// round = {
//   flaws:  [{ id, title, category, severity, skill_track, targets: ['T6', 'T5'],
//              accepted_fixes: [...], partial_fixes: [...], concept?, explanation? }],
//   decoys: [{ targets: ['T8'], why }]
// }
// submission = {
//   flags:   [{ target: 'T6', category: 'dependency', severity: 'high',
//               fix: 'accepted' | 'partial' | 'none' }],   // fix already graded: picked option or Claude's verdict
//   verdict: 'approve' | 'send_back'
// }

export function correctVerdict(round) {
  return round.flaws.every((f) => f.severity === 'low') ? 'approve' : 'send_back';
}

function severityPoints(given, expected) {
  const a = SEVERITIES.indexOf(given);
  const b = SEVERITIES.indexOf(expected);
  if (a < 0 || b < 0) return 0;
  const d = Math.abs(a - b);
  return d === 0 ? POINTS.severityExact : d === 1 ? POINTS.severityNear : 0;
}

function fixPoints(fix) {
  if (fix === 'accepted') return POINTS.fixAccepted;
  if (fix === 'partial') return POINTS.fixPartial;
  return 0;
}

export function validateRound(round) {
  const problems = [];
  const owner = new Map();
  for (const f of round.flaws) {
    if (!CATEGORIES.includes(f.category)) problems.push(`${f.id}: unknown category ${f.category}`);
    if (!SEVERITIES.includes(f.severity)) problems.push(`${f.id}: unknown severity ${f.severity}`);
    if (!f.targets?.length) problems.push(`${f.id}: no targets`);
    for (const t of f.targets || []) {
      if (owner.has(t)) problems.push(`${t}: in both ${owner.get(t)} and ${f.id} (flaws must not share a task)`);
      owner.set(t, f.id);
    }
  }
  for (const d of round.decoys || []) {
    for (const t of d.targets) if (owner.has(t)) problems.push(`${t}: decoy is also a target of ${owner.get(t)}`);
  }
  return problems;
}

// Match flags to flaws. Right-category flags are matched first so the result never
// depends on the order the player placed flags. One flag scores per flaw; further
// flags on an already-found flaw are "repeats" and cost nothing.
function matchFlags(round, flags) {
  const byFlaw = new Map();
  const matched = new Set();
  const order = flags.map((flag, i) => ({ flag, i }));
  for (const pass of ['exact', 'place']) {
    for (const { flag, i } of order) {
      if (matched.has(i)) continue;
      const hit = round.flaws.find((f) => !byFlaw.has(f.id) && f.targets.includes(flag.target)
        && (pass === 'place' || f.category === flag.category));
      if (hit) { byFlaw.set(hit.id, { flag, i }); matched.add(i); }
    }
  }
  const repeats = [];
  const falsePositives = [];
  for (const { flag, i } of order) {
    if (matched.has(i)) continue;
    const flaw = round.flaws.find((f) => f.targets.includes(flag.target));
    if (flaw) { repeats.push({ flag, flaw: flaw.id }); continue; }
    const decoy = (round.decoys || []).find((d) => d.targets.includes(flag.target));
    falsePositives.push({ flag, decoy: decoy ? decoy.why : null });
  }
  return { byFlaw, repeats, falsePositives };
}

export function scoreCritique(round, submission) {
  const flags = submission.flags || [];
  const { byFlaw, repeats, falsePositives } = matchFlags(round, flags);

  const flaws = round.flaws.map((f) => {
    const m = byFlaw.get(f.id);
    if (!m) {
      return { id: f.id, title: f.title, skill_track: f.skill_track, found: false,
        points: { found: 0, severity: 0, fix: 0 }, total: 0, max: 20 };
    }
    const rightCategory = m.flag.category === f.category;
    const points = {
      found: rightCategory ? POINTS.found : POINTS.foundWrongCategory,
      severity: severityPoints(m.flag.severity, f.severity),
      fix: fixPoints(m.flag.fix),
    };
    return {
      id: f.id, title: f.title, skill_track: f.skill_track, found: true, rightCategory,
      flaggedAt: m.flag.target, givenCategory: m.flag.category,
      givenSeverity: m.flag.severity, expectedSeverity: f.severity, fix: m.flag.fix || 'none',
      points, total: points.found + points.severity + points.fix, max: 20,
    };
  });

  const expectedVerdict = correctVerdict(round);
  const verdictPoints = submission.verdict === expectedVerdict ? POINTS.verdict : 0;
  const fpPoints = Math.max(POINTS.falsePositiveCap, POINTS.falsePositive * falsePositives.length);

  const max = 20 * round.flaws.length + POINTS.verdict;
  const raw = flaws.reduce((s, f) => s + f.total, 0) + verdictPoints + fpPoints;
  const score = Math.round((100 * Math.max(0, raw)) / max);

  // Per skill track: found flaws earn XP (progression.js decides how much);
  // missed ones raise that track's weight in Daily Mission selection.
  const tracks = {};
  for (const f of flaws) {
    const t = (tracks[f.skill_track] ||= { found: 0, missed: 0 });
    f.found ? t.found++ : t.missed++;
  }

  return {
    score, raw, max,
    flaws,
    verdict: { given: submission.verdict ?? null, expected: expectedVerdict, points: verdictPoints },
    falsePositives: falsePositives.map(({ flag, decoy }) => ({ target: flag.target, category: flag.category, decoyWhy: decoy })),
    falsePositivePoints: fpPoints,
    repeats: repeats.map(({ flag, flaw }) => ({ target: flag.target, flaw })),
    tracks,
    missedTracks: Object.keys(tracks).filter((t) => tracks[t].missed > 0),
  };
}

// Normal mode: the player picks a fix from three options per flagged flaw.
// One accepted fix, one partial fix, and one accepted fix of a different flaw
// (right for that flaw, no credit here). Seeded so a replay shows the same options.
export function fixOptions(flaw, otherFlaws, seed) {
  const rng = makeRng(`${seed}:${flaw.id}:fixes`);
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length)];
  const options = [{ text: pick(flaw.accepted_fixes), grade: 'accepted' }];
  if (flaw.partial_fixes?.length) options.push({ text: pick(flaw.partial_fixes), grade: 'partial' });
  const others = otherFlaws.filter((o) => o.id !== flaw.id && o.accepted_fixes?.length);
  if (others.length) options.push({ text: pick(pick(others).accepted_fixes), grade: 'none' });
  return rng.shuffle(options).map((o, i) => ({ id: `fix${i + 1}`, ...o }));
}

// Lines for the debrief, biggest miss first, then what was found.
export function debriefLines(round, result) {
  const lines = [];
  const byId = Object.fromEntries(round.flaws.map((f) => [f.id, f]));
  for (const f of result.flaws.filter((x) => !x.found)) {
    lines.push({ kind: 'missed', flaw: f.id, text: `Missed: ${f.title}. ${byId[f.id].explanation || ''}`.trim() });
  }
  for (const f of result.flaws.filter((x) => x.found)) {
    const notes = [];
    if (!f.rightCategory) notes.push(`right place, but this is ${byId[f.id].category.replace(/_/g, ' ')}`);
    if (f.points.severity < POINTS.severityExact) notes.push(`severity is ${f.expectedSeverity}`);
    if (f.fix !== 'accepted') notes.push(`a full fix: ${byId[f.id].accepted_fixes[0]}`);
    lines.push({ kind: 'found', flaw: f.id, text: `Found: ${f.title} (${f.total}/20)${notes.length ? ': ' + notes.join('; ') : ''}.` });
  }
  for (const fp of result.falsePositives) {
    lines.push({ kind: 'false_positive', target: fp.target,
      text: fp.decoyWhy ? `${fp.target} was fine: ${fp.decoyWhy}` : `${fp.target} had no planted flaw.` });
  }
  if (result.verdict.points === 0) {
    lines.push({ kind: 'verdict', text: result.verdict.expected === 'send_back'
      ? 'This plan should have been sent back: it has a medium or high flaw.'
      : 'Every flaw here was low; this plan could be approved with notes.' });
  }
  return lines;
}

// ---------- planting flaws (content/flaws/*.json) into a baseline plan ----------

// Flag targets: a task id; "link:<from>><to>"; "risk:<id>"; "gate"; "touchpoints:qa-review" or
// "touchpoints:faculty-contact" (the calendar's review or contact slots); "load:<role>"; "backup:<role>".
// plantFlaw returns a new plan (the input is untouched) and the targets a careful reviewer could flag.
export function plantFlaw(plan, flaw, project) {
  if (!flawApplies(flaw, project)) throw new Error(`${flaw.id} isn't planted on ${project.id}`);
  const p = structuredClone(plan);
  const plant = flaw.plant_by_project?.[project.id] ?? flaw.plant;
  const t = (id) => {
    if (!p.tasks[id]) throw new Error(`${flaw.id}: no task ${id} in ${project.id}`);
    return p.tasks[id];
  };
  const owner = (id) => project.tasks.find((x) => x.id === id).owner;
  let targets = [];
  switch (plant.op) {
    case 'remove_link': {
      const to = t(plant.to);
      to.deps = to.deps.filter((d) => d.split(':')[0] !== plant.from);
      targets = [plant.to, plant.from, `link:${plant.from}>${plant.to}`];
      break;
    }
    case 'shift_to_launch': {
      const by = p.launchWeek - t(plant.anchor).end;
      for (const id of plant.tasks) {
        const x = t(id);
        x.start = Math.min(p.launchWeek, x.start + by);
        x.end = Math.min(p.launchWeek, x.end + by);
      }
      targets = [...plant.tasks];
      break;
    }
    case 'squeeze_reviews': {
      const qa = project.tasks.find((x) => x.isQA).id;
      const week = String(t(qa).start - 1);
      for (const w of Object.keys(p.touchpoints)) p.touchpoints[w] = p.touchpoints[w].map((x) => (x === 'qa-review' ? 'faculty-update' : x));
      p.touchpoints[week] = [...(p.touchpoints[week] ?? [null, null])];
      p.touchpoints[week][1] = 'qa-review';
      targets = ['touchpoints:qa-review'];
      break;
    }
    case 'clear_risk_fields': {
      const hit = p.risks.slice(0, plant.count);
      for (const r of hit) for (const k of plant.fields) r[k] = '';
      targets = hit.map((r) => `risk:${r.id}`);
      break;
    }
    case 'compress': {
      const x = t(plant.task);
      if (plant.start) x.start = plant.start;
      x.end = x.start + plant.weeks - 1;
      targets = [plant.task, `load:${owner(plant.task)}`];
      break;
    }
    case 'clear_backups': {
      const had = Object.keys(p.tasks).filter((id) => p.tasks[id].backup);
      for (const x of Object.values(p.tasks)) x.backup = null;
      const counts = {};
      for (const id of criticalPath(p, project)) counts[owner(id)] = (counts[owner(id)] ?? 0) + 1;
      targets = [...had, ...Object.keys(counts).filter((r) => counts[r] >= 4).map((r) => `backup:${r}`)];
      break;
    }
    case 'remove_contact': {
      for (const w of Object.keys(p.touchpoints)) p.touchpoints[w] = p.touchpoints[w].map((x) => (plant.types.includes(x) ? null : x));
      if (plant.gate) p.gate = null;
      targets = ['touchpoints:faculty-contact', ...(plant.gate ? ['gate'] : [])];
      break;
    }
    case 'overlap': {
      const x = t(plant.task);
      const start = Math.max(t(plant.with).start, p.joinWeek ?? 1);
      x.end = Math.max(x.end, start);
      x.start = start;
      targets = [plant.task, plant.with];
      break;
    }
    default:
      throw new Error(`${flaw.id}: unknown plant op ${plant.op}`);
  }
  return { plan: p, targets };
}

export function flawApplies(flaw, project) {
  return !flaw.projects || flaw.projects.includes(project.id);
}

// A playable round from a sample (content/critique-samples.json): the flawed plan and the answer key
// in the shape scoreCritique expects. Flaws are planted in order on the project's baseline.
export function buildRound(sample, flawsById, baseline, project) {
  let plan = baseline;
  const flaws = [];
  for (const id of sample.flaws) {
    const flaw = flawsById[id];
    if (!flaw) throw new Error(`Unknown flaw ${id}`);
    const planted = plantFlaw(plan, flaw, project);
    plan = planted.plan;
    flaws.push({
      id: flaw.id, title: flaw.title, category: flaw.category, severity: sample.severity?.[id] ?? flaw.severity,
      skill_track: flaw.skill_track, check: flaw.check, targets: planted.targets,
      accepted_fixes: flaw.accepted_fixes, partial_fixes: flaw.partial_fixes,
      concept: flaw.concept, explanation: flaw.explanation, where: sample.key?.[id]?.where ?? null, bestFix: sample.key?.[id]?.fix ?? null,
    });
  }
  return { id: sample.id, project: project.id, rank: sample.rank, plan, flaws, decoys: sample.decoys ?? [] };
}

// ---------- the plan with your fixes, played forward ----------

// The flaws a review fixed: found, with an accepted fix. A partial fix or a missed flaw stays as planted.
export function fixedFlaws(result) {
  return result.flaws.filter((f) => f.found && f.fix === 'accepted').map((f) => f.id);
}

// "The plan with your fixes": the baseline with only the flaws the review didn't fix planted again, in the
// round's order. Flaws never share a target, so planting a subset is exact: with nothing fixed it is the
// plan as written, and with everything fixed it is the baseline.
export function fixedPlan(round, result, flawsById, baseline, project) {
  const fixed = new Set(fixedFlaws(result));
  let plan = baseline;
  for (const f of round.flaws) if (!fixed.has(f.id)) plan = plantFlaw(plan, flawsById[f.id], project).plan;
  return { plan, fixed: [...fixed] };
}

// One slice of the play-forward comparison: runs on time, and rework hours (rework fixed during the run plus
// mistakes still hidden at launch), over seeded runs from..from+runs. Callable in slices like onTimeOdds.
export function forwardStats(plan, ctx, { runs = 500, from = 0, seed = 'forward' } = {}) {
  let onTime = 0;
  let rework = 0;
  for (let i = from; i < from + runs; i++) {
    const g = playPlan(plan, { ...ctx, seed: `${seed}:${i}` });
    if (g.result.launchedOnTime) onTime++;
    for (const e of g.log) for (const spent of Object.values(e.work ?? {})) for (const w of spent) rework += w.fix ?? 0;
    rework += g.tasks.reduce((s, t) => s + t.hidden, 0);
  }
  return { onTime, rework, runs };
}

// The highest planned load on anyone, as a share of usable hours (the Load check's figure).
export function peakLoad(plan, project, world) {
  return Object.entries(loadReport(plan, project, world))
    .map(([role, r]) => ({ role, share: r.peak.share, from: r.peak.from, to: r.peak.to }))
    .sort((a, b) => b.share - a.share)[0] ?? { role: null, share: 0 };
}
