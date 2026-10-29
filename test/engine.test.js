import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../engine/sim.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const [intro, documentary, rescue] = projects;

const credit = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
const best = (ev) => S.bestChoice(ev);
const worst = (ev) => [...ev.choices].sort((a, b) => credit(a) - credit(b))[0];
const goodHabits = (g) => (g.week % 3 === 0 ? [['qa-review'], ['faculty-update']] : [['checkin'], ['working-session']]);

function play(project, seed, pickChoice, actionsFor = () => []) {
  const g = S.createGame({ world, project, deck, seed });
  while (!g.over) {
    const ev = S.currentEvent(g);
    if (ev) S.chooseOption(g, pickChoice(ev).id);
    for (const [a, who] of actionsFor(g)) if (g.actionPoints > 0) S.takeAction(g, a, who);
    S.advanceWeek(g);
  }
  return g;
}

test('same seed and same choices give the same result', () => {
  for (const p of projects) {
    const a = play(p, 'repeat', best, goodHabits);
    const b = play(p, 'repeat', best, goodHabits);
    assert.deepEqual(a.result, b.result);
    assert.deepEqual(a.log, b.log);
  }
});

test('content is internally consistent', () => {
  for (const p of projects) {
    const ids = new Set(p.tasks.map((t) => t.id));
    for (const t of p.tasks) for (const d of t.dependsOn) assert.ok(ids.has(d), `${p.id}: ${t.id} depends on missing ${d}`);
    for (const role of Object.keys(p.team)) {
      const pool = role === 'faculty' ? world.faculty : world.people;
      assert.ok(pool.some((x) => x.id === p.team[role]), `${p.id}: unknown ${role} ${p.team[role]}`);
    }
  }
  const projectIds = projects.map((p) => p.id);
  for (const e of deck.events) {
    assert.ok(e.debrief?.independent && e.debrief?.escalateWhen, `${e.id} needs both debrief explanations`);
    const full = e.choices.filter((c) => credit(c) === 1);
    assert.equal(full.length, 1, `${e.id} needs exactly one best answer`);
    assert.ok(e.choices.length >= 3, `${e.id} needs at least three choices`);
    for (const c of e.choices) assert.ok(c.why && c.outcome, `${e.id}/${c.id} needs outcome and why`);
    assert.ok(['ld', 'mp', 'gd', 'faculty', 'sup'].includes(e.who), `${e.id} needs a who`);
    for (const pid of e.projects ?? []) assert.ok(projectIds.includes(pid), `${e.id} names unknown project ${pid}`);
  }
});

test('every placeholder in situation text resolves for every project', () => {
  for (const p of projects) {
    const g = S.createGame({ world, project: p, deck, seed: 'names' });
    const texts = [g.project.brief];
    for (const e of deck.events) {
      texts.push(S.say(g, e.title), S.say(g, e.text), S.say(g, e.debrief.independent), S.say(g, e.debrief.escalateWhen));
      for (const c of e.choices) texts.push(S.say(g, c.label), S.say(g, c.outcome), S.say(g, c.why));
    }
    for (const a of S.actionList(g)) texts.push(a.label, a.help);
    for (const t of texts) assert.ok(!/\{\w+\}/.test(t), `${p.id}: unresolved placeholder in "${t}"`);
  }
});

test('good play beats passive play on every project', () => {
  for (const p of projects) {
    let good = 0, bad = 0;
    for (let i = 0; i < 25; i++) {
      good += play(p, `cmp${i}`, best, goodHabits).result.overall;
      bad += play(p, `cmp${i}`, worst).result.overall;
    }
    assert.ok(good / 25 > bad / 25 + 20, `${p.id}: good ${good / 25} vs bad ${bad / 25}`);
  }
});

test('the standard projects are winnable; passive play rarely launches on time', () => {
  for (const p of [intro, documentary]) {
    let strong = 0, passive = 0;
    for (let i = 0; i < 40; i++) {
      if (play(p, `ot${i}`, best, goodHabits).result.launchedOnTime) strong++;
      if (play(p, `ot${i}`, worst).result.launchedOnTime) passive++;
    }
    assert.ok(strong / 40 >= 0.75, `${p.id}: strong on-time rate ${strong / 40}`);
    assert.ok(passive / 40 <= 0.1, `${p.id}: passive on-time rate ${passive / 40}`);
  }
});

test('the rescue starts mid-project with progress already made', () => {
  const g = S.createGame({ world, project: rescue, deck, seed: 'r' });
  assert.equal(g.week, 6);
  assert.ok(S.taskComplete(g.tasks.find((t) => t.id === 'coursemap')));
  assert.ok(g.tasks.find((t) => t.id === 'scripts').done > 0);
  assert.ok(g.team.mp.morale < 60);
});

test('schedule status reads on track at the start and behind when work stalls', () => {
  const g = S.createGame({ world, project: intro, deck: { events: [] }, seed: 'st' });
  assert.equal(S.scheduleStatus(g).label, 'on-track');
  for (const r of S.STAFF) g.team[r].hoursPerWeek = 0;
  g.team.faculty.hoursPerWeek = 0;
  for (let i = 0; i < 4; i++) S.advanceWeek(g);
  const st = S.scheduleStatus(g);
  assert.ok(st.variance < -2, `variance ${st.variance}`);
  assert.equal(st.label, 'far-behind');
});

test('asking for extra hours adds output and costs morale', () => {
  const g = S.createGame({ world, project: intro, deck: { events: [] }, seed: 'ot' });
  const before = g.team.ld.morale;
  S.takeAction(g, 'overtime', 'ld');
  assert.ok(g.team.ld.morale < before);
  assert.throws(() => S.takeAction(g, 'overtime', 'faculty'), /Pick who/);
});

test('escalation earns partial credit and the debrief explains the independent fix', () => {
  const escalate = (ev) => ev.choices.find((c) => c.tier === 'escalate_plan') ?? ev.choices[0];
  const g = play(intro, 'esc', escalate, goodHabits);
  const lessons = S.debrief(g).filter((l) => l.kind === 'decision');
  assert.ok(lessons.length > 0);
  for (const l of lessons) {
    assert.ok(l.independent.length > 20);
    assert.ok(l.credit >= 0 && l.credit <= 1);
  }
});

test('hard mode: an AI credit overrides the option credit and is kept in the debrief', () => {
  for (let i = 0; i < 50; i++) {
    const g = S.createGame({ world, project: intro, deck, seed: `hard${i}`, mode: 'hard' });
    while (!g.over && !g.pendingEvent) S.advanceWeek(g);
    const ev = S.currentEvent(g);
    if (!ev) continue;
    const prompt = S.gradingPrompt(g, ev, 'I would talk to the team first.');
    assert.ok(prompt.includes('Rubric') && prompt.includes('I would talk to the team first.'));
    assert.ok(!/\{\w+\}/.test(prompt));
    S.chooseOption(g, worst(ev).id, { credit: 0.85, response: 'My answer', feedback: 'Good start.' });
    const lesson = S.debrief(g)[0];
    assert.equal(lesson.credit, 0.85);
    assert.equal(lesson.response, 'My answer');
    assert.ok(lesson.bestLabel, 'written answers always show the best move');
    return;
  }
  assert.fail('no event fired');
});

test('the game refuses to advance with an unresolved situation', () => {
  for (let i = 0; i < 50; i++) {
    const g = S.createGame({ world, project: intro, deck, seed: `pend${i}` });
    while (!g.over && !g.pendingEvent) S.advanceWeek(g);
    if (g.pendingEvent) {
      assert.throws(() => S.advanceWeek(g), /Resolve/);
      assert.throws(() => S.takeAction(g, 'checkin'), /Resolve/);
      return;
    }
  }
  assert.fail('no event fired in 50 seeds');
});

test('quality reviews surface hidden rework', () => {
  const g = S.createGame({ world, project: intro, deck: { events: [] }, seed: 'qa' });
  for (let i = 0; i < 4; i++) S.advanceWeek(g);
  const before = g.tasks.reduce((s, t) => s + t.hidden, 0);
  S.takeAction(g, 'qa-review');
  const after = g.tasks.reduce((s, t) => s + t.hidden, 0);
  assert.ok(after < before * 0.5, `hidden ${before} -> ${after}`);
});

test('a situation comes up at least every other week', () => {
  for (const p of projects) {
    for (let i = 0; i < 40; i++) {
      const g = play(p, `gap${i}`, best, goodHabits);
      const weeks = g.decisions.map((d) => d.week);
      const lastWeek = g.log.at(-1).week;
      for (let w = g.startWeek + 1; w <= lastWeek; w += 1) {
        assert.ok(weeks.some((x) => x === w || x === w - 1), `${p.id} seed gap${i}: no situation in weeks ${w - 1}-${w}`);
      }
    }
  }
});

test('the best answer is not always shown first', () => {
  let firstIsBest = 0, total = 0;
  for (let i = 0; i < 20; i++) {
    const g = S.createGame({ world, project: intro, deck, seed: `order${i}` });
    for (const ev of deck.events) {
      total++;
      if (S.choicesInOrder(g, ev)[0].id === S.bestChoice(ev).id) firstIsBest++;
    }
  }
  assert.ok(firstIsBest / total < 0.45, `best shown first ${firstIsBest}/${total}`);
});
