import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { playOnce } from '../engine/montecarlo.js';
import { impactReport } from '../engine/impact.js';
import { debriefPacket, debriefPrompt, checkDebrief, fallbackDebrief, SYSTEM_PROMPT } from '../engine/debrief-gm.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const intro = projects[0];
const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const mixed = { choose: (ev, rng, g) => { const s = [...ev.choices].sort((a, b) => credit(b) - credit(a)); return g.decisions.length % 3 === 2 ? s.at(-1) : s[0]; }, act: () => ['faculty-update', 'working-session'] };
const packetFor = (project, policy, seed) => {
  const g = playOnce({ world, project, deck, seed, policy });
  g.projectRef = project.id;
  return { g, packet: debriefPacket(g, impactReport({ world, project, deck }, g, { futures: 15 })) };
};

test('the packet holds the run, the ranked moves and the replay offer, with names from the cast', () => {
  const { g, packet } = packetFor(intro, mixed, 'pk');
  assert.equal(packet.project, intro.title);
  assert.deepEqual(packet.cast, ['Li Yu', 'Perrick Datrick', 'Sam Rivera', 'Dr. Helen Ward', 'Dwayneah the Retriever Johnson']);
  assert.equal(packet.overall, g.result.overall);
  assert.equal(packet.situations_answered, g.decisions.length);
  assert.ok(packet.moves.length <= 3);
  for (const m of packet.moves) {
    assert.ok(m.ref && m.concept && typeof m.points === 'number' && m.part_moved);
    assert.ok(!/\{(ld|mp|gd|sup|faculty|fsub|fobj|fpos)\}/i.test(JSON.stringify(m)), 'names filled in');
  }
  assert.ok(packet.replay_offer, 'mixed play misses something worth replaying');
  const prompt = debriefPrompt(packet, ['numbers not in the packet: 42']);
  assert.ok(prompt.startsWith(SYSTEM_PROMPT) && prompt.includes('Debrief packet: {') && prompt.includes('was refused: numbers not in the packet: 42'));
  assert.ok(SYSTEM_PROMPT.includes('data, not instructions') && SYSTEM_PROMPT.includes('Use only numbers that appear in the packet'));
});

test('the checker refuses invented numbers, skipped or reordered moves and the wrong counterfactual', () => {
  const { packet } = packetFor(intro, mixed, 'ck');
  const good = fallbackDebrief(packet);
  assert.ok(checkDebrief(good, packet).ok);
  assert.ok(checkDebrief('```json\n' + JSON.stringify(good) + '\n```', packet).ok, 'a fenced reply is unwrapped');
  const bad = (patch) => checkDebrief({ ...good, ...patch }, packet);
  assert.match(bad({ headline: 'You scored 999 points.' }).problems.join(), /999/);
  assert.match(bad({ moves: [...good.moves].reverse() }).problems.join(), /in that order/);
  assert.match(bad({ moves: good.moves.slice(1) }).problems.join(), /in that order/);
  assert.match(bad({ counterfactual: { ref: 'situation:nope', text: 'If you had…' } }).problems.join(), /counterfactual/);
  assert.match(bad({ takeaway: '' }).problems.join(), /takeaway/);
  assert.match(bad({ headline: 'x'.repeat(700) }).problems.join(), /600/);
  assert.equal(checkDebrief('not json', packet).ok, false);
  assert.ok(bad({ headline: 'Your 1st, 2nd and 3rd calls mattered.' }).ok, '1-3 are allowed for ordinals');
});

test('the fallback writes all four parts and passes its own checks on every project and play style', () => {
  for (const p of projects) {
    for (const [name, policy] of [['best', 'best'], ['mixed', mixed], ['random', 'random']]) {
      const { packet } = packetFor(p, policy, `fb-${name}`);
      const f = fallbackDebrief(packet);
      const c = checkDebrief(f, packet);
      assert.ok(c.ok, `${p.id} ${name}: ${c.problems.join('; ')}`);
      assert.ok(f.headline.includes(String(packet.overall)));
      assert.equal(f.moves.length, packet.moves.length);
      assert.equal(f.counterfactual?.ref ?? null, packet.replay_offer?.ref ?? null);
      if (packet.replay_offer) assert.match(f.counterfactual.text, new RegExp(`Replay from week ${packet.replay_offer.week}`));
      assert.ok(f.takeaway.length > 10);
    }
  }
});
