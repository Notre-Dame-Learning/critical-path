import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as P from '../engine/progression.js';
import { playOnce } from '../engine/montecarlo.js';
import { profileHtml, xpPanelHtml, rankLineHtml } from '../app/profile-view.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const run = (project, seed, policy = 'best', mode = 'standard') => {
  const g = playOnce({ world, project, deck, seed, policy });
  g.projectRef = project.id;
  g.runId = `${project.id}:${seed}:${policy}`;
  if (mode === 'hard') g.mode = 'hard';
  return g;
};

test('situation XP: 20 × credit primary, 8 × credit secondary, hard mode × 1.5; five ranks with rising XP', () => {
  const ev = deck.events.find((e) => e.id === 'timeline-slip-request'); // change / stakeholders
  assert.deepEqual(P.situationXp(ev, 1), { change: 20, stakeholders: 8 });
  assert.deepEqual(P.situationXp(ev, 0.5, 'hard'), { change: 15, stakeholders: 6 });
  assert.deepEqual(P.RANKS.map((r) => r.xp), [0, 200, 600, 1200, 2500]);
  assert.equal(P.RANKS.length, 5);
  assert.equal(P.ACHIEVEMENTS.length, 11);
});

test('run XP: scorecard by track, habits capped at 8 per action, situations at their best credit', () => {
  const g = run(intro, 'xp1');
  const { xp, situations } = P.runXp(g);
  const s = g.result.scores;
  assert.equal(xp.capacity, Math.round(s.team) / 10);
  assert.ok(Math.abs(xp.planning - (s.scope / 10 + (g.result.launchedOnTime ? 10 : 0))) < 0.11);
  assert.ok(xp.leadership <= 8 && xp.communication <= 8 && xp.leadership > 0);
  assert.equal(Object.keys(situations).length, g.decisions.length);
  assert.ok(Object.values(situations).every((c) => c >= 0.95));
});

test('applying runs: situation XP only on improvement, and the same run is never counted twice', () => {
  const g = run(intro, 'xp2');
  const first = P.applyRun(P.newProfile(), g);
  assert.ok(first.total > 150, `first run ${first.total}`);
  assert.equal(first.profile.runs.length, 1);
  assert.ok(P.applyRun(first.profile, g).duplicate);
  // Replaying the same situations at the same credit pays the scorecard and habits only.
  const again = run(intro, 'xp2');
  again.runId = 'replay';
  const second = P.applyRun(first.profile, again);
  const habitsAndScores = Object.values(P.runXp(again).xp).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(second.total - habitsAndScores) < 0.5, `${second.total} vs ${habitsAndScores}`);
  assert.equal(second.profile.runs.length, 2);
});

test('ranks need XP and the gate: best play reaches PM in 1 run and Senior PM in 2; random play does not', () => {
  let p = P.newProfile();
  p = P.applyRun(p, run(intro, 'r1')).profile;
  assert.equal(P.rankOf(p).id, 'pm');
  const r2 = P.applyRun(p, run(documentary, 'r2'));
  assert.equal(r2.promotion, 'Senior PM');
  // XP alone is not enough: lots of XP but no on-time Intro run stays Coordinator.
  const rich = { ...P.newProfile(), xp: Object.fromEntries(P.TRACKS.map((t) => [t, 500])) };
  assert.equal(P.rankOf(rich).id, 'coordinator');
  assert.equal(P.nextRank(rich).xpMet, true);
  assert.equal(P.nextRank(rich).gateMet, false);
  let q = P.newProfile();
  for (let i = 0; i < 2; i++) q = P.applyRun(q, run(intro, `rand${i}`, 'random')).profile;
  assert.equal(P.rankOf(q).id, 'coordinator');
  // Locks are off by default; with ?locks=1 a Coordinator only has Intro in standard mode.
  assert.equal(P.unlocked(q).projects.length, 3);
  assert.deepEqual(P.unlocked(q, { locks: true }), { projects: [intro.id], modes: ['standard'], plan: [] });
  assert.deepEqual(P.unlocked(r2.profile, { locks: true }).projects, [intro.id, documentary.id, rescue.id]);
});

test('achievements: best play earns the habit badges; heavy overtime and a missed launch earns Brooks Was Right', () => {
  const g = run(intro, 'a1');
  const got = P.achievementsOf(g);
  for (const id of ['no-heroes', 'trusted-partner', 'steady-team', 'early-warning', 'own-it']) assert.ok(got.includes(id), id);
  assert.ok(!got.includes('brooks-was-right') && !got.includes('rescuer'));
  let brooks = false;
  for (let i = 0; i < 10 && !brooks; i++) {
    const bad = playOnce({ world, project: intro, deck, seed: `b${i}`, policy: { choose: (ev) => ev.choices[ev.choices.length - 1], act: (st) => ['overtime:mp', 'overtime:ld'] } });
    brooks = P.achievementsOf(bad).includes('brooks-was-right');
  }
  assert.ok(brooks);
});

test('Rescuer only for the Rescue, and Bad News Early for escalating with a plan where that was best', () => {
  let rescued = null;
  for (let i = 0; i < 30 && !rescued; i++) { const g = run(rescue, `res${i}`); if (g.result.launchedOnTime) rescued = g; }
  assert.ok(rescued && P.achievementsOf(rescued).includes('rescuer'));
  let early = false;
  for (let i = 0; i < 30 && !early; i++) { const g = run(intro, `bn${i}`); early = g.decisions.some((d) => d.eventId === 'timeline-slip-request') && P.achievementsOf(g).includes('bad-news-early'); }
  assert.ok(early, 'the timeline change request is best handled by escalating with a plan');
});

test('profile codes round-trip and reject anything else', () => {
  const p = P.applyRun(P.newProfile(), run(intro, 'code')).profile;
  const code = P.exportCode(p);
  assert.match(code, /^CP1\./);
  const back = P.importCode(code);
  assert.deepEqual(back.xp, p.xp);
  assert.deepEqual(back.achievements, p.achievements);
  assert.equal(back.runs.length, 1);
  assert.equal(P.importCode('hello'), null);
  assert.equal(P.importCode('CP1.bm90IGpzb24='), null);
  const tampered = P.importCode(P.exportCode({ ...p, xp: { planning: -50, risk: 'lots' }, achievements: ['made-up', 'no-heroes'] }));
  assert.equal(tampered.xp.planning, 0);
  assert.deepEqual(tampered.achievements, ['no-heroes']);
});

test('screens: XP panel, profile with eight track bars and every badge, rank line, all escaped', () => {
  const res = P.applyRun(P.newProfile(), run(intro, 'view'));
  const panel = xpPanelHtml(res, esc);
  assert.match(panel, /\+\d+ XP/);
  assert.match(panel, /Promoted to <strong>Project Manager<\/strong>/);
  assert.equal(xpPanelHtml({ ...res, duplicate: true }, esc), '');
  const html = profileHtml(res.profile, esc);
  assert.equal((html.match(/class="track"/g) ?? []).length, 8);
  assert.equal((html.match(/<span class="badge/g) ?? []).length, 11);
  assert.ok(html.includes('Project Manager') && html.includes('id="profile-code"'));
  assert.equal(rankLineHtml(P.newProfile(), esc), '');
  assert.match(rankLineHtml(res.profile, esc), /Project Manager.*1 run/);
  const odd = { ...res.profile, runs: [{ project: '<script>', mode: 'standard', onTime: true, grade: 'A', xp: 1 }] };
  assert.ok(!profileHtml(odd, esc).includes('<script>'));
});
