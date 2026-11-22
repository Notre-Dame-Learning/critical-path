// Plan editor step 5: Submit, scoring and the debrief; the stand-in calendar; XP for a plan round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as P from '../engine/plan.js';
import * as G from '../engine/progression.js';
import * as V from '../app/plan-screen.js';
import * as U from '../app/plan-submit.js';
import { bundleContent } from '../scripts/content.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (p) => JSON.parse(fs.readFileSync(path.join(root, 'content', p)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const ids = load('projects.json').projects;
const intro = load('projects/intro-psych-online.json');
const base = load('plans/intro-psych-online.json');
const flaws = Object.fromEntries(P.CHECKS.map((c) => [c.id, load(`flaws/${c.flaw}.json`)]));
const noCalendar = (plan) => ({ ...plan, touchpoints: {}, gate: null });

function manualSchedule() {
  const q = [];
  return {
    q,
    frame: (fn) => { const h = { fn }; q.push(h); return h; },
    cancel: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    flush() { let n = 0; while (q.length) { q.shift().fn(); n++; } return n; },
  };
}

test('the stand-in calendar rebuilds every baseline\'s own calendar and gate from its windows', () => {
  for (const id of ids) {
    const project = load(`projects/${id}.json`);
    const plan = load(`plans/${id}.json`);
    const { plan: eff, standIn } = U.effectivePlan(noCalendar(plan), project, plan);
    assert.equal(standIn, true, id);
    assert.deepEqual(eff.touchpoints, plan.touchpoints, id);
    assert.equal(eff.gate, plan.gate, id);
  }
  // A plan with any calendar of its own, or no baseline, is left alone.
  assert.equal(U.effectivePlan(base, intro, base).standIn, false);
  assert.equal(U.effectivePlan(noCalendar(base), intro, null).standIn, false);
  // Moving QA earlier than the baseline's gate pulls the gate in front of it.
  const early = { ...noCalendar(base), tasks: { ...base.tasks, qa: { ...base.tasks.qa, start: 9, end: 10 } } };
  assert.equal(U.standInCalendar(early, intro, base).gate, 8);
  // An empty plan (nothing placed yet) doesn't throw.
  assert.doesNotThrow(() => U.standInCalendar(P.emptyPlan(intro, world), intro, base));
});

test('with a baseline, a calendar-less plan passes 8/8 and the two calendar checks say so', () => {
  // Without it, no working sessions means fewer faculty hours, so Load fails as well.
  const plain = V.planView(noCalendar(base), intro, world);
  assert.deepEqual(plain.checks.filter((c) => c.status === 'fail').map((c) => c.id), ['quality', 'load', 'stakeholders']);
  const view = V.planView(noCalendar(base), intro, world, { baseline: base });
  assert.equal(view.passed, 8);
  assert.equal(view.standIn, true);
  assert.deepEqual(view.checks.filter((c) => c.standIn).map((c) => c.id), G.CALENDAR_CHECKS);
  const html = V.checksHtml(view);
  assert.equal((html.match(/standard calendar<\/em>/g) ?? []).length, 2);
  assert.match(html, /can't plan the meeting calendar yet/);
});

test('the submit run works in slices, matches one scorePlan call and reuses the baseline\'s odds', () => {
  U.clearBaselineCache();
  const ctx = { world, project: intro, deck };
  const plan = U.effectivePlan(noCalendar(base), intro, base).plan;
  const sched = manualSchedule();
  const seen = [];
  let done = null;
  const run = U.createSubmitRun(ctx, base, { runs: 40, slice: 10, schedule: sched, onProgress: (p) => seen.push(p), onDone: (s) => { done = s; } });
  run.start(plan);
  assert.equal(sched.flush(), 8); // 4 slices of the player's plan, 4 of the baseline
  assert.deepEqual(seen.map((p) => p.done), [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.equal(seen.at(-1).total, 80);
  const direct = P.scorePlan(plan, base, ctx, { runs: 40, seed: U.SUBMIT.seed });
  assert.deepEqual({ ...done, runs: undefined }, { ...direct, runs: undefined });
  assert.equal(done.total, 95); // the model plan, re-entered, scores what the model plan scores
  // Second submit: the baseline is cached, so only the player's 4 slices run.
  done = null;
  seen.length = 0;
  run.start(plan);
  assert.equal(sched.flush(), 4);
  assert.equal(seen[0].total, 40);
  assert.equal(done.total, 95);
  // stop() mid-run cancels without finishing.
  done = null;
  run.start(plan);
  sched.q.shift().fn();
  run.stop();
  assert.equal(sched.flush(), 0);
  assert.equal(done, null);
});

test('the debrief turns failed checks into lessons from the flaw files and compares every window', () => {
  // Production starts a week early and doesn't wait for script review: Required links fails.
  const plan = U.effectivePlan(noCalendar({
    ...base,
    tasks: { ...base.tasks, production: { ...base.tasks.production, start: 4, end: 6, deps: base.tasks.production.deps.filter((d) => !d.startsWith('scriptreview')) } },
  }), intro, base).plan;
  const score = P.scorePlan(plan, base, { world, project: intro, deck }, { runs: 20, playerOdds: 0.6, baselineOdds: 0.865 });
  const m = U.debriefModel({ ...score, runs: 500 }, { plan, baseline: base, project: intro, world, flaws, standIn: true });
  assert.deepEqual(m.lessons.map((l) => l.id), ['links']); // Load's warning matches the model plan's: no lesson
  const link = m.lessons[0];
  assert.equal(link.concept, flaws.links.concept);
  assert.equal(link.sop, flaws.links.sop_ref);
  assert.match(link.reason, /Production days in studio doesn't wait for Script review/);
  const prod = m.rows.find((r) => r.id === 'production');
  assert.equal(prod.diff, 'starts 1 week earlier');
  assert.equal(prod.flagged, true);
  assert.equal(m.changed, 1);
  assert.equal(m.calendarPts, 20); // the two calendar checks (10) and the stakeholder plan (10)
  assert.deepEqual(m.parts.map((p) => p.max), [40, 40, 10, 10]);
  assert.equal(m.odds.player, 60);
  assert.match(m.headline, /27 points less often/);
  assert.equal(U.windowDiff({ start: 3, end: 6 }, { start: 3, end: 5 }), '1 week longer');
  assert.equal(U.windowDiff({ start: 5, end: 5 }, { start: 3, end: 5 }), 'starts 2 weeks later, 2 weeks shorter');
});

test('debrief HTML escapes text, shows ghost bars for both plans and the stand-in note', () => {
  const score = P.scorePlan(base, base, { world, project: intro, deck }, { runs: 20, playerOdds: 0.865, baselineOdds: 0.865 });
  const m = U.debriefModel({ ...score, runs: 500 }, { plan: base, baseline: base, project: { ...intro, title: 'Intro <script>' }, world, flaws, standIn: true });
  const html = U.debriefHtml(m);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Intro &lt;script&gt;/);
  assert.equal((html.match(/class="ghost"/g) ?? []).length, intro.tasks.length);
  assert.equal((html.match(/class="mine"/g) ?? []).length, intro.tasks.length);
  assert.match(html, /standard calendar fitted to your task weeks/);
  assert.match(html, /data-pe="debrief-edit"/);
  assert.match(U.checkingHtml({ phase: 'baseline', done: 600, total: 1000, share: 0.6 }), /aria-valuenow="60"/);
});

test('plan XP is the score ÷ 10 split by check, skips the stand-in\'s parts, and only beats your best', () => {
  // Every flaw file's skill track is the track its check pays XP on.
  for (const c of P.CHECKS) assert.equal(G.TRACK_LABEL[G.CHECK_TRACK[c.id]], flaws[c.id].skill_track, c.id);
  const score = P.scorePlan(base, base, { world, project: intro, deck }, { runs: 20, playerOdds: 0.865, baselineOdds: 0.865 });
  assert.equal(score.total, 95);
  const full = G.planXp(score);
  assert.equal(Object.values(full).reduce((s, x) => s + x, 0), 9.5);
  const standIn = G.planXp(score, { standIn: true });
  assert.equal(Object.values(standIn).reduce((s, x) => s + x, 0), 7.5);
  assert.equal(standIn.stakeholders, 0);
  assert.deepEqual(standIn, { planning: 3, estimating: 2.5, capacity: 1, risk: 0.5, stakeholders: 0, communication: 0, change: 0, leadership: 0.5 });

  const first = G.applyPlanRound(G.newProfile(), { project: intro.id, score, standIn: true });
  assert.equal(first.total, 7.5);
  assert.equal(first.profile.xp.planning, 3);
  assert.equal(first.profile.runs.length, 0); // rank gates read runs; a plan round isn't one
  assert.equal(first.profile.planRounds.length, 1);
  const again = G.applyPlanRound(first.profile, { project: intro.id, score, standIn: true });
  assert.equal(again.total, 0);
  assert.equal(again.profile.planRounds.length, 2);
  const better = G.applyPlanRound(again.profile, { project: intro.id, score, standIn: false });
  assert.deepEqual(better.gained, { planning: 0.5, stakeholders: 1.5 });
  // The export code carries plan rounds and bests.
  const back = G.importCode(G.exportCode(better.profile));
  assert.deepEqual(back.planBest, better.profile.planBest);
  assert.equal(back.planRounds.length, 3);
});

test('the bundle carries every project\'s model plan and the flaw file for each check', () => {
  const c = bundleContent(root);
  assert.deepEqual(Object.keys(c.plans).sort(), [...ids].sort());
  assert.deepEqual(Object.keys(c.flaws), P.CHECKS.map((x) => x.id));
  for (const f of Object.values(c.flaws)) assert.ok(f.concept && f.sop_ref && f.explanation);
  assert.equal(c.plans[intro.id].gate, base.gate);
});
