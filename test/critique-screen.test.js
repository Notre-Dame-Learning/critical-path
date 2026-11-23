// Critique the Plan: the review screen (plan editor step 6), the plan with your fixes played forward, and XP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as P from '../engine/plan.js';
import * as C from '../engine/critique.js';
import * as G from '../engine/progression.js';
import * as Q from '../app/critique-screen.js';
import { bundleContent } from '../scripts/content.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (p) => JSON.parse(fs.readFileSync(path.join(root, 'content', p)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const intro = load('projects/intro-psych-online.json');
const base = load('plans/intro-psych-online.json');
const flawFiles = Object.fromEntries(P.CHECKS.map((c) => [c.id, load(`flaws/${c.flaw}.json`)]));
const byId = Q.flawsById(flawFiles);
const samples = load('critique-samples.json');
const rounds = samples.rounds.map((s) => C.buildRound(s, byId, base, intro));
const ctx = { world, project: intro, deck };

// The flag a careful reviewer places for a flaw: its first target (a person for load or backup), its
// category and severity, and the accepted fix among the three the sheet offers.
function perfectFlag(round, flaw) {
  const t = flaw.targets[0];
  const target = /^(load|backup):/.test(t) ? `person:${t.split(':')[1]}` : t;
  const fix = Q.fixChoices(round.id, target, flaw.category, flawFiles).find((o) => o.grade === 'accepted');
  return { target, category: flaw.category, severity: flaw.severity, fix: { id: fix.id, text: fix.text, grade: fix.grade } };
}

function manualSchedule() {
  const q = [];
  return {
    frame: (fn) => { const h = { fn }; q.push(h); return h; },
    cancel: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    flush() { let n = 0; while (q.length) { q.shift().fn(); n++; } return n; },
  };
}

test('rounds are offered easiest first, with the one for your rank marked', () => {
  const r = Q.roundChoices(samples, 'pm');
  assert.deepEqual(r.map((x) => x.rank), ['Coordinator', 'PM', 'Senior PM']);
  assert.deepEqual(r.map((x) => x.yours), [false, true, false]);
  assert.equal(Q.roundChoices(samples, 'director').at(-1).yours, true);
});

test('the plan with your fixes: nothing fixed is the plan as written, everything fixed is the model plan', () => {
  for (const round of rounds) {
    const none = C.scoreCritique(round, { verdict: 'send_back', flags: [] });
    assert.deepEqual(C.fixedPlan(round, none, byId, base, intro).plan, round.plan, round.id);
    const all = C.scoreCritique(round, Q.submissionOf(round.flaws.map((f) => perfectFlag(round, f)), 'send_back'));
    const fixed = C.fixedPlan(round, all, byId, base, intro);
    assert.deepEqual(fixed.plan, base, round.id);
    assert.equal(fixed.fixed.length, round.flaws.length);
  }
  // A partial fix leaves the flaw planted.
  const r = rounds[0];
  const flags = r.flaws.map((f) => perfectFlag(r, f));
  const partial = Q.fixChoices(r.id, flags[0].target, flags[0].category, flawFiles).find((o) => o.grade === 'partial');
  flags[0] = { ...flags[0], fix: { ...partial } };
  const res = C.scoreCritique(r, Q.submissionOf(flags, 'send_back'));
  assert.deepEqual(C.fixedPlan(r, res, byId, base, intro).fixed, [r.flaws[1].id]);
});

test('a perfect review through the screen\'s flags scores 100 on every round; a person resolves by category', () => {
  for (const round of rounds) {
    const flags = round.flaws.reduce((acc, f) => Q.setFlag(acc, perfectFlag(round, f)), []);
    assert.equal(C.scoreCritique(round, Q.submissionOf(flags, 'send_back')).score, 100, round.id);
  }
  assert.equal(Q.resolveTarget('person:ld', 'single_point_of_failure'), 'backup:ld');
  assert.equal(Q.resolveTarget('person:mp', 'utilization'), 'load:mp');
  assert.equal(Q.resolveTarget('production', 'dependency'), 'production');
});

test('fix options follow the category picked, not what is planted, and one flag per target', () => {
  const decoy = Q.fixChoices('intro-coordinator', 'animations', 'dependency', flawFiles);
  const real = Q.fixChoices('intro-coordinator', 'production', 'dependency', flawFiles);
  assert.deepEqual(decoy.map((o) => o.grade).sort(), ['accepted', 'none', 'partial']);
  assert.deepEqual(real.map((o) => o.grade).sort(), ['accepted', 'none', 'partial']);
  assert.ok(decoy.some((o) => byId.missing_dependency.accepted_fixes.includes(o.text)));
  assert.deepEqual(Q.fixChoices('x', 'y', 'nope', flawFiles), []);
  const a = { target: 'qa', category: 'buffer', severity: 'high', fix: null };
  let flags = Q.setFlag([], a);
  flags = Q.setFlag(flags, { ...a, severity: 'low' });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, 'low');
  assert.deepEqual(Q.flagMissing(a), ['a fix']);
  assert.deepEqual(Q.removeFlag(flags, 'qa'), []);
});

test('the review screen offers a flag on everything and gives nothing away', () => {
  for (const round of rounds) {
    const m = Q.reviewModel(round, intro, world);
    const html = Q.reviewHtml(m, { flags: [], world, rank: round.rank, tab: 'tasks' });
    for (const id of Object.keys(round.plan.tasks)) assert.ok(html.includes(`data-id="${id}"`), `${round.id}: ${id}`);
    for (const r of round.plan.risks) assert.ok(html.includes(`data-target="risk:${r.id}"`));
    for (const c of Q.CALENDAR_TARGETS) assert.ok(html.includes(`data-target="${c.target}"`));
    for (const role of ['ld', 'mp', 'gd', 'faculty']) assert.ok(html.includes(`data-target="person:${role}"`), role);
    // No check results, no flaw names, no answer-key words.
    for (const leak of ['mark-fail', 'mark-warn', 'Required links', ...round.flaws.map((f) => f.title), ...round.flaws.map((f) => f.where)]) {
      assert.ok(!html.includes(leak), `${round.id} leaks ${leak}`);
    }
    // Every link into a task can be flagged from its sheet.
    const sheet = Q.sheetHtml(m, { sheet: { task: 'post' }, flags: [] });
    for (const d of round.plan.tasks.post.deps) assert.ok(sheet.includes(`data-target="link:${P.parseDep(d).id}&gt;post"`) || sheet.includes(`data-target="link:${P.parseDep(d).id}>post"`));
  }
  // Player text is escaped, and a flag shows on its task and in the list.
  const m = Q.reviewModel(rounds[0], intro, world);
  const flags = [{ target: 'production', category: 'dependency', severity: 'high', fix: { id: 'fix1', text: '<b>x</b>', grade: 'accepted' } }];
  const html = Q.reviewHtml(m, { flags, world });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('cq-marked'));
  assert.ok(Q.flaggedTasks([{ target: 'link:scriptreview>production' }]).has('production'));
});

test('play forward in slices equals one call, skips the copy when nothing is fixed, and stops cleanly', () => {
  const round = rounds[0];
  const s = manualSchedule();
  let out = null;
  const progress = [];
  const run = Q.createForwardRun(ctx, { written: round.plan, fixed: base }, { runs: 12, slice: 5, schedule: s, onProgress: (p) => progress.push(p.done), onDone: (r) => { out = r; } });
  run.start();
  s.flush();
  const w = C.forwardStats(round.plan, ctx, { runs: 12, seed: Q.FORWARD.seed });
  const f = C.forwardStats(base, ctx, { runs: 12, seed: Q.FORWARD.seed });
  assert.equal(out.written.onTime, w.onTime / 12);
  assert.equal(out.fixed.onTime, f.onTime / 12);
  assert.ok(Math.abs(out.written.rework - w.rework / 12) < 1e-9);
  assert.equal(progress.at(-1) < 24, true);
  let same = null;
  const one = Q.createForwardRun(ctx, { written: round.plan, fixed: round.plan, same: true }, { runs: 6, slice: 6, schedule: s, onDone: (r) => { same = r; } });
  one.start();
  assert.equal(s.flush(), 1);
  assert.deepEqual(same.fixed, same.written);
  let never = null;
  const stopped = Q.createForwardRun(ctx, { written: round.plan, fixed: base }, { runs: 10, slice: 2, schedule: s, onDone: (r) => { never = r; } });
  stopped.start();
  stopped.stop();
  s.flush();
  assert.equal(never, null);
  assert.equal(stopped.running(), false);
});

test('the debrief: misses first, your flag beside the answer, decoys explained, both plans drawn', () => {
  const round = rounds[0]; // missing_dependency + review_squeezed; decoys animations, mastersite, load:mp
  const flags = [
    perfectFlag(round, round.flaws[0]),
    { target: 'animations', category: 'dependency', severity: 'medium', fix: null },
  ];
  const result = C.scoreCritique(round, Q.submissionOf(flags, 'send_back'));
  const fixed = C.fixedPlan(round, result, byId, base, intro);
  const forward = { written: { onTime: 0.2, rework: 16.7 }, fixed: { onTime: 0.8, rework: 4.6 }, runs: 500, same: false };
  const m = Q.debriefModel(round, result, { flags, project: intro, world, flawFiles, baseline: base, fixed, forward });
  assert.deepEqual(m.cards.map((c) => [c.id, c.found]), [['missing_dependency', true], ['review_squeezed', false]]);
  assert.equal(m.fixedCount, 1);
  assert.equal(m.falsePositives.length, 1);
  assert.match(m.falsePositives[0].why, /different people/);
  assert.deepEqual(m.parts.map((p) => p.max), [20, 6, 14, 10]);
  assert.equal(m.forward.fixed.odds - m.forward.written.odds, 60);
  assert.ok(m.rows.find((r) => r.id === 'production').changed);
  const html = Q.debriefHtml(m);
  assert.ok(html.indexOf('Missed: Internal reviews') < html.indexOf('Found: Shoot before script review') && html.includes('Missed: Internal reviews'));
  assert.ok(html.includes('Your fixes win back 60 points'));
  assert.ok(html.includes(byId.missing_dependency.sop_ref.replace(/'/g, '&#39;')));
  assert.equal((html.match(/class="pd-row[ "]/g) ?? []).length, Object.keys(base.tasks).length);
  // While the runs play, the forward card shows progress instead.
  assert.match(Q.forwardHtml(null, { share: 0.5 }), /aria-valuenow="50"/);
});

test('Critique XP: score ÷ 10 on the flaws\' tracks, best-of per round, and the Senior PM pass', () => {
  const senior = rounds[2];
  const all = C.scoreCritique(senior, Q.submissionOf(senior.flaws.map((f) => perfectFlag(senior, f)), 'send_back'));
  const xp = G.critiqueXp(all);
  assert.ok(Math.abs(Object.values(xp).reduce((s, x) => s + x, 0) - 10) < 0.11);
  assert.ok(xp.planning > xp.risk && xp.risk > 0 && xp.leadership > 0);
  assert.deepEqual(Object.values(G.critiqueXp(C.scoreCritique(senior, { verdict: 'send_back', flags: [] }))).filter((x) => x > 0), []);
  const first = G.applyCritiqueRound(G.newProfile(), { round: senior, result: all });
  assert.equal(first.passedSenior, true);
  assert.equal(first.profile.critiquePassedAtSenior, true);
  assert.ok(first.total > 9.8);
  const again = G.applyCritiqueRound(first.profile, { round: senior, result: all });
  assert.equal(again.total, 0);
  assert.equal(again.profile.planRounds.filter((r) => r.mode === 'critique').length, 2);
  const back = G.importCode(G.exportCode(again.profile));
  assert.deepEqual(back.planBest['critique:intro-senior-pm'], again.profile.planBest['critique:intro-senior-pm']);
  // A low score on a Coordinator round passes nothing.
  const coord = G.applyCritiqueRound(G.newProfile(), { round: rounds[0], result: C.scoreCritique(rounds[0], { verdict: 'send_back', flags: [] }) });
  assert.equal(coord.profile.critiquePassedAtSenior, false);
});

test('the bundle carries the Critique rounds', () => {
  const content = bundleContent(root);
  assert.deepEqual(content.critique.rounds.map((r) => r.id), samples.rounds.map((r) => r.id));
});
