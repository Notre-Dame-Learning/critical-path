import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { createGameAt } from '../engine/difficulty.js';
import * as M from '../engine/moves.js';
import { readTheBoard } from '../engine/montecarlo.js';
import { TIPS, nextTip, seenTips, markSeen, tipsEnabled, setTipsEnabled } from '../app/coach.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];

// Play a run, asking the coach at every point the screen would, and dismissing each tip it shows.
function coachedRun(project, seed, { play = 'best', mode = 'standard' } = {}) {
  const g = createGameAt(S, { world, project, deck, seed, mode });
  const seen = new Set();
  const shown = [];
  const ask = () => { for (let t = nextTip(g, seen); t; t = nextTip(g, seen)) { shown.push({ ...t, week: g.week, inSituation: Boolean(g.pendingEvent) }); seen.add(t.id); } };
  while (!g.over) {
    ask();
    const ev = S.currentEvent(g);
    if (ev) {
      const sorted = [...ev.choices].sort((a, b) => credit(b) - credit(a));
      S.chooseOption(g, (play === 'best' ? sorted[0] : sorted.at(-1)).id);
      ask();
    }
    if (play === 'best') readTheBoard(g);
    else for (let i = 0; i < 2 && g.actionPoints > 0; i++) M.takeMove(g, 'overtime:mp');
    ask();
    M.endWeek(g);
  }
  assert.equal(nextTip(g, new Set()), null, 'no tip once the course has launched');
  return { g, shown };
}

test('each tip shows at most once, and a first run opens with Action Points, the first situation and End week', () => {
  for (let i = 0; i < 20; i++) {
    const { shown } = coachedRun(intro, `c${i}`);
    const ids = shown.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, 'no repeats');
    assert.ok(['action-points', 'first-situation'].includes(ids[0]), ids[0]); // a week-1 situation comes first
    assert.ok(ids.includes('recap'));
    const order = ['action-points', 'end-week', 'recap'].map((id) => ids.indexOf(id)).filter((x) => x >= 0);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(shown.filter((t) => t.inSituation).every((t) => t.id === 'first-situation'), 'only the first-situation tip during a situation');
    assert.ok(ids.indexOf('action-points') < ids.indexOf('end-week') || !ids.includes('end-week'));
  }
  const counts = Array.from({ length: 30 }, (_, i) => coachedRun(intro, `n${i}`).shown.length);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  assert.ok(avg >= 5 && avg <= 9, `about 6 tips a run (${avg})`);
});

test('a rough run brings the warning tips: behind, low morale and rework', () => {
  const ids = new Set();
  for (let i = 0; i < 10; i++) for (const t of coachedRun(intro, `r${i}`, { play: 'worst' }).shown) ids.add(t.id);
  for (const id of ['behind', 'low-morale', 'rework-found']) assert.ok(ids.has(id), id);
});

test('Rescue opens with the takeover tip; the other projects never show it', () => {
  const r = coachedRun(rescue, 'take').shown;
  assert.equal(r[0].id, 'takeover');
  assert.match(r[0].text, /week 6/);
  for (const p of [intro, documentary]) for (let i = 0; i < 5; i++) assert.ok(!coachedRun(p, `t${i}`).shown.some((t) => t.id === 'takeover'));
});

test('no tip leaves a name unfilled or gives away a situation option, in either mode', () => {
  const labels = deck.events.flatMap((e) => e.choices.map((c) => c.label.toLowerCase()));
  for (const mode of ['standard', 'hard']) {
    for (const p of projects) {
      const { shown } = coachedRun(p, `m-${mode}`, { mode, play: 'worst' });
      for (const t of shown) {
        assert.ok(!/[{}]/.test(t.text), `${t.id}: ${t.text}`);
        assert.ok(!labels.some((l) => t.text.toLowerCase().includes(l.slice(0, 40))), `${t.id} repeats an option`);
      }
    }
  }
  assert.equal(TIPS.length, 12);
  const story = createGameAt(S, { world, project: intro, deck, seed: 'ap', difficulty: 'story' });
  assert.match(nextTip(story).text, /3 Action Points/);
});

test('tips remembered per browser, can be turned off, and work without storage', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(tipsEnabled(store));
  markSeen(store, 'recap');
  markSeen(store, 'recap');
  assert.deepEqual([...seenTips(store)], ['recap']);
  setTipsEnabled(store, false);
  assert.equal(tipsEnabled(store), false);
  assert.deepEqual([...seenTips(store)], ['recap'], 'turning tips off keeps what was seen');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  markSeen(broken, 'behind');
  assert.ok(seenTips(broken).has('behind'), 'kept in memory for this page');
  assert.ok(seenTips(null).has('behind'));
});
