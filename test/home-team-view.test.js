import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as M from '../engine/moves.js';
import * as P from '../engine/progression.js';
import { createGameAt } from '../engine/difficulty.js';
import { playOnce } from '../engine/montecarlo.js';
import { avatarSVG } from '../app/avatars.js';
import { icon, ICONS } from '../app/icons.js';
import { teamHtml, recapHtml, weekSegments } from '../app/team-view.js';
import { stepperHtml, meetingHtml } from '../app/moves-view.js';
import { deskHtml, avatarMakerHtml } from '../app/home-view.js';
import { SKINS, HAIRS, STYLES, SHIRTS, defaultPlayer, randomPlayer, cleanPlayer } from '../engine/player.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const intro = load('projects/intro-psych-online.json');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const face = (role) => `<i data-face="${role}"></i>`;

test('the week log says where each person\'s hours went: work by task, rework fixed and idle time add up', () => {
  const g = playOnce({ world, project: intro, deck, seed: 'log', policy: 'best' });
  for (const e of g.log) for (const r of [...S.STAFF, 'faculty']) {
    const spent = e.work[r].reduce((s, w) => s + w.new + w.fix, 0) + e.idle[r];
    assert.ok(Math.abs(spent - e.hours[r]) < 0.3, `week ${e.week} ${r}: ${spent} vs ${e.hours[r]}`);
    assert.ok(e.work[r].every((w) => g.tasks.find((t) => t.id === w.task)?.owner === r));
  }
  assert.ok(g.log.every((e) => S.STAFF.every((r) => Number.isFinite(e.morale[r])) && Number.isFinite(e.trust)));
});

test('the team panel shows last week per person, you first, with changes since the week before', () => {
  const g = createGameAt(S, { world, project: intro, deck: { events: [] }, seed: 'team' });
  assert.match(recapHtml(g, esc), /first week/);
  for (let i = 0; i < 3; i++) M.endWeek(g);
  const html = teamHtml(g, { face, esc, player: { name: 'Maya <b>', avatar: defaultPlayer().avatar }, playerFace: '<i data-you></i>' });
  assert.match(html, /Last week \(week 3\)/);
  assert.match(html, /class="mate you"/);
  assert.ok(html.includes('Maya &lt;b&gt;') && !html.includes('Maya <b>'));
  assert.equal((html.match(/class="hbar"/g) ?? []).length, 4, 'three staff and the faculty partner');
  assert.match(html, /Morale/);
  assert.match(html, /Trust/);
  const segs = weekSegments(g, g.log.at(-1), 'ld');
  assert.ok(segs.length && segs.every((x) => x.hours > 0));
  assert.ok(!teamHtml(g, { face, esc }).includes('class="mate you"'), 'no you card without a face');
});

test('the week steps: the stepper follows the meeting and Action Points, the meeting shows the faculty partner', () => {
  const g = createGameAt(S, { world, project: intro, deck: { events: [] }, seed: 'steps' });
  assert.match(stepperHtml(g), /class="st\s+now\s*"[^>]*>.*Meeting/s);
  assert.match(stepperHtml(g, { situation: true }), /Situation first/);
  assert.match(meetingHtml(g, M.meetingOptions(g), esc, { facultyFace: '<i data-fac></i>' }), /data-fac/);
  M.setMeetingFocus(g, 'workload');
  assert.match(stepperHtml(g), /class="st done[^"]*"[^>]*>.*Meeting/s);
  while (g.actionPoints > 0) M.takeMove(g, M.moveOptions(g).find((o) => o.affordable && o.id.startsWith('checkin:')).id);
  assert.match(stepperHtml(g), /class="st\s+now\s*"[^>]*>.*End week/s);
});

test('every move and meeting focus has its own icon', () => {
  const g = createGameAt(S, { world, project: intro, deck: { events: [] }, seed: 'icons' });
  for (const o of M.meetingOptions(g)) assert.ok(ICONS.includes(o.id), o.id);
  for (const id of ['checkin', 'review', 'overtime', 'status-update', 'team-meeting', 'defer', 'placeholder', 'backup', 'prevent', 'status', 'preview', 'sign-offs', 'keep-short']) assert.ok(ICONS.includes(id), id);
  assert.match(icon('review', { label: 'A "review"' }), /aria-label="A &quot;review&quot;"/);
});

test('players: defaults, a seeded random pick, and anything odd cleaned', () => {
  assert.deepEqual(randomPlayer('a'), randomPlayer('a'));
  const r = randomPlayer('b').avatar;
  assert.ok(SKINS.includes(r.skin) && HAIRS.includes(r.hair) && STYLES.includes(r.style) && SHIRTS.includes(r.shirt));
  const c = cleanPlayer({ name: '  <script>Alexandria Ocasio-Something Very Long  ', avatar: { skin: 'red', style: 'mohawk', glasses: 'yes', beard: true } });
  assert.ok(!c.name.includes('<') && c.name.length <= 24);
  assert.equal(c.avatar.skin, defaultPlayer().avatar.skin);
  assert.equal(c.avatar.style, 'short');
  assert.equal(c.avatar.glasses, false);
  assert.equal(c.avatar.beard, true);
  assert.equal(cleanPlayer(null), null);
  // The player travels in the profile code.
  const p = { ...P.newProfile(), player: { name: 'Maya', avatar: { ...defaultPlayer().avatar, style: 'bald' } } };
  assert.deepEqual(P.importCode(P.exportCode(p)).player, p.player);
  assert.equal(P.importCode(P.exportCode(P.newProfile())).player, undefined);
});

test('your desk: avatar, rank on the career path, the next gate, skills, badges and recent runs', () => {
  const fresh = deskHtml(P.newProfile(), esc, { avatarSVG });
  assert.match(fresh, /id="make-avatar"/);
  assert.match(fresh, /Welcome to ODL/);
  assert.match(fresh, /No runs yet/);
  assert.equal((fresh.match(/class="skill"/g) ?? []).length, 8);
  assert.equal((fresh.match(/class="ros /g) ?? []).length, P.ACHIEVEMENTS.length);
  assert.equal((fresh.match(/<li class="(past|here|ahead)">/g) ?? []).length, P.RANKS.length);
  const g = playOnce({ world, project: intro, deck, seed: 'desk', policy: 'best' });
  g.projectRef = intro.id;
  const prof = { ...P.applyRun(P.newProfile(), g).profile, player: { name: 'Maya', avatar: defaultPlayer().avatar } };
  const html = deskHtml(prof, esc, { avatarSVG });
  assert.ok(html.includes('Welcome back') && html.includes('Maya') && !html.includes('id="make-avatar"'));
  assert.match(html, /<li class="past">.*<li class="here">/s);
  assert.match(html, /Intro to Psychology/);
  assert.match(html, /id="open-profile"/);
  const maker = avatarMakerHtml({ name: 'A"b', avatar: defaultPlayer().avatar }, esc, { avatarSVG, mood: 'worried' });
  assert.equal((maker.match(/data-av="skin"/g) ?? []).length, SKINS.length);
  assert.equal((maker.match(/data-av="style"/g) ?? []).length, STYLES.length);
  assert.match(maker, /value="A&quot;b"/);
  assert.match(maker, /mood-worried/);
});
