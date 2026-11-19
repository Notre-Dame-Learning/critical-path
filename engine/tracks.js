// Skill tracks, track levels and the situation-to-track map ("Progression" tab of the framework doc).
// Shared by the Daily Mission generator (mission.js) and, later, progression.js.
// A `track` / `track2` on a deck event overrides the map, so new situations can tag themselves.

export const TRACKS = ['planning', 'estimating', 'capacity', 'risk', 'stakeholders', 'communication', 'change', 'leadership'];
export const TRACK_LABEL = {
  planning: 'Planning', estimating: 'Estimating', capacity: 'Capacity', risk: 'Risk',
  stakeholders: 'Stakeholders', communication: 'Communication', change: 'Change Control', leadership: 'Team Leadership',
};

// Level thresholds: L1 at 0 XP, L2 at 40, L3 at 120, L4 at 250, L5 at 450.
export const LEVELS = [0, 40, 120, 250, 450];
export function levelOf(xp) {
  let level = 1;
  LEVELS.forEach((min, i) => { if ((xp ?? 0) >= min) level = i + 1; });
  return level;
}

// [primary, secondary] for each situation; primary earns 20 × credit, secondary 8 × credit.
export const SITUATION_TRACKS = {
  'overloaded-ld': ['capacity', 'leadership'],
  'graphics-requests': ['capacity', 'leadership'],
  'last-minute-change': ['change', 'stakeholders'],
  'interactive-request': ['change', 'stakeholders'],
  'timeline-slip-request': ['change', 'stakeholders'],
  'rough-cut-notes': ['change', 'stakeholders'],
  'script-too-long': ['change', 'stakeholders'],
  'summary-email-miss': ['communication', 'stakeholders'],
  'meeting-derails': ['communication', 'leadership'],
  'no-agenda': ['communication', 'stakeholders'],
  'stale-asana': ['estimating', 'planning'],
  'animate-before-final': ['planning', 'estimating'],
  'faculty-traveling': ['planning', 'stakeholders'],
  'handoff-prep': ['planning', 'communication'],
  'calendar-not-blocked': ['planning', 'risk'],
  'video-late': ['planning', 'communication'],
  'embed-codes': ['planning', 'communication'],
  'lower-third-typo': ['risk', 'leadership'],
  'copyright-snag': ['risk', 'stakeholders'],
  'captions-missing': ['risk', 'planning'],
  'qa-findings': ['risk', 'leadership'],
  'release-form': ['risk', null],
  'location-permits': ['risk', 'planning'],
  'stock-image-license': ['risk', null],
  'ip-agreement': ['risk', 'stakeholders'],
  'broken-promises': ['stakeholders', 'change'],
  'faculty-overwhelmed': ['stakeholders', 'capacity'],
  'publisher-tool': ['stakeholders', 'change'],
  'silent-faculty': ['stakeholders', 'communication'],
  'style-rejected': ['stakeholders', 'change'],
  'est-two-weekends': ['estimating', 'stakeholders'],
  'est-post-guess': ['estimating', 'communication'],
  'est-module-one-actuals': ['estimating', 'planning'],
};

// Accepts the doc's labels ("Change Control") as well as ids on deck events.
const toId = (t) => {
  if (!t) return null;
  const s = String(t).toLowerCase().trim();
  if (TRACKS.includes(s)) return s;
  return TRACKS.find((id) => TRACK_LABEL[id].toLowerCase() === s) ?? null;
};

export function tracksOf(event) {
  const [p, s] = SITUATION_TRACKS[event.id] ?? [null, null];
  return { primary: toId(event.track) ?? p, secondary: event.track2 !== undefined ? toId(event.track2) : s };
}
