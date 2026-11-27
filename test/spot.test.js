// Spot the flaw: the Daily Mission kind for Planning, Risk and Capacity (engine/spot.js, app/spot-screen.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Plan from '../engine/plan.js';
import * as C from '../engine/critique.js';
import * as Sp from '../engine/spot.js';
import * as M from '../engine/mission.js';
import * as P from '../engine/progression.js';
import * as V from '../app/mission-screen.js';
import * as Q from '../app/critique-screen.js';
import * as D from '../app/spot-screen.js';
import { tracksOf } from '../engine/tracks.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../content/${p}`, import.meta.url)));
const world = load('world.json');
const deck = load('scenarios/core-deck.json');
const projects = load('projects.json').projects.map((id) => load(`projects/${id}.json`));
const plans = Object.fromEntries(projects.map((p) => [p.id, load(`plans/${p.id}.json`)]));
const flaws = Object.fromEntries(Plan.CHECKS.map((c) => [c.id, load(`flaws/${c.flaw}.json`)]));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const intro = projects.find((p) => p.id === 'intro-psych-online');
const ids = (cands) => cands.map((c) => c.id).sort();
const spot = (projectId, flawId, extra = {}) => ({ kind: 'spot', date: '2026-11-27', playerId: 'fellow', track: Sp.flawTrack(Object.values(flaws).find((f) => f.id === flawId)), tier: 'primary', eventId: `spot:${projectId}:${flawId}`, projectId, flawId, seed: `fellow:${projectId}:${flawId}`, difficulty: 'standard', mode: 'standard', title: 'Spot the flaw', reason: 'Planning is your lowest track (L1)', ...extra });
// Profiles at PM and Senior PM: the XP and the launches progression.js's gates read.
const XP300 = { planning: 300, estimating: 300, capacity: 300, risk: 300, stakeholders: 300, communication: 300, change: 300, leadership: 300 };
const pmProfile = { ...P.newProfile(), xp: { ...XP300 }, runs: [{ project: 'intro-psych-online', onTime: true, grade: 'B' }] };
const seniorProfile = { ...pmProfile, runs: [...pmProfile.runs, { project: 'ai-ethics-documentary', onTime: true, grade: 'B' }] };
const seenTrack = (track, xpLow = 0) => ({
  xp: { planning: 300, estimating: 300, capacity: 300, risk: 300, stakeholders: 300, communication: 300, change: 300, leadership: 300, [track]: xpLow },
  bestCredit: Object.fromEntries(deck.events.filter((e) => tracksOf(e).primary === track).map((e) => [e.id, 0.5])),
});

test('candidates: flaws feed their own track and open by rank; every pair plants one flaw that fails exactly its check', () => {
  const coord = P.newProfile();
  assert.deepEqual(ids(Sp.spotCandidates(coord, { track: 'planning', flaws, projects, plans })),
    ['ai-ethics-documentary', 'intro-psych-online', 'rescue-sustainable-business'].flatMap((p) => [`spot:${p}:missing_dependency`, `spot:${p}:review_squeezed`]).sort());
  assert.equal(Sp.spotCandidates(coord, { track: 'risk', flaws, projects, plans }).length, 3);
  assert.equal(Sp.spotCandidates(coord, { track: 'capacity', flaws, projects, plans }).length, 0, 'the overload flaw opens at PM');
  assert.equal(Sp.spotCandidates(coord, { track: 'stakeholders', flaws, projects, plans }).length, 0, 'not a spot track');
  // Higher ranks open the PM and Senior PM flaws (rank comes from the profile).
  assert.equal(P.rankOf(pmProfile).id, 'pm');
  assert.equal(P.rankOf(seniorProfile).id, 'senior');
  assert.equal(Sp.spotCandidates(pmProfile, { track: 'capacity', flaws, projects, plans }).length, 3);
  assert.equal(Sp.spotCandidates(pmProfile, { track: 'planning', flaws, projects, plans }).length, 6);
  assert.equal(Sp.spotCandidates(seniorProfile, { track: 'planning', flaws, projects, plans }).length, 9, 'unrealistic parallel work opens at Senior PM');

  for (const project of projects) {
    for (const f of Object.values(flaws).filter((x) => C.flawApplies(x, project))) {
      const pick = spot(project.id, f.id);
      const round = Sp.spotRound(pick, { flaws, plans, projects, world });
      assert.equal(round.flaws.length, 1);
      assert.deepEqual(C.validateRound(round), []);
      const failing = Plan.runChecks(round.plan, project, world).filter((c) => c.status === 'fail').map((c) => c.id);
      assert.deepEqual(failing, [f.check], `${project.id} ${f.id}`);
      assert.ok(round.flaws[0].where.length > 20 && !/undefined|NaN/.test(round.flaws[0].where), `${project.id} ${f.id}: ${round.flaws[0].where}`);
      assert.equal(round.flaws[0].bestFix, f.accepted_fixes[0]);
    }
  }
  assert.match(Sp.spotRound(spot('intro-psych-online', 'missing_dependency'), { flaws, plans, projects, world }).flaws[0].where, /^Production days in studio no longer waits for Script review/);
  assert.match(Sp.spotRound(spot('rescue-sustainable-business', 'unrealistic_parallel'), { flaws, plans, projects, world }).flaws[0].where, /Master site build in Canvas is planned from week 6/);
});

test('the Daily Mission offers a spot once the track\'s situations are seen, rotates spots, and needs the flaw library', () => {
  const prof = seenTrack('planning');
  const ctx = { date: '2026-11-27', playerId: 'fellow', world, deck, projects, unlocked: ['intro-psych-online'], flaws, plans };
  const pick = M.pickMission(prof, ctx);
  assert.equal(pick.kind, 'spot');
  assert.equal(pick.track, 'planning');
  assert.equal(pick.projectId, 'intro-psych-online');
  assert.ok(['missing_dependency', 'review_squeezed'].includes(pick.flawId));
  assert.match(pick.reason, /Planning is your lowest track \(L1\)/);
  assert.equal(pick.title, `Spot the flaw: ${intro.title}`);
  assert.deepEqual(M.pickMission(prof, ctx), pick, 'same all day');
  assert.equal(M.setupMission(pick, ctx), null);
  // Without the flaw library (an old caller), the same profile gets a situation replay.
  assert.ok(!M.pickMission(prof, { ...ctx, flaws: undefined }).kind);
  // A fresh player still gets unseen Planning situations first.
  assert.ok(!M.pickMission({ xp: seenTrack('planning').xp }, ctx).kind);
  // Risk too; Capacity has no spot at Coordinator, so it falls back to a situation.
  assert.equal(M.pickMission(seenTrack('risk'), ctx).flawId, 'unowned_risks');
  assert.ok(!M.pickMission(seenTrack('capacity'), ctx).kind);

  // Recorded: XP to the flaw's track only; the pair rests a week, so tomorrow brings the other flaw.
  const rec = M.recordMission(prof, pick, { credit: 0.85 }, Sp.spotEvent(pick));
  assert.deepEqual(rec.gained.xp, { planning: 27 }); // 20 × 0.85 + the 10 XP bonus
  const next = M.pickMission(rec.profile, { ...ctx, date: '2026-11-28' });
  assert.equal(next.kind, 'spot');
  assert.notEqual(next.flawId, pick.flawId);
  // Hard mode pays 1.5×.
  const hard = M.recordMission(prof, { ...pick, mode: 'hard' }, { credit: 1 }, Sp.spotEvent(pick));
  assert.equal(hard.gained.xp.planning, 40);
});

test('scoring: Critique scoring without the verdict, out of 20; extra flags cost 3, at most 9', () => {
  const pick = spot('intro-psych-online', 'missing_dependency');
  const round = Sp.spotRound(pick, { flaws, plans, projects, world });
  const f = round.flaws[0];
  const fixes = Q.fixChoices(round.id, 'link:scriptreview>production', 'dependency', flaws);
  const flag = (target, category, severity, grade) => ({ target, category, severity, fix: fixes.find((o) => o.grade === grade) ?? { grade } });
  const score = (flags) => Sp.scoreSpot(round, C.scoreCritique(round, Q.submissionOf(flags, 'send_back')));
  const perfect = score([flag('link:scriptreview>production', 'dependency', f.severity, 'accepted')]);
  assert.equal(perfect.credit, 1);
  assert.equal(perfect.raw, 20);
  assert.equal(perfect.track, 'planning');
  assert.equal(Sp.spotHeadline(perfect, f.title), 'You found it, named it, judged it right and fixed it.');
  const partial = score([flag('production', 'parallelism', 'medium', 'partial')]);
  assert.equal(partial.raw, 5 + 1 + 3);
  assert.match(Sp.spotHeadline(partial, f.title), /what was wrong, how serious it was and a partial fix/);
  const noisy = score([flag('production', 'dependency', 'high', 'accepted'), ...['animations', 'mastersite', 'post', 'qa'].map((t) => flag(t, 'dependency', 'low', 'none'))]);
  assert.equal(noisy.raw, 20 - 9);
  assert.equal(noisy.falsePositives, 4);
  const missed = score([flag('animations', 'dependency', 'high', 'accepted')]);
  assert.equal(missed.credit, 0);
  assert.equal(missed.raw, -3);
  assert.match(Sp.spotHeadline(missed, f.title), /^You missed it: Shoot before script review\. Your flag was on things that were fine\./);
});

test('the desk card, brief and result card', () => {
  const pick = { ...spot('intro-psych-online', 'review_squeezed'), title: `Spot the flaw: ${intro.title}` };
  const card = V.missionCardHtml(P.newProfile(), pick, esc, { projects, hardOpen: true });
  assert.match(card, /Spot the flaw/);
  assert.match(card, /data-mission="hard"/);
  assert.doesNotMatch(V.missionCardHtml(P.newProfile(), pick, esc, { projects, hardOpen: false }), /data-mission="hard"/);

  const round = Sp.spotRound(pick, { flaws, plans, projects, world });
  const brief = D.briefHtml(pick, round, intro, world, esc, { fixMode: 'write', canGrade: true });
  assert.match(brief, /One thing is wrong with this plan/);
  assert.match(brief, /exactly one/);
  assert.match(brief, /Claude grades it/);
  // The review screen shows one Score button and no verdict; the brief and review give nothing away.
  const review = Q.reviewHtml(Q.reviewModel(round, intro, world), { flags: [], world, kicker: D.kickerOf(pick), subline: 'A draft with one problem', submitLabel: 'Score my flag' });
  assert.match(review, /Score my flag/);
  assert.doesNotMatch(review, /Approve|Send back/);
  assert.doesNotMatch(brief + review, /One internal review in the whole plan|review_squeezed|Reviews squeezed/);

  const flagOk = { target: 'touchpoints:qa-review', category: 'quality_squeeze', severity: 'high', fix: Q.fixChoices(round.id, 'touchpoints:qa-review', 'quality_squeeze', flaws).find((o) => o.grade === 'accepted') };
  const result = C.scoreCritique(round, Q.submissionOf([flagOk, { target: 'animations', category: 'dependency', severity: 'low', fix: { grade: 'none', text: 'x' } }], 'send_back'));
  const record = { gained: { planning: 24 }, total: 24, bonus: true, levelUps: [], promotion: null, streak: 3 };
  const forward = { written: { onTime: 0.74, rework: 4 }, fixed: { onTime: 0.87, rework: 4 }, runs: 200 };
  const m = D.spotModel(pick, round, result, { flags: [flagOk], project: intro, world, flawFiles: flaws, baseline: plans[intro.id], forward, xp: record });
  assert.equal(m.score.raw, 17);
  assert.ok(m.forward.shows);
  const html = D.resultHtml(m, esc);
  assert.match(html, /<strong>Spotted · 85%\.<\/strong>/);
  assert.match(html, /You found it; points went on a flag on things that were fine\./);
  assert.match(html, /Fixing it is worth 13 points of on-time odds/);
  assert.match(html, /One internal review in the whole plan, in week 11/);
  assert.match(html, /\+24 XP/);
  assert.match(html, /Planning \+24, including the 10 XP daily bonus/);
  assert.match(html, /3-day streak/);
  assert.doesNotMatch(html, /undefined|NaN/);
  // A flaw that barely shows in play says so and explains what it does when it bites.
  const quiet = D.forwardHtml({ written: { odds: 87, rework: 4, peak: 120, peakWho: 'Perrick' }, fixed: { odds: 87, rework: 4, peak: 94, peakWho: 'Perrick' }, runs: 200, shows: false, effect: 'The plan assumes more hours than Perrick has.' }, null, esc);
  assert.match(quiet, /barely moves the odds\. The fix also takes Perrick's peak from 120% to 94%/);
  assert.match(quiet, /The plan assumes more hours/);
  assert.match(D.forwardHtml(null, { share: 0.5 }), /aria-valuenow="50"/);
  // Practice records nothing.
  assert.match(D.resultHtml({ ...m, pick: { ...pick, practice: true }, record: null }, esc), /Practice: nothing recorded/);
});

test('in play: missing the script-review link costs Intro to Psychology on-time odds and rework', () => {
  const pick = spot('intro-psych-online', 'missing_dependency');
  const round = Sp.spotRound(pick, { flaws, plans, projects, world });
  const ctx = { world, project: intro, deck };
  const a = C.forwardStats(round.plan, ctx, { runs: 60, seed: Sp.FORWARD.seed });
  const b = C.forwardStats(plans[intro.id], ctx, { runs: 60, seed: Sp.FORWARD.seed });
  const f = { written: { onTime: a.onTime / 60, rework: a.rework / 60 }, fixed: { onTime: b.onTime / 60, rework: b.rework / 60 } };
  assert.ok(Sp.showsInPlay(f), JSON.stringify(f));
  assert.ok(f.fixed.onTime - f.written.onTime >= 0.15);
});
