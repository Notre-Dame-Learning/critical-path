import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { createGameAt } from '../engine/difficulty.js';
import { playOnce } from '../engine/montecarlo.js';
import * as I from '../engine/impact.js';
import * as C from '../engine/conversation.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;
const ctx = (project) => ({ world, project, deck });
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const STYLES = {
  best: 'best',
  mixed: { choose: (ev, rng, g) => { const s = [...ev.choices].sort((a, b) => credit(b) - credit(a)); return g.decisions.length % 3 === 2 ? s.at(-1) : s[0]; }, act: () => ['faculty-update', 'working-session'] },
  struggling: { choose: (ev, rng) => ev.choices[Math.floor(rng.next() * ev.choices.length)], act: (g) => (g.week % 2 ? ['overtime:mp', 'overtime:ld'] : ['overtime:gd', 'faculty-update']) },
};
const played = (project, style, seed) => { const g = playOnce({ world, project, deck, seed, policy: STYLES[style] }); g.projectRef = project.id; return g; };

test('every record replays its run exactly: three projects, three play styles', () => {
  for (const p of projects) for (const style of Object.keys(STYLES)) for (let i = 0; i < 2; i++) {
    assert.ok(I.replaysExactly(ctx(p), played(p, style, `ex${i}`)), `${p.id} ${style} ${i}`);
  }
});

test('a hard-mode run with graded answers and a conversation also replays exactly', () => {
  const convs = load('conversations.json');
  for (let i = 0; i < 6; i++) {
    const g = createGameAt(S, { world, project: intro, deck, seed: `hard${i}`, mode: 'hard' });
    g.projectRef = intro.id;
    while (!g.over) {
      const ev = S.currentEvent(g);
      const conv = ev && C.conversationFor(g, ev.id, convs);
      if (conv) C.applyVerdict(g, conv, { outcome: 'partial', rubric: { curiosity: 2, clarity: 1, options_and_tradeoffs: 1, bad_news_early: 0, respect_and_tone: 2 }, hidden_concern_revealed: false, commitments: [] }, [{ from: 'player', text: 'Can we talk?' }]);
      else if (ev) S.chooseOption(g, ev.choices[0].id, { credit: 0.65, response: 'my answer' });
      if (g.actionPoints > 0) S.takeAction(g, 'checkin');
      S.advanceWeek(g);
    }
    assert.ok(I.replaysExactly(ctx(intro), g), `hard ${i}`);
  }
});

test('replay to a week stops with that week\'s situation waiting, ready to answer differently', () => {
  const g = played(intro, 'mixed', 'rp');
  const d = g.decisions[2];
  const back = I.replay(ctx(intro), I.recordOf(g), { untilWeek: d.week });
  assert.equal(back.week, d.week);
  assert.equal(S.currentEvent(back)?.id, d.eventId);
  assert.equal(back.decisions.length, 2);
  const other = S.bestChoice(S.currentEvent(back)).id;
  S.chooseOption(back, other);
  while (!back.over) { const ev = S.currentEvent(back); if (ev) S.chooseOption(back, S.bestChoice(ev).id); S.advanceWeek(back); }
  assert.ok(back.over && back.decisions.length >= 3);
});

test('candidates: every answer tested the other way; habits only when the run shows them', () => {
  const best = played(intro, 'best', 'c1');
  const cb = I.candidates(best);
  assert.equal(cb.length, best.decisions.length);
  assert.ok(cb.every((c) => c.kind === 'kept'));
  const rough = played(intro, 'struggling', 'c2');
  const cr = I.candidates(rough);
  assert.ok(cr.some((c) => c.ref === 'habit:no-overtime'));
  assert.ok(cr.some((c) => c.kind === 'missed'));
  const quiet = playOnce({ world, project: intro, deck, seed: 'c3', policy: { choose: (ev) => ev.choices[0], act: () => [] } });
  assert.ok(I.candidates(quiet).some((c) => c.ref === 'habit:reviews'));
  assert.ok(!cb.some((c) => c.kind === 'habit'));
});

test('ranking: best play gets credit and no replay offer; a struggling run is told to drop overtime first', () => {
  const rb = I.impactReport(ctx(intro), played(intro, 'best', 'r1'), { futures: 20 });
  assert.ok(rb.exact);
  assert.ok(rb.moves.length >= 1 && rb.moves.length <= 3);
  assert.ok(rb.moves.every((m) => m.kind === 'kept' && m.points >= I.MIN_POINTS));
  assert.deepEqual(rb.moves.map((m) => m.rank), rb.moves.map((_, i) => i + 1));
  assert.ok(rb.moves.every((m, i) => i === 0 || m.points <= rb.moves[i - 1].points));
  assert.equal(rb.replayOffer, null);
  for (const p of [intro, rescue]) {
    const rs = I.impactReport(ctx(p), played(p, 'struggling', 'r2'), { futures: 20 });
    assert.equal(rs.moves[0].ref, 'habit:no-overtime', p.id);
    assert.equal(rs.moves[0].partMoved, 'team morale');
    assert.ok(rs.moves[0].points > 5);
  }
});

test('the replay offer is the biggest missed chance, even outside the top 3', () => {
  const r = I.impactReport(ctx(documentary), played(documentary, 'mixed', 'o1'), { futures: 20 });
  const missed = r.all.filter((m) => m.kind === 'missed' && m.points >= I.MIN_POINTS).sort((a, b) => b.points - a.points);
  assert.equal(r.replayOffer?.ref ?? null, missed[0]?.ref ?? null);
  if (r.replayOffer) assert.ok(r.replayOffer.week >= (documentary.startWeek ?? 1));
  // A same-future block appears only when the later situations still line up with the run.
  for (const m of r.all) if (m.sameFuture) assert.equal(typeof m.sameFuture.overall, 'number');
});
