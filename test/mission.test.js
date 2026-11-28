import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as M from '../engine/mission.js';
import { TRACKS, levelOf, tracksOf, SITUATION_TRACKS } from '../engine/tracks.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary] = projects;
const ctx = { world, deck, projects };
const event = (id) => deck.events.find((e) => e.id === id);
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];

test('the track map covers every situation in the deck with valid tracks, and levels follow the thresholds', () => {
  for (const e of deck.events) {
    const { primary, secondary } = tracksOf(e);
    assert.ok(TRACKS.includes(primary), `${e.id} primary`);
    assert.ok(secondary === null || (TRACKS.includes(secondary) && secondary !== primary), `${e.id} secondary`);
  }
  assert.equal(Object.keys(SITUATION_TRACKS).length, 33);
  assert.deepEqual(tracksOf({ id: 'new-one', track: 'Change Control', track2: 'risk' }), { primary: 'change', secondary: 'risk' });
  assert.deepEqual([0, 39, 40, 119, 120, 250, 449, 450, 9999].map(levelOf), [1, 1, 2, 2, 3, 4, 4, 5, 5]);
});

test('weakest tracks: lowest level, then lowest XP, then the fixed order', () => {
  assert.deepEqual(M.weakestTracks({}), TRACKS);
  const order = M.weakestTracks({ xp: { planning: 130, estimating: 45, capacity: 10, risk: 300, communication: 39 } });
  assert.deepEqual(order.slice(0, 5), ['stakeholders', 'change', 'leadership', 'capacity', 'communication']);
  assert.equal(order.at(-1), 'risk');
});

test('staging pauses at the mission situation with a week to spare, other situations answered well', () => {
  const g = M.stage({ world, project: intro, deck, event: event('script-too-long'), seed: 's1' });
  assert.ok(g && !g.over);
  assert.equal(S.currentEvent(g).id, 'script-too-long');
  assert.ok(g.week <= g.launchWeek - 1 && g.week >= 5 && g.week <= 11);
  assert.ok(g.decisions.every((d) => d.eventId !== 'script-too-long' && d.credit >= 0.95));
  const again = M.stage({ world, project: intro, deck, event: event('script-too-long'), seed: 's1' });
  assert.deepEqual(again, g, 'staging replays exactly from its seed');
  assert.equal(M.stage({ world, project: intro, deck, event: event('location-permits'), seed: 's1' }), null, 'a documentary-only situation');
});

test("today's pick targets the weakest track, is the same all day, and differs by day or player", () => {
  const profile = { xp: { planning: 200, estimating: 200, capacity: 200, risk: 200, stakeholders: 200, communication: 10, change: 200, leadership: 200 } };
  const a = M.pickMission(profile, { ...ctx, date: '2026-11-19', playerId: 'fellow' });
  assert.equal(a.track, 'communication');
  assert.equal(tracksOf(event(a.eventId)).primary, 'communication');
  assert.match(a.reason, /Communication is your lowest track \(L1\)/);
  assert.deepEqual(M.pickMission(profile, { ...ctx, date: '2026-11-19', playerId: 'fellow' }), a);
  const others = ['2026-11-20', '2026-11-21', '2026-11-22'].map((date) => M.pickMission(profile, { ...ctx, date, playerId: 'fellow' }));
  assert.ok(others.some((o) => o.eventId !== a.eventId || o.projectId !== a.projectId));
  const onlyIntro = M.pickMission(profile, { ...ctx, date: '2026-11-19', unlocked: ['intro-psych-online'] });
  assert.equal(onlyIntro.projectId, 'intro-psych-online');
});

test('rotation: unseen situations first, mastered ones rested for a week, a learned track rested after two strong missions', () => {
  const comm = deck.events.filter((e) => tracksOf(e).primary === 'communication').map((e) => e.id);
  const base = { xp: { planning: 300, estimating: 300, capacity: 300, risk: 300, stakeholders: 300, communication: 0, change: 300, leadership: 300 } };
  const credits = (fn) => Object.fromEntries(comm.map((id, i) => [id, fn(i)]));
  // Every Communication situation but the last one seen: the unseen one comes first.
  const seen = { ...base, bestCredit: Object.fromEntries(comm.slice(0, -1).map((id, i) => [id, 0.3 + 0.1 * i])) };
  assert.equal(M.pickMission(seen, { ...ctx, date: '2026-11-19' }).eventId, comm.at(-1));
  // All seen: lowest best credit first.
  const all = { ...base, bestCredit: credits((i) => 0.3 + 0.1 * i) };
  assert.equal(M.pickMission(all, { ...ctx, date: '2026-11-19' }).eventId, comm[0]);
  // A mastered situation played this week is skipped.
  const mastered = { ...base, bestCredit: credits(() => 1), missions: [{ date: '2026-11-18', eventId: comm[0], track: 'communication', credit: 1 }] };
  assert.notEqual(M.pickMission(mastered, { ...ctx, date: '2026-11-19' }).eventId, comm[0]);
  // Two strong missions in a row on Communication: today goes to the next-weakest track.
  const strong = { ...base, xp: { ...base.xp, change: 290 }, missions: [
    { date: '2026-11-17', eventId: comm[0], track: 'communication', credit: 1 },
    { date: '2026-11-18', eventId: comm[1], track: 'communication', credit: 0.9 }] };
  const rested = M.pickMission(strong, { ...ctx, date: '2026-11-19' });
  assert.equal(rested.track, 'change');
  assert.match(rested.reason, /Communication is resting/);
});

test('setup and briefing: the pick rebuilds the same staged week, with the situation and shuffled choices', () => {
  const pick = M.pickMission({}, { ...ctx, date: '2026-11-19', playerId: 'p2' });
  const g = M.setupMission(pick, ctx);
  assert.equal(g.week, pick.stagedWeek);
  const b = M.missionBriefing(g);
  assert.equal(b.situation.id, pick.eventId);
  assert.equal(b.weeksLeft, g.launchWeek - g.week);
  assert.ok(b.weeksLeft >= 1 && b.trust > 0 && b.phases.length > 0 && b.schedule.label);
  assert.deepEqual(b.choices.map((c) => c.id).sort(), event(pick.eventId).choices.map((c) => c.id).sort());
  assert.ok(!b.situation.text.includes('{'), 'names are filled in');
});

test('playing forward: the best answer beats the worst on the same futures, and the deltas are reported', () => {
  const ev = event('calendar-not-blocked');
  const g = M.stage({ world, project: intro, deck, event: ev, seed: 'pf' });
  const sorted = [...ev.choices].sort((a, b) => credit(b) - credit(a));
  const worst = M.resolveMission(g, sorted.at(-1).id, {}, { runs: 40 });
  const best = M.resolveMission(g, sorted[0].id, {}, { runs: 40 });
  assert.equal(best.bestLabel, null);
  assert.ok(worst.bestLabel && worst.credit < 0.3);
  assert.equal(worst.odds.best, best.odds.yours, 'the same futures for both answers');
  assert.ok(worst.odds.best > worst.odds.yours, `best ${worst.odds.best} vs worst ${worst.odds.yours}`);
  assert.ok(['trust', 'morale', 'rework'].every((k) => typeof worst.weeks3.yours[k] === 'number'));
  assert.equal(S.currentEvent(g).id, ev.id, 'resolving never changes the staged game');
  assert.ok(worst.debrief.concept && worst.tracks.primary === 'planning');
});

test('XP: paid only on improvement, hard mode × 1.5, a 0.8+ bonus once a day', () => {
  const ev = event('timeline-slip-request'); // change, secondary stakeholders
  const pick = { eventId: ev.id, track: 'change', date: '2026-11-19', projectId: 'intro-psych-online' };
  let { profile, gained } = M.recordMission({}, pick, { credit: 0.5 }, ev);
  assert.deepEqual(gained.xp, { change: 10, stakeholders: 4 });
  assert.equal(gained.bonus, false);
  ({ profile, gained } = M.recordMission(profile, pick, { credit: 1 }, ev));
  assert.deepEqual(gained.xp, { change: 20, stakeholders: 4 }); // 20 × 0.5 more, + 10 bonus
  ({ gained } = M.recordMission(profile, pick, { credit: 1 }, ev));
  assert.deepEqual(gained.xp, {}, 'no improvement and the bonus is spent today');
  const hard = M.missionXp(profile, { ...pick, date: '2026-11-20', mode: 'hard' }, ev, 1);
  assert.deepEqual(hard.xp, { change: 20, stakeholders: 4 }); // 1.5 stored vs best 1, plus tomorrow's bonus
  assert.equal(profile.xp.change, 30);
  assert.equal(profile.bestCredit[ev.id], 1);
});

test('streak counts consecutive days, from today or yesterday', () => {
  const m = (date) => ({ date });
  assert.equal(M.streak([m('2026-11-17'), m('2026-11-18'), m('2026-11-19')], '2026-11-19'), 3);
  assert.equal(M.streak([m('2026-11-17'), m('2026-11-18')], '2026-11-19'), 2);
  assert.equal(M.streak([m('2026-11-15'), m('2026-11-17')], '2026-11-19'), 0);
  assert.equal(M.streak([], '2026-11-19'), 0);
  const { profile } = M.recordMission({ missions: [{ date: '2026-11-18', eventId: 'no-agenda', track: 'communication', credit: 1 }] },
    { eventId: 'no-agenda', track: 'communication', date: '2026-11-19', projectId: documentary.id }, { credit: 1 }, event('no-agenda'));
  assert.equal(profile.missionStreak, 2);
});
