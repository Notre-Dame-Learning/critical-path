import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as M from '../engine/moves.js';
import { createGameAt } from '../engine/difficulty.js';
import { playOnce } from '../engine/montecarlo.js';
import { signalsHtml, meetingHtml, movesHtml, avoidedHtml } from '../app/moves-view.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const intro = load('projects/intro-psych-online.json');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const face = (role) => `<i data-face="${role}"></i>`;

test('the week panel: signals with hints, a free meeting focus, and team moves with per-person buttons', () => {
  const g = createGameAt(S, { world, project: intro, deck: { events: [] }, seed: 'view' });
  for (let i = 0; i < 3; i++) M.endWeek(g);
  g.team.ld.morale = 40;
  const sig = signalsHtml(M.signals(g), esc);
  assert.match(sig, /class="sig urgent"/);
  assert.match(sig, /class="hint"/);
  assert.ok(!signalsHtml(M.signals(g, { hints: false }), esc).includes('class="hint"'));
  assert.match(signalsHtml([], esc), /Nothing stands out/);

  const meet = meetingHtml(g, M.meetingOptions(g), esc);
  assert.equal((meet.match(/data-meeting=/g) ?? []).length, M.meetingOptions(g).length);
  assert.match(meet, /routine status meeting/);
  M.setMeetingFocus(g, 'workload');
  const after = meetingHtml(g, M.meetingOptions(g), esc);
  assert.ok(!after.includes('data-meeting=') && after.includes('Check on their workload'));

  const html = movesHtml(g, M.moveOptions(g), esc, face);
  assert.equal((html.match(/data-move="checkin:/g) ?? []).length, 3);
  assert.equal((html.match(/data-move="overtime:/g) ?? []).length, 3);
  assert.match(html, /data-move="review"/);
  assert.match(html, /data-move="team-meeting"/);
  assert.match(html, /2 Action Points left/);
  assert.ok(movesHtml(g, M.moveOptions(g), esc, face, { blocked: true }).match(/data-move="[^"]+" disabled/g).length === M.moveOptions(g).length);
});

test('the debrief lists situations headed off and scope moved after launch, escaped', () => {
  let g;
  for (let i = 0; i < 20 && !g?.v2?.prevented?.length; i++) g = playOnce({ world, project: intro, deck, seed: `av${i}`, policy: 'best' });
  const html = avoidedHtml(M.avoided(g), [{ task: 'post', hours: 4.2, week: 9 }], g, esc);
  assert.match(html, /What you avoided/);
  assert.equal((html.match(/class="lesson folded"/g) ?? []).length, g.v2.prevented.length);
  assert.match(html, /about 4 hours of post-production/);
  assert.equal(avoidedHtml([], [], g, esc), '');
  const odd = avoidedHtml([{ title: '<b>x</b>', move: '', concept: '' }], [], g, esc);
  assert.ok(!odd.includes('<b>x'));
});
