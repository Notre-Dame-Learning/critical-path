// Critique the Plan: scoring a player's review against a round's answer key.
// Rules are the "Critique scoring" table in the framework doc (Plan-flaw library tab):
//   Found     10 per flaw  (right place + right category; right place, wrong category = 5)
//   Severity   3 per flaw  (exact 3, one level off 1)
//   Fix        7 per flaw  (accepted 7, partial 3, none 0)
//   Verdict   10           ("send_back" unless every planted flaw is low)
//   False positives -3 each, at most -9 (decoys included)
// Raw points are scaled to 0-100 against 20 per flaw + 10.
//
// Pure functions only: no plan model needed, so this file does not depend on engine/plan.js.
// Planting flaws and playing both plans forward are added here once plan.js is in the repo.

import { makeRng } from './rng.js';

export const CATEGORIES = [
  'dependency', 'buffer', 'utilization', 'single_point_of_failure',
  'quality_squeeze', 'risk_ownership', 'parallelism', 'stakeholder',
];
export const SEVERITIES = ['low', 'medium', 'high'];
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
