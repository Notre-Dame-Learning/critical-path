// Estimate drill: the Daily Mission kind for Estimating (engine/estimate.js, app/estimate-screen.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../engine/estimate.js';
import * as M from '../engine/mission.js';
import * as P from '../engine/progression.js';
import * as V from '../app/mission-screen.js';
import * as D from '../app/estimate-screen.js';
import { playOnce } from '../engine/montecarlo.js';
import { tracksOf } from '../engine/tracks.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const plans = Object.fromEntries(projects.map((p) => [p.id, load(`plans/${p.id}.json`)]));
const ctx = { world, deck, projects, plans };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avatarSVG = (a, mood, { label } = {}) => `<svg data-mood="${mood}" aria-label="${label}"></svg>`;
const intro = projects.find((p) => p.id === 'intro-psych-online');
const drill = (projectId, taskId, extra = {}) => ({ kind: 'drill', date: '2026-11-26', playerId: 'fellow', track: 'estimating', tier: 'primary', eventId: `drill:${projectId}:${taskId}`, projectId, taskId, seed: `fellow:${projectId}:${taskId}`, difficulty: 'standard', mode: 'standard', title: 'Estimate: Post-production', reason: 'Estimating is your lowest track (L1)', ...extra });
// Every Estimating situation already seen, so the next Estimating mission is a drill.
const estSeen = { xp: { planning: 300, estimating: 0, capacity: 300, risk: 300, stakeholders: 300, communication: 300, change: 300, leadership: 300 },
  bestCredit: Object.fromEntries(deck.events.filter((e) => tracksOf(e).primary === 'estimating').map((e) => [e.id, 0.5])) };

test('actual hours count new work, fixes, what is left and any part moved after launch; drills skip faculty, started and small tasks', () => {
  const g = playOnce({ world, project: intro, deck, seed: 'a:1', policy: 'best' });
  const a = E.taskActuals(g);
  const post = g.tasks.find((t) => t.id === 'post');
  const worked = g.log.flatMap((e) => Object.values(e.work).flat()).filter((w) => w.task === 'post').reduce((s, w) => s + w.new + w.fix, 0);
  assert.ok(Math.abs(a.post.hours - (worked + Math.max(0, post.effort - post.done) + post.known)) < 0.2);
  assert.ok(a.post.hours >= post.effort - 0.5, 'never less than the work itself');
  // A deferral adds back what was moved after launch.
  const h = structuredClone(g);
  h.v2.deferred = [{ task: 'post', hours: 5, week: 9 }];
  assert.ok(Math.abs(E.taskActuals(h).post.hours - a.post.hours - 5) < 0.11);

  const ids = (p) => E.drillTasks(p, world).map((b) => b.id);
  assert.ok(!ids(intro).some((id) => ['scripts', 'content', 'handoff', 'embed', 'brief', 'scriptreview', 'distribution'].includes(id)), 'faculty-owned and tasks under 8 h are out');
  assert.ok(ids(intro).includes('post') && ids(intro).includes('mastersite'));
  const rescue = projects.find((p) => p.id === 'rescue-sustainable-business');
  for (const b of E.drillTasks(rescue, world)) assert.ok(!b.inherited && !b.started, `${b.id} not under way at the takeover`);
  for (const p of projects) assert.ok(E.drillTasks(p, world).length >= 2, `${p.id} has drills`);
});

test('scoring: the fair range scores full marks, a range that misses scores low, a too-wide one loses width marks', () => {
  const actual = Array.from({ length: 60 }, (_, i) => 25 + (i % 10)); // 25..34
  const fair = E.scoreRange([25, 29, 34], actual);
  assert.equal(fair.credit, 1);
  assert.equal(fair.caught, 60);
  assert.deepEqual(fair.fair, [26, 33]); // 10th to 90th percentile
  assert.equal(fair.fairCaught, 48);
  const low = E.scoreRange([14, 18, 24], actual);
  assert.equal(low.caught, 0);
  assert.equal(low.credit, 0);
  const narrow = E.scoreRange([28, 29, 30], actual); // catches 18 of 60
  assert.equal(narrow.caught, 18);
  assert.ok(narrow.credit > 0.3 && narrow.credit < 0.4, String(narrow.credit));
  const wide = E.scoreRange([10, 30, 60], actual);
  assert.equal(wide.caught, 60);
  assert.equal(wide.widthPart, 0.25);
  const bitWide = E.scoreRange([23, 29, 36], actual); // 6 h wider than the fair range on a typical 30: free
  assert.equal(bitWide.credit, 1);
  // Whole hours cover half an hour either side.
  assert.equal(E.scoreRange([8, 8, 8], Array(60).fill(8.3)).credit, 1);
  assert.equal(E.checkRange([5, 4, 9]), 'Best case ≤ most likely ≤ worst case.');
  assert.match(E.checkRange([5, NaN, 9]), /all three/);
  assert.match(E.checkRange([0, 4, 9]), /whole hours/);
  assert.equal(E.checkRange([5, 6, 9]), null);
});

test('the Intro post-production drill: Perrick quotes low, past courses show it, and the fair range wins', () => {
  const pick = drill('intro-psych-online', 'post');
  const brief = E.drillBrief(pick, ctx);
  assert.equal(brief.person.short, 'Perrick');
  assert.ok(brief.optimistic);
  assert.deepEqual(brief.task.weeks, [plans['intro-psych-online'].tasks.post.start, plans['intro-psych-online'].tasks.post.end]);
  assert.ok(brief.history.length >= 2 && brief.history.every((r) => r.taskId === 'post' && r.projectId !== 'intro-psych-online'));
  assert.ok(brief.history.every((r) => r.took.p50 > r.quote[1] * 1.3), 'past post-production ran well over Perrick\'s likely figure');
  const quote = E.resolveDrill(pick, brief.quote, ctx, brief);
  assert.ok(quote.score.caught <= 6, `quote caught ${quote.score.caught}`);
  assert.ok(quote.credit < 0.15);
  assert.match(quote.lessons[0], /optimistic estimator/);
  const fair = E.resolveDrill(pick, [quote.score.fair[0], Math.round(quote.score.p50), quote.score.fair[1]], ctx, brief);
  assert.ok(fair.credit >= 0.95, String(fair.credit));
  // Same pick, same futures.
  assert.deepEqual(E.resolveDrill(pick, brief.quote, ctx, brief).actual, quote.actual);
  assert.throws(() => E.resolveDrill(pick, [9, 8, 7], ctx, brief));
});

test('calibration: on every drill the fair range scores 0.95+, and Perrick\'s quotes miss more than the others\'', () => {
  const byOwner = { optimistic: [], honest: [] };
  for (const p of projects) {
    for (const b of E.drillTasks(p, world)) {
      const { actual } = E.playFutures({ world, project: p, deck, runs: 30, seed: 'cal' }).tasks[b.id];
      const s = E.spread(actual);
      const fair = E.scoreRange([Math.round(s.p10), Math.round(s.p50), Math.round(s.p90)], actual);
      assert.ok(fair.credit >= 0.95, `${p.id}/${b.id} fair ${fair.credit}`);
      byOwner[b.optimistic ? 'optimistic' : 'honest'].push(E.scoreRange(b.quote, actual).caught / actual.length);
    }
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(byOwner.optimistic.length >= 5 && byOwner.honest.length >= 10);
  assert.ok(mean(byOwner.optimistic) < 0.4 && mean(byOwner.honest) > 0.8, `optimistic ${mean(byOwner.optimistic)}, honest ${mean(byOwner.honest)}`);
});

test('the Daily Mission picks a drill once the Estimating situations are seen, rotates drills, and pays Estimating XP', () => {
  const pick = M.pickMission(estSeen, { date: '2026-11-26', playerId: 'fellow', world, deck, projects, unlocked: ['intro-psych-online'] });
  assert.equal(pick.kind, 'drill');
  assert.equal(pick.track, 'estimating');
  assert.equal(pick.projectId, 'intro-psych-online');
  assert.match(pick.title, /^Estimate: /);
  assert.match(pick.reason, /Estimating is your lowest track \(L1\)/);
  assert.deepEqual(M.pickMission(estSeen, { date: '2026-11-26', playerId: 'fellow', world, deck, projects, unlocked: ['intro-psych-online'] }), pick);
  assert.equal(M.setupMission(pick, ctx), null);
  // A fresh player still gets an unseen Estimating situation first.
  const fresh = M.pickMission({ xp: { ...estSeen.xp } }, { date: '2026-11-26', world, deck, projects, unlocked: ['intro-psych-online'] });
  assert.notEqual(fresh.kind, 'drill');

  const result = { credit: 0.9 };
  const { profile: after, gained } = M.recordMission(estSeen, pick, result, E.drillEvent(pick));
  assert.deepEqual(gained.xp, { estimating: 28 }); // 20 × 0.9 + the 10 XP bonus
  assert.equal(after.bestCredit[pick.eventId], 0.9);
  const next = M.pickMission(after, { date: '2026-11-27', playerId: 'fellow', world, deck, projects, unlocked: ['intro-psych-online'] });
  assert.equal(next.kind, 'drill');
  assert.notEqual(next.eventId, pick.eventId, 'a drill done this week rests');
  const again = M.recordMission(after, { ...pick, date: '2026-11-27' }, { credit: 0.95 }, E.drillEvent(pick));
  assert.equal(again.gained.xp.estimating, 11, 'only the improvement (1 XP) plus the day\'s bonus');
});

test('the desk card, the brief, a bad range, the result and recording all work for a drill', () => {
  const pick = drill('intro-psych-online', 'post');
  const card = V.missionCardHtml(P.newProfile(), pick, esc, { projects, hardOpen: true });
  assert.match(card, /Estimate drill/);
  assert.match(card, /Estimate: Post-production/);
  assert.doesNotMatch(card, /data-mission="hard"/, 'no written answer for a drill');

  const els = {};
  const root = {
    innerHTML: '', handlers: {},
    addEventListener(t, f) { root.handlers[t] = f; },
    removeEventListener(t) { delete root.handlers[t]; },
    querySelector(sel) { return (els[sel] ??= { focus() {}, value: '' }); },
    click(sel) { root.handlers.click({ target: { closest: (s) => (s === sel ? {} : null) } }); },
  };
  const recorded = [];
  const view = V.mountMission(root, {
    pick: { ...pick, mode: 'hard' }, world, deck, projects, plans, esc, avatarSVG, schedule: (fn) => fn(),
    onRecord: (pk, result, event) => { recorded.push({ pk, result, event }); return V.recordResult(P.newProfile(), pk, result, event); },
  });
  assert.match(root.innerHTML, /How similar work went on past courses/);
  assert.match(root.innerHTML, /Best case 14 hours, most likely 18, worst case 24/);
  assert.match(root.innerHTML, /Play it 60 times/);
  // Out of order: an error, nothing recorded.
  for (const [i, v] of ['30', '20', '35'].entries()) { els[`#es-v${i}`].value = v; els[`#es-v${i}`].oninput(); }
  root.click('#es-submit');
  assert.match(root.innerHTML, /Best case ≤ most likely ≤ worst case/);
  assert.equal(recorded.length, 0);
  els['#es-v0'].value = '24'; els['#es-v0'].oninput();
  els['#es-v1'].value = '28'; els['#es-v1'].oninput();
  root.click('#es-submit');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].event.track, 'estimating');
  assert.equal(recorded[0].pk.mode, 'standard');
  const html = root.innerHTML;
  assert.match(html, /<svg class="es-strip"/);
  assert.match(html, /Your range of 24–35 h caught \d+ of 60 futures/);
  assert.match(html, /Perrick's quote/);
  assert.match(html, /A fair range/);
  assert.match(html, /optimistic estimator/);
  assert.match(html, /\+\d+ XP/);
  view.unmount();

  // Practice records nothing.
  const quiet = [];
  V.mountMission(root, { pick: { ...pick, practice: true }, world, deck, projects, plans, esc, avatarSVG, schedule: (fn) => fn(), onRecord: () => quiet.push(1) });
  for (const [i, v] of ['24', '28', '35'].entries()) { els[`#es-v${i}`].value = v; els[`#es-v${i}`].oninput(); }
  root.click('#es-submit');
  assert.equal(quiet.length, 0);
  assert.match(root.innerHTML, /Practice: nothing recorded/);
});

test('today\'s pick keeps a drill and its title all day', () => {
  const m = new Map();
  const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
  const only = projects.filter((p) => p.id === 'intro-psych-online');
  const a = V.todaysPick(store, estSeen, { date: '2026-11-26', world, deck, projects: only, newId: () => 'fellow' });
  assert.equal(a.kind, 'drill');
  assert.match(a.title, /^Estimate: /);
  assert.deepEqual(V.todaysPick(store, { ...estSeen, xp: { ...estSeen.xp, estimating: 500 } }, { date: '2026-11-26', world, deck, projects: only }), a);
  assert.ok(D.leadLine({ range: [10, 12, 14], actual: Array(60).fill(20), score: E.scoreRange([10, 12, 14], Array(60).fill(20)) }).includes('60 ran over it'));
});
