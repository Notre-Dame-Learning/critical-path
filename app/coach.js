// First-run coach: one-time tips from Dwayneah that teach the controls on a first run.
// Tips never hint at a situation's answer, and are held back during a situation (except the first one).
// Design: "First-run coach" tab of the framework doc.
import * as S from '../engine/sim.js';
import * as M from '../engine/moves.js';

// In table order: the first tip whose condition holds, and that hasn't been seen, is shown.
export const TIPS = [
  { id: 'takeover', duringSituation: true, when: (g) => g.startWeek > 1 && g.week === g.startWeek,
    text: 'Welcome aboard. You\'re taking over in week {week}: some work is done, some is late, and some of it hides rework nobody has found yet. Check in with the team early so you know what you really inherited.' },
  { id: 'action-points', when: (g) => g.week === g.startWeek && !g.actionsTaken.some((a) => a.week === g.week),
    text: 'You meet {faculty} every week anyway, so pick a focus for that meeting; it\'s free. Your {ap} Action Points go on team moves, and the small text under each says what it does. Watch what you\'re noticing: the moves that matter change week to week.' },
  { id: 'first-situation', duringSituation: true, when: (g) => Boolean(g.pendingEvent) && g.decisions.length === 0,
    text: 'Your first situation. Several options are partly right, so read them all. Escalating to me is always allowed, but I\'d rather you handle what you can and keep me informed.' },
  { id: 'end-week', when: (g) => g.week === g.startWeek && g.actionPoints === 0,
    text: 'You\'re out of Action Points. End the week to see what the team got done. Points you don\'t spend don\'t carry over.' },
  { id: 'recap', when: (g) => g.log.length >= 1,
    text: 'The recap shows the hours each person put in and what finished. The schedule bar compares finished work with the pace needed to launch on time: ahead, on track or behind.' },
  { id: 'rework-found', when: (g) => g.tasks.some((t) => t.known >= 0.5) || g.log.some((e) => e.discovered >= 0.5),
    text: 'Somebody found rework: mistakes in work that looked finished. Found now, it\'s cheap to fix. Check-ins and internal reviews find more of it early.' },
  { id: 'risk-move', when: (g) => g.week > g.startWeek && M.moveOptions(g).some((o) => o.kind === 'risk'),
    text: 'See "Head off a risk"? Those moves come up when trouble is likely. Heading it off is cheaper than handling it, though it isn\'t guaranteed.' },
  { id: 'behind', when: (g) => ['behind', 'far-behind'].includes(S.scheduleStatus(g).label),
    text: 'You\'re behind the pace to launch. Extra hours help this week but cost morale and add mistakes. A backup from the directors, or moving some work to after launch, are options too; each has a cost.' },
  { id: 'low-morale', when: (g) => S.STAFF.some((r) => g.team[r].morale < 45),
    text: 'Someone on the team is worn down. Tired people work slower and make mistakes you won\'t see until later. A check-in helps.' },
  { id: 'low-trust', when: (g) => g.team.faculty.trust < 45,
    text: '{faculty}\'s trust is low, so {fsub}\'ll respond more slowly. A status update with real news, or asking about {fpos} workload in the weekly meeting, rebuilds it.' },
  { id: 'qa-started', when: (g) => g.tasks.some((t) => t.isQA && t.startedWeek !== null),
    text: 'QA has started, so hidden rework will surface much faster now. Leave room in these last weeks to fix what it finds.' },
  { id: 'launch-week', when: (g) => g.week === g.launchWeek,
    text: 'Launch week. The course opens at the end of this week, ready or not. Then you\'ll see your scorecard and the debrief.' },
];

// The next tip to show, or null. seen: a Set (or array) of tip ids already dismissed.
export function nextTip(game, seen = new Set()) {
  if (!game || game.over) return null;
  const done = seen instanceof Set ? seen : new Set(seen);
  const inSituation = Boolean(game.pendingEvent);
  for (const tip of TIPS) {
    if (done.has(tip.id) || (inSituation && !tip.duringSituation)) continue;
    if (tip.when(game)) return { id: tip.id, text: S.say(game, tip.text.replace('{week}', String(game.week)).replace('{ap}', String(game.actionPointsPerWeek))) };
  }
  return null;
}

// ---------- per-browser memory (localStorage, wrapped: the coach works without it) ----------

const KEY = 'critical-path-coach-v1';
const memory = { seen: [], off: false };

// Without working storage the choices last for this page only (kept in memory).
function read(store) {
  if (!store) return structuredClone(memory);
  try {
    const raw = store.getItem(KEY);
    return raw ? { seen: [], off: false, ...JSON.parse(raw) } : { seen: [], off: false };
  } catch { return structuredClone(memory); }
}

function write(store, data) {
  Object.assign(memory, data);
  try { store?.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

export const seenTips = (store) => new Set(read(store).seen);
export const tipsEnabled = (store) => !read(store).off;

export function markSeen(store, id) {
  const d = read(store);
  if (!d.seen.includes(id)) d.seen.push(id);
  write(store, d);
}

export function setTipsEnabled(store, on) {
  write(store, { ...read(store), off: !on });
}
