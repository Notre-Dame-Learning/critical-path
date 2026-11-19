// Plan editor, step 1: a pure layout model for the timeline screen. It turns a plan into the week axis,
// task rows with bar positions, bar marks from the checks, the per-person load strip and the calendar
// shading. Positions are fractions of the timeline width, so the screen can draw them at any size.
// Design: "Plan editor screen" tab of the framework doc.
import { runChecks, loadReport, stakeholderParts, workOrder, LOAD_WARN, LOAD_FAIL } from '../engine/plan.js';

// Weeks 1..launch; the launch week is drawn in gold, weeks before the join week greyed (Rescue).
export function weekAxis(plan) {
  return Array.from({ length: plan.launchWeek }, (_, i) => {
    const week = i + 1;
    return { week, launch: week === plan.launchWeek, beforeJoin: week < (plan.joinWeek ?? 1) };
  });
}

// Where a bar sits: left edge and width as fractions of the timeline.
export function barPosition(plan, start, end) {
  const n = plan.launchWeek;
  return { left: (start - 1) / n, width: (end - start + 1) / n };
}

// The worst status each task is named in by a check, with the checks that name it.
export function barMarks(checks) {
  const rank = { pass: 0, warn: 1, fail: 2 };
  const marks = {};
  for (const c of checks) {
    if (c.status === 'pass') continue;
    for (const id of c.tasks ?? []) {
      const m = (marks[id] ??= { status: 'pass', checks: [] });
      if (rank[c.status] > rank[m.status]) m.status = c.status;
      m.checks.push({ id: c.id, name: c.name, status: c.status });
    }
  }
  return marks;
}

// Everything the timeline needs in one call. Rows follow the order people work (start week, links first);
// unplaced tasks go to the Unscheduled tray.
export function layout(plan, project, world, { checks = runChecks(plan, project, world) } = {}) {
  const marks = barMarks(checks);
  const people = (role) => (role === 'faculty' ? world.faculty.find((f) => f.id === project.team.faculty) : world.people.find((p) => p.id === project.team[role]));
  const rows = [];
  const unscheduled = [];
  for (const t of workOrder(plan, project)) {
    const p = plan.tasks[t.id];
    const who = people(t.owner);
    const row = {
      id: t.id, name: t.name, phase: t.phase, owner: t.owner, ownerName: who?.short ?? who?.name ?? t.owner,
      avatar: who?.avatar ?? null, locked: Boolean(p.locked), backup: p.backup ?? null,
      start: p.start, end: p.end, mark: marks[t.id] ?? { status: 'pass', checks: [] },
    };
    if (p.start == null) unscheduled.push(row);
    else rows.push({ ...row, ...barPosition(plan, p.start, p.end) });
  }
  return { axis: weekAxis(plan), rows, unscheduled, checks, load: loadStrip(plan, project, world), calendar: calendarShading(plan, project) };
}

// One strip per person: each week's share of usable hours over the worst stretch containing it (the Load
// check's rule, so the strip never shows red while the check passes), with a level for colour and icon.
export function loadStrip(plan, project, world) {
  const report = loadReport(plan, project, world);
  const level = (s) => (s > LOAD_FAIL + 1e-9 ? 'fail' : s > LOAD_WARN + 1e-9 ? 'warn' : 'ok');
  return Object.fromEntries(Object.entries(report).map(([role, r]) => [role, {
    weeks: r.weeks.map((w) => ({ ...w, level: level(w.share) })),
    peak: { ...r.peak, level: level(r.peak.share) },
  }]));
}

// The Weeks tab: which weeks fall in a faculty-contact gap (shaded), and which have faculty-owned work
// open (a small faculty face, where working sessions pay off).
export function calendarShading(plan, project) {
  const { gaps, gateOk } = stakeholderParts(plan, project);
  const gapWeeks = gaps.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  const facultyOpen = [];
  for (let w = plan.joinWeek ?? 1; w <= plan.launchWeek; w++) {
    if (project.tasks.some((t) => t.owner === 'faculty' && !plan.tasks[t.id].locked && plan.tasks[t.id].start != null && plan.tasks[t.id].start <= w && plan.tasks[t.id].end >= w)) facultyOpen.push(w);
  }
  return { gapWeeks, facultyOpen, gate: plan.gate ?? null, gateOk };
}
