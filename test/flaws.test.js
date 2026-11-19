import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../engine/plan.js';
import { plantFlaw, buildRound, flawApplies, validateRound, scoreCritique, CATEGORIES, SEVERITIES } from '../engine/critique.js';

const dir = new URL('../content/', import.meta.url);
const load = (p) => JSON.parse(fs.readFileSync(new URL(p, dir)));
const world = load('world.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const byProject = Object.fromEntries(projects.map((p) => [p.id, p]));
const flaws = fs.readdirSync(new URL('flaws/', dir)).filter((f) => f.endsWith('.json')).map((f) => load(`flaws/${f}`));
const flawsById = Object.fromEntries(flaws.map((f) => [f.id, f]));
const samples = load('critique-samples.json').rounds;
const failing = (plan, project) => P.runChecks(plan, project, world).filter((c) => c.status === 'fail').map((c) => c.id);

test('eight flaw files, one per editor check, with complete fields', () => {
  assert.equal(flaws.length, 8);
  assert.deepEqual(flaws.map((f) => f.check).sort(), P.CHECKS.map((c) => c.id).sort());
  for (const f of flaws) {
    assert.ok(CATEGORIES.includes(f.category), f.id);
    assert.ok(SEVERITIES.includes(f.severity), f.id);
    assert.ok(['Coordinator', 'PM', 'Senior PM'].includes(f.min_rank), f.id);
    for (const k of ['title', 'skill_track', 'concept', 'explanation', 'sop_ref', 'sim_effect']) assert.ok(f[k], `${f.id}.${k}`);
    assert.ok(f.accepted_fixes.length >= 2 && f.partial_fixes.length >= 2, f.id);
    assert.equal(P.CHECKS.find((c) => c.id === f.check).flaw, f.id, `${f.id} mirrors its check`);
  }
});

test('every plant fails exactly its own check on every baseline it applies to, and leaves the baseline untouched', () => {
  let planted = 0;
  for (const project of projects) {
    const base = load(`plans/${project.id}.json`);
    const before = JSON.stringify(base);
    for (const f of flaws.filter((x) => flawApplies(x, project))) {
      const { plan, targets } = plantFlaw(base, f, project);
      assert.deepEqual(P.blockers(plan, project), [], `${project.id} ${f.id} blockers`);
      assert.deepEqual(failing(plan, project), [f.check], `${project.id} ${f.id}`);
      assert.ok(targets.length > 0, `${project.id} ${f.id} targets`);
      planted++;
    }
    assert.equal(JSON.stringify(base), before);
  }
  assert.equal(planted, 23); // 8 + 8 + 7 (no single point of failure on Rescue)
  assert.throws(() => plantFlaw(load('plans/rescue-sustainable-business.json'), flawsById.single_point_of_failure, byProject['rescue-sustainable-business']));
});

test('sample rounds: Coordinator 2, PM 3, Senior PM 4 flaws; each fails exactly its planted checks with no shared targets', () => {
  assert.deepEqual(samples.map((s) => [s.rank, s.flaws.length]), [['Coordinator', 2], ['PM', 3], ['Senior PM', 4]]);
  for (const s of samples) {
    const project = byProject[s.project];
    const round = buildRound(s, flawsById, load(`plans/${project.id}.json`), project);
    assert.deepEqual(validateRound(round), [], s.id);
    assert.deepEqual(failing(round.plan, project).sort(), round.flaws.map((f) => f.check).sort(), s.id);
    for (const f of round.flaws) assert.ok(P.CHECKS.find((c) => c.id === f.check), f.id);
    for (const f of s.flaws) {
      assert.ok(flawsById[f].min_rank === 'Coordinator' || ['PM', 'Senior PM'].indexOf(s.rank) >= ['PM', 'Senior PM'].indexOf(flawsById[f].min_rank), `${s.id}: ${f} is above rank`);
      assert.ok(s.key[f]?.where && s.key[f]?.fix, `${s.id}: answer key for ${f}`);
    }
  }
});

test('a perfect review of a planted round scores 100 and the flawed plan does worse on the engine', () => {
  const s = samples.find((x) => x.rank === 'Coordinator');
  const project = byProject[s.project];
  const base = load(`plans/${project.id}.json`);
  const round = buildRound(s, flawsById, base, project);
  const flags = round.flaws.map((f) => ({ target: f.targets[0], category: f.category, severity: f.severity, fix: 'accepted' }));
  assert.equal(scoreCritique(round, { flags, verdict: 'send_back' }).score, 100);
  const decoyFlag = { target: round.decoys[0].targets[0], category: 'parallelism', severity: 'low', fix: 'none' };
  assert.ok(scoreCritique(round, { flags: [...flags, decoyFlag], verdict: 'send_back' }).score < 100);
  const ctx = { world, project, deck: load('scenarios/core-deck.json') };
  const odds = (plan) => P.onTimeOdds(plan, ctx, { runs: 150, seed: 'cr' }).share;
  assert.ok(odds(round.plan) < odds(base) - 0.1, 'the planted plan loses on-time odds');
});
