import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOdds } from '../engine/montecarlo.js';
import { stage } from '../engine/mission.js';
import { tracksOf, TRACKS } from '../engine/tracks.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const NEW = ['global-health-cases', 'a11y-sprint-ochem', 'teaching-ai-microcourse', 'stats-refresh-sprint'];
const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
const odds = (p, policy, runs = 200) => runOdds({ world, project: p, deck, runs, seed: 'newp', policy }).onTime;

test('seven projects: a design-heavy course and three sprints joined the original three', () => {
  assert.equal(projects.length, 7);
  for (const id of NEW) assert.ok(byId[id], id);
  assert.equal(byId['global-health-cases'].difficulty, 'Design-heavy');
  for (const id of NEW.slice(1)) {
    assert.equal(byId[id].difficulty, 'Sprint');
    assert.ok(byId[id].launchWeek <= 7, `${id} is short`);
  }
  // Design-heavy: the learning designer and graphic designer carry most of the hours, video little.
  const gh = byId['global-health-cases'];
  const hours = (role) => gh.tasks.filter((t) => t.owner === role).reduce((s, t) => s + t.effort, 0);
  assert.ok(hours('ld') + hours('gd') > 3 * hours('mp'), 'design outweighs media');
  for (const p of projects) assert.equal(p.tasks.filter((t) => t.isQA).length, 1, `${p.id} has one QA task`);
});

test('calibration: best play usually launches the new projects on time, random play rarely, passive never', () => {
  for (const id of NEW) {
    const p = byId[id];
    const best = odds(p, 'best');
    const random = odds(p, 'random');
    assert.ok(best >= 0.75 && best <= 0.98, `${id} best ${best}`);
    assert.ok(random <= 0.32 && random < best - 0.45, `${id} random ${random}`);
    assert.equal(odds(p, 'passive', 100), 0, `${id} passive`);
  }
});

test('every new situation is tagged with tracks, limited to its projects, and can come up there', () => {
  const fresh = deck.events.filter((e) => e.projects?.some((pid) => NEW.includes(pid)));
  assert.equal(fresh.length, 18);
  for (const e of fresh) {
    const { primary, secondary } = tracksOf(e);
    assert.ok(TRACKS.includes(primary) && TRACKS.includes(secondary), e.id);
    for (const pid of e.projects) {
      assert.ok(NEW.includes(pid), `${e.id} stays in the new projects`);
      assert.ok(stage({ world, project: byId[pid], deck, event: e, seed: `st:${e.id}` }), `${e.id} stages in ${pid}`);
    }
  }
  // Each sprint has at least five situations of its own, so repeat runs vary (Nov 28: 7, 5 and 7).
  for (const id of NEW.slice(1)) assert.ok(fresh.filter((e) => e.projects.includes(id)).length >= 5, id);
});
