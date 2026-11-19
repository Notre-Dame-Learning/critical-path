// Build the Plan: the v2 plan model, its 8 editor checks, submit blockers, the task bank,
// on-time odds played on sim.js itself, and the 100-point score.
// Rules: "Build the Plan baselines" tab of the framework doc (v2, Nov 5). sim.js is unchanged:
// a plan is played by driving the normal game week by week.
//
// A plan (content/plans/<project>.json, and what app/plan-edit.js edits):
// {
//   project, launchWeek, joinWeek,
//   tasks: { <taskId>: { start, end, est: [low, likely, high], deps: ["scripts", "coursemap:SS+1"], backup, locked } },
//   touchpoints: { "<week>": [slot, slot] },   slot: working-session | faculty-update | checkin | qa-review | overtime:<role> | null
//   gate: <week of the director gate> | null,
//   risks: [{ id, text, owner, mitigation, trigger, contingency }]
// }
// Weeks are inclusive: a task with start 3 and end 5 is worked in weeks 3, 4 and 5.
import * as S from './sim.js';

export const CHECKS = [
  { id: 'links', name: 'Required links', flaw: 'missing_dependency' },
  { id: 'buffer', name: 'Buffer', flaw: 'no_buffer' },
  { id: 'quality', name: 'Quality built in', flaw: 'review_squeezed' },
  { id: 'load', name: 'Load', flaw: 'full_utilization' },
  { id: 'backup', name: 'Backup', flaw: 'single_point_of_failure' },
  { id: 'risks', name: 'Risk owners', flaw: 'unowned_risks' },
  { id: 'sequence', name: 'Sequence', flaw: 'unrealistic_parallel' },
  { id: 'stakeholders', name: 'Stakeholders', flaw: 'no_stakeholder_plan' },
];

export const SLOTS = ['working-session', 'faculty-update', 'checkin', 'qa-review', 'overtime:ld', 'overtime:mp', 'overtime:gd'];
export const LOAD_WARN = 0.85;
export const LOAD_FAIL = 1.0;
const STEADY_STAFF = 0.6 + 0.5 * 0.7;  // sim.js morale factor at the steady-state morale of 70
const STEADY_FACULTY = 0.6 + 0.5 * 0.75; // sim.js uses morale 75 for faculty
const SESSION_HOURS = 3; // sim.js working-session bonus
const OVERTIME_HOURS = 5; // sim.js overtime bonus
const OPTIMISTIC = 0.75; // an "optimistic estimator" quotes 25% low
const REVIEW_EVERY = 4;
const CONTACT_EVERY = 2;

// ---------- small helpers ----------

export function parseDep(dep) {
  const m = /^([\w-]+)(?::SS([+-]\d+)?)?$/.exec(String(dep));
  if (!m) throw new Error(`Bad link ${dep}`);
  const ss = String(dep).includes(':SS');
  return { id: m[1], type: ss ? 'SS' : 'FS', lag: ss ? Number(m[2] ?? 0) : 0 };
}

export function estimateFor(effort) {
  return [Math.round(effort * 0.8), effort, Math.round(effort * 1.35)];
}

const joinOf = (project) => project.startWeek ?? 1;
const doneShare = (project, id) => project.initial?.tasks?.[id]?.done ?? 0;
const roleOf = (project, t) => t.owner;
const taskName = (project, id) => project.tasks.find((t) => t.id === id)?.name ?? id;
const weeksOf = (w) => Object.keys(w).map(Number).sort((a, b) => a - b);
const slotsAt = (plan, week) => plan.touchpoints?.[week] ?? plan.touchpoints?.[String(week)] ?? [];
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// The links the editor checks for: every dependency in the project's task graph.
export function requiredLinks(project) {
  return project.tasks.flatMap((t) => t.dependsOn.map((d) => [d, t.id]));
}

// ---------- the task bank ----------

// What the player starts from: tasks with owner and the owner's quoted estimate, never the true one.
// For a project joined mid-stream, a finished task is locked and a started task is quoted for what's left.
export function taskBank(project, world) {
  return project.tasks.map((t) => {
    const owner = roleOf(project, t);
    const person = owner === 'faculty' ? null : world.people.find((p) => p.id === project.team[owner]);
    const optimistic = person?.traits?.some((x) => /optimistic estimator/.test(x)) ?? false;
    const left = 1 - doneShare(project, t.id);
    const k = (optimistic ? OPTIMISTIC : 1) * left;
    const quote = estimateFor(t.effort).map((h) => (left <= 0 ? 0 : Math.max(1, Math.round(h * k))));
    return {
      id: t.id, name: t.name, phase: t.phase, owner, quote,
      quotedBy: owner === 'faculty' ? 'faculty' : person?.short ?? owner,
      optimistic, requiredLinks: [...t.dependsOn], inherited: left <= 0, started: left > 0 && left < 1, isQA: Boolean(t.isQA),
    };
  });
}

// An empty plan: every task unplaced with its quoted estimate, no links, no touchpoints.
// Inherited (finished) tasks keep a locked window before the join week.
export function emptyPlan(project, world) {
  const tasks = {};
  for (const b of taskBank(project, world)) {
    tasks[b.id] = { start: null, end: null, est: b.quote, deps: [], backup: null, locked: b.inherited };
    if (b.inherited) Object.assign(tasks[b.id], { start: 1, end: joinOf(project) - 1, deps: [...b.requiredLinks] });
  }
  return { project: project.id, launchWeek: project.launchWeek, joinWeek: joinOf(project), tasks, touchpoints: {}, gate: null, risks: [] };
}

// ---------- submit blockers ----------

// Things that stop Submit: an unplaced task, a loop, a window past launch or before the join week,
// an estimate out of order. Each names its targets for the screen.
export function blockers(plan, project) {
  const out = [];
  const join = joinOf(project);
  for (const t of project.tasks) {
    const p = plan.tasks[t.id];
    if (!p || p.start == null || p.end == null) { out.push({ code: 'unplaced', reason: `${t.name} has no weeks yet`, tasks: [t.id] }); continue; }
    if (p.end < p.start) out.push({ code: 'window', reason: `${t.name} ends before it starts`, tasks: [t.id] });
    if (p.end > plan.launchWeek) out.push({ code: 'past_launch', reason: `${t.name} runs past launch (week ${plan.launchWeek})`, tasks: [t.id] });
    if (!p.locked && doneShare(project, t.id) === 0 && p.start < join) out.push({ code: 'before_join', reason: `${t.name} starts before you join in week ${join}`, tasks: [t.id] });
    const [lo, mid, hi] = p.est ?? [];
    if (![lo, mid, hi].every((x) => Number.isFinite(x) && x >= 0) || lo > mid || mid > hi) out.push({ code: 'estimate', reason: `${t.name}'s estimate needs low ≤ likely ≤ high`, tasks: [t.id] });
  }
  const loop = findLoop(plan);
  if (loop) out.push({ code: 'loop', reason: `Links make a loop: ${loop.join(' → ')}`, tasks: [...new Set(loop)] });
  return out;
}

export function findLoop(plan) {
  const state = {};
  const stack = [];
  const visit = (id) => {
    if (state[id] === 2) return null;
    if (state[id] === 1) return [...stack.slice(stack.indexOf(id)), id];
    state[id] = 1;
    stack.push(id);
    for (const d of plan.tasks[id]?.deps ?? []) {
      const dep = parseDep(d).id;
      if (!plan.tasks[dep]) continue;
      const loop = visit(dep);
      if (loop) return loop;
    }
    stack.pop();
    state[id] = 2;
    return null;
  };
  for (const id of Object.keys(plan.tasks)) {
    const loop = visit(id);
    if (loop) return loop.reverse();
  }
  return null;
}

// ---------- load ----------

// Usable hours per person per week, as sim.js would give them at steady morale.
export function usableHours(plan, project, world, role, week) {
  const slots = slotsAt(plan, week);
  if (role === 'faculty') {
    const f = world.faculty.find((x) => x.id === project.team.faculty);
    const trust = project.initial?.trust ?? f.trust;
    const sessions = slots.filter((s) => s === 'working-session').length;
    return (f.hoursPerWeek * f.responsiveness * (0.7 + 0.6 * (trust / 100)) + SESSION_HOURS * sessions) * STEADY_FACULTY;
  }
  const p = world.people.find((x) => x.id === project.team[role]);
  const overtime = slots.filter((s) => s === `overtime:${role}`).length;
  return (p.hoursPerWeek + OVERTIME_HOURS * overtime) * STEADY_STAFF;
}

// For each person: likely hours planned against usable hours. A stretch of weeks is overloaded when the
// likely hours of tasks planned entirely inside it exceed the usable hours across it; each week's share is
// the worst stretch containing it, and the peak is the worst stretch overall.
export function loadReport(plan, project, world) {
  const join = joinOf(project);
  const weeks = range(join, plan.launchWeek);
  const out = {};
  for (const role of ['ld', 'mp', 'gd', 'faculty']) {
    const tasks = project.tasks
      .filter((t) => t.owner === role && !plan.tasks[t.id]?.locked && plan.tasks[t.id]?.start != null)
      .map((t) => ({ id: t.id, from: Math.max(join, plan.tasks[t.id].start), to: plan.tasks[t.id].end, hours: plan.tasks[t.id].est?.[1] ?? 0 }));
    const usable = Object.fromEntries(weeks.map((w) => [w, usableHours(plan, project, world, role, w)]));
    const share = Object.fromEntries(weeks.map((w) => [w, 0]));
    let peak = { share: 0, from: null, to: null, tasks: [] };
    for (const a of weeks) {
      let cap = 0;
      for (const b of weeks.filter((w) => w >= a)) {
        cap += usable[b];
        const inside = tasks.filter((t) => t.from >= a && t.to <= b);
        const s = inside.reduce((x, t) => x + t.hours, 0) / Math.max(cap, 1e-9);
        if (s > peak.share + 1e-9) peak = { share: s, from: a, to: b, tasks: inside.map((t) => t.id) };
        for (let w = a; w <= b; w++) share[w] = Math.max(share[w], s);
      }
    }
    const planned = Object.fromEntries(weeks.map((w) => [w, tasks.filter((t) => t.from <= w && t.to >= w).reduce((x, t) => x + t.hours / (t.to - t.from + 1), 0)]));
    out[role] = { weeks: weeks.map((w) => ({ week: w, planned: round(planned[w], 1), usable: round(usable[w], 1), share: round(share[w], 2) })), peak: { ...peak, share: round(peak.share, 2) } };
  }
  return out;
}

// ---------- critical path ----------

// Walk back from the task that ends last, each time to the linked task that ends latest
// (ties go to the bigger task). Locked inherited tasks are left out.
export function criticalPath(plan, project) {
  const placed = project.tasks.filter((t) => plan.tasks[t.id]?.end != null && !plan.tasks[t.id].locked);
  if (!placed.length) return [];
  const likely = (id) => plan.tasks[id].est?.[1] ?? 0;
  const later = (a, b) => (plan.tasks[a].end - plan.tasks[b].end) || (likely(a) - likely(b));
  // Start from the last task to end; among tasks ending together, one that others don't feed (the hand-off, not QA).
  const lastEnd = Math.max(...placed.map((t) => plan.tasks[t.id].end));
  const tied = placed.filter((t) => plan.tasks[t.id].end === lastEnd).map((t) => t.id);
  const feeds = (id) => tied.some((o) => o !== id && (plan.tasks[o].deps ?? []).some((d) => parseDep(d).id === id));
  const sinks = tied.filter((id) => !feeds(id));
  let cur = (sinks.length ? sinks : tied).reduce((a, b) => (later(b, a) > 0 ? b : a));
  const path = [cur];
  const seen = new Set(path);
  for (;;) {
    const preds = (plan.tasks[cur].deps ?? []).map((d) => parseDep(d).id).filter((id) => plan.tasks[id]?.end != null && !plan.tasks[id].locked && !seen.has(id));
    if (!preds.length) break;
    cur = preds.reduce((a, b) => (later(b, a) > 0 ? b : a));
    path.unshift(cur);
    seen.add(cur);
  }
  return path;
}

// ---------- the 8 checks ----------

export function runChecks(plan, project, world) {
  const tasks = plan.tasks;
  const join = joinOf(project);
  const qaTask = project.tasks.find((t) => t.isQA);
  const qa = qaTask ? tasks[qaTask.id] : null;
  const qaStart = qa?.start ?? plan.launchWeek;
  const qaEnd = qa?.end ?? plan.launchWeek;
  const res = (id, status, reason, extra = {}) => ({ id, name: CHECKS.find((c) => c.id === id).name, status, reason, tasks: [], weeks: [], risks: [], ...extra });
  const out = [];

  // Required links: every link in the project's task graph is in the plan (either kind).
  const missing = requiredLinks(project).filter(([pred, succ]) => !(tasks[succ]?.deps ?? []).some((d) => parseDep(d).id === pred));
  out.push(missing.length
    ? res('links', 'fail', missing.map(([p, s]) => `${taskName(project, s)} doesn't wait for ${taskName(project, p)}`).join('; '), { tasks: [...new Set(missing.flat())], links: missing })
    : res('links', 'pass', 'Every required link is in the plan'));

  // Buffer: QA planned to finish by the week before launch (the hand-off may sit in launch week).
  out.push(qa && qaEnd <= plan.launchWeek - 1
    ? res('buffer', 'pass', `QA ends in week ${qaEnd}, a week before launch`)
    : res('buffer', 'fail', `QA ends in week ${qaEnd}, launch week itself, so there is no buffer`, { tasks: qaTask ? [qaTask.id] : [], weeks: [plan.launchWeek] }));

  // Quality built in: an internal review at least every 4 weeks from week 3 (or joining) until QA starts.
  const reviewWeeks = weeksOf(plan.touchpoints ?? {}).filter((w) => slotsAt(plan, w).includes('qa-review'));
  const from = Math.max(3, join);
  const gaps = gapWeeks(reviewWeeks.filter((w) => w >= join && w < qaStart), from, qaStart - 1, REVIEW_EVERY);
  out.push(gaps.length
    ? res('quality', 'fail', `No internal review in weeks ${fmtRanges(gaps)}; review at least every ${REVIEW_EVERY} weeks before QA`, { weeks: gaps.flat() })
    : res('quality', 'pass', `Internal reviews at least every ${REVIEW_EVERY} weeks before QA`));

  // Load: likely hours fit usable hours over every stretch of weeks. Warn over 85%, fail over 100%.
  const load = loadReport(plan, project, world);
  const worst = Object.entries(load).sort((a, b) => b[1].peak.share - a[1].peak.share)[0];
  const [who, { peak }] = worst;
  const label = who === 'faculty' ? 'the faculty partner' : nameOf(project, world, who);
  const loadExtra = { tasks: peak.tasks, weeks: peak.from ? range(peak.from, peak.to) : [], who, share: peak.share };
  const pct = Math.round(peak.share * 100);
  out.push(peak.share > LOAD_FAIL + 1e-9
    ? res('load', 'fail', `${label} is at ${pct}% in weeks ${peak.from}–${peak.to}`, loadExtra)
    : peak.share > LOAD_WARN + 1e-9
      ? res('load', 'warn', `${label} peaks at ${pct}% in weeks ${peak.from}–${peak.to} (over 85%, under 100%)`, loadExtra)
      : res('load', 'pass', `Everyone stays at or under 85% (peak ${pct}%)`, loadExtra));

  // Backup: anyone owning 4+ critical-path tasks names a backup on one of them.
  const cp = criticalPath(plan, project);
  const owners = {};
  for (const id of cp) (owners[project.tasks.find((t) => t.id === id).owner] ??= []).push(id);
  const exposed = Object.entries(owners).filter(([, ids]) => ids.length >= 4 && !ids.some((id) => tasks[id].backup));
  out.push(exposed.length
    ? res('backup', 'fail', exposed.map(([r, ids]) => `${r === 'faculty' ? 'The faculty partner' : nameOf(project, world, r)} owns ${ids.length} critical-path tasks with no backup`).join('; '), { tasks: exposed.flatMap(([, ids]) => ids), criticalPath: cp })
    : res('backup', 'pass', 'No one carries the critical path without a backup', { criticalPath: cp }));

  // Risk owners: every risk has owner, mitigation, trigger and contingency.
  const risks = plan.risks ?? [];
  const bad = risks.filter((r) => ['owner', 'mitigation', 'trigger', 'contingency'].some((k) => !String(r[k] ?? '').trim()));
  out.push(!risks.length
    ? res('risks', 'fail', 'The risk register is empty')
    : bad.length
      ? res('risks', 'fail', bad.map((r) => `${r.text || r.id} is missing ${['owner', 'mitigation', 'trigger', 'contingency'].filter((k) => !String(r[k] ?? '').trim()).join(', ')}`).join('; '), { risks: bad.map((r) => r.id) })
      : res('risks', 'pass', `All ${risks.length} risks have an owner, mitigation, trigger and contingency`));

  // Sequence: no task starts before a task it depends on ends (rolling links: before its feeder starts + lag).
  const early = [];
  for (const [id, p] of Object.entries(tasks)) {
    if (p.start == null || p.locked) continue;
    for (const d of p.deps ?? []) {
      const { id: dep, type, lag } = parseDep(d);
      const q = tasks[dep];
      if (!q || q.start == null) continue;
      if (type === 'FS' ? p.start < q.end : p.start < q.start + lag) early.push([dep, id]);
    }
  }
  out.push(early.length
    ? res('sequence', 'fail', early.map(([d, s]) => `${taskName(project, s)} starts week ${tasks[s].start}, before ${taskName(project, d)} ${parseDep(tasks[s].deps.find((x) => parseDep(x).id === d)).type === 'FS' ? `ends (week ${tasks[d].end})` : 'is far enough along'}`).join('; '), { tasks: [...new Set(early.flat())] })
    : res('sequence', 'pass', 'No task starts before the work it depends on'));

  // Stakeholders: faculty contact at least every 2 weeks and a director gate before QA starts.
  const contact = stakeholderParts(plan, project);
  out.push(contact.contactOk && contact.gateOk
    ? res('stakeholders', 'pass', `Faculty contact at least every ${CONTACT_EVERY} weeks; director gate in week ${plan.gate}`)
    : res('stakeholders', 'fail', [!contact.contactOk && `No faculty contact in weeks ${fmtRanges(contact.gaps)}`, !contact.gateOk && (plan.gate == null ? 'No director gate' : `The director gate (week ${plan.gate}) comes after QA starts`)].filter(Boolean).join('; '), { weeks: contact.gaps.flat() }));
  return out;
}

// Faculty contact gaps and the gate, for the Stakeholders check, the score and the calendar shading.
export function stakeholderParts(plan, project) {
  const join = joinOf(project);
  const qaTask = project.tasks.find((t) => t.isQA);
  const qa = qaTask ? plan.tasks[qaTask.id] : null;
  const last = Math.min(plan.launchWeek - 1, qa?.end ?? plan.launchWeek - 1);
  const contactWeeks = weeksOf(plan.touchpoints ?? {}).filter((w) => w >= join && slotsAt(plan, w).some((s) => s === 'faculty-update' || s === 'working-session'));
  const gaps = gapWeeks(contactWeeks, join, last, CONTACT_EVERY);
  const gateOk = plan.gate != null && plan.gate >= join && plan.gate < (qa?.start ?? plan.launchWeek);
  return { contactOk: gaps.length === 0, gateOk, gaps };
}

// Runs of more than `every` weeks between from..to with no hit, as [first, last] pairs.
function gapWeeks(hits, from, to, every) {
  const gaps = [];
  let run = [];
  for (let w = from; w <= to; w++) {
    if (hits.includes(w)) { if (run.length >= every) gaps.push([run[0], run.at(-1)]); run = []; } else run.push(w);
  }
  if (run.length >= every) gaps.push([run[0], run.at(-1)]);
  return gaps;
}

const fmtRanges = (gaps) => gaps.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
const nameOf = (project, world, role) => world.people.find((p) => p.id === project.team[role])?.short ?? role;

// ---------- playing a plan on the engine ----------

// One run of the plan on sim.js: no task starts before its planned start week (owner decision, Nov 19),
// tasks are worked in the plan's start order, the plan's links (rolling links
// release a task once its feeder has run for `lag` weeks), the touchpoint calendar spent as Action Points,
// and every situation answered with its best choice (situations: false turns them off).
// A required link left out lets the task start early, and the first time it starts before that input is
// finished its full effort is planted as hidden rework, and the redo waits for that input
// (a shoot on unapproved scripts is reshot once the scripts are approved).
export function playPlan(plan, { world, project, deck, seed = 'plan', situations = true, onWeek = null }) {
  const order = workOrder(plan, project);
  const proj = { ...project, tasks: order.map((t) => ({ ...t, dependsOn: [] })) };
  const g = S.createGame({ world, project: proj, deck: situations ? deck : { events: [] }, seed });
  const deps = Object.fromEntries(project.tasks.map((t) => [t.id, (plan.tasks[t.id]?.deps ?? []).map(parseDep).filter((d) => d.id !== t.id)]));
  const missing = requiredLinks(project).filter(([p, s]) => !deps[s].some((d) => d.id === p));
  const planted = new Set();
  const byId = (id) => g.tasks.find((t) => t.id === id);
  const wire = () => {
    for (const t of g.tasks) {
      t.dependsOn = deps[t.id].filter((d) => {
        if (d.type === 'FS') return true;
        const f = byId(d.id);
        return !f || f.startedWeek === null || g.week < f.startedWeek + d.lag;
      }).map((d) => d.id);
      // A task can't start before its planned start week: until then it waits on itself.
      const start = plan.tasks[t.id]?.start;
      if (t.startedWeek === null && start != null && g.week < start) t.dependsOn.push(t.id);
    }
  };
  let guard = 0;
  while (!g.over && guard++ < 80) {
    if (g.pendingEvent) S.chooseOption(g, S.bestChoice(S.currentEvent(g)).id);
    for (const slot of slotsAt(plan, g.week)) {
      if (!slot || g.actionPoints <= 0) continue;
      const [action, who] = slot.split(':');
      S.takeAction(g, action, who);
    }
    wire();
    const before = Object.fromEntries(missing.map(([p]) => [p, S.taskComplete(byId(p))]));
    S.advanceWeek(g);
    if (onWeek) onWeek(g);
    for (const [p, s] of missing) {
      const succ = byId(s);
      if (planted.has(`${p}>${s}`) || succ.startedWeek === null || before[p]) continue;
      // The redo can't happen until the input it was missing is finished: the reshoot waits for approved scripts.
      succ.hidden += succ.effort;
      deps[s].push({ id: p, type: 'FS', lag: 0 });
      planted.add(`${p}>${s}`);
    }
  }
  return g;
}

// The order people work their ready tasks in: by planned start week, but never ahead of a task it links to,
// so work handed over mid-week can be picked up the same week (sim.js works tasks in list order).
export function workOrder(plan, project) {
  const start = (t) => plan.tasks[t.id]?.start ?? 99;
  const left = [...project.tasks];
  const done = new Set();
  const out = [];
  while (left.length) {
    const ready = left.filter((t) => (plan.tasks[t.id]?.deps ?? []).every((d) => { const id = parseDep(d).id; return done.has(id) || !plan.tasks[id] || id === t.id; }));
    const pool = ready.length ? ready : left; // a loop: fall back to start order
    const next = pool.reduce((a, b) => (start(b) < start(a) ? b : a));
    out.push(next);
    done.add(next.id);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}

// On-time odds over `runs` seeded runs, callable in slices (from, runs) so a screen can spread the work.
export function onTimeOdds(plan, ctx, { runs = 500, seed = 'odds', from = 0, situations = true } = {}) {
  let onTime = 0;
  for (let i = from; i < from + runs; i++) if (playPlan(plan, { ...ctx, seed: `${seed}:${i}`, situations }).result.launchedOnTime) onTime++;
  return { onTime, runs, share: runs ? onTime / runs : 0 };
}

// ---------- scoring ----------

// The 100-point score: on-time odds against the baseline (40), 5 per check passed (40),
// team load (10: everyone at or under 85%, or 5 if under 100%), stakeholder plan (10: 5 + 5).
export function scorePlan(plan, baseline, ctx, { runs = 500, seed = 'score', baselineOdds } = {}) {
  const block = blockers(plan, ctx.project);
  if (block.length) return { submittable: false, blockers: block };
  const checks = runChecks(plan, ctx.project, ctx.world);
  const player = onTimeOdds(plan, ctx, { runs, seed }).share;
  const base = baselineOdds ?? onTimeOdds(baseline, ctx, { runs, seed }).share;
  const peak = Math.max(...Object.values(loadReport(plan, ctx.project, ctx.world)).map((r) => r.peak.share));
  const sh = stakeholderParts(plan, ctx.project);
  const parts = {
    odds: round(Math.min(40, base > 0 ? 40 * (player / base) : player > 0 ? 40 : 0), 1),
    checks: 5 * checks.filter((c) => c.status !== 'fail').length,
    load: peak <= LOAD_WARN + 1e-9 ? 10 : peak <= LOAD_FAIL + 1e-9 ? 5 : 0,
    stakeholders: (sh.contactOk ? 5 : 0) + (sh.gateOk ? 5 : 0),
  };
  return { submittable: true, total: Math.round(parts.odds + parts.checks + parts.load + parts.stakeholders), parts, odds: { player, baseline: base }, checks, peakLoad: round(peak, 2) };
}

// ---------- baselines ----------

// Standard touchpoints: a working session every week the faculty partner owns open work, else a check-in;
// an internal review every third week from week 3 until QA, else a Friday summary.
export function standardTouchpoints(plan, project, { overtime = {} } = {}) {
  const join = joinOf(project);
  const qa = project.tasks.find((t) => t.isQA);
  const qaStart = plan.tasks[qa.id].start;
  const facultyOpen = (w) => project.tasks.some((t) => t.owner === 'faculty' && !plan.tasks[t.id].locked && plan.tasks[t.id].start <= w && plan.tasks[t.id].end >= w);
  const tp = {};
  for (const w of range(join, plan.launchWeek)) {
    const a = overtime[w] ? `overtime:${overtime[w]}` : facultyOpen(w) ? 'working-session' : 'checkin';
    const b = w >= 3 && w < qaStart && (w - 3) % 3 === 0 ? 'qa-review' : 'faculty-update';
    tp[w] = [a, b];
  }
  return tp;
}

// Median start and finish weeks of each task over `runs` engine runs with links restored: the starting
// point for a baseline's windows (scripts/plans.mjs then applies the hand-written parts).
export function medianWindows(plan, ctx, { runs = 60, seed = 'baseline', startQuantile = 0.5 } = {}) {
  const starts = {}, ends = {};
  for (let i = 0; i < runs; i++) {
    const first = {}; // first finish: rework found later reopens a task, which shouldn't stretch its window
    const g = playPlan(plan, { ...ctx, seed: `${seed}:${i}`, onWeek: (s) => { for (const t of s.tasks) if (t.finishedWeek !== null) first[t.id] ??= t.finishedWeek; } });
    for (const t of g.tasks) {
      (starts[t.id] ??= []).push(t.startedWeek ?? g.launchWeek);
      (ends[t.id] ??= []).push(first[t.id] ?? t.finishedWeek ?? g.launchWeek);
    }
  }
  const q = (xs, k) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * k))];
  return Object.fromEntries(Object.keys(starts).map((id) => [id, { start: q(starts[id], startQuantile), end: q(ends[id], 0.5) }]));
}

function round(x, d = 0) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
