// Daily Mission screen: today's pick kept all day, the desk card, the brief, grading, the result and XP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';
import * as M from '../engine/mission.js';
import * as P from '../engine/progression.js';
import * as V from '../app/mission-screen.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avatarSVG = (a, mood, { label } = {}) => `<svg data-mood="${mood}" aria-label="${label}"></svg>`;
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const ctx = (date) => ({ date, world, deck, projects, newId: () => 'fellow' });
const event = (id) => deck.events.find((e) => e.id === id);

function fakeRoot() {
  const els = {};
  const root = {
    innerHTML: '', els,
    addEventListener(_t, f) { root.handler = f; },
    removeEventListener() { root.handler = null; },
    querySelector(sel) { if (sel === '#ms-answer' && !root.innerHTML.includes('id="ms-answer"')) return null; return (els[sel] ??= { focus() {}, disabled: false, value: '' }); },
    click(sel, dataset = {}) { root.handler({ target: { closest: (s) => (s === sel ? { dataset } : null) } }); },
  };
  return root;
}

test('today\'s pick is kept all day, even after the profile changes, and a new one comes the next day', () => {
  const store = memStore();
  const a = V.todaysPick(store, P.newProfile(), ctx('2026-11-25'));
  assert.ok(a && a.eventId && a.projectId && a.track);
  assert.ok(a.title && !/[{}]/.test(a.title), 'title has names filled in');
  const richer = { ...P.newProfile(), xp: { ...P.newProfile().xp, planning: 300 } };
  assert.deepEqual(V.todaysPick(store, richer, ctx('2026-11-25')), a);
  const next = V.todaysPick(store, richer, ctx('2026-11-26'));
  assert.equal(next.date, '2026-11-26');
  assert.notEqual(next.track, 'planning');
  // Storage that throws still gives a mission (kept in memory).
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.ok(V.todaysPick(blocked, P.newProfile(), ctx('2026-11-27')));
  assert.match(V.localDate(new Date(2026, 0, 5, 23, 30)), /^2026-01-05$/);
});

test('the desk card offers the mission, Hard when it is open, and shows done with practice and the streak', () => {
  const pick = V.todaysPick(memStore(), P.newProfile(), ctx('2026-11-25'));
  const ready = V.missionCardHtml(P.newProfile(), pick, esc, { projects, hardOpen: true });
  assert.match(ready, /data-mission="standard"/);
  assert.match(ready, /data-mission="hard"/);
  assert.match(ready, /Today's mission/);
  assert.doesNotMatch(V.missionCardHtml(P.newProfile(), pick, esc, { projects, hardOpen: false }), /data-mission="hard"/);
  const profile = { ...P.newProfile(), missions: [{ date: '2026-11-24', eventId: 'x', track: 'risk', credit: 1 }, { date: pick.date, eventId: pick.eventId, track: pick.track, credit: 0.7 }] };
  const done = V.missionCardHtml(profile, pick, esc, { projects });
  assert.match(done, /done/);
  assert.match(done, /data-mission="practice"/);
  assert.match(done, /2-day streak/);
  assert.ok(done.includes(esc(pick.title)));
  assert.match(V.missionCardHtml(P.newProfile(), null, esc, { projects }), /No mission/);
});

test('the brief shows where the project stands and the situation; hard mode asks for a written answer first', () => {
  const pick = V.todaysPick(memStore(), P.newProfile(), ctx('2026-11-25'));
  const g = M.setupMission(pick, { world, deck, projects });
  const ev = S.currentEvent(g);
  const html = V.briefHtml(pick, g, esc, { avatarSVG });
  assert.equal((html.match(/data-ms-choice=/g) ?? []).length, ev.choices.length);
  assert.match(html, new RegExp(`Week ${g.week} of ${g.launchWeek}`));
  assert.match(html, /· trust/);
  assert.doesNotMatch(html, /\{(ld|mp|gd|faculty|sup)\}/);
  const hard = { ...pick, mode: 'hard' };
  const write = V.briefHtml(hard, g, esc, { avatarSVG, ui: { stage: 'write', text: 'short' }, canGrade: true });
  assert.match(write, /id="ms-answer"/);
  assert.match(write, /id="ms-submit" disabled/);
  assert.doesNotMatch(write, /data-ms-choice/);
  const pickStage = V.briefHtml(hard, g, esc, { avatarSVG, ui: { stage: 'pick', text: 'I would talk to them first and agree a plan.' } });
  assert.match(pickStage, /closest to what you wrote/);
  assert.equal((pickStage.match(/data-ms-choice=/g) ?? []).length, ev.choices.length);
});

test('a graded answer plays as Claude\'s closest option, or the option nearest its credit', () => {
  const ev = event('faculty-traveling');
  const best = S.bestChoice(ev);
  assert.deepEqual(V.gradedChoice(ev, { credit: 0.9, closest: best.id, feedback: 'Good.' }), { choiceId: best.id, credit: 0.9, feedback: 'Good.' });
  assert.equal(V.gradedChoice(ev, { credit: 1, closest: 'nope' }).choiceId, best.id);
  assert.equal(V.gradedChoice(ev, { credit: 7 }).credit, 1);
  assert.throws(() => V.gradedChoice(ev, { closest: best.id }), (e) => e.code === 'invalid_json');
});

test('the lead line: launch odds when they moved 10+ points, otherwise the three-week picture', () => {
  const w = (trust, morale, rework) => ({ trust, morale, rework });
  const base = { choiceId: 'a', bestId: 'b', odds: { yours: 0.5, best: 0.8 }, oddsMatter: true, weeks3: { yours: w(80, 70, 4), best: w(80, 70, 4) } };
  assert.match(V.leadLine(base), /50% of 60 futures; with the best answer, 80%/);
  assert.match(V.leadLine({ ...base, oddsMatter: false, weeks3: { yours: w(72, 70, 10.2), best: w(84, 71, 3.6) } }), /faculty trust 72 vs 84 with the best answer; 7 more hours of rework/);
  assert.match(V.leadLine({ ...base, oddsMatter: false }), /almost the same/);
  assert.match(V.leadLine({ ...base, choiceId: 'b', odds: { yours: 0.9, best: 0.9 } }), /launches on time in 90%/);
});

test('recording pays XP on improvement, the daily bonus once, keeps the streak and reports level-ups', () => {
  const pick = V.todaysPick(memStore(), P.newProfile(), ctx('2026-11-25'));
  const ev = event(pick.eventId);
  const start = { ...P.newProfile(), missions: [{ date: '2026-11-24', eventId: 'x', track: 'risk', credit: 1, bonus: true }], xp: { ...P.newProfile().xp, [pick.track]: 30 } };
  const first = V.recordResult(start, pick, { credit: 1 }, ev);
  assert.ok(first.total >= 20 + M.BONUS_XP);
  assert.equal(first.bonus, true);
  assert.equal(first.streak, 2);
  assert.ok(first.levelUps.some((l) => l.track === pick.track && l.level === 2));
  const again = V.recordResult(first.profile, pick, { credit: 1 }, ev);
  assert.equal(again.total, 0);
  assert.equal(again.bonus, false);
});

test('the mission plays end to end: choose, play forward, record once; practice records nothing', () => {
  const pick = { ...V.todaysPick(memStore(), P.newProfile(), ctx('2026-11-25')), mode: 'standard' };
  const ev = event(pick.eventId);
  const worst = [...ev.choices].sort((a, b) => (a.credit ?? S.TIER_CREDIT[a.tier]) - (b.credit ?? S.TIER_CREDIT[b.tier]))[0];
  for (const practice of [false, true]) {
    const root = fakeRoot();
    const records = [];
    const queue = [];
    const view = V.mountMission(root, {
      pick: { ...pick, practice }, world, deck, projects, esc, avatarSVG, schedule: (fn) => queue.push(fn),
      onRecord: (pk, result, e) => { records.push(result); return V.recordResult(P.newProfile(), pk, result, e); },
    });
    assert.match(root.innerHTML, /data-ms-choice/);
    root.click('[data-ms-choice]', { msChoice: worst.id });
    assert.match(root.innerHTML, /Playing the next weeks forward/);
    queue.shift()();
    assert.match(root.innerHTML, /Launches on time/);
    assert.match(root.innerHTML, /Best move/);
    assert.match(root.innerHTML, /The idea/);
    if (practice) { assert.equal(records.length, 0); assert.match(root.innerHTML, /Practice: nothing recorded/); } else { assert.equal(records.length, 1); assert.match(root.innerHTML, /XP/); }
    view.unmount();
    assert.equal(root.innerHTML, '');
  }
});

test('hard mode: Claude grades the written answer, which plays as its closest option with the grade', async () => {
  const pick = { ...V.todaysPick(memStore(), P.newProfile(), ctx('2026-11-25')), mode: 'hard' };
  const ev = event(pick.eventId);
  const best = S.bestChoice(ev);
  const root = fakeRoot();
  const prompts = [];
  const queue = [];
  let recorded = null;
  V.mountMission(root, {
    pick, world, deck, projects, esc, avatarSVG, schedule: (fn) => queue.push(fn),
    grader: async (prompt) => { prompts.push(prompt); return { credit: 0.85, closest: best.id, feedback: 'Solid plan; add a date.' }; },
    onRecord: (pk, result, e) => { recorded = result; return V.recordResult(P.newProfile(), pk, result, e); },
  });
  const box = root.els['#ms-answer'];
  box.value = 'I would meet them this week, agree what changes and confirm it in writing.';
  box.oninput();
  root.click('#ms-submit');
  await new Promise((r) => setImmediate(r));
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].includes(box.value));
  queue.shift()();
  assert.equal(recorded.credit, 0.85);
  assert.equal(recorded.choiceId, best.id);
  assert.match(root.innerHTML, /85%/);
  assert.match(root.innerHTML, /Solid plan; add a date\./);
  assert.match(root.innerHTML, /You wrote/);
  // A failed grade offers Try again and the pick-the-closest fallback.
  const r2 = fakeRoot();
  V.mountMission(r2, { pick, world, deck, projects, esc, avatarSVG, schedule: (fn) => fn(), grader: async () => { throw { code: 'timeout' }; } });
  r2.els['#ms-answer'].value = 'A long enough written answer for grading.';
  r2.els['#ms-answer'].oninput();
  r2.click('#ms-submit');
  await new Promise((r) => setImmediate(r));
  assert.match(r2.innerHTML, /Grading didn/);
  assert.match(r2.innerHTML, /id="ms-pick"/);
});
