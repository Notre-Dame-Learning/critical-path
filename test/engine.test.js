import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const project = load('projects/intro-psych-online.json');
const deck = load('scenarios/core-deck.json');

function play(seed, pickChoice, actionsFor = () => []) {
  const g = S.createGame({ world, project, deck, seed });
  while (!g.over) {
    const ev = S.currentEvent(g);
    if (ev) S.chooseOption(g, pickChoice(ev).id);
    for (const a of actionsFor(g)) if (g.actionPoints > 0) S.takeAction(g, a);
    S.advanceWeek(g);
  }
  return g;
}
const best = (ev) => ev.choices.find((c) => (c.credit ?? S.TIER_CREDIT[c.tier]) === 1);
const worst = (ev) => ev.choices.find((c) => c.tier === 'ignore') ?? ev.choices.at(-1);
const goodHabits = (g) => (g.week % 3 === 0 ? ['qa-review', 'faculty-update'] : ['checkin', 'working-session']);

test('same seed and same choices give the same result', () => {
  const a = play('repeat', best, goodHabits);
  const b = play('repeat', best, goodHabits);
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.log, b.log);
});

test('content is internally consistent', () => {
  const ids = new Set(project.tasks.map((t) => t.id));
  for (const t of project.tasks) for (const d of t.dependsOn) assert.ok(ids.has(d), `${t.id} depends on missing ${d}`);
  for (const e of deck.events) {
    assert.ok(e.debrief?.independent && e.debrief?.escalateWhen, `${e.id} needs both debrief explanations`);
    assert.ok(e.choices.length >= 2);
    for (const c of e.choices) {
      assert.ok(c.tier in S.TIER_CREDIT, `${e.id}/${c.id} bad tier`);
      for (const fx of c.effects) if (fx.task) assert.ok(ids.has(fx.task), `${e.id}/${c.id} effect on missing task ${fx.task}`);
    }
    const full = e.choices.filter((c) => (c.credit ?? S.TIER_CREDIT[c.tier]) === 1);
    assert.equal(full.length, 1, `${e.id} needs exactly one best answer`);
    assert.ok(e.choices.length >= 3, `${e.id} needs at least three choices`);
    for (const c of e.choices) assert.ok(c.why && c.outcome, `${e.id}/${c.id} needs outcome and why`);
    assert.ok(['ld', 'mp', 'faculty', 'sup'].includes(e.who), `${e.id} needs a who`);
  }
});

test('good play beats passive play on average', () => {
  let good = 0, bad = 0;
  for (let i = 0; i < 40; i++) {
    good += play(`cmp${i}`, best, goodHabits).result.overall;
    bad += play(`cmp${i}`, worst).result.overall;
  }
  assert.ok(good / 40 > bad / 40 + 20, `good ${good / 40} vs bad ${bad / 40}`);
});

test('strong play usually launches on time; passive play rarely does', () => {
  let strong = 0, passive = 0;
  for (let i = 0; i < 60; i++) {
    if (play(`ot${i}`, best, goodHabits).result.launchedOnTime) strong++;
    if (play(`ot${i}`, worst).result.launchedOnTime) passive++;
  }
  assert.ok(strong / 60 >= 0.8, `strong on-time rate ${strong / 60}`);
  assert.ok(passive / 60 <= 0.2, `passive on-time rate ${passive / 60}`);
});

test('escalation earns partial credit and the debrief explains the independent fix', () => {
  const escalate = (ev) => ev.choices.find((c) => c.tier === 'escalate_plan') ?? ev.choices[0];
  const g = play('esc', escalate, goodHabits);
  const lessons = S.debrief(g).filter((l) => l.kind === 'decision');
  assert.ok(lessons.length > 0);
  for (const l of lessons) {
    assert.ok(l.independent.length > 20);
    assert.ok(l.credit >= 0 && l.credit <= 1);
  }
});

test('the game refuses to advance with an unresolved situation', () => {
  for (let i = 0; i < 50; i++) {
    const g = S.createGame({ world, project, deck, seed: `pend${i}` });
    while (!g.over && !g.pendingEvent) S.advanceWeek(g);
    if (g.pendingEvent) {
      assert.throws(() => S.advanceWeek(g), /Resolve/);
      assert.throws(() => S.takeAction(g, 'checkin'), /Resolve/);
      return;
    }
  }
  assert.fail('no event fired in 50 seeds');
});

test('quality reviews surface hidden rework', () => {
  const g = S.createGame({ world, project, deck: { events: [] }, seed: 'qa' });
  for (let i = 0; i < 4; i++) S.advanceWeek(g);
  const before = g.tasks.reduce((s, t) => s + t.hidden, 0);
  S.takeAction(g, 'qa-review');
  const after = g.tasks.reduce((s, t) => s + t.hidden, 0);
  assert.ok(after < before * 0.5, `hidden ${before} -> ${after}`);
});

test('a situation comes up at least every other week', () => {
  for (let i = 0; i < 100; i++) {
    const g = play(`gap${i}`, best, goodHabits);
    const weeks = g.decisions.map((d) => d.week);
    const lastWeek = g.log.at(-1).week;
    for (let w = 2; w <= lastWeek; w += 1) {
      assert.ok(weeks.some((x) => x === w || x === w - 1), `seed gap${i}: no situation in weeks ${w - 1}-${w}`);
    }
  }
});

test('the best answer is not always shown first', () => {
  let firstIsBest = 0, total = 0;
  for (let i = 0; i < 20; i++) {
    const g = S.createGame({ world, project, deck, seed: `order${i}` });
    for (const ev of deck.events) {
      total++;
      if (S.choicesInOrder(g, ev)[0].id === S.bestChoice(ev).id) firstIsBest++;
    }
  }
  assert.ok(firstIsBest / total < 0.45, `best shown first ${firstIsBest}/${total}`);
});
