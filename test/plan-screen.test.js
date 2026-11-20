import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../engine/plan.js';
import * as E from '../app/plan-edit.js';
import * as V from '../app/plan-screen.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const intro = load('projects/intro-psych-online.json');
const rescue = load('projects/rescue-sustainable-business.json');
const base = load('plans/intro-psych-online.json');
const run = (plan, ops, project = intro) => ops.reduce((p, op) => V.editFor(op, project)(p), plan);

// The screen's own ops, in the order a player would tap them, from an empty plan to the Intro baseline.
function baselineOps(target, project) {
  const ops = [];
  for (const t of P.workOrder(target, project)) {
    const x = target.tasks[t.id];
    if (x.locked) continue;
    for (const d of x.deps) ops.push({ op: 'link', from: P.parseDep(d).id, to: t.id, kind: V.kindOf(P.parseDep(d).type === 'FS' ? 'FS' : `SS+${P.parseDep(d).lag}`) });
    ops.push({ op: 'place', id: t.id }, { op: 'window', id: t.id, start: x.start, end: x.end }, { op: 'estimate', id: t.id, est: x.est });
    if (x.backup) ops.push({ op: 'backup', id: t.id, role: x.backup });
  }
  return ops;
}
const withCalendar = (p) => ({ ...p, touchpoints: base.touchpoints, gate: base.gate, risks: base.risks });

test('the screen\'s ops rebuild the Intro baseline; the header shows 8/8 and an open Submit', () => {
  const p = withCalendar(run(P.emptyPlan(intro, world), baselineOps(base, intro)));
  assert.deepEqual(p, base);
  const v = V.planView(p, intro, world);
  assert.equal(v.passed, 8);
  assert.equal(v.blockers.length, 0);
  const html = V.screenHtml(v, {});
  assert.match(html, /<strong>8\/8<\/strong>/);
  assert.match(html, /Submit plan/);
  assert.doesNotMatch(html, /aria-disabled/);
  assert.equal((html.match(/data-pe="bar"/g) ?? []).length, intro.tasks.length);
  assert.match(html, /Every task has weeks/);
});

test('an empty plan puts every task in the tray and Submit names what blocks it', () => {
  const v = V.planView(P.emptyPlan(intro, world), intro, world);
  const html = V.timelineHtml(v);
  assert.match(html, new RegExp(`Unscheduled \\(${intro.tasks.length}\\)`));
  assert.equal((html.match(/data-pe="bar"/g) ?? []).length, 0);
  assert.match(V.headerHtml(v), new RegExp(`Submit · ${v.blockers.length} to fix`));
  assert.ok(v.blockers.every((b) => b.code === 'unplaced'));
});

test('removing the script review → production link fails only Required links, and marks those two bars', () => {
  const p = run(base, [{ op: 'unlink', from: 'scriptreview', to: 'production' }]);
  const v = V.planView(p, intro, world);
  assert.deepEqual(v.checks.filter((c) => c.status === 'fail').map((c) => c.id), ['links']);
  assert.equal(v.passed, 7);
  const html = V.timelineHtml(v);
  for (const id of ['scriptreview', 'production']) assert.match(html, new RegExp(`class="pe-bar mark-fail" data-pe="bar" data-id="${id}"`));
  assert.match(html, /class="pe-bar mark-warn" data-pe="bar" data-id="post"/); // Perrick's load warning, as on the baseline
  const panel = V.checksHtml(v);
  assert.equal((panel.match(/class="pe-check fail/g) ?? []).length, 1);
});

test('tapping a check lights up what it names; long reasons fold until tapped', () => {
  const v = V.planView(P.emptyPlan(intro, world), intro, world);
  const links = v.checks.find((c) => c.id === 'links');
  const hl = { ...V.targetsOf(links), key: 'check:links' };
  assert.ok(hl.tasks.includes('production'));
  assert.match(V.checksHtml(v), /; and \d+ more/);
  assert.doesNotMatch(V.checksHtml(v, { highlight: hl }).match(/data-id="links"[\s\S]*?<\/button>/)[0], /and \d+ more/);
  const placed = V.planView(base, intro, world);
  const row = V.timelineHtml(placed, { highlight: { tasks: ['post'], weeks: [8] } });
  assert.match(row, /class="pe-row hl" data-row="post"/);
  assert.equal((row.match(/<i class="hl">/g) ?? []).length, intro.tasks.length); // week 8 in every row
});

test('keys and drags map to week edits; a loop is refused through the same ops', () => {
  assert.deepEqual(V.keyOp('ArrowRight', {}, 'post'), { op: 'move', id: 'post', by: 1 });
  assert.deepEqual(V.keyOp('ArrowLeft', { shift: true }, 'post'), { op: 'resize', id: 'post', which: 'end', by: -1 });
  assert.equal(V.keyOp('Enter', {}, 'post'), null);
  assert.deepEqual(V.dragOp('post', 'body', 95, 40), { op: 'move', id: 'post', by: 2 });
  assert.deepEqual(V.dragOp('post', 'start', -41, 40), { op: 'resize', id: 'post', which: 'start', by: -1 });
  assert.equal(V.dragOp('post', 'end', 15, 40), null);
  const moved = run(base, [V.keyOp('ArrowRight', {}, 'post'), V.dragOp('post', 'end', 40, 40)]);
  assert.deepEqual([moved.tasks.post.start, moved.tasks.post.end], [base.tasks.post.start + 1, base.tasks.post.end + 2]);
  assert.throws(() => run(base, [{ op: 'link', from: 'handoff', to: 'analysis' }]), (e) => e instanceof E.PlanEditError && e.code === 'loop');
});

test('the task sheet: quote as given, staff backups only, links with their kind, hint at Coordinator only', () => {
  const m = V.sheetModel(base, intro, world, 'post', { rank: 'coordinator' });
  assert.equal(m.quotedBy, 'Perrick');
  assert.deepEqual(m.quote, P.taskBank(intro, world).find((b) => b.id === 'post').quote);
  assert.deepEqual(m.backups.map((b) => b.role), ['ld', 'gd']);
  assert.deepEqual(m.links.map((l) => [l.from, l.kind]), [['production', 'FS'], ['animations', 'FS']]);
  assert.ok(!m.candidates.some((c) => c.id === 'post' || c.id === 'production'));
  assert.ok(m.hint.weeks >= 1 && m.hint.who === 'Perrick');
  assert.equal(V.sheetModel(base, intro, world, 'post', { rank: 'pm' }).hint, null);
  const rolled = run(base, [{ op: 'retype', from: 'animations', to: 'post', kind: V.kindOf('SS+2') }]);
  assert.equal(V.sheetModel(rolled, intro, world, 'post').links[1].kind, 'SS+2');
  const bad = V.sheetHtml(V.sheetModel(run(base, [{ op: 'estimate', id: 'post', est: [30, 20, 10] }]), intro, world, 'post'));
  assert.match(bad, /Low ≤ likely ≤ high/);
});

test('Rescue: finished tasks are locked rows with no drag handles and a read-only sheet', () => {
  const r = load('plans/rescue-sustainable-business.json');
  const html = V.timelineHtml(V.planView(r, rescue, world));
  assert.match(html, /data-id="coursemap"[^>]*data-locked="1"/);
  assert.match(html, /class="pe-row locked" data-row="analysis"/);
  assert.equal((html.match(/<i class="before">/g) ?? []).length, 5 * rescue.tasks.length); // weeks 1–5 greyed
  const sheet = V.sheetHtml(V.sheetModel(r, rescue, world, 'coursemap'));
  assert.match(sheet, /Finished before you joined in week 6/);
  assert.doesNotMatch(sheet, /data-pe="step"|data-pe="unlink"|Add link/);
});
