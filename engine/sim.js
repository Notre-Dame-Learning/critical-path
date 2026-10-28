// Critical Path simulation engine (v0.2).
// Deterministic given a seed. The engine does the math; narration and debrief text
// come from content files, and every number shown to the player comes from state.log.

import { makeRng } from './rng.js';

export const TIER_CREDIT = { resolve: 1.0, escalate_plan: 0.8, escalate: 0.5, ignore: 0.2 };
export const TIER_LABEL = {
  resolve: 'Resolved it yourself',
  escalate_plan: 'Escalated with a recommendation',
  escalate: 'Escalated the problem only',
  ignore: 'Waited or avoided it',
};

const ROLES = ['ld', 'mp', 'faculty'];
const FACULTY_SKILL = 3;

// Weekly moves the player spends Action Points on.
export const ACTIONS = [
  { id: 'checkin', label: 'Milestone check-in with Priya and Marcus', help: 'Lifts morale a little and surfaces hidden problems early.' },
  { id: 'faculty-update', label: 'Send the Friday weekly summary', help: 'Builds trust; the faculty partner responds a bit faster next week.' },
  { id: 'working-session', label: '15-minute check-in with the faculty partner', help: 'She gets more done this week.' },
  { id: 'qa-review', label: 'Internal review of work so far', help: 'Costs design time; finds most hidden rework now instead of at launch.' },
  { id: 'overtime-ld', label: 'Ask the designer for extra hours', help: 'More output this week, lower morale, more mistakes.' },
  { id: 'overtime-mp', label: 'Ask the producer for extra hours', help: 'More output this week, lower morale, more mistakes.' },
];

// How often situations come up: a forced one if the previous week had none.
const EVENT_GAP = 2;

export function createGame({ world, project, deck, seed = 'default' }) {
  const ld = world.people.find((p) => p.id === project.team.ld);
  const mp = world.people.find((p) => p.id === project.team.mp);
  const fac = world.faculty.find((f) => f.id === project.team.faculty);
  const rng = makeRng(seed);
  const state = {
    version: 0,
    seed: String(seed),
    rngState: rng.state,
    week: 1,
    launchWeek: project.launchWeek,
    actionPointsPerWeek: project.actionPointsPerWeek ?? 2,
    actionPoints: project.actionPointsPerWeek ?? 2,
    project: { id: project.id, title: project.title, brief: project.brief },
    supervisor: world.supervisor,
    lastEventWeek: 0,
    team: {
      ld: { id: ld.id, name: ld.name, role: ld.role, skill: ld.skill, hoursPerWeek: ld.hoursPerWeek, morale: ld.morale, avatar: ld.avatar },
      mp: { id: mp.id, name: mp.name, role: mp.role, skill: mp.skill, hoursPerWeek: mp.hoursPerWeek, morale: mp.morale, avatar: mp.avatar },
      faculty: { id: fac.id, name: fac.name, role: 'Faculty partner', skill: FACULTY_SKILL, hoursPerWeek: fac.hoursPerWeek, responsiveness: fac.responsiveness, trust: fac.trust, avatar: fac.avatar },
    },
    tasks: project.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn], done: 0, hidden: 0, known: 0, startedWeek: null, finishedWeek: null })),
    mods: [], // temporary effects: { type, who, value, fromWeek, untilWeek }
    weekFlags: {}, // per-week action effects, cleared each week
    deck: deck.events,
    firedEvents: [],
    pendingEvent: null,
    decisions: [], // { week, eventId, choiceId, tier, credit }
    actionsTaken: [], // { week, actionId }
    log: [],
    over: false,
    result: null,
  };
  drawEvent(state, rng);
  state.rngState = rng.state;
  return state;
}

// ---------- queries ----------

// Rework under half an hour is treated as noise, not a reopened task.
const REWORK_THRESHOLD = 0.5;

export function taskComplete(t) {
  return t.done >= t.effort - 1e-6 && t.known < REWORK_THRESHOLD;
}

export function taskReady(state, t) {
  return t.dependsOn.every((id) => taskComplete(state.tasks.find((x) => x.id === id)));
}

export function percentDone(t) {
  if (taskComplete(t)) return 100;
  return Math.min(100, Math.round((100 * Math.max(0, Math.min(t.done, t.effort) - t.known)) / t.effort));
}

function modSum(state, type, who) {
  return state.mods
    .filter((m) => m.type === type && (who === undefined || m.who === who) && m.fromWeek <= state.week && m.untilWeek >= state.week)
    .reduce((s, m) => s + m.value, 0);
}

export function effectiveResponsiveness(state) {
  return clamp(state.team.faculty.responsiveness + modSum(state, 'responsiveness'), 0.1, 1);
}

function baseHours(state, role) {
  const p = state.team[role];
  let h = p.hoursPerWeek + modSum(state, 'capacity', role);
  if (role === 'faculty') h = h * effectiveResponsiveness(state) * (0.7 + 0.6 * (state.team.faculty.trust / 100));
  h += state.weekFlags[`extra-${role}`] ?? 0;
  return Math.max(0, h);
}

function remainingWork(state) {
  return state.tasks.reduce((s, t) => s + Math.max(0, t.effort - t.done) + t.known, 0);
}

export function schedulePressure(state) {
  const weeksLeft = Math.max(1, state.launchWeek - state.week + 1);
  const capacity = ROLES.reduce((s, r) => s + state.team[r].hoursPerWeek * (r === 'faculty' ? 0.6 : 1), 0);
  return clamp(remainingWork(state) / (capacity * weeksLeft * 0.75) - 1, 0, 1);
}

// ---------- player moves ----------

export function availableActions(state) {
  if (state.over || state.pendingEvent) return [];
  return state.actionPoints > 0 ? ACTIONS : [];
}

export function takeAction(state, actionId) {
  if (state.over) throw new Error('Game is over.');
  if (state.pendingEvent) throw new Error('Resolve the current situation first.');
  if (state.actionPoints <= 0) throw new Error('No Action Points left this week.');
  if (!ACTIONS.some((a) => a.id === actionId)) throw new Error(`Unknown action ${actionId}`);
  const rng = restoreRng(state);
  const note = { week: state.week, actionId, detail: '' };
  switch (actionId) {
    case 'checkin': {
      state.team.ld.morale = clamp(state.team.ld.morale + 4, 0, 100);
      state.team.mp.morale = clamp(state.team.mp.morale + 4, 0, 100);
      const found = discover(state, 0.3, (t) => t.startedWeek !== null);
      note.detail = found > 0.5 ? `The team flagged ${round(found)} hours of rework you didn't know about.` : 'Nothing new surfaced; the team appreciated the time.';
      break;
    }
    case 'faculty-update':
      state.team.faculty.trust = clamp(state.team.faculty.trust + 4, 0, 100);
      state.mods.push({ type: 'responsiveness', value: 0.05, fromWeek: state.week + 1, untilWeek: state.week + 1 });
      note.detail = `${state.team.faculty.name} thanks you for keeping her in the loop.`;
      break;
    case 'working-session':
      state.weekFlags['extra-faculty'] = (state.weekFlags['extra-faculty'] ?? 0) + 3;
      state.team.faculty.trust = clamp(state.team.faculty.trust + 1, 0, 100);
      note.detail = 'A focused hour together gets more content written this week.';
      break;
    case 'qa-review': {
      state.mods.push({ type: 'capacity', who: 'ld', value: -2, fromWeek: state.week, untilWeek: state.week });
      const found = discover(state, 0.6, (t) => t.done > 0);
      note.detail = found > 0.5 ? `The review found ${round(found)} hours of rework. Better now than at launch.` : 'The review came back clean.';
      break;
    }
    case 'overtime-ld':
    case 'overtime-mp': {
      const role = actionId === 'overtime-ld' ? 'ld' : 'mp';
      state.weekFlags[`extra-${role}`] = (state.weekFlags[`extra-${role}`] ?? 0) + 4;
      state.weekFlags[`overtime-${role}`] = true;
      state.team[role].morale = clamp(state.team[role].morale - 6, 0, 100);
      note.detail = `${state.team[role].name} agrees, a little reluctantly.`;
      break;
    }
  }
  state.actionPoints -= 1;
  state.actionsTaken.push(note);
  state.rngState = rng.state;
  return note;
}

export function chooseOption(state, choiceId) {
  const ev = state.pendingEvent;
  if (!ev) throw new Error('No situation to resolve.');
  const event = state.deck.find((e) => e.id === ev.id);
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Unknown choice ${choiceId}`);
  for (const fx of choice.effects) applyEffect(state, fx);
  const credit = choice.credit ?? TIER_CREDIT[choice.tier];
  state.decisions.push({ week: state.week, eventId: event.id, choiceId, tier: choice.tier, credit });
  state.pendingEvent = null;
  return { outcome: choice.outcome, tier: choice.tier, credit, why: choice.why ?? '', reaction: choice.reaction ?? null, who: event.who ?? null };
}

function applyEffect(state, fx) {
  const until = (weeks) => state.week + (weeks ?? 1) - 1;
  switch (fx.type) {
    case 'trust':
      state.team.faculty.trust = clamp(state.team.faculty.trust + fx.value, 0, 100);
      break;
    case 'morale':
      state.team[fx.who].morale = clamp(state.team[fx.who].morale + fx.value, 0, 100);
      break;
    case 'responsiveness':
      state.mods.push({ type: 'responsiveness', value: fx.value, fromWeek: state.week, untilWeek: until(fx.weeks) });
      break;
    case 'capacity':
      state.mods.push({ type: 'capacity', who: fx.who, value: fx.value, fromWeek: state.week, untilWeek: until(fx.weeks) });
      break;
    case 'addEffort': {
      const t = state.tasks.find((x) => x.id === fx.task);
      t.effort = Math.max(1, t.effort + fx.value);
      break;
    }
    case 'addHiddenRework': {
      const t = state.tasks.find((x) => x.id === fx.task);
      t.hidden += fx.value;
      break;
    }
    case 'removeDependency': {
      const t = state.tasks.find((x) => x.id === fx.task);
      t.dependsOn = t.dependsOn.filter((d) => d !== fx.dep);
      break;
    }
    default:
      throw new Error(`Unknown effect ${fx.type}`);
  }
}

// ---------- the weekly tick ----------

export function advanceWeek(state) {
  if (state.over) throw new Error('Game is over.');
  if (state.pendingEvent) throw new Error('Resolve the current situation first.');
  const rng = restoreRng(state);
  const pressure = schedulePressure(state);
  const entry = { week: state.week, pressure: round(pressure, 2), hours: {}, errorRate: {}, discovered: 0, completed: [] };

  for (const role of ROLES) {
    const person = state.team[role];
    const morale = role === 'faculty' ? 75 : person.morale;
    const moraleFactor = 0.6 + 0.5 * (morale / 100);
    let hours = baseHours(state, role) * moraleFactor * rng.range(0.8, 1.2);
    const errorRate = clamp(
      0.08 + 0.12 * pressure + (morale < 50 ? 0.08 : 0) + (state.weekFlags[`overtime-${role}`] ? 0.06 : 0) - 0.01 * person.skill,
      0.02, 0.4,
    );
    entry.hours[role] = round(hours, 1);
    entry.errorRate[role] = round(errorRate, 2);

    for (const t of state.tasks) {
      if (hours <= 0) break;
      if (t.owner !== role || taskComplete(t) || !taskReady(state, t)) continue;
      if (t.startedWeek === null) t.startedWeek = state.week;
      // Fix known rework first, then new work. Both can introduce fresh mistakes.
      const fix = Math.min(hours, t.known);
      t.known -= fix;
      hours -= fix;
      const fresh = Math.min(hours, Math.max(0, t.effort - t.done));
      t.done += fresh;
      hours -= fresh;
      t.hidden += (fix + fresh) * errorRate;
    }
  }

  // Rework discovery: slow early, fast once QA has started (the "90% done" syndrome).
  const qaStarted = state.tasks.some((t) => t.isQA && t.startedWeek !== null);
  entry.discovered = round(discover(state, qaStarted ? 0.5 : 0.1, (t) => t.done > 0), 1);

  for (const t of state.tasks) {
    if (taskComplete(t) && t.finishedWeek === null) {
      t.finishedWeek = state.week;
      entry.completed.push(t.id);
    } else if (!taskComplete(t)) {
      t.finishedWeek = null;
    }
  }

  // Morale drifts toward 70 and sags under schedule pressure.
  for (const role of ['ld', 'mp']) {
    const p = state.team[role];
    p.morale = clamp(p.morale + (70 - p.morale) * 0.1 - 6 * pressure, 0, 100);
  }

  state.log.push(entry);
  const allDone = state.tasks.every(taskComplete);
  if (state.week >= state.launchWeek || allDone) {
    state.over = true;
    state.result = scorecard(state, allDone ? state.week : null);
    state.rngState = rng.state;
    return entry;
  }

  state.week += 1;
  state.actionPoints = state.actionPointsPerWeek;
  state.weekFlags = {};
  state.mods = state.mods.filter((m) => m.untilWeek >= state.week);
  drawEvent(state, rng);
  state.rngState = rng.state;
  return entry;
}

function discover(state, rate, filter) {
  let found = 0;
  for (const t of state.tasks) {
    if (!filter(t) || t.hidden <= 0) continue;
    const d = t.hidden * rate;
    t.hidden -= d;
    t.known += d;
    found += d;
  }
  return found;
}

function drawEvent(state, rng) {
  const eligible = rng.shuffle(state.deck.filter((e) => !state.firedEvents.includes(e.id) && triggerMet(state, e.trigger)));
  if (!eligible.length) return;
  const forced = state.week - state.lastEventWeek >= EVENT_GAP;
  const pick = forced ? eligible[0] : eligible.find((e) => rng.chance(e.trigger.chance ?? 0.4));
  if (!pick) return;
  state.pendingEvent = { id: pick.id, week: state.week };
  state.firedEvents.push(pick.id);
  state.lastEventWeek = state.week;
}

function triggerMet(state, trig) {
  const [lo, hi] = trig.weeks ?? [1, Infinity];
  if (state.week < lo || state.week > hi) return false;
  const r = trig.requires ?? {};
  const task = (id) => state.tasks.find((t) => t.id === id);
  if (r.taskStarted && task(r.taskStarted).startedWeek === null) return false;
  if (r.taskDone && !taskComplete(task(r.taskDone))) return false;
  if (r.taskNotDone && taskComplete(task(r.taskNotDone))) return false;
  return true;
}

// Face to draw for a person, from morale (team) or trust (faculty).
export function moodFor(state, role) {
  if (role === 'sup') return 'neutral';
  const v = role === 'faculty' ? state.team.faculty.trust : state.team[role].morale;
  if (v >= 72) return 'happy';
  if (v >= 55) return 'neutral';
  if (v >= 40) return 'worried';
  return 'sad';
}

export function bestChoice(event) {
  return event.choices.reduce((a, c) => ((c.credit ?? TIER_CREDIT[c.tier]) > (a.credit ?? TIER_CREDIT[a.tier]) ? c : a));
}

// Choices in a stable shuffled order per run, so the best answer isn't always first.
export function choicesInOrder(state, event) {
  return makeRng(`${state.seed}:${event.id}`).shuffle(event.choices);
}

export function currentEvent(state) {
  return state.pendingEvent ? state.deck.find((e) => e.id === state.pendingEvent.id) : null;
}

// ---------- scoring and debrief ----------

export function scorecard(state, finishedWeek) {
  const totalEffort = state.tasks.reduce((s, t) => s + t.effort, 0);
  const delivered = state.tasks.reduce((s, t) => s + Math.max(0, Math.min(t.done, t.effort) - t.known), 0);
  const hiddenLeft = state.tasks.reduce((s, t) => s + t.hidden, 0);
  const team = (state.team.ld.morale + state.team.mp.morale) / 2;
  const judgment = state.decisions.length ? (100 * state.decisions.reduce((s, d) => s + d.credit, 0)) / state.decisions.length : null;
  const scores = {
    scope: Math.round((100 * delivered) / totalEffort),
    quality: Math.round(clamp(100 - hiddenLeft * 4, 0, 100)),
    team: Math.round(team),
    faculty: Math.round(state.team.faculty.trust),
    judgment: judgment === null ? null : Math.round(judgment),
  };
  const weights = { scope: 0.3, quality: 0.2, team: 0.15, faculty: 0.15, judgment: 0.2 };
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (scores[k] === null) continue;
    num += scores[k] * w;
    den += w;
  }
  return {
    launchedOnTime: finishedWeek !== null && finishedWeek <= state.launchWeek,
    finishedWeek,
    scores,
    overall: Math.round(num / den),
    grade: gradeFor(num / den),
  };
}

function gradeFor(x) {
  if (x >= 90) return 'A';
  if (x >= 80) return 'B';
  if (x >= 70) return 'C';
  if (x >= 60) return 'D';
  return 'F';
}

// Debrief lessons drawn from the run: decisions first, then patterns in the log.
export function debrief(state) {
  const lessons = [];
  for (const d of state.decisions) {
    const ev = state.deck.find((e) => e.id === d.eventId);
    const chosen = ev.choices.find((c) => c.id === d.choiceId);
    const best = bestChoice(ev);
    lessons.push({
      kind: 'decision',
      week: d.week,
      title: ev.title,
      who: ev.who ?? null,
      tier: d.tier,
      tierLabel: TIER_LABEL[d.tier],
      credit: d.credit,
      chosen: chosen.label,
      why: chosen.why ?? '',
      bestLabel: best.id === chosen.id ? null : best.label,
      bestWhy: best.id === chosen.id ? null : best.why ?? '',
      concept: ev.debrief.concept,
      independent: ev.debrief.independent,
      escalateWhen: ev.debrief.escalateWhen,
      sop: ev.debrief.sop ?? null,
    });
  }
  const count = (id) => state.actionsTaken.filter((a) => a.actionId === id).length;
  const overtime = count('overtime-ld') + count('overtime-mp');
  if (overtime >= 3) {
    lessons.push({ kind: 'pattern', title: 'Overtime has a cost', concept: 'Sustainable pace', independent: `You asked for extra hours ${overtime} times. Overtime raises the error rate and lowers morale, so part of those hours came back as rework.` });
  }
  if (count('checkin') + count('qa-review') === 0) {
    lessons.push({ kind: 'pattern', title: 'Problems hid until the end', concept: 'The rework cycle', independent: 'You never ran a check-in or quality review, so mistakes stayed hidden until QA. Early reviews find rework when it is cheapest to fix.' });
  }
  if (count('faculty-update') === 0 && state.team.faculty.trust < 55) {
    lessons.push({ kind: 'pattern', title: 'Faculty felt out of the loop', concept: 'Stakeholder communication', independent: 'Regular status updates build trust, and trusted faculty partners respond faster.' });
  }
  return lessons;
}

// ---------- helpers ----------

function restoreRng(state) {
  const rng = makeRng(state.seed);
  rng.state = state.rngState;
  return rng;
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function round(x, d = 0) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
