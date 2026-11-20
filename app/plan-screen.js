// Plan editor, step 2: the Build the Plan screen. Timeline, task sheet and checks panel, live on
// engine/plan.js. Edits go through app/plan-edit.js, drawing through app/plan-layout.js.
// Design: "Plan editor screen" tab of the framework doc. Step 3 (touchpoint calendar, risk register),
// step 4 (odds meter) and step 5 (Submit, scoring, debrief) build on this file.
//
// The top half is pure (view model, HTML, key and drag mapping, edit ops) and runs in Node for the tests.
// mountPlanEditor() at the bottom is the only part that touches the DOM.
import { runChecks, blockers, usableHours, emptyPlan, taskBank, parseDep, CHECKS } from '../engine/plan.js';
import * as E from './plan-edit.js';
import { layout } from './plan-layout.js';
import { avatarSVG } from './avatars.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE = { ld: 'Learning Design', mp: 'Media', gd: 'Graphics', faculty: 'Faculty' };
const ICON = { pass: '✓', warn: '!', fail: '✗' };
const STATUS_WORD = { pass: 'passes', warn: 'warning', fail: 'fails' };

// ---------- view model ----------

// Everything the screen draws for one plan. A check counts as passed unless it fails (a warning passes,
// as in the score's 5 points per check).
export function planView(plan, project, world) {
  const checks = runChecks(plan, project, world);
  const lay = layout(plan, project, world, { checks });
  return {
    project, world, plan, checks, lay,
    passed: checks.filter((c) => c.status !== 'fail').length,
    blockers: blockers(plan, project),
  };
}

export function personFor(project, world, role) {
  return role === 'faculty' ? world.faculty.find((f) => f.id === project.team.faculty) : world.people.find((p) => p.id === project.team[role]);
}

// What tapping a check or blocker points at.
export function targetsOf(item) {
  return { tasks: [...new Set(item?.tasks ?? [])], weeks: [...new Set(item?.weeks ?? [])], risks: [...new Set(item?.risks ?? [])] };
}

// ---------- edit ops ----------

// Every screen edit is an op, turned into a plan → plan function from plan-edit.js. Refusals throw
// PlanEditError and leave the history unchanged.
export function editFor(op, project) {
  switch (op.op) {
    case 'place': return (p) => E.place(p, op.id, project);
    case 'unplace': return (p) => E.unplace(p, op.id);
    case 'move': return (p) => E.move(p, op.id, op.by, project);
    case 'resize': return (p) => E.resize(p, op.id, op.which, op.by, project);
    case 'window': return (p) => E.setWindow(p, op.id, op.start, op.end, project);
    case 'estimate': return (p) => E.setEstimate(p, op.id, op.est);
    case 'backup': return (p) => E.setBackup(p, op.id, op.role || null, project);
    case 'link': return (p) => E.addLink(p, op.from, op.to, op.kind ?? 'FS');
    case 'unlink': return (p) => E.removeLink(p, op.from, op.to);
    case 'retype': return (p) => E.retypeLink(p, op.from, op.to, op.kind);
    default: throw new Error(`Unknown edit ${op.op}`);
  }
}

// Keyboard on a focused bar: arrows move it a week, Shift+arrows move its end.
export function keyOp(key, { shift = false } = {}, id) {
  const by = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (!by) return null;
  return shift ? { op: 'resize', id, which: 'end', by } : { op: 'move', id, by };
}

// A drag of dx pixels on a bar, snapped to whole weeks; part = 'body' | 'start' | 'end'.
export function dragOp(id, part, dx, weekPx) {
  const by = Math.round(dx / Math.max(1, weekPx));
  if (!by) return null;
  return part === 'body' ? { op: 'move', id, by } : { op: 'resize', id, which: part, by };
}

// Link kinds as the sheet offers them: finish-to-start, or rolling (start-to-start plus n weeks).
export const LINK_KINDS = [
  { value: 'FS', label: 'after it finishes' },
  { value: 'SS+0', label: 'rolling, same week' },
  { value: 'SS+1', label: 'rolling, 1 week behind' },
  { value: 'SS+2', label: 'rolling, 2 weeks behind' },
];
export const kindOf = (value) => (value === 'FS' ? 'FS' : { lag: Number(/SS\+(\d+)/.exec(value)?.[1] ?? 0) });
const kindValue = (dep) => { const d = parseDep(dep); return d.type === 'FS' ? 'FS' : `SS+${d.lag}`; };

// ---------- the task sheet ----------

// What the sheet shows for one task. The Coordinator hint ("about N weeks at Li's usable hours") is
// hidden from Project Manager up.
export function sheetModel(plan, project, world, id, { rank = 'coordinator' } = {}) {
  const t = project.tasks.find((x) => x.id === id);
  const p = plan.tasks[id];
  const bank = taskBank(project, world).find((b) => b.id === id);
  const owner = personFor(project, world, t.owner);
  const ownerName = owner?.short ?? owner?.name ?? t.owner;
  const name = (x) => project.tasks.find((y) => y.id === x)?.name ?? x;
  const links = (p.deps ?? []).map((d) => ({ from: parseDep(d).id, name: name(parseDep(d).id), kind: kindValue(d), required: t.dependsOn.includes(parseDep(d).id) }));
  const linked = new Set(links.map((l) => l.from));
  const candidates = project.tasks.filter((x) => x.id !== id && !linked.has(x.id)).map((x) => ({ id: x.id, name: x.name }));
  const backups = ['ld', 'mp', 'gd'].filter((r) => r !== t.owner && project.team[r]).map((r) => ({ role: r, name: personFor(project, world, r)?.short ?? r }));
  const [lo, mid, hi] = p.est ?? [0, 0, 0];
  let hint = null;
  if (rank === 'coordinator' && p.est) {
    const week = p.start ?? plan.joinWeek ?? 1;
    const hours = usableHours(plan, project, world, t.owner, week);
    hint = { weeks: Math.max(1, Math.ceil(mid / Math.max(hours, 1e-9))), who: t.owner === 'faculty' ? 'the faculty partner' : ownerName, hours: Math.round(hours * 10) / 10 };
  }
  return {
    id, name: t.name, phase: t.phase, owner: t.owner, ownerName, ownerRole: ROLE[t.owner] ?? t.owner, avatar: owner?.avatar,
    locked: Boolean(p.locked), started: Boolean(bank?.started), placed: p.start != null, start: p.start, end: p.end,
    est: [lo, mid, hi], estOk: lo <= mid && mid <= hi, quote: bank?.quote ?? [lo, mid, hi], quotedBy: bank?.quotedBy ?? ownerName,
    backup: p.backup ?? null, backups, links, candidates, hint, launchWeek: plan.launchWeek, joinWeek: plan.joinWeek ?? 1,
  };
}

// ---------- HTML ----------

export function headerHtml(view, { canUndo = false, canRedo = false } = {}) {
  const { project, plan, passed, blockers: block } = view;
  return `<div class="pe-head card">
    <div class="pe-title"><span class="kicker">Build the plan</span>
      <h2>${esc(project.title)}</h2>
      <p class="small muted">Launch week ${plan.launchWeek}${plan.joinWeek > 1 ? ` · you join in week ${plan.joinWeek}` : ''} · ${project.tasks.length} tasks</p></div>
    <div class="pe-score" aria-label="${passed} of ${CHECKS.length} checks pass"><strong>${passed}/${CHECKS.length}</strong><span class="small muted">checks</span></div>
    <div class="pe-tools">
      <button type="button" data-pe="undo" ${canUndo ? '' : 'disabled'} title="Undo (Ctrl+Z)">Undo</button>
      <button type="button" data-pe="redo" ${canRedo ? '' : 'disabled'} title="Redo (Ctrl+Shift+Z)">Redo</button>
      <button type="button" data-pe="reset">Reset</button>
      <button type="button" data-pe="exit">Back</button>
    </div>
    <button type="button" class="primary pe-submit" data-pe="submit" ${block.length ? 'aria-disabled="true"' : ''}>${block.length ? `Submit · ${block.length} to fix` : 'Submit plan'}</button>
  </div>`;
}

export function timelineHtml(view, { highlight = targetsOf(null), selected = null } = {}) {
  const { lay, plan, project, world } = view;
  const hlTasks = new Set(highlight.tasks);
  const hlWeeks = new Set(highlight.weeks);
  const cells = lay.axis.map((a) => `<i class="${[a.launch && 'launch', a.beforeJoin && 'before', hlWeeks.has(a.week) && 'hl'].filter(Boolean).join(' ')}"></i>`).join('');
  const face = (row, size) => avatarSVG(row.avatar ?? personFor(project, world, row.owner)?.avatar, 'neutral', { size, label: row.ownerName });
  const pct = (x) => `${(x * 100).toFixed(3)}%`;
  const rowHtml = (r) => {
    const m = r.mark.status;
    const why = r.mark.checks.map((c) => `${c.name} ${STATUS_WORD[c.status]}`).join(', ');
    const label = `${r.name}, ${r.ownerName}, weeks ${r.start} to ${r.end}${why ? `. ${why}` : ''}${r.locked ? '. Finished before you joined' : ''}`;
    return `<div class="pe-row${hlTasks.has(r.id) ? ' hl' : ''}${r.locked ? ' locked' : ''}${selected === r.id ? ' selected' : ''}" data-row="${esc(r.id)}">
      <button type="button" class="pe-name" data-pe="open" data-id="${esc(r.id)}">${face(r, 28)}<span><span class="pe-task">${r.locked ? '<span aria-hidden="true">🔒 </span>' : ''}${esc(r.name)}</span><small>${esc(r.ownerName)}${r.backup ? ` · backup ${esc(personFor(project, world, r.backup)?.short ?? r.backup)}` : ''}</small></span></button>
      <div class="pe-track"><div class="pe-cells">${cells}</div>
        <button type="button" class="pe-bar mark-${m}" data-pe="bar" data-id="${esc(r.id)}" style="left:${pct(r.left)};width:${pct(r.width)}" aria-label="${esc(label)}" ${r.locked ? 'data-locked="1"' : ''}>
          ${r.locked ? '' : '<span class="pe-edge start" data-edge="start" aria-hidden="true"></span>'}<span class="pe-bar-text">${m !== 'pass' ? `<b aria-hidden="true">${ICON[m]}</b>` : ''}${r.end - r.start + 1}w</span>${r.locked ? '' : '<span class="pe-edge end" data-edge="end" aria-hidden="true"></span>'}
        </button></div>
    </div>`;
  };
  const weeks = lay.axis.map((a) => `<span class="${a.launch ? 'launch' : ''}${hlWeeks.has(a.week) ? ' hl' : ''}">${a.launch ? `${a.week}<em>launch</em>` : a.week}</span>`).join('');
  const tray = lay.unscheduled.length
    ? `<div class="pe-tray"><h3>Unscheduled (${lay.unscheduled.length})</h3><ul>${lay.unscheduled.map((r) => `<li class="${hlTasks.has(r.id) ? 'hl' : ''}"><button type="button" class="pe-chip-name" data-pe="open" data-id="${esc(r.id)}">${face(r, 22)}<span>${esc(r.name)}</span></button><button type="button" data-pe="place" data-id="${esc(r.id)}" aria-label="Place ${esc(r.name)}">Place</button></li>`).join('')}</ul></div>`
    : `<p class="pe-tray done small muted">Every task has weeks.</p>`;
  return `<section class="pe-timeline card" aria-label="Timeline" style="--weeks:${plan.launchWeek}">
    <div class="pe-scroll" tabindex="-1">
      <div class="pe-grid">
        <div class="pe-row pe-axis" aria-hidden="true"><div class="pe-name">Week</div><div class="pe-track pe-weeks">${weeks}</div></div>
        ${lay.rows.map(rowHtml).join('') || `<p class="pe-empty small muted">Nothing is placed yet. Place tasks from the tray below; each starts as a one-week bar after its latest linked task.</p>`}
      </div>
    </div>
    ${tray}
    <p class="small muted pe-keys">Tap a task to set its weeks, estimate, links and backup. On a computer you can drag a bar, drag its ends, or focus it and use ← → (Shift moves the end).</p>
  </section>`;
}

export function checksHtml(view, { highlight = null } = {}) {
  const { checks, passed, blockers: block, lay, project, world } = view;
  const active = highlight?.key;
  // A long reason (Required links can name a dozen) shows two parts until its check is tapped.
  const reasonOf = (c, open) => {
    const parts = c.reason.split('; ');
    return open || parts.length <= 2 ? c.reason : `${parts.slice(0, 2).join('; ')}; and ${parts.length - 2} more`;
  };
  const rows = checks.map((c) => `<li><button type="button" class="pe-check ${c.status}${active === `check:${c.id}` ? ' active' : ''}" data-pe="check" data-id="${esc(c.id)}" aria-pressed="${active === `check:${c.id}`}">
      <span class="pe-icon" aria-hidden="true">${ICON[c.status]}</span><span><strong>${esc(c.name)}</strong><span class="sr"> ${STATUS_WORD[c.status]}</span><small>${esc(reasonOf(c, active === `check:${c.id}`))}</small></span></button></li>`).join('');
  const strip = (role, r) => {
    const who = personFor(project, world, role);
    const peak = Math.round(r.peak.share * 100);
    return `<div class="pe-load-row"><span class="pe-load-who">${esc(who?.short ?? role)}<small class="${r.peak.level}">${peak}%</small></span>
      <span class="pe-strip" role="img" aria-label="${esc(who?.short ?? role)}: peak ${peak}% of usable hours${r.peak.from ? `, weeks ${r.peak.from} to ${r.peak.to}` : ''}">
        ${r.weeks.map((w) => `<i class="${w.level}" style="height:${Math.min(100, (w.share / 1.3) * 100).toFixed(1)}%" title="Week ${w.week}: ${Math.round(w.share * 100)}%"></i>`).join('')}
        <b class="line85" aria-hidden="true"></b><b class="line100" aria-hidden="true"></b></span></div>`;
  };
  const blockList = block.length
    ? `<h3>Before you can submit (${block.length})</h3><ul class="pe-blockers">${block.map((b, i) => `<li><button type="button" class="${active === `blocker:${i}` ? 'active' : ''}" data-pe="blocker" data-id="${i}">${esc(b.reason)}</button></li>`).join('')}</ul>`
    : `<p class="pe-ready small">Nothing blocks Submit.</p>`;
  return `<section class="pe-checks card" aria-label="Checks">
    <h3>Checks <span class="muted">${passed}/${checks.length}</span></h3>
    <ul class="pe-check-list">${rows}</ul>
    <p class="small muted">Tap a check to light up the tasks and weeks it names. Touchpoints and risks get their own tabs in the next build step.</p>
    <h3>Team load</h3>
    <div class="pe-load">${Object.entries(lay.load).filter(([role]) => project.tasks.some((t) => t.owner === role)).map(([role, r]) => strip(role, r)).join('')}</div>
    <p class="small muted">Planned likely hours as a share of usable hours; lines at 85% and 100%.</p>
    ${blockList}
  </section>`;
}

export function sheetHtml(m, { error = '' } = {}) {
  const step = (which, value) => `<span class="pe-step"><button type="button" data-pe="step" data-which="${which}" data-by="-1" aria-label="${which} week earlier">−</button><output aria-live="polite">${value}</output><button type="button" data-pe="step" data-which="${which}" data-by="1" aria-label="${which} week later">+</button></span>`;
  const windowPart = m.locked
    ? `<p class="small muted">Finished before you joined in week ${m.joinWeek}; it can't be changed.</p>`
    : m.placed
      ? `<div class="pe-window"><label>Start ${step('start', m.start)}</label><label>End ${step('end', m.end)}</label></div>
         <p class="small muted">${m.end - m.start + 1} week${m.end === m.start ? '' : 's'}${m.hint ? ` · about ${m.hint.weeks} week${m.hint.weeks === 1 ? '' : 's'} at ${esc(m.hint.who)}'s usable hours (${m.hint.hours} h a week)` : ''}</p>
         <button type="button" data-pe="unplace" data-id="${esc(m.id)}">Move back to Unscheduled</button>`
      : `<p class="small muted">Not placed yet.${m.hint ? ` About ${m.hint.weeks} week${m.hint.weeks === 1 ? '' : 's'} at ${esc(m.hint.who)}'s usable hours.` : ''}</p><button type="button" class="primary" data-pe="place" data-id="${esc(m.id)}">Place at the earliest week</button>`;
  const est = ['low', 'likely', 'high'].map((k, i) => `<label>${k}<input type="number" min="0" step="1" inputmode="numeric" data-pe-est="${i}" value="${m.est[i]}" ${m.locked ? 'disabled' : ''}></label>`).join('');
  const links = m.links.length
    ? `<ul class="pe-links">${m.links.map((l) => `<li><span>${esc(l.name)}</span>
        <select data-pe-kind="${esc(l.from)}" aria-label="How ${esc(m.name)} waits for ${esc(l.name)}" ${m.locked ? 'disabled' : ''}>${LINK_KINDS.map((k) => `<option value="${k.value}" ${k.value === l.kind ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
        ${m.locked ? '' : `<button type="button" data-pe="unlink" data-from="${esc(l.from)}" aria-label="Remove link from ${esc(l.name)}">✕</button>`}</li>`).join('')}</ul>`
    : `<p class="small muted">Starts without waiting for anything.</p>`;
  const add = m.locked ? '' : `<div class="pe-add-link"><select id="pe-new-from" aria-label="Task to wait for"><option value="">Wait for…</option>${m.candidates.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
      <select id="pe-new-kind" aria-label="Kind of link">${LINK_KINDS.map((k) => `<option value="${k.value}">${k.label}</option>`).join('')}</select>
      <button type="button" data-pe="link">Add link</button></div>`;
  return `<aside class="pe-sheet card" role="dialog" aria-modal="false" aria-labelledby="pe-sheet-h" data-task="${esc(m.id)}">
    <div class="pe-sheet-head">${avatarSVG(m.avatar, 'neutral', { size: 40, label: m.ownerName })}
      <div><h3 id="pe-sheet-h">${esc(m.name)}</h3><p class="small muted">${esc(m.phase)} · owner ${esc(m.ownerName)} (${esc(m.ownerRole)})</p></div>
      <button type="button" class="pe-close" data-pe="close" aria-label="Close">✕</button></div>
    ${error ? `<p class="pe-error" role="alert">${esc(error)}</p>` : ''}
    <h4>Weeks</h4>${windowPart}
    <h4>Estimate (hours)</h4>
    <div class="pe-est">${est}</div>
    <p class="small ${m.estOk ? 'muted' : 'error'}">${m.estOk ? `Quoted by ${esc(m.quotedBy)}: ${m.quote.join(' / ')}` : 'Low ≤ likely ≤ high, or Submit stays blocked.'}</p>
    <h4>Waits for</h4>${links}${add}
    <h4>Backup</h4>
    <select data-pe-backup aria-label="Backup for ${esc(m.name)}" ${m.locked ? 'disabled' : ''}><option value="">No backup</option>${m.backups.map((b) => `<option value="${b.role}" ${m.backup === b.role ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
  </aside>`;
}

export function screenHtml(view, ui = {}) {
  const sheet = ui.sheet ? sheetHtml(sheetModel(view.plan, view.project, view.world, ui.sheet, { rank: ui.rank }), { error: ui.sheetError }) : '';
  return `<div class="pe" data-tab="${ui.tab ?? 'tasks'}">
    ${headerHtml(view, ui)}
    <p class="pe-status small" role="status" aria-live="polite">${esc(ui.status ?? '')}</p>
    <div class="pe-tabs" role="tablist" aria-label="Plan views">
      <button type="button" role="tab" data-pe="tab" data-id="tasks" aria-selected="${(ui.tab ?? 'tasks') === 'tasks'}">Tasks</button>
      <button type="button" role="tab" data-pe="tab" data-id="checks" aria-selected="${ui.tab === 'checks'}">Checks ${view.passed}/${view.checks.length}</button>
    </div>
    <div class="pe-body">
      <div class="pe-main">${timelineHtml(view, ui)}</div>
      <div class="pe-side">${checksHtml(view, ui)}</div>
    </div>
    ${sheet}
  </div>`;
}

// ---------- the screen ----------

// Mount the editor in `root` for one project. Returns { unmount }.
export function mountPlanEditor(root, { project, world, store = null, rank = 'coordinator', onExit = () => {} }) {
  const saved = E.loadDraft(store, project, world);
  let h = E.history(saved ?? emptyPlan(project, world));
  const ui = { tab: 'tasks', sheet: null, sheetError: '', status: saved ? 'Your saved draft is back. Reset starts over.' : '', highlight: targetsOf(null), rank };
  let view = planView(h.present, project, world);

  const draw = (focus) => {
    view = planView(h.present, project, world);
    const scroll = root.querySelector('.pe-scroll')?.scrollLeft ?? 0;
    const sheetScroll = root.querySelector('.pe-sheet')?.scrollTop ?? 0;
    root.innerHTML = screenHtml(view, { ...ui, canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
    const sc = root.querySelector('.pe-scroll');
    if (sc) sc.scrollLeft = scroll;
    const sh = root.querySelector('.pe-sheet');
    if (sh) sh.scrollTop = sheetScroll;
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  };

  const edit = (op, { focus = null, quiet = false } = {}) => {
    try {
      h = E.apply(h, editFor(op, project));
      E.saveDraft(store, project, world, h.present);
      ui.sheetError = '';
      ui.highlight = targetsOf(null);
      if (!quiet) ui.status = '';
    } catch (e) {
      if (!(e instanceof E.PlanEditError)) throw e;
      if (ui.sheet) ui.sheetError = e.message;
      ui.status = e.message;
    }
    draw(focus);
  };

  const highlightItem = (key, item) => {
    if (ui.highlight.key === key) { ui.highlight = targetsOf(null); draw(); return; }
    ui.highlight = { ...targetsOf(item), key };
    const first = ui.highlight.tasks[0];
    const narrow = window.matchMedia?.('(max-width: 860px)').matches;
    if (narrow && first) ui.tab = 'tasks';
    draw();
    if (first) root.querySelector(`[data-row="${CSS.escape(first)}"], .pe-tray li.hl`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const onClick = (e) => {
    const b = e.target.closest('[data-pe]');
    if (!b || !root.contains(b)) return;
    if (b.dataset.pe === 'bar' && drag?.moved) return; // the drag already applied its edit
    const id = b.dataset.id;
    switch (b.dataset.pe) {
      case 'undo': h = E.undo(h); E.saveDraft(store, project, world, h.present); ui.sheetError = ''; return draw();
      case 'redo': h = E.redo(h); E.saveDraft(store, project, world, h.present); ui.sheetError = ''; return draw();
      case 'reset':
        if (!window.confirm('Empty the plan and start over? Undo can bring it back.')) return;
        h = E.apply(h, () => emptyPlan(project, world));
        E.clearDraft(store, project);
        ui.sheet = null; ui.status = 'The plan is empty again.'; return draw();
      case 'exit': return onExit();
      case 'submit':
        ui.status = view.blockers.length
          ? `Fix ${view.blockers.length} thing${view.blockers.length === 1 ? '' : 's'} first: they're listed under Checks.`
          : 'Your plan is ready. Scoring it against the baseline and the debrief are the next build step.';
        if (view.blockers.length) ui.tab = 'checks';
        return draw();
      case 'tab': ui.tab = id; return draw();
      case 'open': case 'bar': ui.sheet = id; ui.sheetError = ''; return draw('.pe-sheet .pe-close');
      case 'close': { const was = ui.sheet; ui.sheet = null; ui.sheetError = ''; return draw(`[data-pe="bar"][data-id="${CSS.escape(was)}"], [data-pe="open"][data-id="${CSS.escape(was)}"]`); }
      case 'place': return edit({ op: 'place', id }, { focus: `[data-pe="bar"][data-id="${CSS.escape(id)}"]` });
      case 'unplace': return edit({ op: 'unplace', id });
      case 'step': {
        const t = h.present.tasks[ui.sheet];
        const by = Number(b.dataset.by);
        const start = b.dataset.which === 'start' ? t.start + by : t.start;
        const end = b.dataset.which === 'end' ? t.end + by : Math.max(t.end, start);
        return edit({ op: 'window', id: ui.sheet, start, end }, { focus: `[data-pe="step"][data-which="${b.dataset.which}"][data-by="${b.dataset.by}"]` });
      }
      case 'unlink': return edit({ op: 'unlink', from: b.dataset.from, to: ui.sheet });
      case 'link': {
        const from = root.querySelector('#pe-new-from')?.value;
        if (!from) { ui.sheetError = 'Pick a task to wait for.'; return draw(); }
        return edit({ op: 'link', from, to: ui.sheet, kind: kindOf(root.querySelector('#pe-new-kind')?.value ?? 'FS') });
      }
      case 'check': return highlightItem(`check:${id}`, view.checks.find((c) => c.id === id));
      case 'blocker': return highlightItem(`blocker:${id}`, view.blockers[Number(id)]);
      default:
    }
  };

  const onChange = (e) => {
    const el = e.target;
    if (el.matches('[data-pe-est]')) {
      const vals = [...root.querySelectorAll('[data-pe-est]')].map((x) => Number(x.value));
      return edit({ op: 'estimate', id: ui.sheet, est: vals }, { focus: `[data-pe-est="${el.dataset.peEst}"]` });
    }
    if (el.matches('[data-pe-backup]')) return edit({ op: 'backup', id: ui.sheet, role: el.value || null }, { focus: '[data-pe-backup]' });
    if (el.matches('[data-pe-kind]')) return edit({ op: 'retype', from: el.dataset.peKind, to: ui.sheet, kind: kindOf(el.value) }, { focus: `[data-pe-kind="${CSS.escape(el.dataset.peKind)}"]` });
  };

  const onKey = (e) => {
    const inField = e.target.closest('input, select, textarea');
    if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      h = e.shiftKey ? E.redo(h) : E.undo(h);
      E.saveDraft(store, project, world, h.present);
      return draw();
    }
    if (e.key === 'Escape' && ui.sheet) { e.preventDefault(); const was = ui.sheet; ui.sheet = null; return draw(`[data-pe="bar"][data-id="${CSS.escape(was)}"]`); }
    const bar = e.target.closest('[data-pe="bar"]');
    if (!bar || bar.dataset.locked) return;
    const op = keyOp(e.key, { shift: e.shiftKey }, bar.dataset.id);
    if (!op) return;
    e.preventDefault();
    edit(op, { focus: `[data-pe="bar"][data-id="${CSS.escape(bar.dataset.id)}"]` });
  };

  // Dragging on a computer: the body moves the window, the ends resize it, snapping to weeks.
  // Touch keeps the page scrolling and edits through the sheet.
  let drag = null;
  const onDown = (e) => {
    const bar = e.target.closest('[data-pe="bar"]');
    if (!bar || bar.dataset.locked || e.pointerType === 'touch' || e.button !== 0) { drag = null; return; }
    const track = bar.parentElement;
    drag = { bar, id: bar.dataset.id, part: e.target.dataset.edge ?? 'body', x: e.clientX, weekPx: track.getBoundingClientRect().width / h.present.launchWeek, left: bar.offsetLeft, width: bar.offsetWidth, moved: false };
    bar.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (!drag.moved) return;
    const snap = Math.round(dx / drag.weekPx) * drag.weekPx;
    const s = drag.bar.style;
    if (drag.part === 'body') s.left = `${drag.left + snap}px`;
    else if (drag.part === 'start') { s.left = `${drag.left + snap}px`; s.width = `${Math.max(drag.weekPx, drag.width - snap)}px`; }
    else s.width = `${Math.max(drag.weekPx, drag.width + snap)}px`;
    drag.bar.classList.add('dragging');
  };
  const onUp = (e) => {
    if (!drag) return;
    const d = drag;
    if (d.moved) {
      const op = dragOp(d.id, d.part, e.clientX - d.x, d.weekPx);
      if (op) edit(op, { focus: `[data-pe="bar"][data-id="${CSS.escape(d.id)}"]` });
      else draw();
      setTimeout(() => { drag = null; }, 0); // swallow the click that follows the drag
    } else drag = null;
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  draw();
  return {
    get plan() { return h.present; },
    unmount() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.innerHTML = '';
    },
  };
}
