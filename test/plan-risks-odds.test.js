// Plan editor steps 3 (risk register) and 4 (odds meter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../engine/plan.js';
import * as V from '../app/plan-screen.js';
import * as R from '../app/plan-risks.js';
import * as O from '../app/plan-odds.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const prompts = load('risks.json');
const intro = load('projects/intro-psych-online.json');
const base = load('plans/intro-psych-online.json');
const ids = load('projects.json').projects;
const run = (plan, ops, project = intro) => ops.reduce((p, op) => V.editFor(op, project)(p), plan);
const noRisks = { ...base, risks: [] };

// A scheduler the test steps by hand: later() and frame() queue, flush() runs everything queued.
function manualSchedule() {
  const q = [];
  return {
    q,
    later: (fn) => { const h = { fn }; q.push(h); return h; },
    frame: (fn) => { const h = { fn }; q.push(h); return h; },
    cancel: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    flush() { let n = 0; while (q.length) { q.shift().fn(); n++; } return n; },
  };
}

test('risk prompts carry every baseline risk for every project, and only the risk text', () => {
  for (const id of ids) {
    const plan = load(`plans/${id}.json`);
    const texts = new Set((prompts.projects[id] ?? []).map((r) => r.text));
    for (const r of plan.risks) assert.ok(texts.has(r.text), `${id}: ${r.text}`);
  }
  for (const r of [...Object.values(prompts.projects).flat(), ...prompts.common]) assert.deepEqual(Object.keys(r).sort(), ['id', 'text']);
  assert.ok(prompts.common.length >= 6);
});

test('building the register from the list through the screen\'s ops turns Risk owners from fail to pass', () => {
  assert.equal(P.runChecks(noRisks, intro, world).find((c) => c.id === 'risks').status, 'fail');
  let p = noRisks;
  const offered = R.riskPrompts(prompts, intro, p);
  assert.equal(offered.project.length, 3);
  // Add two from the list: each lands with its text only and the card names what's missing.
  p = run(p, [{ op: 'risk-add', risk: R.promptFor(`project:${offered.project[0].id}`, prompts, intro) }, { op: 'risk-add', risk: R.promptFor(`common:${prompts.common[0].id}`, prompts, intro) }]);
  let m = R.riskModel(p, intro, world, prompts);
  assert.equal(m.cards.length, 2);
  assert.deepEqual(m.cards[0].missing, ['owner', 'mitigation', 'trigger', 'contingency']);
  assert.equal(m.check.status, 'fail');
  assert.equal(R.riskPrompts(prompts, intro, p).project.length, 2, 'an added risk leaves the list');
  // Fill both in, one field per edit as the screen sends them.
  const fill = { owner: 'PM', mitigation: 'Weekly working sessions', trigger: 'Scripts not started by the end of week 3', contingency: 'Li drafts from the course map' };
  for (const r of p.risks) for (const [k, v] of Object.entries(fill)) p = run(p, [{ op: 'risk-edit', id: r.id, fields: { [k]: v } }]);
  m = R.riskModel(p, intro, world, prompts);
  assert.ok(m.cards.every((c) => c.complete));
  assert.equal(m.check.status, 'pass');
  // Clearing one field fails the check again and the card says which; removing that risk passes it.
  p = run(p, [{ op: 'risk-edit', id: p.risks[1].id, fields: { trigger: '  ' } }]);
  m = R.riskModel(p, intro, world, prompts);
  assert.deepEqual(m.cards[1].missing, ['trigger']);
  assert.equal(m.check.status, 'fail');
  assert.deepEqual(P.runChecks(p, intro, world).find((c) => c.id === 'risks').risks, [p.risks[1].id]);
  p = run(p, [{ op: 'risk-remove', id: p.risks[1].id }]);
  assert.equal(R.riskModel(p, intro, world, prompts).check.status, 'pass');
});

test('the Risks tab draws cards, owners, missing fields and highlights, and escapes what players type', () => {
  const p = run(noRisks, [{ op: 'risk-add', risk: { text: '<b>Studio</b> & "dates"', owner: 'Perrick' } }, { op: 'risk-add' }]);
  const m = R.riskModel(p, intro, world, prompts);
  assert.deepEqual(m.owners.map((o) => o.label), ['You (PM)', 'Li', 'Perrick', 'Sam']);
  const html = R.risksHtml(m, { highlight: { risks: [p.risks[1].id] } });
  assert.match(html, /0\/2 complete/);
  assert.match(html, /Missing mitigation, trigger and contingency/);
  assert.match(html, /Missing the risk itself, owner, mitigation, trigger and contingency/);
  assert.match(html, /&lt;b&gt;Studio&lt;\/b&gt; &amp; &quot;dates&quot;/);
  assert.doesNotMatch(html, /<b>Studio/);
  assert.match(html, /<option value="Perrick" selected>/);
  assert.equal((html.match(/class="pe-risk card[^"]*\bhl\b/g) ?? []).length, 1);
  assert.match(html, /optgroup label="This project"/);
  assert.match(html, /optgroup label="Common in ODL"/);
  // The baseline's register is complete and its prompts are all used up.
  const full = R.risksHtml(R.riskModel(base, intro, world, prompts));
  assert.match(full, /3\/3 complete/);
  assert.doesNotMatch(full, /optgroup label="This project"/);
  // The screen shows the tab with its count; the risk card names stay out of the timeline.
  const screen = V.screenHtml(V.planView(p, intro, world), { tab: 'risks', prompts });
  assert.match(screen, /data-tab="risks"/);
  assert.match(screen, /Risks <span class="pe-tab-count fail">0\/2<\/span>/);
});

test('the odds key ignores risks and the gate, and the meter waits for every task to be placed', () => {
  assert.equal(O.oddsKey(base), O.oddsKey({ ...base, risks: [], gate: null }));
  assert.notEqual(O.oddsKey(base), O.oddsKey(run(base, [{ op: 'move', id: 'qa', by: 1 }])));
  const empty = P.emptyPlan(intro, world);
  assert.equal(O.oddsBlocked(P.blockers(empty, intro)), 'Place every task to see the odds');
  assert.equal(O.oddsBlocked(P.blockers(base, intro)), null);
  const looped = { ...base, tasks: { ...base.tasks, analysis: { ...base.tasks.analysis, deps: ['handoff'] } } };
  assert.equal(O.oddsBlocked(P.blockers(looped, intro)), 'Untangle the loop to see the odds');
  const s = manualSchedule();
  const meter = O.createOddsMeter({ world, project: intro, deck }, { schedule: s });
  meter.request(empty, P.blockers(empty, intro));
  assert.equal(meter.state().status, 'waiting');
  assert.equal(s.q.length, 0, 'nothing is simulated for an unplaced plan');
  assert.match(O.oddsHtml(meter.state()), /Place every task/);
});

test('the meter runs 200 seeded runs in slices of 25, matches one 200-run call, sits near the 500-run figure, and caches', () => {
  const s = manualSchedule();
  const seen = [];
  const meter = O.createOddsMeter({ world, project: intro, deck }, { schedule: s, onUpdate: (st) => seen.push(st.status) });
  meter.request(base, []);
  assert.equal(meter.state().status, 'running');
  const steps = s.flush();
  assert.equal(steps, 200 / 25, 'the debounce runs the first slice, then 7 more frames');
  const st = meter.state();
  assert.equal(st.status, 'done');
  assert.equal(st.runs, 200);
  const direct = P.onTimeOdds(base, { world, project: intro, deck }, { runs: 200, seed: 'meter' }).share;
  assert.equal(st.share, direct);
  const five = P.onTimeOdds(base, { world, project: intro, deck }, { runs: 500, seed: 'odds' }).share;
  assert.ok(Math.abs(st.share - five) <= 0.05, `200-run ${st.share} vs 500-run ${five}`);
  assert.match(O.oddsHtml(st), new RegExp(`~${Math.round(st.share * 100)}%`));
  // The same plan again (Undo back to it) is instant; a risk edit doesn't recompute.
  meter.request({ ...base, risks: [] }, []);
  assert.equal(meter.state().status, 'done');
  assert.equal(s.q.length, 0);
  assert.deepEqual(seen.slice(0, 2), ['running', 'done']);
});

test('a new edit cancels the run in progress; the old number dims; a slow device drops to 100 runs and says so', () => {
  const s = manualSchedule();
  const meter = O.createOddsMeter({ world, project: intro, deck }, { schedule: s });
  meter.request(base, []);
  s.flush();
  const before = meter.state().share;
  const later = run(base, [{ op: 'move', id: 'qa', by: 1 }]);
  meter.request(later, P.blockers(later, intro));
  assert.equal(meter.state().status, 'running');
  assert.equal(meter.state().share, before, 'the old number stays, dimmed');
  assert.match(O.oddsHtml(meter.state()), /class="pe-odds [a-z]+ running"/);
  s.q.shift().fn(); // the debounce fires and runs one slice
  meter.request(base, []); // the player undoes before it finishes
  assert.equal(meter.state().status, 'done');
  assert.equal(meter.state().share, before);
  assert.equal(s.q.length, 0, 'the unfinished run was cancelled');
  // A clock that says each run takes 10 ms: 200 runs would take 2 s, over the 1.5 s budget.
  let t = 0;
  const s2 = manualSchedule();
  const slow = O.createOddsMeter({ world, project: intro, deck }, { schedule: s2, now: () => (t += 250) });
  slow.request(base, []);
  assert.equal(s2.flush(), 100 / 25, 'it stops after 100 runs');
  assert.equal(slow.state().runs, 100);
  assert.equal(slow.state().reduced, true);
  assert.equal(slow.state().share, P.onTimeOdds(base, { world, project: intro, deck }, { runs: 100, seed: 'meter' }).share);
  assert.match(O.oddsHtml(slow.state()), /100 runs/);
});
