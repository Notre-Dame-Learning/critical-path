import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as M from '../engine/moves.js';
import * as I from '../engine/impact.js';
import { createGameAt } from '../engine/difficulty.js';
import { playOnce, runOdds } from '../engine/montecarlo.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary] = projects;
const quiet = { events: [] };
const fresh = (project = intro, seed = 'mv', d = quiet) => createGameAt(S, { world, project, deck: d, seed });
const ids = (g) => M.moveOptions(g).map((o) => o.id);
// Lose most of the work done so far (a bad stretch), so the schedule is behind.
const setBack = (g) => { for (const t of g.tasks) t.done = Math.round(t.done * 0.3); };
const idle = (g, weeks) => { for (let i = 0; i < weeks && !g.over; i++) { const ev = S.currentEvent(g); if (ev) S.chooseOption(g, S.bestChoice(ev).id); M.endWeek(g); } };

test('the core menu is always open with its costs; situation moves wait for the board to call for them', () => {
  const g = fresh();
  const core = ['checkin:ld', 'checkin:mp', 'checkin:gd', 'review', 'overtime:ld', 'overtime:mp', 'overtime:gd', 'status-update', 'team-meeting'];
  assert.deepEqual(M.moveOptions(g).filter((o) => o.kind === 'core').map((o) => o.id), core);
  assert.ok(M.moveOptions(g).every((o) => o.cost >= 1 && o.affordable));
  assert.ok(!ids(g).some((id) => /^(defer|backup):/.test(id)), 'nothing to defer or back up in week 1');
  // Falling behind opens deferral and a backup.
  idle(g, 6);
  setBack(g);
  const st = S.scheduleStatus(g);
  assert.ok(st.variance <= -1, `behind: ${st.variance}`);
  assert.ok(ids(g).some((id) => id.startsWith('defer:')) && ids(g).some((id) => id.startsWith('backup:')));
  assert.equal(M.moveOptions(g).find((o) => o.id.startsWith('defer:')).cost, 2);
  assert.throws(() => M.takeMove(g, 'heroics'));
});

test('the weekly meeting is free, once a week, and a plain status meeting by default; its summary builds trust', () => {
  const g = fresh();
  const ap = g.actionPoints;
  assert.ok(M.meetingOptions(g).some((o) => o.id === 'workload'));
  M.setMeetingFocus(g, 'workload');
  assert.equal(g.actionPoints, ap);
  assert.throws(() => M.setMeetingFocus(g, 'show-finished'));
  M.endWeek(g);
  const h = fresh();
  const trust = h.team.faculty.trust;
  M.endWeek(h);
  assert.deepEqual(h.actionsTaken.map((a) => [a.actionId, a.focus]), [['meeting', 'status']]);
  assert.ok(h.team.faculty.trust >= trust, 'the meeting summary goes out every week');
});

test('moves cost the team hours, and repeating a check-in or review adds little', () => {
  const g = fresh();
  idle(g, 3);
  g.team.mp.morale = 60;
  for (const t of g.tasks) if (t.owner === 'mp' && t.startedWeek !== null) t.hidden = 10;
  M.takeMove(g, 'checkin:mp');
  assert.equal(g.team.mp.morale, 67);
  assert.ok(g.mods.some((m) => m.type === 'capacity' && m.who === 'mp' && m.value === -M.COSTS.checkin && m.fromWeek === g.week));
  const known = g.tasks.filter((t) => t.owner === 'mp').reduce((s, t) => s + t.known, 0);
  assert.ok(known > 0, 'a check-in surfaces problems in that person\'s work');
  M.endWeek(g);
  M.takeMove(g, 'checkin:mp');
  assert.ok(g.team.mp.morale <= 69, 'a check-in a week later adds a point, not seven');
  M.endWeek(g);
  M.takeMove(g, 'review');
  assert.ok(g.mods.some((m) => m.type === 'capacity' && m.who === 'ld' && m.value === -M.COSTS.review));
  M.takeMove(g, 'review');
  assert.match(g.actionsTaken.at(-1).detail, /clean/, 'a second review the same week covers no new work');
});

test('heading off a risk works about 80% of the time and stays seeded; prevented situations are listed for the debrief', () => {
  let tried = 0, worked = 0;
  for (let i = 0; i < 200; i++) {
    const g = fresh(intro, `pv${i}`, deck);
    const ev = S.currentEvent(g);
    if (ev) S.chooseOption(g, S.bestChoice(ev).id);
    const risk = M.moveOptions(g).find((o) => o.kind === 'risk');
    if (!risk) continue;
    tried++;
    M.takeMove(g, risk.id);
    if (g.v2.prevented.length) {
      worked++;
      assert.ok(g.firedEvents.includes(g.v2.prevented[0]));
      assert.equal(M.avoided(g)[0].eventId, g.v2.prevented[0]);
    }
    assert.ok(!M.moveOptions(g).some((o) => o.id === risk.id), 'one try per risk');
  }
  assert.ok(tried >= 150, `risk moves offered in ${tried} games`);
  assert.ok(Math.abs(worked / tried - M.PREVENT_CHANCE) < 0.08, `${worked}/${tried}`);
});

test('scope moved to after launch still counts against course complete', () => {
  const g = fresh();
  idle(g, 6);
  setBack(g);
  const defer = M.moveOptions(g).find((o) => o.id.startsWith('defer:'));
  const trust = g.team.faculty.trust;
  M.takeMove(g, defer.id);
  assert.ok(g.deferredHours >= 1);
  assert.equal(g.team.faculty.trust, trust - 2);
  assert.equal(M.avoided(g).length, 0);
  idle(g, 30);
  assert.ok(g.over && g.result.scores.scope < 100);
});

test('signals show symptoms, never hidden rework; hints only when asked for', () => {
  const g = fresh();
  idle(g, 2);
  for (const t of g.tasks) t.hidden = 12;
  assert.ok(!M.signals(g).some((s) => /problems/.test(s.text)), 'hidden rework stays hidden');
  g.tasks.find((t) => t.owner === 'gd' && t.startedWeek !== null).known = 3;
  g.team.ld.morale = 40;
  const sig = M.signals(g);
  assert.ok(sig.some((s) => /fixing about 3 hours/.test(s.text)));
  assert.ok(sig.some((s) => /stretched/.test(s.text) && s.level === 3));
  assert.ok(sig.length <= 5 && sig.every((s, i) => i === 0 || s.level <= sig[i - 1].level));
  assert.ok(sig.every((s) => s.hint) && M.signals(g, { hints: false }).every((s) => !('hint' in s)));
});

test('reading the board beats any fixed weekly pattern by 10+ points, using five or more different moves', () => {
  for (const project of [intro, documentary, projects[3], projects[4]]) {
    const odds = (policy) => runOdds({ world, project, deck, runs: 100, seed: 'pattern', policy }).onTime;
    const best = odds('best');
    assert.ok(best >= odds('fixed') + 0.1, `${project.id}: best ${best}`);
    const g = playOnce({ world, project, deck, seed: 'variety', policy: 'best' });
    const kinds = new Set(g.actionsTaken.map((a) => (a.actionId === 'meeting' ? `meeting:${a.focus}` : a.actionId)));
    assert.ok(kinds.size >= 5, `${project.id}: ${[...kinds]}`);
  }
});

test('v2 runs replay exactly from their record, situation moves included', () => {
  for (const project of projects.slice(0, 3)) for (let i = 0; i < 3; i++) {
    const g = playOnce({ world, project, deck, seed: `rr${i}`, policy: 'random' });
    g.projectRef = project.id;
    assert.equal(I.recordOf(g).moves, 2);
    assert.ok(I.replaysExactly({ world, project, deck }, g), `${project.id} ${i}`);
  }
});

test('old move ids still run, mapped to their v2 moves', () => {
  const g = fresh();
  idle(g, 3);
  assert.ok(M.meetingOptions(g).some((o) => o.id === 'work-session'));
  M.applyLegacy(g, 'working-session');
  M.applyLegacy(g, 'qa-review');
  M.applyLegacy(g, 'faculty-update');
  assert.deepEqual(g.actionsTaken.filter((a) => a.week === g.week).map((a) => (a.actionId === 'meeting' ? a.focus : a.actionId)), ['work-session', 'qa-review', 'status-update']);
  assert.equal(g.actionPoints, 0);
});
