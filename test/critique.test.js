import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCritique, fixOptions, validateRound, correctVerdict, debriefLines } from '../engine/critique.js';

// The sample round from the Plan-flaw library tab (Intro to Psychology, 3 planted flaws).
const round = {
  flaws: [
    { id: 'missing_dependency', title: 'Shoot before script approval', category: 'dependency', severity: 'high',
      skill_track: 'Planning', targets: ['T6', 'T5'],
      accepted_fixes: ['Make the shoot depend on script approval and move the shoot'],
      partial_fixes: ['Add a note to check scripts before the shoot'],
      explanation: 'Filming unapproved scripts means reshoots.' },
    { id: 'review_squeezed', title: 'Accessibility and QA squeezed to the end', category: 'quality_squeeze', severity: 'high',
      skill_track: 'Planning', targets: ['T10'],
      accepted_fixes: ['Caption and alt-text each module as it is finished'],
      partial_fixes: ['Move accessibility one week earlier'],
      explanation: 'Problems stay hidden until there is no time left.' },
    { id: 'no_buffer', title: 'No buffer before launch', category: 'buffer', severity: 'high',
      skill_track: 'Estimating', targets: ['T11'],
      accepted_fixes: ['Review modules as they finish so week 14 is buffer'],
      partial_fixes: ['Add half a week of slack'],
      explanation: 'Any slip of a week misses the first day of term.' },
  ],
  decoys: [
    { targets: ['T8'], why: 'graphics depend only on storyboards' },
    { targets: ['T9'], why: 'videos are added to the site as they finish' },
  ],
};

const perfect = {
  verdict: 'send_back',
  flags: [
    { target: 'T6', category: 'dependency', severity: 'high', fix: 'accepted' },
    { target: 'T10', category: 'quality_squeeze', severity: 'high', fix: 'accepted' },
    { target: 'T11', category: 'buffer', severity: 'high', fix: 'accepted' },
  ],
};

test('the sample round is valid', () => {
  assert.deepEqual(validateRound(round), []);
  assert.equal(correctVerdict(round), 'send_back');
});

test('a perfect review scores 100; nothing found but the right verdict scores 14', () => {
  assert.equal(scoreCritique(round, perfect).score, 100);
  const r = scoreCritique(round, { verdict: 'send_back', flags: [] });
  assert.equal(r.raw, 10);
  assert.equal(r.score, 14);
  assert.deepEqual(r.missedTracks.sort(), ['Estimating', 'Planning']);
});

test('right place, wrong category earns 5; severity one off earns 1; partial fix earns 3', () => {
  const r = scoreCritique(round, { verdict: 'send_back', flags: [
    { target: 'T5', category: 'parallelism', severity: 'medium', fix: 'partial' },
  ] });
  const f = r.flaws.find((x) => x.id === 'missing_dependency');
  assert.deepEqual(f.points, { found: 5, severity: 1, fix: 3 });
  assert.equal(f.rightCategory, false);
});

test('false positives cost 3 each, capped at 9, and decoys say why they were fine', () => {
  const flags = [...perfect.flags,
    { target: 'T8', category: 'parallelism', severity: 'low', fix: 'none' },
    { target: 'T9', category: 'dependency', severity: 'low', fix: 'none' },
    { target: 'T1', category: 'stakeholder', severity: 'low', fix: 'none' },
    { target: 'T2', category: 'buffer', severity: 'low', fix: 'none' }];
  const r = scoreCritique(round, { verdict: 'send_back', flags });
  assert.equal(r.falsePositives.length, 4);
  assert.equal(r.falsePositivePoints, -9);
  assert.equal(r.raw, 70 - 9);
  assert.equal(r.falsePositives[0].decoyWhy, 'graphics depend only on storyboards');
  assert.equal(r.falsePositives[2].decoyWhy, null);
});

test('flag-everything play cannot go below 0', () => {
  const flags = ['T1', 'T2', 'T3', 'T4', 'T7', 'T8', 'T9'].map((t) => ({ target: t, category: 'buffer', severity: 'high', fix: 'none' }));
  const r = scoreCritique(round, { verdict: 'approve', flags });
  assert.equal(r.score, 0);
});

test('a second flag on a found flaw is a repeat, not a false positive', () => {
  const r = scoreCritique(round, { verdict: 'send_back', flags: [
    ...perfect.flags, { target: 'T5', category: 'dependency', severity: 'high', fix: 'accepted' }] });
  assert.equal(r.score, 100);
  assert.deepEqual(r.repeats, [{ target: 'T5', flaw: 'missing_dependency' }]);
});

test('the score does not depend on the order flags were placed', () => {
  const flags = [
    { target: 'T6', category: 'buffer', severity: 'high', fix: 'none' },
    { target: 'T5', category: 'dependency', severity: 'high', fix: 'accepted' },
  ];
  const a = scoreCritique(round, { verdict: 'send_back', flags });
  const b = scoreCritique(round, { verdict: 'send_back', flags: [...flags].reverse() });
  assert.equal(a.raw, b.raw);
  assert.equal(a.flaws[0].rightCategory, true);
});

test('approve is right only when every planted flaw is low', () => {
  const low = { ...round, flaws: round.flaws.map((f) => ({ ...f, severity: 'low' })) };
  assert.equal(correctVerdict(low), 'approve');
  const mixed = { ...round, flaws: round.flaws.map((f, i) => ({ ...f, severity: i ? 'low' : 'medium' })) };
  assert.equal(correctVerdict(mixed), 'send_back');
});

test('validateRound catches flaws sharing a task and decoys on a target', () => {
  const bad = { flaws: [round.flaws[0], { ...round.flaws[1], targets: ['T6'] }], decoys: [{ targets: ['T5'], why: 'x' }] };
  const problems = validateRound(bad);
  assert.equal(problems.length, 2);
});

test('fix options: three per flaw, one of each grade, the same for the same seed', () => {
  const a = fixOptions(round.flaws[0], round.flaws, 'seed-1');
  const b = fixOptions(round.flaws[0], round.flaws, 'seed-1');
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((o) => o.grade).sort(), ['accepted', 'none', 'partial']);
  assert.deepEqual(a.map((o) => o.id), ['fix1', 'fix2', 'fix3']);
});

test('debrief lists misses first, then found flaws with notes, then false positives', () => {
  const r = scoreCritique(round, { verdict: 'approve', flags: [
    { target: 'T10', category: 'quality_squeeze', severity: 'medium', fix: 'partial' },
    { target: 'T9', category: 'dependency', severity: 'low', fix: 'none' }] });
  const kinds = debriefLines(round, r).map((l) => l.kind);
  assert.deepEqual(kinds, ['missed', 'missed', 'found', 'false_positive', 'verdict']);
});
