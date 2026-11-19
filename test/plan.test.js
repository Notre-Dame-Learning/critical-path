import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../engine/plan.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;
const baseline = (p) => load(`plans/${p.id}.json`);
const ctx = (project) => ({ world, project, deck });
const failing = (plan, project) => P.runChecks(plan, project, world).filter((c) => c.status === 'fail').map((c) => c.id);
const clone = (x) => structuredClone(x);

test('all three baselines are submittable and pass 8/8 checks', () => {
  for (const p of projects) {
    const plan = baseline(p);
    assert.equal(plan.project, p.id);
    assert.deepEqual(P.blockers(plan, p), [], p.id);
    const checks = P.runChecks(plan, p, world);
    assert.equal(checks.length, 8);
    assert.deepEqual(failing(plan, p), [], p.id);
  }
  // The doc's Intro figure: Perrick peaks at 94% in post-production, a warning under the 100% line.
  const perrick = P.loadReport(baseline(intro), intro, world).mp.peak;
  assert.equal(Math.round(perrick.share * 100), 94);
  assert.deepEqual([perrick.from, perrick.to], [8, 10]);
});

test('the task bank quotes Perrick 25% low, keeps the graph as required links, and locks inherited work', () => {
  const bank = P.taskBank(intro, world);
  const post = bank.find((t) => t.id === 'post');
  const course = bank.find((t) => t.id === 'coursemap');
  assert.deepEqual(post.quote, P.estimateFor(24).map((h) => Math.round(h * 0.75)));
  assert.equal(post.quotedBy, 'Perrick');
  assert.deepEqual(course.quote, [11, 14, 19]);
  assert.deepEqual(bank.find((t) => t.id === 'production').requiredLinks, ['scriptreview']);
  assert.equal(P.requiredLinks(intro).length, intro.tasks.reduce((n, t) => n + t.dependsOn.length, 0));
  const rb = P.taskBank(rescue, world);
  assert.ok(rb.find((t) => t.id === 'coursemap').inherited);
  const scripts = rb.find((t) => t.id === 'scripts');
  assert.ok(scripts.started && !scripts.inherited && scripts.quote[1] < 16);
});

test('submit blockers: unplaced tasks, loops, windows past launch and bad estimates', () => {
  const empty = P.emptyPlan(intro, world);
  assert.equal(P.blockers(empty, intro).filter((b) => b.code === 'unplaced').length, intro.tasks.length);
  const plan = baseline(intro);
  plan.tasks.analysis.deps = ['handoff'];
  plan.tasks.qa.end = 15;
  plan.tasks.post.est = [30, 24, 32];
  const codes = P.blockers(plan, intro).map((b) => b.code).sort();
  assert.deepEqual(codes, ['estimate', 'loop', 'past_launch']);
  assert.match(P.blockers(plan, intro).find((b) => b.code === 'loop').reason, /analysis → .* → handoff → analysis/);
  // In a rescue, unstarted work can't be planned before the player joins in week 6.
  const r = baseline(rescue);
  r.tasks.production.start = 4;
  assert.deepEqual(P.blockers(r, rescue).map((b) => b.code), ['before_join']);
});

test('each Plan-flaw plant fails exactly its own check on the Intro baseline', () => {
  const b = baseline(intro);
  const plants = {
    links: (p) => { p.tasks.production.deps = []; },
    buffer: (p) => { Object.assign(p.tasks.embed, { start: 13, end: 13 }); Object.assign(p.tasks.qa, { start: 13, end: 14 }); Object.assign(p.tasks.handoff, { start: 14, end: 14 }); },
    quality: (p) => { for (const w of Object.keys(p.touchpoints)) p.touchpoints[w] = p.touchpoints[w].map((s) => (s === 'qa-review' ? 'faculty-update' : s)); p.touchpoints[11][1] = 'qa-review'; },
    load: (p) => { Object.assign(p.tasks.post, { start: 8, end: 9 }); },
    backup: (p) => { for (const t of Object.values(p.tasks)) t.backup = null; },
    risks: (p) => { for (const r of p.risks.slice(0, 2)) Object.assign(r, { owner: '', trigger: '' }); },
    sequence: (p) => { p.tasks.scripts.start = 1; },
    stakeholders: (p) => { p.gate = null; for (const w of Object.keys(p.touchpoints)) p.touchpoints[w] = p.touchpoints[w].map((s) => (s === 'faculty-update' ? null : s)); },
  };
  for (const [check, plant] of Object.entries(plants)) {
    const p = clone(b);
    plant(p);
    assert.deepEqual(P.blockers(p, intro), [], check);
    assert.deepEqual(failing(p, intro), [check], check);
  }
  assert.match(P.runChecks((() => { const p = clone(b); plants.load(p); return p; })(), intro, world).find((c) => c.id === 'load').reason, /Perrick is at 1\d\d% in weeks 8–9/);
});

test('the critical path runs through the long chain and Li carries five of it', () => {
  const cp = P.criticalPath(baseline(intro), intro);
  assert.deepEqual(cp, ['analysis', 'coursemap', 'scripts', 'scriptreview', 'animations', 'post', 'distribution', 'embed', 'qa', 'handoff']);
  assert.equal(cp.filter((id) => intro.tasks.find((t) => t.id === id).owner === 'ld').length, 5);
});

test('a plan plays on the real engine: deterministic, and a missing link plants its rework', () => {
  const plan = baseline(documentary);
  const a = P.playPlan(plan, { ...ctx(documentary), seed: 'p1' });
  const b = P.playPlan(plan, { ...ctx(documentary), seed: 'p1' });
  assert.deepEqual(a.result, b.result);
  assert.ok(a.over && a.decisions.every((d) => d.credit >= 0.95), 'every situation gets its best answer');
  assert.ok(a.actionsTaken.some((x) => x.actionId === 'working-session') && a.actionsTaken.some((x) => x.actionId === 'qa-review'));
  const cut = clone(plan);
  cut.tasks.production.deps = cut.tasks.production.deps.filter((d) => d !== 'scriptreview');
  cut.tasks.production.start = 2; // with the link gone, the shoot is planned early
  const g = P.playPlan(cut, { ...ctx(documentary), seed: 'p1', situations: false });
  const prod = g.tasks.find((t) => t.id === 'production');
  assert.ok(prod.startedWeek < g.tasks.find((t) => t.id === 'scriptreview').finishedWeek, 'the shoot starts before script review is done');
  assert.ok(prod.hidden + prod.known > 0 || prod.finishedWeek > g.tasks.find((t) => t.id === 'scriptreview').finishedWeek, 'the reshoot waits for approved scripts');
  const i = baseline(intro);
  const icut = clone(i);
  icut.tasks.production.deps = [];
  const odds = (p) => P.onTimeOdds(p, ctx(intro), { runs: 200, seed: 't' }).share;
  assert.ok(odds(icut) < odds(i) - 0.1, 'shooting unapproved scripts costs Intro to Psychology its margin');
});

test('a task never starts before its planned week, and work hands over within the week', () => {
  const plan = baseline(intro);
  const late = clone(plan);
  Object.assign(late.tasks.mastersite, { start: 11, end: 12 });
  for (let i = 0; i < 20; i++) {
    const g = P.playPlan(late, { ...ctx(intro), seed: `w${i}` });
    for (const t of g.tasks) if (t.startedWeek !== null && !late.tasks[t.id].locked) assert.ok(t.startedWeek >= late.tasks[t.id].start, `${t.id} started week ${t.startedWeek}`);
    const embed = g.tasks.find((t) => t.id === 'embed');
    const qa = g.tasks.find((t) => t.id === 'qa');
    if (embed.finishedWeek && qa.startedWeek) assert.ok(qa.startedWeek <= embed.finishedWeek + 1);
  }
  // Work order follows the links even when a successor is planned earlier than its input.
  const early = clone(plan);
  early.tasks.qa.start = 11;
  const order = P.workOrder(early, intro).map((t) => t.id);
  assert.ok(order.indexOf('embed') < order.indexOf('qa'));
  // Planning the build late costs odds: binding starts is what makes a plan's dates matter.
  const odds = (p) => P.onTimeOdds(p, ctx(intro), { runs: 200, seed: 'late' }).share;
  assert.ok(odds(late) < odds(plan) - 0.1);
});

test('on-time odds: the touchpoint calendar is the biggest lever, and odds can be run in slices', () => {
  const plan = baseline(intro);
  const c = ctx(intro);
  const full = P.onTimeOdds(plan, c, { runs: 200, seed: 's' });
  assert.ok(full.share >= 0.75 && full.share <= 0.95, `Intro baseline ${full.share}`);
  const none = clone(plan);
  none.touchpoints = {};
  assert.ok(P.onTimeOdds(none, c, { runs: 200, seed: 's' }).share < 0.4, 'no touchpoints at all sinks the plan');
  const s1 = P.onTimeOdds(plan, c, { runs: 100, seed: 's', from: 0 });
  const s2 = P.onTimeOdds(plan, c, { runs: 100, seed: 's', from: 100 });
  assert.equal(s1.onTime + s2.onTime, full.onTime);
  const rescueOdds = P.onTimeOdds(baseline(rescue), ctx(rescue), { runs: 200, seed: 's' }).share;
  assert.ok(rescueOdds > 0.5 && rescueOdds < 0.85, `Rescue baseline ${rescueOdds}`);
});

test('scoring: the baseline scores 95 against itself, a flawed plan less, a blocked plan not at all', () => {
  const plan = baseline(intro);
  const c = ctx(intro);
  const base = P.scorePlan(plan, plan, c, { runs: 150, seed: 'sc' });
  assert.equal(base.total, 95); // 40 odds + 40 checks + 5 load (Perrick 94%) + 10 stakeholders
  assert.deepEqual(base.parts, { odds: 40, checks: 40, load: 5, stakeholders: 10 });
  const flawed = clone(plan);
  flawed.gate = null;
  Object.assign(flawed.tasks.post, { start: 8, end: 9 });
  const s = P.scorePlan(flawed, plan, c, { runs: 150, seed: 'sc', baselineOdds: base.odds.baseline });
  assert.equal(s.parts.checks, 30);
  assert.equal(s.parts.load, 0);
  assert.equal(s.parts.stakeholders, 5);
  assert.ok(s.total < 80);
  assert.equal(P.scorePlan(P.emptyPlan(intro, world), plan, c).submittable, false);
});
