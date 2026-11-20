// Weekly moves v2: the routine runs on its own, the player picks a free focus for the weekly faculty
// meeting, and spends Action Points on team moves. A small core menu is always open; situation-specific
// moves appear when the board calls for them. Moves cost the team's hours, signals show symptoms (never
// hidden rework), and risk moves lower the odds of a situation rather than cancel it.
// Design: "Weekly moves v2" tab of the framework doc. Built on sim.js's hooks (extra hours, temporary
// effects, fired situations); call endWeek() instead of sim.advanceWeek().
import * as S from './sim.js';
import { makeRng } from './rng.js';

export const PREVENT_CHANCE = 0.8;
// Hours a move costs the people in it.
export const COSTS = { checkin: 0.5, review: 2, teamMeeting: 1 };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
const remaining = (t) => Math.max(0, t.effort - t.done) + t.known;
const open = (g, t) => !S.taskComplete(t);
const name = (g, role) => (role === 'faculty' ? g.team.faculty.short : g.team[role].short);

// Per-run memory for v2, kept on the game state so saves and replays carry it.
function v2(g) {
  return (g.v2 ??= { lastCheckin: {}, lastReviewWeek: null, workAtReview: {}, lastUpdate: null, lastWorkload: null, prevented: [], attempted: [], deferred: [], backupUsed: false, previewed: [] });
}

function discover(g, rate, filter) {
  let found = 0;
  for (const t of g.tasks) {
    if (!filter(t) || t.hidden <= 0) continue;
    const d = t.hidden * rate;
    t.hidden -= d;
    t.known += d;
    found += d;
  }
  return round(found, 1);
}

const costHours = (g, who, hours) => g.mods.push({ type: 'capacity', who, value: -hours, fromWeek: g.week, untilWeek: g.week });
const addTrust = (g, n) => { g.team.faculty.trust = clamp(g.team.faculty.trust + n, 0, 100); };
const addMorale = (g, who, n) => { g.team[who].morale = clamp(g.team[who].morale + n, 0, 100); };
const log = (g, entry) => { g.actionsTaken.push({ week: g.week, ...entry }); return entry; };
const behind = (g) => S.scheduleStatus(g).variance <= -0.75;

// ---------- weekly meeting with the faculty partner (free; one focus a week) ----------

const facultyOpen = (g) => g.tasks.filter((t) => t.owner === 'faculty' && open(g, t) && S.taskReady(g, t));
const waitsOn = (g, t) => g.tasks.some((x) => x.owner !== 'faculty' && open(g, x) && x.dependsOn.includes(t.id));

export function meetingOptions(g) {
  if (g.over) return [];
  const m = v2(g);
  const fac = g.team.faculty.short;
  const out = [];
  const openWork = facultyOpen(g);
  if (openWork.length) out.push({ id: 'work-session', label: `Work through a draft together`, help: `${fac} gets about 3 more hours done this week.` });
  const signable = openWork.filter((t) => remaining(t) <= 3 && waitsOn(g, t));
  if (signable.length) out.push({ id: 'sign-offs', label: 'Get sign-offs in the room', help: `Finish ${signable.map((t) => t.name.toLowerCase()).join(' and ')} in the meeting so the team can move.` });
  const upcoming = g.tasks.filter((t) => t.owner === 'faculty' && t.startedWeek === null && !S.taskReady(g, t) && !m.previewed.includes(t.id)
    && t.dependsOn.every((d) => g.tasks.find((x) => x.id === d)?.startedWeek !== null));
  if (upcoming.length) out.push({ id: 'preview', label: 'Preview what\'s coming next', help: `Set expectations for ${upcoming[0].name.toLowerCase()} before it starts: fewer rewrites later.` });
  const last = g.log.at(-1);
  if (last?.completed?.length) out.push({ id: 'show-finished', label: 'Show what\'s finished', help: 'Walk through last week\'s finished work. Builds goodwill.' });
  if (!openWork.length) out.push({ id: 'keep-short', label: 'Keep it short', help: `Nothing of ${fac}'s is open this week; give the time back.` });
  out.push({ id: 'workload', label: 'Check on their workload', help: 'Ask what else is on their plate. Catches trouble early.' });
  return out;
}

export function setMeetingFocus(g, focus) {
  if (g.weekFlags.meeting) throw new Error('This week\'s meeting focus is already set.');
  const opt = meetingOptions(g).find((o) => o.id === focus);
  if (!opt && focus !== 'status') throw new Error(`${focus} isn't on offer this week.`);
  const m = v2(g);
  let detail = '';
  switch (focus) {
    case 'work-session':
      g.weekFlags['extra-faculty'] = (g.weekFlags['extra-faculty'] ?? 0) + 3;
      addTrust(g, 1);
      detail = 'You worked through a draft together.';
      break;
    case 'sign-offs': {
      const done = facultyOpen(g).filter((t) => remaining(t) <= 3 && waitsOn(g, t));
      for (const t of done) { t.done = t.effort; t.known = 0; if (t.startedWeek === null) t.startedWeek = g.week; }
      addTrust(g, 1);
      detail = `Signed off in the room: ${done.map((t) => t.name).join(', ')}.`;
      break;
    }
    case 'preview': {
      const ts = g.tasks.filter((t) => t.owner === 'faculty' && t.startedWeek === null && !S.taskReady(g, t) && !m.previewed.includes(t.id)
        && t.dependsOn.every((d) => g.tasks.find((x) => x.id === d)?.startedWeek !== null));
      for (const t of ts) { t.effort = Math.max(1, round(t.effort * 0.9, 1)); m.previewed.push(t.id); }
      detail = 'Expectations are set for what comes next.';
      break;
    }
    case 'show-finished':
      addTrust(g, 4);
      detail = S.say(g, '{faculty} liked seeing the finished work.');
      break;
    case 'keep-short':
      addTrust(g, 2);
      detail = 'A short meeting; everyone got time back.';
      break;
    case 'workload': {
      const recent = m.lastWorkload !== null && g.week - m.lastWorkload < 3;
      addTrust(g, recent ? 1 : 3);
      if (!recent) {
        g.mods.push({ type: 'responsiveness', value: 0.05, fromWeek: g.week + 1, untilWeek: g.week + 2 });
        for (const id of ['faculty-overwhelmed', 'silent-faculty']) preventChance(g, id);
      }
      m.lastWorkload = g.week;
      detail = recent ? 'You asked again; not much new.' : S.say(g, '{faculty} talked through what else is on {fpos} plate.');
      break;
    }
    case 'status':
      detail = 'A routine status meeting.';
      break;
  }
  g.weekFlags.meeting = focus;
  return log(g, { actionId: 'meeting', focus, detail });
}

// ---------- team moves (Action Points) ----------

const workSinceReview = (g) => {
  const m = v2(g);
  return round(g.tasks.reduce((s, t) => s + Math.max(0, t.done - (m.workAtReview[t.id] ?? 0)), 0), 1);
};

// Situations a good PM could head off, offered from two weeks before their window while their conditions hold.
function preventable(g) {
  const m = v2(g);
  return g.deck.filter((e) => e.prevent && !g.firedEvents.includes(e.id) && !m.attempted.includes(e.id)
    && g.week >= (e.trigger.weeks?.[0] ?? 1) - 2 && g.week <= (e.trigger.weeks?.[1] ?? 99)
    && Object.entries(e.prevent.when ?? {}).every(([k, id]) => {
      const t = g.tasks.find((x) => x.id === id);
      if (!t) return false;
      return k === 'taskStarted' ? t.startedWeek !== null : k === 'taskDone' ? S.taskComplete(t) : !S.taskComplete(t);
    }));
}

function preventChance(g, eventId) {
  const m = v2(g);
  if (g.firedEvents.includes(eventId) || m.attempted.includes(eventId) || !g.deck.some((e) => e.id === eventId)) return false;
  m.attempted.push(eventId);
  if (makeRng(`${g.seed}:${eventId}:prevent`).next() < PREVENT_CHANCE) { g.firedEvents.push(eventId); m.prevented.push(eventId); return true; }
  return false;
}

export function moveOptions(g) {
  if (g.over) return [];
  const m = v2(g);
  const status = S.scheduleStatus(g);
  const out = [];
  // Core moves: always open.
  for (const r of S.STAFF) {
    const recent = m.lastCheckin[r] !== undefined && g.week - m.lastCheckin[r] < 2;
    out.push({ id: `checkin:${r}`, kind: 'core', cost: 1, who: r, label: `Check in with ${name(g, r)}`, help: recent ? `You checked in ${g.week - m.lastCheckin[r] === 0 ? 'this' : 'last'} week; another adds little.` : `A half-hour one-on-one. Lifts morale and surfaces problems in their work.` });
  }
  out.push({ id: 'review', kind: 'core', cost: 1, label: 'Internal review of work so far', help: `Costs ${g.team.ld.short} 2 hours. Covers work done since the last review (about ${Math.round(workSinceReview(g))} hours).` });
  for (const r of S.STAFF) out.push({ id: `overtime:${r}`, kind: 'core', cost: 1, who: r, label: `Ask ${name(g, r)} for extra hours`, help: g.weekFlags[`overtime-${r}`] || g.actionsTaken.some((a) => a.actionId === 'overtime' && a.who === r && a.week === g.week - 1) ? 'Again so soon: morale drops fast.' : '+5 hours this week; lower morale and more mistakes.' });
  out.push({ id: 'status-update', kind: 'core', cost: 1, label: 'Send a status update', help: 'To the faculty partner and directors. Worth most when something has changed.' });
  out.push({ id: 'team-meeting', kind: 'core', cost: 1, label: 'Call the team together to realign', help: 'Costs everyone an hour. Worth it when things are off track.' });
  // Situation-specific moves.
  if (status.variance <= -1 && g.week <= g.launchWeek - 2) {
    const cands = g.tasks.filter((t) => open(g, t) && !t.isQA && !['handoff', 'embed', 'qa'].includes(t.id) && remaining(t) >= 4)
      .sort((a, b) => remaining(b) - remaining(a)).slice(0, 2);
    for (const t of cands) out.push({ id: `defer:${t.id}`, kind: 'context', cost: 2, label: `Propose moving part of ${t.name.toLowerCase()} to after launch`, help: 'Needs the faculty partner\'s and directors\' agreement. Saves about a third of what\'s left; course complete drops.' });
  }
  const ph = g.tasks.filter((t) => t.startedWeek === null && open(g, t) && !t.isQA).filter((t) => {
    const deps = t.dependsOn.map((d) => g.tasks.find((x) => x.id === d)).filter(Boolean);
    const notDone = deps.filter((d) => !S.taskComplete(d));
    return notDone.length === 1 && notDone[0].startedWeek !== null;
  }).slice(0, 2);
  for (const t of ph) {
    const dep = t.dependsOn.map((d) => g.tasks.find((x) => x.id === d)).find((d) => !S.taskComplete(d));
    out.push({ id: `placeholder:${t.id}`, kind: 'context', cost: 1, label: `Start ${t.name.toLowerCase()} with placeholders`, help: `Don't wait for ${dep.name.toLowerCase()}; some of the early work will need redoing.` });
  }
  if (status.variance <= -0.75 && !m.backupUsed) {
    const who = [...S.STAFF].sort((a, b) => g.tasks.filter((t) => t.owner === b && open(g, t)).reduce((s, t) => s + remaining(t), 0) - g.tasks.filter((t) => t.owner === a && open(g, t)).reduce((s, t) => s + remaining(t), 0))[0];
    out.push({ id: `backup:${who}`, kind: 'context', cost: 2, who, label: `Ask the directors for a backup for ${name(g, who)}`, help: 'Once per project. About 3 more hours a week for two weeks.' });
  }
  for (const e of preventable(g).slice(0, 2)) out.push({ id: `prevent:${e.id}`, kind: 'risk', cost: 1, label: S.say(g, e.prevent.move), help: S.say(g, e.prevent.risk) });
  return out.map((o) => ({ ...o, affordable: g.actionPoints >= o.cost && !g.pendingEvent }));
}

export function takeMove(g, id) {
  if (g.over) throw new Error('Game is over.');
  if (g.pendingEvent) throw new Error('Resolve the current situation first.');
  const opt = moveOptions(g).find((o) => o.id === id);
  if (!opt) throw new Error(`${id} isn't on offer this week.`);
  if (g.actionPoints < opt.cost) throw new Error('Not enough Action Points left this week.');
  const m = v2(g);
  const [kind, arg] = id.split(':');
  let entry;
  switch (kind) {
    case 'checkin': {
      const recent = m.lastCheckin[arg] !== undefined && g.week - m.lastCheckin[arg] < 2;
      costHours(g, arg, COSTS.checkin);
      addMorale(g, arg, recent ? 1 : 7);
      const found = discover(g, recent ? 0.1 : 0.4, (t) => t.owner === arg && t.startedWeek !== null);
      m.lastCheckin[arg] = g.week;
      entry = { actionId: 'checkin', who: arg, detail: found >= 0.5 ? `${name(g, arg)} flagged ${found} hours of problems in their work.` : `${name(g, arg)} appreciated the time; nothing new surfaced.` };
      break;
    }
    case 'review': {
      costHours(g, 'ld', COSTS.review);
      const touched = new Set(g.tasks.filter((t) => t.done > (m.workAtReview[t.id] ?? 0)).map((t) => t.id));
      const found = discover(g, 0.6, (t) => touched.has(t.id));
      for (const t of g.tasks) m.workAtReview[t.id] = t.done;
      m.lastReviewWeek = g.week;
      entry = { actionId: 'qa-review', detail: found >= 0.5 ? `The review found ${found} hours of rework. Better now than at launch.` : 'The review came back clean.' };
      break;
    }
    case 'overtime': {
      const again = g.weekFlags[`overtime-${arg}`] || g.actionsTaken.some((a) => a.actionId === 'overtime' && a.who === arg && a.week === g.week - 1);
      g.weekFlags[`extra-${arg}`] = (g.weekFlags[`extra-${arg}`] ?? 0) + 5;
      g.weekFlags[`overtime-${arg}`] = true;
      addMorale(g, arg, again ? -10 : -6);
      entry = { actionId: 'overtime', who: arg, detail: again ? `${name(g, arg)} agrees again, but it's wearing thin.` : `${name(g, arg)} agrees to 5 extra hours this week, a little reluctantly.` };
      break;
    }
    case 'status-update': {
      const st = S.scheduleStatus(g);
      const known = round(g.tasks.reduce((s, t) => s + t.known, 0), 1);
      const prev = m.lastUpdate;
      const news = !prev || st.label !== prev.label || g.decisions.length > prev.decisions || known >= prev.known + 2 || st.variance <= -0.75;
      addTrust(g, news ? 4 : 1);
      if (news) g.mods.push({ type: 'responsiveness', value: 0.05, fromWeek: g.week + 1, untilWeek: g.week + 1 });
      m.lastUpdate = { week: g.week, label: st.label, decisions: g.decisions.length, known };
      entry = { actionId: 'status-update', news, detail: news ? 'The update had real news; people appreciated hearing it early.' : 'Nothing much had changed; the update was mostly noise.' };
      break;
    }
    case 'team-meeting': {
      const st = S.scheduleStatus(g);
      const peopleWithRework = S.STAFF.filter((r) => g.tasks.some((t) => t.owner === r && t.known >= 1)).length;
      const offTrack = st.variance <= -0.75 || peopleWithRework >= 2 || S.STAFF.reduce((s, r) => s + g.team[r].morale, 0) / 3 < 60;
      for (const r of S.STAFF) { costHours(g, r, COSTS.teamMeeting); addMorale(g, r, offTrack ? 4 : 1); }
      const found = discover(g, offTrack ? 0.3 : 0.15, (t) => t.startedWeek !== null);
      entry = { actionId: 'team-meeting', offTrack, detail: offTrack ? `Everyone realigned on what matters now${found >= 0.5 ? `, and ${found} hours of problems came out` : ''}.` : 'A useful hour, but things were mostly on track already.' };
      break;
    }
    case 'defer': {
      const t = g.tasks.find((x) => x.id === arg);
      const cut = round(Math.max(1, Math.max(0, t.effort - t.done) / 3), 1);
      t.effort = round(t.effort - cut, 1);
      g.deferredHours = round((g.deferredHours ?? 0) + cut, 1);
      m.deferred.push({ task: t.id, hours: cut, week: g.week });
      addTrust(g, -2);
      entry = { actionId: 'defer', target: t.id, detail: `Agreed: about ${Math.round(cut)} hours of ${t.name.toLowerCase()} moves to after launch.` };
      break;
    }
    case 'placeholder': {
      const t = g.tasks.find((x) => x.id === arg);
      const dep = t.dependsOn.find((d) => !S.taskComplete(g.tasks.find((x) => x.id === d)));
      t.dependsOn = t.dependsOn.filter((d) => d !== dep);
      t.hidden += round(t.effort * 0.1, 1);
      entry = { actionId: 'placeholder', target: t.id, detail: `${t.name} starts now with placeholders.` };
      break;
    }
    case 'backup': {
      g.mods.push({ type: 'capacity', who: arg, value: 3, fromWeek: g.week, untilWeek: g.week + 1 });
      m.backupUsed = true;
      entry = { actionId: 'backup', who: arg, detail: `The directors lend a backup to ${name(g, arg)} for two weeks.` };
      break;
    }
    case 'prevent': {
      const ok = preventChance(g, arg);
      entry = { actionId: 'prevent', target: arg, detail: ok ? 'Done. That risk looks handled.' : 'Done, though it may still bite.' };
      break;
    }
    default:
      throw new Error(`Unknown move ${id}`);
  }
  g.actionPoints -= opt.cost;
  return log(g, entry);
}

// End the week: the meeting happens (a plain status meeting if no focus was picked) and its summary goes out.
export function endWeek(g) {
  if (!g.pendingEvent && !g.weekFlags.meeting) setMeetingFocus(g, 'status');
  addTrust(g, 1); // the summary after the weekly meeting
  return S.advanceWeek(g);
}

// ---------- signals: what a PM would notice (symptoms, never hidden rework) ----------

export function signals(g, { hints = true } = {}) {
  if (g.over) return [];
  const m = v2(g);
  const out = [];
  const add = (level, text, hint) => out.push({ level, text, ...(hints ? { hint } : {}) });
  const st = S.scheduleStatus(g);
  if (st.variance <= -0.75) add(st.variance <= -2 ? 3 : 2, `About ${Math.abs(st.variance)} weeks behind the pace needed to launch.`, 'Extra hours, a backup or moving scope can help, and so can clearing what blocks the team.');
  for (const r of S.STAFF) {
    const known = round(g.tasks.filter((t) => t.owner === r).reduce((s, t) => s + t.known, 0));
    if (known >= 2) add(2, `${name(g, r)} is fixing about ${known} hours of problems found in their work.`, 'Problems found now are cheap. A review may find more nearby.');
  }
  for (const r of S.STAFF) if (g.team[r].morale < 60) add(g.team[r].morale < 45 ? 3 : 2, `${name(g, r)} seems stretched lately.`, 'A check-in helps; more overtime makes it worse.');
  if (g.team.faculty.trust < 50) add(2, S.say(g, `{faculty} has been slower to reply.`), 'A status update with real news, or a workload check in the meeting, rebuilds trust.');
  for (const t of g.tasks.filter((x) => x.owner === 'faculty' && open(g, x) && x.startedWeek !== null && g.week - x.startedWeek >= 2)) {
    add(1, `${S.say(g, '{faculty}')}'s ${t.name.replace(/^Faculty /, '').toLowerCase()}: open ${g.week - t.startedWeek} weeks, about ${S.percentDone(t)}% done.`, 'Use the meeting to work through a draft, or get sign-offs in the room.');
  }
  const waiting = g.tasks.filter((t) => t.startedWeek === null && open(g, t) && !S.taskReady(g, t) && t.dependsOn.some((d) => g.tasks.find((x) => x.id === d)?.startedWeek !== null))
.slice(0, 1);
  for (const t of waiting) add(1, `${t.name} is waiting on earlier work.`, 'Placeholders can let it start, at the cost of some redoing.');
  const since = workSinceReview(g);
  const weeksSince = g.week - (m.lastReviewWeek ?? g.startWeek - 1);
  if (since >= 15 && weeksSince >= 3) add(1, `No internal review for ${weeksSince} weeks; about ${Math.round(since)} hours of work done since.`, 'Problems hide in unreviewed work.');
  for (const e of preventable(g).slice(0, 2)) add(1, S.say(g, e.prevent.risk), `Heading it off now is cheaper than handling it later: ${S.say(g, e.prevent.move).toLowerCase()}.`);
  return out.sort((a, b) => b.level - a.level).slice(0, 5);
}

// Situations a player headed off, and scope moved to after launch, for the debrief.
export function avoided(g) {
  const m = v2(g);
  return m.prevented.map((id) => {
    const e = g.deck.find((x) => x.id === id);
    return { eventId: id, title: S.say(g, e.title), move: S.say(g, e.prevent?.move ?? ''), concept: S.say(g, e.debrief.concept) };
  });
}

// Run a v1-style move list (old policies and records) through v2.
export function applyLegacy(g, moveId) {
  const [id, who] = String(moveId).split(':');
  const has = (x) => moveOptions(g).some((o) => o.id === x && o.affordable);
  if (id === 'working-session') { if (!g.weekFlags.meeting && meetingOptions(g).some((o) => o.id === 'work-session')) setMeetingFocus(g, 'work-session'); return; }
  if (id === 'faculty-update') { if (has('status-update')) takeMove(g, 'status-update'); return; }
  if (id === 'checkin' && !who) {
    const r = [...S.STAFF].sort((a, b) => g.team[a].morale - g.team[b].morale)[0];
    if (has(`checkin:${r}`)) takeMove(g, `checkin:${r}`);
    return;
  }
  if (id === 'qa-review') { if (has('review')) takeMove(g, 'review'); return; }
  if (has(moveId)) takeMove(g, moveId);
}
