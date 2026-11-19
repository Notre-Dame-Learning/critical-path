// Plan editor, step 1: every edit as a pure function that returns a new plan, plus undo history and
// draft autosave. The screen (step 2) calls these; nothing here touches the DOM.
// Design: "Plan editor screen" tab of the framework doc. Plan shape: engine/plan.js.
import { parseDep, findLoop, SLOTS, taskBank } from '../engine/plan.js';

export class PlanEditError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PlanEditError';
    this.code = code;
    Object.assign(this, detail);
  }
}

const refuse = (code, message, detail) => { throw new PlanEditError(code, message, detail); };
const clone = (plan) => structuredClone(plan);
const join = (plan) => plan.joinWeek ?? 1;

function task(plan, id) {
  const t = plan.tasks[id];
  if (!t) refuse('unknown_task', `No task ${id}`);
  return t;
}

function editable(plan, id) {
  const t = task(plan, id);
  if (t.locked) refuse('locked', 'This task was finished before you joined; it can\'t be changed.', { task: id });
  return t;
}

// A task may start before the join week only if it was already under way when the player joined.
function checkWindow(plan, id, start, end, project) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) refuse('bad_window', 'Weeks must be whole numbers.', { task: id });
  if (end < start) refuse('bad_window', 'A task can\'t end before it starts.', { task: id });
  const underway = (project?.initial?.tasks?.[id]?.done ?? 0) > 0;
  if (start < (underway ? 1 : join(plan))) refuse('too_early', underway ? 'Weeks start at 1.' : `You join in week ${join(plan)}; work can't be planned before that.`, { task: id });
  if (end > plan.launchWeek) refuse('past_launch', `Launch is week ${plan.launchWeek}; nothing can be planned after it.`, { task: id });
}

// ---------- task windows ----------

// Put an unscheduled task in at its earliest possible week (when its latest linked predecessor ends,
// else the join week) with a one-week window, so the player decides every length.
export function place(plan, id, project) {
  const p = clone(plan);
  const t = editable(p, id);
  const preds = (t.deps ?? []).map((d) => p.tasks[parseDep(d).id]).filter((x) => x?.end != null);
  const start = Math.max(join(p), ...preds.map((x) => x.end));
  checkWindow(p, id, start, start, project);
  Object.assign(t, { start, end: start });
  return p;
}

export function unplace(plan, id) {
  const p = clone(plan);
  Object.assign(editable(p, id), { start: null, end: null });
  return p;
}

export function setWindow(plan, id, start, end, project) {
  const p = clone(plan);
  const t = editable(p, id);
  checkWindow(p, id, start, end, project);
  Object.assign(t, { start, end });
  return p;
}

// Drag the whole bar by `by` weeks, keeping its length.
export function move(plan, id, by, project) {
  const t = task(plan, id);
  if (t.start == null) refuse('unplaced', 'Place the task first.', { task: id });
  return setWindow(plan, id, t.start + by, t.end + by, project);
}

// Drag one edge: which = 'start' | 'end'.
export function resize(plan, id, which, by, project) {
  const t = task(plan, id);
  if (t.start == null) refuse('unplaced', 'Place the task first.', { task: id });
  return which === 'start' ? setWindow(plan, id, t.start + by, t.end, project) : setWindow(plan, id, t.start, t.end + by, project);
}

// Estimates are the player's; low > likely > high is allowed while editing and blocks Submit.
export function setEstimate(plan, id, est) {
  if (!Array.isArray(est) || est.length !== 3 || !est.every((h) => Number.isFinite(h) && h >= 0)) refuse('bad_estimate', 'An estimate is three hour figures: low, likely, high.', { task: id });
  const p = clone(plan);
  editable(p, id).est = est.map((h) => Math.round(h * 10) / 10);
  return p;
}

// ---------- links ----------

// kind: 'FS' (finish to start) or { lag } for rolling work (SS+lag).
const spell = (from, kind) => (kind === 'FS' || kind == null ? from : `${from}:SS+${kind.lag ?? 0}`);

export function addLink(plan, from, to, kind = 'FS') {
  if (from === to) refuse('loop', 'A task can\'t wait for itself.', { loop: [from, to] });
  const p = clone(plan);
  task(p, from);
  const t = editable(p, to);
  t.deps = (t.deps ?? []).filter((d) => parseDep(d).id !== from);
  t.deps.push(spell(from, kind));
  const loop = findLoop(p);
  if (loop) refuse('loop', `That link would make a loop: ${loop.join(' → ')}`, { loop });
  return p;
}

export function removeLink(plan, from, to) {
  const p = clone(plan);
  const t = editable(p, to);
  t.deps = (t.deps ?? []).filter((d) => parseDep(d).id !== from);
  return p;
}

export function retypeLink(plan, from, to, kind) {
  const t = task(plan, to);
  if (!(t.deps ?? []).some((d) => parseDep(d).id === from)) refuse('no_link', 'There is no such link to change.', { task: to });
  return addLink(plan, from, to, kind);
}

// ---------- backups ----------

// A backup is a staff member other than the owner; faculty can't be a backup. null clears it.
export function setBackup(plan, id, role, project) {
  const p = clone(plan);
  const t = editable(p, id);
  if (role != null) {
    const owner = project.tasks.find((x) => x.id === id)?.owner;
    if (!['ld', 'mp', 'gd'].includes(role) || role === owner) refuse('bad_backup', role === owner ? 'The owner can\'t be their own backup.' : 'Pick a staff member as backup.', { task: id });
  }
  t.backup = role ?? null;
  return p;
}

// ---------- touchpoint calendar and gate ----------

export function setSlot(plan, week, index, slot) {
  if (!Number.isInteger(week) || week < join(plan) || week > plan.launchWeek) refuse('bad_slot', `Pick a week from ${join(plan)} to ${plan.launchWeek}.`, { week });
  if (index !== 0 && index !== 1) refuse('bad_slot', 'Each week has two Action Point slots.', { week });
  if (slot != null && !SLOTS.includes(slot)) refuse('bad_slot', `Unknown touchpoint ${slot}.`, { week });
  const p = clone(plan);
  const row = [...(p.touchpoints[week] ?? [null, null])];
  row[index] = slot ?? null;
  if (row.every((s) => s == null)) delete p.touchpoints[week];
  else p.touchpoints[week] = row;
  return p;
}

// "Copy this week to…": copies a week's two slots to each chosen week.
export function copyWeek(plan, from, toWeeks) {
  let p = plan;
  const row = plan.touchpoints[from] ?? [null, null];
  for (const w of toWeeks) for (const i of [0, 1]) p = setSlot(p, w, i, row[i] ?? null);
  return p === plan ? clone(plan) : p;
}

export function setGate(plan, week) {
  if (week != null && (!Number.isInteger(week) || week < join(plan) || week > plan.launchWeek)) refuse('bad_gate', `Pick a week from ${join(plan)} to ${plan.launchWeek}.`, { week });
  const p = clone(plan);
  p.gate = week ?? null;
  return p;
}

// ---------- risks ----------

const RISK_FIELDS = ['text', 'owner', 'mitigation', 'trigger', 'contingency'];

export function addRisk(plan, risk = {}) {
  const p = clone(plan);
  let n = p.risks.length + 1;
  while (p.risks.some((r) => r.id === `risk-${n}`)) n++;
  const r = { id: risk.id ?? `risk-${n}` };
  if (p.risks.some((x) => x.id === r.id)) refuse('bad_risk', 'A risk with that id already exists.');
  for (const k of RISK_FIELDS) r[k] = String(risk[k] ?? '');
  p.risks.push(r);
  return p;
}

export function editRisk(plan, id, fields) {
  const p = clone(plan);
  const r = p.risks.find((x) => x.id === id);
  if (!r) refuse('bad_risk', 'No such risk.');
  for (const k of RISK_FIELDS) if (k in fields) r[k] = String(fields[k] ?? '');
  return p;
}

export function removeRisk(plan, id) {
  const p = clone(plan);
  p.risks = p.risks.filter((r) => r.id !== id);
  return p;
}

// ---------- undo ----------

export const HISTORY_LIMIT = 50;

export function history(plan) {
  return { past: [], present: plan, future: [] };
}

// Apply an edit: fn(plan) → new plan. A refused edit throws and leaves the history unchanged.
export function apply(h, fn) {
  const next = fn(h.present);
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past.at(-1), future: [h.present, ...h.future] };
}

export function redo(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ---------- drafts ----------

// Drafts are saved per project in localStorage (any object with getItem/setItem works), keyed to the
// task bank, so a draft built against a different bank (the content changed) is dropped.
const draftKey = (projectId) => `critical-path-plan-draft:${projectId}`;
export const bankStamp = (project, world) => taskBank(project, world).map((t) => `${t.id}:${t.quote.join('/')}:${t.requiredLinks.join('+')}`).join('|');

export function saveDraft(store, project, world, plan) {
  try {
    store?.setItem(draftKey(project.id), JSON.stringify({ bank: bankStamp(project, world), plan }));
    return true;
  } catch { return false; }
}

export function loadDraft(store, project, world) {
  try {
    const raw = store?.getItem(draftKey(project.id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.bank !== bankStamp(project, world) || d.plan?.project !== project.id) {
      store.removeItem?.(draftKey(project.id));
      return null;
    }
    return d.plan;
  } catch { return null; }
}

export function clearDraft(store, project) {
  try { store?.removeItem(draftKey(project.id)); } catch { /* storage unavailable */ }
}
