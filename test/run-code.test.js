import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import { createGameAt } from '../engine/difficulty.js';
import { normalizeRunCode, pickSeed, runCodeHtml } from '../app/run-code.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const intro = load(`projects/${load('projects.json').projects[0]}.json`);

test('a typed run code wins over ?seed= and a random seed, and is normalized', () => {
  const random = () => 'rnd123';
  assert.equal(normalizeRunCode('  Fellow 1 '), 'fellow-1');
  assert.equal(normalizeRunCode('Fellow-1!'), 'fellow-1');
  assert.equal(normalizeRunCode('x'.repeat(50)).length, 32);
  assert.equal(pickSeed({ typed: 'Fellow 1', search: '?seed=abc', random }), 'fellow-1');
  assert.equal(pickSeed({ typed: '  ', search: '?seed=abc', random }), 'abc');
  assert.equal(pickSeed({ typed: '', search: '', random }), 'rnd123');
  assert.equal(pickSeed({ typed: '!!!', random }), 'rnd123');
  const html = runCodeHtml('"><b>', (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
  assert.ok(html.includes('id="run-code"') && !html.includes('"><b>'));
});

test('the same run code, project and pace give the same situations', () => {
  const situations = (seed, difficulty) => {
    const g = createGameAt(S, { world, project: intro, deck, seed, difficulty });
    const seen = [];
    while (!g.over) {
      const ev = S.currentEvent(g);
      if (ev) {
        seen.push(`${g.week}:${ev.id}`);
        S.chooseOption(g, S.bestChoice(ev).id);
      }
      S.advanceWeek(g);
    }
    return seen.join(' ');
  };
  const code = pickSeed({ typed: 'fellow-1', random: () => 'unused' });
  for (const pace of ['standard', 'story']) {
    const a = situations(code, pace);
    assert.ok(a.length > 0, `${pace}: some situations come up`);
    assert.equal(situations(code, pace), a, `${pace}: same code replays the same situations`);
  }
  assert.notEqual(situations('fellow-1', 'standard'), situations('fellow-2', 'standard'));
});
