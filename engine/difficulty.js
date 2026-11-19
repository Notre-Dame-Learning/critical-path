// engine/difficulty.js
// Difficulty levels (see the "Difficulty settings" tab of the framework doc).
// A level is a content transform: it returns edited copies of world and project,
// so engine/sim.js stays unchanged and a run replays exactly from (seed, mode, difficulty).
export const DIFFICULTY = {
  standard: { label: 'Standard', blurb: 'The real ODL pace.' },
  story: {
    label: 'Story',
    blurb: 'For a first run: one more Action Point a week, a week of buffer before launch, and a rested team.',
    ap: 1, launch: 1, trust: 10, morale: 10,
  },
};

export function applyDifficulty(world, project, level = 'standard') {
  const k = DIFFICULTY[level];
  if (!k) throw new Error(`Unknown difficulty ${level}`);
  const w = structuredClone(world);
  const p = structuredClone(project);
  if (level === 'standard') return { world: w, project: p };
  const cap = (x) => Math.min(100, x);
  p.actionPointsPerWeek = (p.actionPointsPerWeek ?? 2) + (k.ap ?? 0);
  p.launchWeek += k.launch ?? 0;
  for (const f of w.faculty) f.trust = cap(f.trust + (k.trust ?? 0));
  for (const x of w.people) x.morale = cap(x.morale + (k.morale ?? 0));
  if (p.initial?.trust != null) p.initial.trust = cap(p.initial.trust + (k.trust ?? 0));
  for (const r in p.initial?.morale ?? {}) p.initial.morale[r] = cap(p.initial.morale[r] + (k.morale ?? 0));
  p.difficulty = `${p.difficulty} · ${k.label}`;
  return { world: w, project: p };
}

// Start a game at a difficulty: the one call the app and tests use.
export function createGameAt(S, { world, project, deck, seed, mode = 'standard', difficulty = 'standard' }) {
  const t = applyDifficulty(world, project, difficulty);
  const game = S.createGame({ world: t.world, project: t.project, deck, seed, mode });
  game.difficulty = difficulty;
  return game;
}
