import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { runOdds, goodHabits } from '../engine/montecarlo.js';
import { pickMission } from '../engine/mission.js';
import { tracksOf } from '../engine/tracks.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const EST = { 'est-two-weekends': ['intro-psych-online', 'ai-ethics-documentary'], 'est-post-guess': ['ai-ethics-documentary'], 'est-module-one-actuals': null };

test('three Estimating situations, tagged and placed, so Estimating can grow on every project', () => {
  assert.ok(deck.events.length >= 33);
  for (const [id, where] of Object.entries(EST)) {
    const e = deck.events.find((x) => x.id === id);
    assert.ok(e, id);
    assert.equal(tracksOf(e).primary, 'estimating');
    assert.deepEqual(e.projects ?? null, where);
    assert.ok(e.choices.some((c) => c.tier === 'resolve' && credit(c) === 1), `${id} has a full-credit answer`);
    assert.ok(e.debrief.concept && e.debrief.independent && e.debrief.escalateWhen && e.debrief.sop);
    assert.ok(!e.choices.some((c) => c.effects.some((fx) => fx.task === 'qa')), `${id}: no rework planted on QA`);
  }
  for (const p of projects) assert.ok(deck.events.some((e) => tracksOf(e).primary === 'estimating' && (!e.projects || e.projects.includes(p.id))), p.id);
  // A new Coordinator with only Intro unlocked now gets an Estimating mission when it's their weakest track.
  const profile = { xp: { planning: 50, capacity: 50, risk: 50, stakeholders: 50, communication: 50, change: 50, leadership: 50 } };
  const pick = pickMission(profile, { world, deck, projects, date: '2026-11-19', unlocked: ['intro-psych-online'] });
  assert.equal(pick.track, 'estimating');
  assert.equal(pick.tier, 'primary');
});

test('the worst answers to the Estimating situations cost launch odds; best play is unchanged', () => {
  const worstOnEstimating = {
    choose: (ev) => [...ev.choices].sort((a, b) => (ev.id.startsWith('est-') ? credit(a) - credit(b) : credit(b) - credit(a)))[0],
    act: goodHabits,
  };
  for (const id of ['intro-psych-online', 'ai-ethics-documentary']) {
    const project = projects.find((p) => p.id === id);
    const best = runOdds({ world, project, deck, runs: 200, seed: 'est', policy: 'best' }).onTime;
    const worst = runOdds({ world, project, deck, runs: 200, seed: 'est', policy: worstOnEstimating }).onTime;
    assert.ok(best >= 0.8, `${id} best ${best}`);
    assert.ok(worst < best - 0.25, `${id}: best ${best} vs worst on estimating ${worst}`);
  }
});
