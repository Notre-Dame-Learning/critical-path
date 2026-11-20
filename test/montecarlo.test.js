import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOdds, playOnce, oddsReport, POLICIES } from '../engine/montecarlo.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;
const odds = (project, policy, runs = 200, extra = {}) => runOdds({ world, project, deck, runs, seed: 'cal', policy, ...extra }).onTime;

test('calibration bands: best play launches the standard projects on time, Rescue is hard', () => {
  for (const p of [intro, documentary]) {
    const best = odds(p, 'best');
    assert.ok(best >= 0.8 && best <= 0.98, `${p.id} best ${best}`);
    assert.ok(odds(p, 'plan') >= best - 0.02, `${p.id}: situations never make it easier`);
  }
  const r = odds(rescue, 'best');
  assert.ok(r >= 0.2 && r <= 0.5, `rescue best ${r}`);
  assert.ok(odds(rescue, 'plan') > r + 0.3, 'Rescue is hard because of situations, not the plan');
});

test('calibration bands: random play rarely launches on time, passive play never does', () => {
  for (const p of projects) {
    assert.ok(odds(p, 'random') <= 0.3, `${p.id} random`);
    assert.equal(odds(p, 'passive', 100), 0, `${p.id} passive`);
  }
});

test('policies spend Action Points as described, and runs replay exactly from the seed', () => {
  // Every week has one meeting entry (a plain status meeting when no focus is picked); moves are the rest.
  const moves = (g) => g.actionsTaken.filter((a) => a.actionId !== 'meeting');
  const g = playOnce({ world, project: intro, deck, seed: 's1', policy: 'random' });
  assert.equal(g.actionsTaken.filter((a) => a.actionId === 'meeting').length, g.log.length);
  assert.ok(moves(g).length >= g.log.length * 1.5, 'random play spends most Action Points');
  const passive = playOnce({ world, project: intro, deck, seed: 's1', policy: 'passive' });
  assert.equal(moves(passive).length, 0);
  assert.ok(passive.actionsTaken.every((a) => a.focus === 'status'));
  assert.ok(playOnce({ world, project: intro, deck, seed: 's1', policy: 'plan' }).decisions.length === 0);
  assert.deepEqual(playOnce({ world, project: rescue, deck, seed: 'x', policy: 'random' }).result, playOnce({ world, project: rescue, deck, seed: 'x', policy: 'random' }).result);
  assert.deepEqual(runOdds({ world, project: documentary, deck, runs: 30, seed: 'd' }), runOdds({ world, project: documentary, deck, runs: 30, seed: 'd' }));
  assert.throws(() => playOnce({ world, project: intro, deck, seed: 's', policy: 'heroic' }));
});

test('the report covers every project and policy, and Story pace lifts a random player', () => {
  const rows = oddsReport({ world, projects, deck, runs: 20, seed: 'r' });
  assert.equal(rows.length, projects.length * Object.keys(POLICIES).length);
  assert.ok(rows.every((r) => r.runs === 20 && r.onTime >= 0 && r.onTime <= 1 && r.avg.overall > 0));
  assert.ok(odds(intro, 'random', 200, { difficulty: 'story' }) > odds(intro, 'random') + 0.1);
});
