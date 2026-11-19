// test/difficulty.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { applyDifficulty, createGameAt } from '../engine/difficulty.js';
import { defaultDifficulty, rememberDifficulty, difficultyHtml } from '../app/difficulty-picker.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;

const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const habits = (g) => (g.week % 3 === 0 ? ['qa-review', 'faculty-update'] : ['checkin', 'working-session']);

function play(project, seed, difficulty, { pick = 'best', act = true } = {}) {
  const g = createGameAt(S, { world, project, deck, seed, difficulty });
  while (!g.over) {
    const ev = S.currentEvent(g);
    if (ev) {
      const sorted = [...ev.choices].sort((a, b) => credit(b) - credit(a));
      const c = pick === 'best' ? sorted[0] : pick === 'worst' ? sorted.at(-1) : sorted[(g.week + seed.length) % sorted.length];
      S.chooseOption(g, c.id);
    }
    if (act) for (const a of habits(g)) if (g.actionPoints > 0) S.takeAction(g, a);
    S.advanceWeek(g);
  }
  return g;
}
const onTime = (project, level, opts) => {
  let n = 0;
  for (let i = 0; i < 60; i++) if (play(project, `d${i}`, level, opts).result.launchedOnTime) n++;
  return n / 60;
};

test('Standard leaves content unchanged and Story never edits the originals', () => {
  const before = JSON.stringify({ world, projects });
  for (const p of projects) {
    const std = applyDifficulty(world, p, 'standard');
    assert.deepEqual(std, { world, project: p });
    const story = applyDifficulty(world, p, 'story');
    assert.equal(story.project.launchWeek, p.launchWeek + 1);
    assert.equal(story.project.actionPointsPerWeek, (p.actionPointsPerWeek ?? 2) + 1);
  }
  assert.equal(JSON.stringify({ world, projects }), before);
  assert.equal(applyDifficulty(world, rescue, 'story').project.initial.trust, rescue.initial.trust + 10);
  assert.throws(() => applyDifficulty(world, intro, 'nightmare'));
});

test('Story is kinder to new players without making passive play work', () => {
  for (const p of [intro, documentary]) {
    assert.ok(onTime(p, 'story') >= 0.95, `${p.id}: best play on Story`);
    assert.ok(onTime(p, 'story', { pick: 'cycle' }) >= onTime(p, 'standard', { pick: 'cycle' }), `${p.id}: Story beats Standard`);
    assert.ok(onTime(p, 'story', { pick: 'worst', act: false }) <= 0.05, `${p.id}: passive still fails`);
  }
});

test('a run replays exactly from seed, mode and difficulty', () => {
  const a = play(rescue, 'same', 'story');
  const b = play(rescue, 'same', 'story');
  assert.equal(a.difficulty, 'story');
  assert.deepEqual(a.result, b.result);
  assert.equal(a.launchWeek, rescue.launchWeek + 1);
  assert.equal(a.actionPointsPerWeek, 3);
});

test('picker: first run defaults to Story, then remembers the last pick', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(defaultDifficulty(store), 'story');
  assert.equal(defaultDifficulty(null), 'story');
  rememberDifficulty(store, 'standard');
  assert.equal(defaultDifficulty(store), 'standard');
  mem.set('critical-path-difficulty', 'bogus');
  assert.equal(defaultDifficulty(store), 'story');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(defaultDifficulty(broken), 'story');
  rememberDifficulty(broken, 'story');
  const html = difficultyHtml('story');
  assert.match(html, /value="story" checked/);
  assert.doesNotMatch(html, /value="standard" checked/);
});
