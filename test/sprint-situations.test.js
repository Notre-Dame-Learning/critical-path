// Nov 28: nine more situations for the three sprints, so repeat runs vary, and risk moves that only
// offer (and only credit) situations the project can actually have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as M from '../engine/moves.js';
import { createGameAt } from '../engine/difficulty.js';
import { playOnce } from '../engine/montecarlo.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const byId = Object.fromEntries(load('projects.json').projects.map((id) => [id, load(`projects/${id}.json`)]));
const SPRINTS = ['a11y-sprint-ochem', 'teaching-ai-microcourse', 'stats-refresh-sprint'];
const ADDED = ['screen-reader-test', 'captioner-out', 'alt-text-essays', 'ai-tool-updated', 'policy-not-final',
  'split-the-build', 'term-shell-missing', 'last-term-feedback', 'next-term-instructor'];
const ev = (id) => deck.events.find((e) => e.id === id);

test('the nine sprint situations name only tasks their sprints have, and each has one best answer', () => {
  for (const id of ADDED) {
    const e = ev(id);
    assert.ok(e, id);
    for (const pid of e.projects) {
      assert.ok(SPRINTS.includes(pid), `${id} stays in the sprints`);
      const tasks = new Set(byId[pid].tasks.map((t) => t.id));
      for (const t of Object.values(e.trigger.requires)) assert.ok(tasks.has(t), `${id} trigger task ${t} in ${pid}`);
      for (const c of e.choices) for (const fx of c.effects) if (fx.task) assert.ok(tasks.has(fx.task), `${id}/${c.id} task ${fx.task} in ${pid}`);
      for (const t of Object.values(e.prevent?.when ?? {})) assert.ok(tasks.has(t), `${id} prevent task ${t} in ${pid}`);
    }
    assert.equal(e.choices.filter((c) => c.credit === 1).length, 1, id);
    assert.ok(e.debrief.concept && e.debrief.independent && e.debrief.escalateWhen && e.debrief.sop, id);
  }
});

test('risk moves offer and credit only situations the project can have', () => {
  const a11y = byId['a11y-sprint-ochem'];
  const offered = new Set();
  for (let s = 0; s < 20; s++) {
    const g = createGameAt(S, { world, project: a11y, deck, seed: `rm:${s}` });
    // Ask about workload every week: in a sprint with no scripts or content task it must head off nothing.
    for (let i = 0; i < 8 && !g.over; i++) {
      const cur = S.currentEvent(g);
      if (cur) S.chooseOption(g, S.bestChoice(cur).id);
      for (const o of M.moveOptions(g)) if (o.id.startsWith('prevent:')) offered.add(o.id.slice(8));
      M.setMeetingFocus(g, 'workload');
      M.endWeek(g);
    }
    for (const id of g.v2?.prevented ?? []) assert.ok(M.canOccur(g, ev(id)), `${id} credited as avoided but can't happen`);
  }
  assert.ok(!offered.has('stock-image-license'), 'no branding task, so no image-licence risk');
  assert.ok(offered.has('screen-reader-test'), 'the screen-reader risk can be headed off');
  for (const id of offered) assert.ok(ev(id).projects === undefined || ev(id).projects.includes(a11y.id), id);
  assert.equal(M.canOccur({ tasks: a11y.tasks }, ev('silent-faculty')), false);
  assert.equal(M.canOccur({ tasks: a11y.tasks }, ev('captioner-out')), true);
});

test('repeat runs vary: each sprint shows more distinct situations, and every new one comes up', () => {
  const floor = { 'a11y-sprint-ochem': 7, 'teaching-ai-microcourse': 12, 'stats-refresh-sprint': 15 };
  for (const pid of SPRINTS) {
    const project = byId[pid];
    const shown = {};
    const runs = 150;
    for (let i = 0; i < runs; i++) {
      const g = playOnce({ world, project, deck, seed: `var:${i}`, policy: 'random' });
      for (const d of g.decisions) shown[d.eventId] = (shown[d.eventId] ?? 0) + 1;
    }
    assert.ok(Object.keys(shown).length >= floor[pid], `${pid}: ${Object.keys(shown).length} distinct`);
    for (const id of ADDED.filter((x) => ev(x).projects.includes(pid))) assert.ok((shown[id] ?? 0) / runs >= 0.1, `${id} shows in ${pid}: ${shown[id] ?? 0}/${runs}`);
  }
});
