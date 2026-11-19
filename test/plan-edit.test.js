import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../engine/plan.js';
import * as E from '../app/plan-edit.js';
import { layout, loadStrip, calendarShading, weekAxis, barMarks } from '../app/plan-layout.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const intro = load('projects/intro-psych-online.json');
const rescue = load('projects/rescue-sustainable-business.json');
const base = load('plans/intro-psych-online.json');
const refused = (fn, code) => assert.throws(fn, (e) => e instanceof E.PlanEditError && e.code === code);

// Build the Intro baseline from an empty plan, one edit at a time, as a player would.
function enterBaseline(project, target) {
  let p = E.setGate(P.emptyPlan(project, world), target.gate);
  for (const t of P.workOrder(target, project)) {
    const x = target.tasks[t.id];
    if (x.locked) continue;
    for (const d of x.deps) p = E.addLink(p, P.parseDep(d).id, t.id);
    p = E.place(p, t.id, project);
    p = E.setWindow(p, t.id, x.start, x.end, project);
    p = E.setEstimate(p, t.id, x.est);
    if (x.backup) p = E.setBackup(p, t.id, x.backup, project);
  }
  for (const [w, row] of Object.entries(target.touchpoints)) row.forEach((s, i) => { p = E.setSlot(p, Number(w), i, s); });
  for (const r of target.risks) p = E.addRisk(p, r);
  return p;
}

test('entering the Intro baseline through the edit functions gives the plan file and passes 8/8', () => {
  const p = enterBaseline(intro, base);
  assert.deepEqual(p, base);
  assert.deepEqual(P.runChecks(p, intro, world).filter((c) => c.status === 'fail'), []);
});

test('every edit is pure: the plan it is given is unchanged', () => {
  const before = JSON.stringify(base);
  E.move(base, 'post', 1, intro);
  E.resize(base, 'post', 'end', -1, intro);
  E.unplace(base, 'qa');
  E.removeLink(base, 'scriptreview', 'production');
  E.setBackup(base, 'post', 'gd', intro);
  E.setSlot(base, 4, 0, 'checkin');
  E.copyWeek(base, 3, [4, 5]);
  E.setGate(base, 11);
  E.editRisk(E.addRisk(base, { text: 'x' }), 'risk-4', { owner: 'PM' });
  E.removeRisk(base, base.risks[0].id);
  E.setEstimate(base, 'post', [1, 2, 3]);
  assert.equal(JSON.stringify(base), before);
});

test('a link that would make a loop is refused in place, with the loop named', () => {
  let err;
  try { E.addLink(base, 'handoff', 'analysis'); } catch (e) { err = e; }
  assert.ok(err instanceof E.PlanEditError && err.code === 'loop');
  assert.equal(err.loop[0], err.loop.at(-1));
  assert.ok(err.loop.includes('handoff') && err.loop.includes('analysis'));
  assert.match(err.message, /analysis → .* → analysis|handoff → .* → handoff/);
  refused(() => E.addLink(base, 'post', 'post'), 'loop');
  // Retyping keeps one link: rolling post-production after animations, two weeks in.
  const p = E.retypeLink(base, 'animations', 'post', { lag: 2 });
  assert.deepEqual(p.tasks.post.deps, ['production', 'animations:SS+2']);
});

test('Place puts a task where its latest linked predecessor ends, for one week', () => {
  let p = E.unplace(base, 'post');
  p = E.place(p, 'post', intro);
  assert.deepEqual([p.tasks.post.start, p.tasks.post.end], [7, 7]); // production and animations end in week 7
  let q = E.unplace(P.emptyPlan(intro, world), 'analysis');
  q = E.place(q, 'analysis', intro);
  assert.deepEqual([q.tasks.analysis.start, q.tasks.analysis.end], [1, 1]);
});

test('refusals: too early, past launch, locked, bad backup, bad slot, bad gate', () => {
  const r = load('plans/rescue-sustainable-business.json');
  refused(() => E.setWindow(r, 'production', 5, 8, rescue), 'too_early'); // you join in week 6
  assert.equal(E.setWindow(r, 'scripts', 4, 7, rescue).tasks.scripts.start, 4); // under way when you joined
  refused(() => E.setWindow(r, 'coursemap', 2, 4, rescue), 'locked');
  refused(() => E.move(base, 'handoff', 2, intro), 'past_launch');
  refused(() => E.setWindow(base, 'post', 9, 8, intro), 'bad_window');
  refused(() => E.setBackup(base, 'post', 'mp', intro), 'bad_backup'); // the owner
  refused(() => E.setBackup(base, 'post', 'faculty', intro), 'bad_backup');
  refused(() => E.setSlot(base, 3, 0, 'pizza-party'), 'bad_slot');
  refused(() => E.setSlot(base, 15, 0, 'checkin'), 'bad_slot');
  refused(() => E.setSlot(base, 3, 2, 'checkin'), 'bad_slot');
  refused(() => E.setGate(base, 0), 'bad_gate');
  refused(() => E.setEstimate(base, 'post', [1, 2]), 'bad_estimate');
});

test('undo after three edits restores the original; redo replays; refused edits leave no entry; 50 kept', () => {
  let h = E.history(base);
  h = E.apply(h, (p) => E.move(p, 'post', 1, intro));
  h = E.apply(h, (p) => E.setGate(p, 9));
  h = E.apply(h, (p) => E.setBackup(p, 'post', 'gd', intro));
  assert.throws(() => E.apply(h, (p) => E.addLink(p, 'handoff', 'analysis')));
  assert.equal(h.past.length, 3);
  const after = h.present;
  h = E.undo(E.undo(E.undo(h)));
  assert.deepEqual(h.present, base);
  assert.equal(E.undo(h), h);
  h = E.redo(E.redo(E.redo(h)));
  assert.deepEqual(h.present, after);
  let long = E.history(base);
  for (let i = 0; i < 60; i++) long = E.apply(long, (p) => E.setGate(p, 2 + (i % 8)));
  assert.equal(long.past.length, E.HISTORY_LIMIT);
});

test('removing the script review → production link fails only Required links, and the bar is marked', () => {
  const p = E.removeLink(base, 'scriptreview', 'production');
  const checks = P.runChecks(p, intro, world);
  assert.deepEqual(checks.filter((c) => c.status === 'fail').map((c) => c.id), ['links']);
  const view = layout(p, intro, world, { checks });
  const prod = view.rows.find((r) => r.id === 'production');
  assert.equal(prod.mark.status, 'fail');
  assert.deepEqual(prod.mark.checks.map((c) => c.id), ['links']);
  assert.deepEqual(barMarks(P.runChecks(base, intro, world)).post.checks.map((c) => c.id), ['load']); // the 94% warning
});

test('layout: week axis with the launch column, bar positions, and the Unscheduled tray', () => {
  const axis = weekAxis(base);
  assert.equal(axis.length, 14);
  assert.deepEqual(axis.filter((w) => w.launch).map((w) => w.week), [14]);
  const view = layout(E.unplace(base, 'handoff'), intro, world);
  const post = view.rows.find((r) => r.id === 'post');
  assert.equal(post.ownerName, 'Perrick');
  assert.ok(Math.abs(post.left - 7 / 14) < 1e-9 && Math.abs(post.width - 3 / 14) < 1e-9);
  assert.deepEqual(view.unscheduled.map((r) => r.id), ['handoff']);
  assert.ok(view.rows.findIndex((r) => r.id === 'embed') < view.rows.findIndex((r) => r.id === 'qa'));
  const rplan = load('plans/rescue-sustainable-business.json');
  const r = layout(rplan, rescue, world);
  assert.deepEqual(weekAxis(rplan).filter((w) => w.beforeJoin).map((w) => w.week), [1, 2, 3, 4, 5]);
  assert.ok(r.rows.find((x) => x.id === 'coursemap').locked);
});

test('load strip matches the Load check: Perrick 94% in weeks 8–10, and red only when the check fails', () => {
  const strip = loadStrip(base, intro, world);
  assert.equal(Math.round(strip.mp.peak.share * 100), 94);
  assert.equal(strip.mp.peak.level, 'warn');
  assert.deepEqual(strip.mp.weeks.filter((w) => w.level === 'warn').map((w) => w.week), [8, 9, 10]);
  const squeezed = E.setWindow(base, 'post', 8, 9, intro);
  const s2 = loadStrip(squeezed, intro, world);
  assert.deepEqual(s2.mp.weeks.filter((w) => w.level === 'fail').map((w) => w.week), [8, 9]);
  assert.equal(P.runChecks(squeezed, intro, world).find((c) => c.id === 'load').status, 'fail');
});

test('calendar shading shows faculty-contact gaps and faculty-owned weeks; drafts survive only for the same task bank', () => {
  const c = calendarShading(base, intro);
  assert.deepEqual(c.gapWeeks, []);
  assert.deepEqual(c.facultyOpen, [3, 4, 5, 6]);
  let quiet = base;
  for (const w of [7, 8, 9]) for (const i of [0, 1]) quiet = E.setSlot(quiet, w, i, i === 0 ? 'checkin' : null);
  assert.deepEqual(calendarShading(quiet, intro).gapWeeks, [7, 8, 9]);

  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.ok(E.saveDraft(store, intro, world, quiet));
  assert.deepEqual(E.loadDraft(store, intro, world), quiet);
  const changed = structuredClone(intro);
  changed.tasks.find((t) => t.id === 'post').effort = 30;
  assert.equal(E.loadDraft(store, changed, world), null);
  assert.equal(mem.size, 0, 'a stale draft is dropped');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(E.saveDraft(broken, intro, world, base), false);
  assert.equal(E.loadDraft(broken, intro, world), null);
});
