// Critique the Plan: the review screen (plan editor build order, step 6: the Critique overlay).
// Design: "Plan editor screen" tab (Critique flow, Critique mode on the same screen, Debrief) and the
// "Plan-flaw library" tab (round flow, scoring, play-forward comparison).
//
// Flow: brief card ("a draft from another PM") → the plan read-only, with a Flag action on every task,
// link, calendar row, gate, risk and person → verdict (Approve / Send back) → scorecard → the plan as
// written and the plan with your fixes, each played 500 times → what each flaw was and what it cost.
// No checks show while reviewing: live checks would give the answer away.
//
// Flags: { target, category, severity, fix: { id, text, grade } }. A person is flagged as `person:<role>`
// and scored as `backup:<role>` for "one person with no backup", else `load:<role>`. Fix options are the
// three engine/critique.js fixOptions for the category the player picked (never the planted flaw's), so
// the choices give nothing away. Standard mode only: written fixes graded by Claude come later.
//
// The top half is pure and runs in Node; mountCritique() is the only part that touches the page.
import * as C from '../engine/critique.js';
import { parseDep, workOrder } from '../engine/plan.js';
import { loadStrip } from './plan-layout.js';
import { avatarSVG } from './avatars.js';
import { TRACK_LABEL } from '../engine/progression.js';

export const FORWARD = { runs: 500, slice: 25, seed: 'forward' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const SEV_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
const SLOT_LABEL = {
  'working-session': 'Working session', 'faculty-update': 'Friday summary', checkin: 'Team check-in', 'qa-review': 'Internal review',
};
export const CALENDAR_TARGETS = [
  { target: 'touchpoints:qa-review', label: 'The internal reviews' },
  { target: 'touchpoints:faculty-contact', label: 'Contact with the faculty partner' },
  { target: 'gate', label: 'The director gate' },
];

// ---------- rounds ----------

// The sample rounds the start screen offers, easiest first, with the one for your rank marked.
const RANK_ORDER = ['Coordinator', 'PM', 'Senior PM'];
const RANK_OF = { coordinator: 'Coordinator', pm: 'PM', senior: 'Senior PM', program: 'Senior PM', director: 'Senior PM' };
export function roundChoices(samples, rankId = 'coordinator') {
  const mine = RANK_OF[rankId] ?? 'Coordinator';
  return [...(samples?.rounds ?? [])]
    .sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank))
    .map((r) => ({ id: r.id, rank: r.rank, project: r.project, flaws: r.flaws.length, yours: r.rank === mine }));
}

export const flawsById = (flawFiles) => Object.fromEntries(Object.values(flawFiles ?? {}).map((f) => [f.id, f]));

// ---------- names ----------

export function personFor(project, world, role) {
  return role === 'faculty' ? world.faculty.find((f) => f.id === project.team.faculty) : world.people.find((p) => p.id === project.team[role]);
}
const shortOf = (project, world, role) => (role === 'faculty' ? 'the faculty partner' : personFor(project, world, role)?.short ?? role);
const taskName = (project, id) => project.tasks.find((t) => t.id === id)?.name ?? id;

// What a flag points at, in words.
export function targetLabel(target, project, world) {
  const [kind, rest] = target.includes(':') ? [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)] : [target, ''];
  switch (kind) {
    case 'link': { const [from, to] = rest.split('>'); return `${taskName(project, to)} waits for ${taskName(project, from)}`; }
    case 'risk': return `Risk: ${rest}`;
    case 'person': case 'load': case 'backup': { const p = personFor(project, world, rest); return rest === 'faculty' ? 'The faculty partner' : p?.short ?? rest; }
    case 'gate': return 'The director gate';
    case 'touchpoints': return CALENDAR_TARGETS.find((c) => c.target === target)?.label ?? target;
    default: return taskName(project, target);
  }
}

// The target the scorer reads: a person flagged for "no backup" is their backup; anything else on a
// person is their load.
export function resolveTarget(target, category) {
  if (!target.startsWith('person:')) return target;
  const role = target.slice('person:'.length);
  return category === 'single_point_of_failure' ? `backup:${role}` : `load:${role}`;
}

// ---------- flags ----------

// The three fix options for a flag: those of the category the player picked, seeded by round and target.
export function fixChoices(roundId, target, category, flawFiles) {
  const all = Object.values(flawFiles ?? {});
  const flaw = all.find((f) => f.category === category);
  if (!flaw) return [];
  return C.fixOptions(flaw, all, `${roundId}:${target}`);
}

// One flag per target: saving a flag on a target already flagged replaces it.
export function setFlag(flags, flag) {
  const i = flags.findIndex((f) => f.target === flag.target);
  return i < 0 ? [...flags, flag] : flags.map((f, j) => (j === i ? flag : f));
}
export const removeFlag = (flags, target) => flags.filter((f) => f.target !== target);

// What a flag still needs before it can be saved.
export function flagMissing(flag) {
  return [!flag.category && 'what is wrong', !flag.severity && 'how serious it is', !flag.fix && 'a fix'].filter(Boolean);
}

// The submission engine/critique.js scores.
export function submissionOf(flags, verdict) {
  return { verdict, flags: flags.map((f) => ({ target: resolveTarget(f.target, f.category), category: f.category, severity: f.severity, fix: f.fix?.grade ?? 'none' })) };
}

// Which tasks carry a flag marker: the task itself, or a link into it.
export function flaggedTasks(flags) {
  const out = new Set();
  for (const f of flags) {
    if (f.target.startsWith('link:')) out.add(f.target.split('>')[1]);
    else if (!f.target.includes(':') && f.target !== 'gate') out.add(f.target);
  }
  return out;
}

// ---------- the review screen model ----------

export function reviewModel(round, project, world) {
  const plan = round.plan;
  const order = workOrder(plan, project);
  const rows = order.map((t) => {
    const p = plan.tasks[t.id];
    const who = personFor(project, world, t.owner);
    return {
      id: t.id, name: t.name, phase: t.phase, owner: t.owner, ownerName: who?.short ?? who?.name ?? t.owner, avatar: who?.avatar,
      start: p.start, end: p.end, est: p.est, backup: p.backup ? shortOf(project, world, p.backup) : null, locked: Boolean(p.locked),
      links: (p.deps ?? []).map((d) => { const dep = parseDep(d); return { target: `link:${dep.id}>${t.id}`, from: dep.id, name: taskName(project, dep.id), kind: dep.type === 'FS' ? 'after it finishes' : `rolling, ${dep.lag ? `${dep.lag} week${dep.lag === 1 ? '' : 's'} behind` : 'same week'}` }; }),
      left: (p.start - 1) / plan.launchWeek, width: (p.end - p.start + 1) / plan.launchWeek,
    };
  });
  const weeks = [];
  for (let w = plan.joinWeek ?? 1; w <= plan.launchWeek; w++) {
    const slots = (plan.touchpoints?.[w] ?? plan.touchpoints?.[String(w)] ?? [null, null]).map((s) => {
      if (!s) return 'Nothing planned';
      if (s.startsWith('overtime:')) return `Overtime: ${shortOf(project, world, s.split(':')[1])}`;
      return SLOT_LABEL[s] ?? s;
    });
    weeks.push({ week: w, slots, gate: plan.gate === w, launch: w === plan.launchWeek });
  }
  const load = loadStrip(plan, project, world);
  const people = Object.entries(load).filter(([role]) => project.tasks.some((t) => t.owner === role)).map(([role, r]) => ({
    role, target: `person:${role}`, name: role === 'faculty' ? 'Faculty partner' : shortOf(project, world, role), avatar: personFor(project, world, role)?.avatar,
    peak: Math.round(r.peak.share * 100), level: r.peak.level, weeks: r.weeks, from: r.peak.from, to: r.peak.to,
    owns: project.tasks.filter((t) => t.owner === role).length, backs: Object.values(plan.tasks).filter((x) => x.backup === role).length,
  }));
  const risks = (plan.risks ?? []).map((r) => ({ ...r, target: `risk:${r.id}` }));
  return { project, plan, rows, weeks, gate: plan.gate ?? null, people, risks, launchWeek: plan.launchWeek };
}

// ---------- HTML: brief, review, flag sheet ----------

export function briefHtml(round, project, world) {
  const sup = world.supervisor ?? null;
  return `<section class="cq-brief card">
    <span class="kicker">Critique the plan · ${esc(round.rank)} round</span>
    <h2>A draft from another PM: ${esc(project.title)}</h2>
    <p>${sup ? `${esc(sup.short ?? sup.name)} wants a second pair of eyes` : 'Your supervisor wants a second pair of eyes'} on this plan before it goes to the faculty partner. Launch is week ${round.plan.launchWeek}.</p>
    <ul class="how">
      <li>Read the timeline, the meeting calendar, the risks and the team's load. Nothing is graded while you look.</li>
      <li>When something is wrong, <strong>Flag</strong> it: say what's wrong, how serious it is, and pick a fix.</li>
      <li>Plans usually have two to four real problems. Some things look odd and are fine; a flag on those costs 3 points.</li>
      <li>Finish with a verdict: <strong>Approve</strong>, or <strong>Send back</strong> if anything is medium or high.</li>
    </ul>
    <p class="small muted">Then both versions are played 500 times: the plan as written, and the plan with your fixes.</p>
    <div class="pd-actions"><button type="button" class="primary" data-cq="start">Start reviewing</button><button type="button" data-cq="exit">Back</button></div>
  </section>`;
}

const flagBtn = (target, flags, label = 'Flag') => {
  const on = flags.some((f) => f.target === target);
  return `<button type="button" class="cq-flag-btn${on ? ' on' : ''}" data-cq="flag" data-target="${esc(target)}" aria-label="${esc(on ? `Edit flag: ${label}` : `Flag: ${label}`)}">${on ? '⚑ Flagged' : '⚐ Flag'}</button>`;
};

export function reviewHtml(m, ui = {}) {
  const flags = ui.flags ?? [];
  const tab = ui.tab ?? 'tasks';
  const marked = flaggedTasks(flags);
  const pct = (x) => `${(x * 100).toFixed(3)}%`;
  const axis = Array.from({ length: m.launchWeek }, (_, i) => i + 1);
  const cells = axis.map((w) => `<i class="${w === m.launchWeek ? 'launch' : ''}${w < (m.plan.joinWeek ?? 1) ? ' before' : ''}"></i>`).join('');
  const rows = m.rows.map((r) => `<div class="pe-row${marked.has(r.id) ? ' cq-marked' : ''}${ui.sheet?.task === r.id ? ' selected' : ''}" data-row="${esc(r.id)}">
      <button type="button" class="pe-name" data-cq="open" data-id="${esc(r.id)}">${avatarSVG(r.avatar, 'neutral', { size: 28, label: r.ownerName })}<span><span class="pe-task">${marked.has(r.id) ? '<b class="cq-mark" aria-label="flagged">⚑ </b>' : ''}${esc(r.name)}</span><small>${esc(r.ownerName)}${r.backup ? ` · backup ${esc(r.backup)}` : ''}</small></span></button>
      <div class="pe-track"><div class="pe-cells">${cells}</div>
        <button type="button" class="pe-bar cq-bar" data-cq="open" data-id="${esc(r.id)}" style="left:${pct(r.left)};width:${pct(r.width)}" aria-label="${esc(`${r.name}, ${r.ownerName}, weeks ${r.start} to ${r.end}`)}"><span class="pe-bar-text">${r.end - r.start + 1}w</span></button></div>
    </div>`).join('');
  const weekHead = axis.map((w) => `<span class="${w === m.launchWeek ? 'launch' : ''}">${w === m.launchWeek ? `${w}<em>launch</em>` : w}</span>`).join('');
  const timeline = `<section class="pe-timeline card cq-pane" data-pane="tasks" aria-label="Timeline" style="--weeks:${m.launchWeek}">
    <div class="pe-scroll" tabindex="-1"><div class="pe-grid">
      <div class="pe-row pe-axis" aria-hidden="true"><div class="pe-name">Week</div><div class="pe-track pe-weeks">${weekHead}</div></div>
      ${rows}</div></div>
    <p class="small muted pe-keys">Tap a task to see its estimate, what it waits for and its backup, and to flag it or one of its links.</p>
  </section>`;
  const calendar = `<section class="card cq-pane cq-calendar" data-pane="calendar" aria-label="Meeting calendar">
    <h3>Meetings and reviews</h3>
    <p class="small muted">Two Action Points a week, planned in advance. The director gate is the director's sign-off before QA.</p>
    <ul class="cq-cal-flags">${CALENDAR_TARGETS.map((c) => `<li><span>${esc(c.label)}${c.target === 'gate' ? `: ${m.gate ? `week ${m.gate}` : '<strong>none planned</strong>'}` : ''}</span>${flagBtn(c.target, flags, c.label)}</li>`).join('')}</ul>
    <table class="cq-cal"><thead><tr><th scope="col">Week</th><th scope="col">First slot</th><th scope="col">Second slot</th></tr></thead>
      <tbody>${m.weeks.map((w) => `<tr class="${w.launch ? 'cq-launch' : ''}${w.gate ? ' cq-gate' : ''}"><th scope="row">${w.week}${w.gate ? ' <span class="chip ok">gate</span>' : ''}${w.launch ? ' <span class="chip partial">launch</span>' : ''}</th>${w.slots.map((s) => `<td class="${s === 'Nothing planned' ? 'muted' : ''}">${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </section>`;
  const risks = `<section class="card cq-pane cq-risks" data-pane="risks" aria-label="Risk register">
    <h3>Risk register</h3>
    <ul class="pe-risk-list">${m.risks.map((r) => `<li class="pe-risk card"><div class="cq-risk-head"><strong>${esc(r.text)}</strong>${flagBtn(r.target, flags, r.text)}</div>
      <dl class="cq-risk-fields">${['owner', 'mitigation', 'trigger', 'contingency'].map((k) => `<div><dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd class="${String(r[k] ?? '').trim() ? '' : 'muted'}">${esc(String(r[k] ?? '').trim() || '—')}</dd></div>`).join('')}</dl></li>`).join('') || '<li class="small muted">No risks listed.</li>'}</ul>
  </section>`;
  const team = `<section class="card cq-pane cq-team" data-pane="team" aria-label="Team load">
    <h3>Team</h3>
    <p class="small muted">Planned likely hours as a share of each person's usable hours; lines at 85% and 100%. Flag a person who is overloaded or has no backup.</p>
    <div class="pe-load">${m.people.map((p) => `<div class="cq-person">
      <span class="pe-load-who">${esc(p.name)}<small class="${p.level}">${p.peak}%</small></span>
      <span class="pe-strip" role="img" aria-label="${esc(`${p.name}: peak ${p.peak}% of usable hours${p.from ? `, weeks ${p.from} to ${p.to}` : ''}`)}">${p.weeks.map((w) => `<i class="${w.level}" style="height:${Math.min(100, (w.share / 1.3) * 100).toFixed(1)}%" title="Week ${w.week}: ${Math.round(w.share * 100)}%"></i>`).join('')}<b class="line85" aria-hidden="true"></b><b class="line100" aria-hidden="true"></b></span>
      <small class="muted cq-owns">Owns ${plural(p.owns, 'task')}${p.role !== 'faculty' ? ` · backup on ${p.backs}` : ''}</small>
      ${flagBtn(p.target, flags, p.name)}</div>`).join('')}</div>
  </section>`;
  const flagList = flags.length
    ? `<ul class="cq-flag-list">${flags.map((f) => `<li><button type="button" data-cq="flag" data-target="${esc(f.target)}"><strong>⚑ ${esc(targetLabel(f.target, m.project, ui.world ?? { people: [], faculty: [] }))}</strong>
        <small>${esc(C.CATEGORY_LABEL[f.category] ?? f.category)} · ${esc(SEV_LABEL[f.severity] ?? f.severity)}</small><small class="muted">Fix: ${esc(f.fix?.text ?? '—')}</small></button></li>`).join('')}</ul>`
    : '<p class="small muted">No flags yet. Flag anything that would hurt this plan.</p>';
  const confirm = ui.confirm ? `<div class="cq-confirm" role="alertdialog" aria-labelledby="cq-confirm-h">
      <p id="cq-confirm-h"><strong>${ui.confirm === 'approve' ? 'Approve' : 'Send back'} this plan with ${plural(flags.length, 'flag')}?</strong> This ends the review.</p>
      <div class="pd-actions"><button type="button" class="primary" data-cq="verdict-yes">${ui.confirm === 'approve' ? 'Yes, approve it' : 'Yes, send it back'}</button><button type="button" data-cq="verdict-no">Keep reviewing</button></div></div>` : '';
  const tabs = [['tasks', 'Tasks'], ['calendar', 'Calendar'], ['risks', 'Risks'], ['team', 'Team'], ['flags', `Flags ${flags.length}`]];
  return `<div class="pe cq" data-tab="${tab}">
    <div class="pe-head card cq-head">
      <div class="pe-title"><span class="kicker">Critique the plan · ${esc(ui.rank ?? '')} round</span><h2>${esc(m.project.title)}</h2>
        <p class="small muted">A draft from another PM · launch week ${m.launchWeek} · ${m.rows.length} tasks</p></div>
      <div class="pe-score" aria-label="${plural(flags.length, 'flag')}"><strong>${flags.length}</strong><span class="small muted">${flags.length === 1 ? 'flag' : 'flags'}</span></div>
      <div class="pe-tools"><button type="button" data-cq="exit">Back</button></div>
      <div class="cq-verdict"><button type="button" data-cq="verdict" data-id="approve">Approve</button><button type="button" class="primary" data-cq="verdict" data-id="send_back">Send back</button></div>
    </div>
    ${confirm}
    <p class="pe-status small" role="status" aria-live="polite">${esc(ui.status ?? '')}</p>
    <div class="pe-tabs cq-tabs" role="tablist" aria-label="Plan views">${tabs.map(([id, label]) => `<button type="button" role="tab" data-cq="tab" data-id="${id}" aria-selected="${tab === id}">${esc(label)}</button>`).join('')}</div>
    <div class="pe-body">
      <div class="pe-main">${timeline}${calendar}${risks}${team}</div>
      <div class="pe-side"><section class="card cq-flags" aria-label="Your flags"><h3>Your flags <span class="muted">${flags.length}</span></h3>${flagList}</section></div>
    </div>
    ${ui.sheet ? sheetHtml(m, ui) : ''}
  </div>`;
}

// The sheet: a task's details (with Flag on the task and each link), or the Flag form for one target.
export function sheetHtml(m, ui) {
  const s = ui.sheet;
  const close = '<button type="button" class="pe-close" data-cq="close" aria-label="Close">✕</button>';
  if (s.task) {
    const r = m.rows.find((x) => x.id === s.task);
    return `<aside class="pe-sheet card" role="dialog" aria-modal="false" aria-labelledby="cq-sheet-h">
      <div class="pe-sheet-head">${avatarSVG(r.avatar, 'neutral', { size: 40, label: r.ownerName })}<div><h3 id="cq-sheet-h">${esc(r.name)}</h3><p class="small muted">${esc(r.phase)} · owner ${esc(r.ownerName)}</p></div>${close}</div>
      <h4>Weeks</h4><p>Weeks ${r.start}–${r.end} (${plural(r.end - r.start + 1, 'week')})</p>
      <h4>Estimate (hours)</h4><p>${r.est ? `${r.est[0]} / ${r.est[1]} / ${r.est[2]} (low / likely / high)` : '—'}</p>
      <h4>Waits for</h4>${r.links.length ? `<ul class="pe-links cq-links">${r.links.map((l) => `<li><span>${esc(l.name)} <small class="muted">${esc(l.kind)}</small></span>${flagBtn(l.target, ui.flags ?? [], `${r.name} waits for ${l.name}`)}</li>`).join('')}</ul>` : '<p class="small muted">Starts without waiting for anything.</p>'}
      <h4>Backup</h4><p>${r.backup ? esc(r.backup) : '<span class="muted">No backup</span>'}</p>
      <div class="pd-actions">${flagBtn(r.id, ui.flags ?? [], r.name).replace('⚐ Flag', '⚐ Flag this task')}</div>
    </aside>`;
  }
  const d = s.draft;
  const label = targetLabel(d.target, m.project, ui.world ?? { people: [], faculty: [] });
  const fixes = d.category ? fixChoices(ui.roundId, d.target, d.category, ui.flawFiles) : [];
  const radio = (name, value, text, checked, extra = '') => `<label class="cq-opt"><input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} ${extra}><span>${text}</span></label>`;
  const missing = flagMissing(d);
  const existing = (ui.flags ?? []).some((f) => f.target === d.target);
  return `<aside class="pe-sheet card cq-sheet" role="dialog" aria-modal="false" aria-labelledby="cq-sheet-h">
    <div class="pe-sheet-head"><div><span class="kicker">Flag</span><h3 id="cq-sheet-h">${esc(label)}</h3></div>${close}</div>
    <fieldset><legend>What's wrong?</legend><div class="cq-opts">${Object.entries(C.CATEGORY_LABEL).map(([id, text]) => radio('cq-cat', id, esc(text), d.category === id, 'data-cq-field="category"')).join('')}</div></fieldset>
    <fieldset><legend>How serious?</legend><div class="cq-opts cq-sev">${C.SEVERITIES.map((v) => radio('cq-sev', v, SEV_LABEL[v], d.severity === v, 'data-cq-field="severity"')).join('')}</div></fieldset>
    <fieldset><legend>Your fix</legend>${fixes.length ? `<div class="cq-opts">${fixes.map((f) => radio('cq-fix', f.id, esc(f.text), d.fix?.id === f.id, 'data-cq-field="fix"')).join('')}</div>` : '<p class="small muted">Say what\'s wrong first; the fixes depend on it.</p>'}</fieldset>
    <div class="pd-actions"><button type="button" class="primary" data-cq="save-flag" ${missing.length ? 'aria-disabled="true"' : ''}>${existing ? 'Update flag' : 'Save flag'}</button>
      ${existing ? `<button type="button" data-cq="remove-flag" data-target="${esc(d.target)}">Remove flag</button>` : ''}<button type="button" data-cq="close">Cancel</button></div>
    ${missing.length ? `<p class="small muted">Still to choose: ${esc(missing.join(', '))}.</p>` : ''}
  </aside>`;
}

// ---------- the play-forward run ----------

// Plays the plan as written and the plan with your fixes `runs` times each on the same seeds, in slices
// between frames. With nothing fixed the two plans are the same, so the second half is skipped.
export function createForwardRun(ctx, { written, fixed, same = false }, { onProgress = () => {}, onDone = () => {}, schedule = defaultSchedule, ...opts } = {}) {
  const o = { ...FORWARD, ...opts };
  const plans = same ? [written] : [written, fixed];
  const acc = plans.map(() => ({ onTime: 0, rework: 0 }));
  let job = { i: 0, from: 0, handle: null };
  const total = plans.length * o.runs;
  const step = () => {
    if (!job) return;
    const n = Math.min(o.slice, o.runs - job.from);
    const r = C.forwardStats(plans[job.i], ctx, { runs: n, from: job.from, seed: o.seed });
    acc[job.i].onTime += r.onTime;
    acc[job.i].rework += r.rework;
    job.from += n;
    if (job.from >= o.runs) { job.i += 1; job.from = 0; }
    if (job.i >= plans.length) {
      job = null;
      const out = acc.map((a) => ({ onTime: a.onTime / o.runs, rework: a.rework / o.runs }));
      onDone({ written: out[0], fixed: out[1] ?? out[0], runs: o.runs, same });
      return;
    }
    onProgress({ done: job.i * o.runs + job.from, total, share: (job.i * o.runs + job.from) / total });
    job.handle = schedule.frame(step);
  };
  return {
    start() { onProgress({ done: 0, total, share: 0 }); job.handle = schedule.frame(step); },
    stop() { if (job?.handle) schedule.cancel(job.handle); job = null; },
    running: () => job !== null,
  };
}

const defaultSchedule = {
  frame: (fn) => (globalThis.requestAnimationFrame ? { r: requestAnimationFrame(() => fn()) } : { t: setTimeout(fn, 0) }),
  cancel: (h) => { if (h?.t) clearTimeout(h.t); if (h?.r) cancelAnimationFrame(h.r); },
};

// ---------- the debrief ----------

export function debriefModel(round, result, { flags = [], project, world, flawFiles, baseline, fixed = null, forward = null, xp = null }) {
  const files = flawsById(flawFiles);
  const n = round.flaws.length;
  const sum = (k) => result.flaws.reduce((s, f) => s + f.points[k], 0);
  const parts = [
    { id: 'found', label: 'Found', points: sum('found'), max: 10 * n, detail: `${result.flaws.filter((f) => f.found).length} of ${n} problems flagged in the right place` },
    { id: 'severity', label: 'Severity', points: sum('severity'), max: 3 * n, detail: 'Exact 3, one level off 1' },
    { id: 'fix', label: 'Fixes', points: sum('fix'), max: 7 * n, detail: 'A full fix 7, a partial fix 3' },
    { id: 'verdict', label: 'Verdict', points: result.verdict.points, max: 10, detail: result.verdict.points ? `${result.verdict.expected === 'send_back' ? 'Send back' : 'Approve'} was right` : `This plan should have been ${result.verdict.expected === 'send_back' ? 'sent back' : 'approved'}` },
  ];
  const flagFor = (f) => (f.found ? flags.find((x) => resolveTarget(x.target, x.category) === f.flaggedAt) : null);
  const cards = round.flaws.map((rf) => {
    const r = result.flaws.find((x) => x.id === rf.id);
    const file = files[rf.id] ?? {};
    const flag = flagFor(r);
    return {
      id: rf.id, title: rf.title, found: r.found, total: r.total, points: r.points, severity: rf.severity, track: rf.skill_track,
      where: rf.where, bestFix: rf.bestFix ?? rf.accepted_fixes?.[0], concept: rf.concept ?? file.concept, explanation: rf.explanation ?? file.explanation, sop: file.sop_ref ?? '',
      yours: flag ? { at: targetLabel(flag.target, project, world), category: C.CATEGORY_LABEL[flag.category], rightCategory: r.rightCategory, severity: flag.severity, fix: flag.fix?.text, grade: flag.fix?.grade ?? 'none' } : null,
      fixed: (fixed?.fixed ?? []).includes(rf.id),
    };
  });
  const falsePositives = result.falsePositives.map((fp) => ({ at: targetLabel(flags.find((x) => resolveTarget(x.target, x.category) === fp.target)?.target ?? fp.target, project, world), why: fp.decoyWhy }));
  const pct = (x) => Math.round(x * 100);
  const peakW = C.peakLoad(round.plan, project, world);
  const peakF = fixed ? C.peakLoad(fixed.plan, project, world) : peakW;
  const rows = fixed ? workOrder(round.plan, project).map((t) => {
    const a = round.plan.tasks[t.id]; const b = fixed.plan.tasks[t.id];
    return { id: t.id, name: t.name, written: { start: a.start, end: a.end }, fixed: { start: b.start, end: b.end }, changed: a.start !== b.start || a.end !== b.end || (a.deps ?? []).join() !== (b.deps ?? []).join() || (a.backup ?? null) !== (b.backup ?? null) };
  }) : [];
  const calendarChanged = fixed ? JSON.stringify([round.plan.touchpoints, round.plan.gate, round.plan.risks]) !== JSON.stringify([fixed.plan.touchpoints, fixed.plan.gate, fixed.plan.risks]) : false;
  return {
    roundId: round.id, rank: round.rank, project: { id: project.id, title: project.title }, launchWeek: round.plan.launchWeek,
    score: result.score, parts, fpPoints: result.falsePositivePoints, verdict: result.verdict, cards, falsePositives, repeats: result.repeats.length,
    fixedCount: fixed?.fixed.length ?? 0, n,
    forward: forward ? {
      written: { odds: pct(forward.written.onTime), rework: Math.round(forward.written.rework), peak: pct(peakW.share), peakWho: shortOf(project, world, peakW.role) },
      fixed: { odds: pct(forward.fixed.onTime), rework: Math.round(forward.fixed.rework), peak: pct(peakF.share), peakWho: shortOf(project, world, peakF.role) },
      runs: forward.runs, same: forward.same,
    } : null,
    rows, calendarChanged,
    xp: xp ? { total: xp.total, rows: Object.entries(xp.gained ?? {}).filter(([, g]) => g > 0).map(([t, g]) => ({ label: TRACK_LABEL[t] ?? t, xp: g })), promotion: xp.promotion, passedSenior: xp.passedSenior } : null,
    headline: headlineFor(result, n),
  };
}

function headlineFor(result, n) {
  const found = result.flaws.filter((f) => f.found);
  if (result.score >= 90) return `A sharp review: you found ${found.length === n ? 'every problem' : `${found.length} of ${n} problems`} and called the verdict right.`;
  if (!found.length) return 'Every problem in this plan got past you. The cards below show where each one was.';
  if (found.length < n) return `You found ${found.length} of ${n} problems. The ones you missed are first below.`;
  const lost = [
    found.some((f) => f.points.found < 10) && 'a category',
    found.some((f) => f.points.severity < 3) && 'severity',
    found.some((f) => f.points.fix < 7) && 'a fix',
    result.falsePositives.length && 'flags on things that were fine',
    !result.verdict.points && 'the verdict',
  ].filter(Boolean);
  return `You found all ${n} problems${lost.length ? `; points went on ${lost.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : ''}.`;
}

export function forwardHtml(f, progress = null) {
  if (!f) {
    const pct = Math.round((progress?.share ?? 0) * 100);
    return `<section class="card cq-forward" aria-busy="true"><h3>Played forward</h3>
      <p class="small">Playing the plan as written and the plan with your fixes, 500 times each, with this project's situations…</p>
      <div class="pd-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Playing both plans"><i style="width:${pct}%"></i></div></section>`;
  }
  const col = (label, x, cls) => `<div class="cq-fw ${cls}"><span class="kicker">${label}</span><b>${x.odds}%</b><small>on time</small>
    <dl><div><dt>Rework</dt><dd>${x.rework} h a run</dd></div><div><dt>Peak load</dt><dd>${x.peak}% (${esc(x.peakWho)})</dd></div></dl></div>`;
  const gain = f.fixed.odds - f.written.odds;
  return `<section class="card cq-forward"><h3>Played forward</h3>
    <div class="cq-fw-grid">${col('As written', f.written, 'written')}${f.same ? '' : col('With your fixes', f.fixed, 'fixed')}</div>
    <p class="small">${f.same ? 'None of your fixes repaired a planted problem, so the plan with your fixes plays the same as the plan as written.' : gain > 0 ? `Your fixes win back ${gain} points of on-time odds${f.written.rework > f.fixed.rework ? ` and about ${f.written.rework - f.fixed.rework} hours of rework a run` : ''}.` : 'Your fixes don\'t change the odds much here: what they repair costs little when played forward, but a director would still send it back.'}</p>
    <p class="small muted">${f.runs} runs each on the same seeds. Only a full fix counts as fixed; a partial fix leaves the problem in.</p></section>`;
}

export function debriefHtml(m, { progress = null } = {}) {
  const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const parts = m.parts.map((p) => `<li class="pd-part"><span class="pd-part-head"><strong>${esc(p.label)}</strong><span><b>${fmt(p.points)}</b>/${p.max}</span></span>
    <span class="pd-meter" aria-hidden="true"><i style="width:${((p.points / p.max) * 100).toFixed(1)}%"></i></span><small class="muted">${esc(p.detail)}</small></li>`).join('');
  const grade = { accepted: 'a full fix', partial: 'a partial fix', none: 'not a fix for this' };
  const card = (c) => `<li class="pd-lesson ${c.found ? 'pass' : 'fail'}">
    <h4><span class="pe-icon" aria-hidden="true">${c.found ? '✓' : '✗'}</span><span>${c.found ? 'Found' : 'Missed'}: ${esc(c.title)} <span class="muted">· ${c.total}/20 · ${esc(c.track)}</span></span></h4>
    ${c.where ? `<p class="small"><strong>Where:</strong> ${esc(c.where)}. <strong>Severity:</strong> ${esc(c.severity)}.</p>` : ''}
    ${c.yours ? `<p class="small"><strong>Your flag:</strong> ${esc(c.yours.at)}, ${esc(c.yours.category)}${c.yours.rightCategory ? '' : ' (right place, other category)'}, ${esc(c.yours.severity)}; fix: ${esc(c.yours.fix ?? '—')} (${grade[c.yours.grade]}).</p>` : ''}
    <p class="small"><strong>Best fix:</strong> ${esc(c.bestFix)}.</p>
    ${c.explanation ? `<p class="small">${c.concept ? `<strong>${esc(c.concept)}.</strong> ` : ''}${esc(c.explanation)}</p>` : ''}
    ${c.sop ? `<p class="small muted">SOP: ${esc(c.sop)}</p>` : ''}</li>`;
  const cards = [...m.cards.filter((c) => !c.found), ...m.cards.filter((c) => c.found)].map(card).join('');
  const fps = m.falsePositives.length ? `<h4>Flags on things that were fine (${m.fpPoints} points)</h4><ul class="cq-fps">${m.falsePositives.map((f) => `<li class="small"><strong>${esc(f.at)}:</strong> ${esc(f.why ?? 'no planted problem here')}</li>`).join('')}</ul>` : '';
  const pctX = (w) => `${(((w - 1) / m.launchWeek) * 100).toFixed(3)}%`;
  const widthX = (a, b) => `${(((b - a + 1) / m.launchWeek) * 100).toFixed(3)}%`;
  const bar = (cls, w) => `<i class="${cls}" style="left:${pctX(w.start)};width:${widthX(w.start, w.end)}"></i>`;
  const changed = m.rows.filter((r) => r.changed);
  const compare = !m.rows.length ? '' : !changed.length ? `<section class="pd-compare card"><h3>As written beside your fixes</h3><p class="small muted">Your fixes change no task's weeks, links or backup${m.calendarChanged ? '; they change the calendar, the gate or the risks' : ''}.</p></section>` : `<section class="pd-compare card" style="--weeks:${m.launchWeek}"><h3>As written beside your fixes</h3>
    <p class="small muted"><span class="pd-key mine"></span> with your fixes <span class="pd-key ghost"></span> as written · ${changed.length ? `${plural(changed.length, 'task')} changed` : 'no task weeks, links or backups changed'}${m.calendarChanged ? '; the calendar, gate or risks changed too' : ''}</p>
    <div class="pd-rows">${m.rows.map((r) => `<div class="pd-row${r.changed ? ' cq-changed' : ''}"><span class="pd-name"><span>${r.changed ? '<b aria-hidden="true">↻ </b>' : ''}${esc(r.name)}</span></span>
      <span class="pd-track" role="img" aria-label="${esc(`${r.name}: as written weeks ${r.written.start}–${r.written.end}; with your fixes weeks ${r.fixed.start}–${r.fixed.end}`)}">${bar('ghost', r.written)}${bar('mine', r.fixed)}</span></div>`).join('')}</div></section>`;
  const xp = !m.xp ? '' : m.xp.rows.length
    ? `<p class="pd-xp"><strong>+${fmt(m.xp.total)} XP</strong> ${m.xp.rows.map((r) => `<span class="chip ok">${esc(r.label)} +${fmt(r.xp)}</span>`).join(' ')}</p>${m.xp.promotion ? `<p class="small"><strong>Promoted to ${esc(m.xp.promotion)}.</strong></p>` : ''}`
    : '<p class="small muted">No new XP: this doesn\'t beat your best on this round on any track.</p>';
  return `<div class="pd cq-debrief">
    <section class="pd-score card">
      <div class="pd-total"><span class="kicker">Critique score · ${esc(m.rank)} round</span><span class="grade">${m.score}</span><span class="small muted">out of 100</span></div>
      <div class="pd-summary"><p>${esc(m.headline)}</p>
        <p class="small">Your verdict: <strong>${m.verdict.given === 'approve' ? 'Approve' : 'Send back'}</strong>${m.verdict.points ? ' ✓' : `; it should have been ${m.verdict.expected === 'approve' ? 'approved' : 'sent back'}`}.${m.xp?.passedSenior ? ' This passes a Senior PM round, the Program Manager gate.' : ''}</p>${xp}</div>
      <ul class="pd-parts">${parts}</ul>
      ${m.fpPoints ? `<p class="small muted pd-note">${m.fpPoints} for flags on things that were fine (3 each, at most 9).</p>` : ''}
    </section>
    ${forwardHtml(m.forward, progress)}
    <section class="pd-lessons card"><h3>The problems in this plan</h3><ul>${cards}</ul>${fps}</section>
    ${compare}
    <div class="pd-actions"><button type="button" class="primary" data-cq="again">Review it again</button><button type="button" data-cq="exit">Done</button></div>
  </div>`;
}

// ---------- the screen ----------

// Mount a Critique round in `root`. sample: a round from content/critique-samples.json; flawFiles: the flaw
// files (by check id or flaw id); baseline: the project's model plan; onScored(round, result) records XP
// and returns applyCritiqueRound's result, or null.
export function mountCritique(root, { sample, flawFiles, baseline, project, world, deck = { events: [] }, onExit = () => {}, onScored = () => null, forwardOptions = {} }) {
  const byId = flawsById(flawFiles);
  const round = C.buildRound(sample, byId, baseline, project);
  const model = reviewModel(round, project, world);
  const ctx = { world, project, deck };
  const ui = { mode: 'brief', tab: 'tasks', flags: [], sheet: null, confirm: null, status: '', world, flawFiles, roundId: round.id, rank: round.rank, debrief: null, progress: null };
  let result = null;
  let forwardRun = null;

  const draw = (focus) => {
    if (ui.mode === 'brief') root.innerHTML = briefHtml(round, project, world);
    else if (ui.mode === 'debrief') root.innerHTML = debriefHtml(ui.debrief, { progress: ui.progress });
    else {
      const scroll = root.querySelector('.pe-scroll')?.scrollLeft ?? 0;
      root.innerHTML = reviewHtml(model, ui);
      const sc = root.querySelector('.pe-scroll');
      if (sc) sc.scrollLeft = scroll;
    }
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  };

  const finish = (verdict) => {
    result = C.scoreCritique(round, submissionOf(ui.flags, verdict));
    let xp = null;
    try { xp = onScored(round, result) ?? null; } catch { xp = null; }
    const fixed = C.fixedPlan(round, result, byId, baseline, project);
    const debriefArgs = { flags: ui.flags, project, world, flawFiles, baseline, fixed, xp };
    ui.debrief = debriefModel(round, result, debriefArgs);
    ui.mode = 'debrief';
    ui.sheet = null;
    ui.confirm = null;
    ui.progress = null;
    draw('[data-cq="again"]');
    root.querySelector('.pd-total')?.scrollIntoView?.({ block: 'start' });
    forwardRun = createForwardRun(ctx, { written: round.plan, fixed: fixed.plan, same: fixed.fixed.length === 0 }, {
      ...forwardOptions,
      onProgress: (p) => {
        ui.progress = p;
        const el = root.querySelector('.cq-forward');
        if (el) { const t = document.createElement('template'); t.innerHTML = forwardHtml(null, p).trim(); el.replaceWith(t.content.firstElementChild); }
      },
      onDone: (forward) => {
        ui.debrief = debriefModel(round, result, { ...debriefArgs, forward });
        const el = root.querySelector('.cq-forward');
        if (el) { const t = document.createElement('template'); t.innerHTML = forwardHtml(ui.debrief.forward).trim(); el.replaceWith(t.content.firstElementChild); }
      },
    });
    forwardRun.start();
  };

  const openFlag = (target) => {
    const have = ui.flags.find((f) => f.target === target);
    ui.sheet = { draft: have ? { ...have } : { target, category: null, severity: null, fix: null }, from: ui.sheet?.task ?? null };
    ui.status = '';
    draw('.cq-sheet input:checked, .cq-sheet input[name="cq-cat"]');
  };

  const onClick = (e) => {
    const b = e.target.closest('[data-cq]');
    if (!b || !root.contains(b)) return undefined;
    const id = b.dataset.id;
    switch (b.dataset.cq) {
      case 'start': ui.mode = 'review'; ui.status = ''; draw('[data-cq="tab"][aria-selected="true"]'); window.scrollTo?.(0, 0); return undefined;
      case 'exit': forwardRun?.stop(); return onExit();
      case 'tab': ui.tab = id; return draw(`[data-cq="tab"][data-id="${id}"]`);
      case 'open': ui.sheet = { task: id }; return draw('.pe-sheet .pe-close');
      case 'close': {
        const back = ui.sheet?.from;
        const was = ui.sheet?.task ?? ui.sheet?.draft?.target;
        ui.sheet = back ? { task: back } : null;
        return draw(back ? '.pe-sheet .pe-close' : `[data-cq][data-id="${CSS.escape(was ?? '')}"], [data-cq="flag"][data-target="${CSS.escape(was ?? '')}"]`);
      }
      case 'flag': return openFlag(b.dataset.target);
      case 'save-flag': {
        const d = ui.sheet?.draft;
        if (!d) return undefined;
        const missing = flagMissing(d);
        if (missing.length) { ui.status = `Choose ${missing.join(', ')} first.`; return draw(); }
        ui.flags = setFlag(ui.flags, d);
        ui.status = `Flagged: ${targetLabel(d.target, project, world)}.`;
        ui.sheet = ui.sheet.from ? { task: ui.sheet.from } : null;
        return draw(`[data-cq="flag"][data-target="${CSS.escape(d.target)}"]`);
      }
      case 'remove-flag': {
        ui.flags = removeFlag(ui.flags, b.dataset.target);
        ui.status = 'Flag removed.';
        ui.sheet = ui.sheet?.from ? { task: ui.sheet.from } : null;
        return draw();
      }
      case 'verdict': ui.confirm = id; ui.sheet = null; return draw('[data-cq="verdict-yes"]');
      case 'verdict-no': ui.confirm = null; return draw('[data-cq="verdict"]');
      case 'verdict-yes': return finish(ui.confirm);
      case 'again':
        forwardRun?.stop();
        Object.assign(ui, { mode: 'review', flags: [], sheet: null, confirm: null, status: 'A fresh look: your flags are cleared.', tab: 'tasks', debrief: null, progress: null });
        draw('[data-cq="tab"][aria-selected="true"]');
        window.scrollTo?.(0, 0);
        return undefined;
      default: return undefined;
    }
  };

  const onChange = (e) => {
    const el = e.target;
    const field = el.dataset?.cqField;
    if (!field || !ui.sheet?.draft) return;
    const d = ui.sheet.draft;
    if (field === 'category') { if (d.category !== el.value) { d.category = el.value; d.fix = null; } }
    else if (field === 'severity') d.severity = el.value;
    else if (field === 'fix') {
      const opt = fixChoices(round.id, d.target, d.category, flawFiles).find((f) => f.id === el.value);
      d.fix = opt ? { id: opt.id, text: opt.text, grade: opt.grade } : null;
    }
    const sheet = root.querySelector('.pe-sheet')?.scrollTop ?? 0;
    draw(`.cq-sheet input[name="${el.name}"][value="${CSS.escape(el.value)}"]`);
    const sh = root.querySelector('.pe-sheet');
    if (sh) sh.scrollTop = sheet;
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && ui.sheet) { e.preventDefault(); onClick({ target: root.querySelector('[data-cq="close"]') }); }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey);
  draw('[data-cq="start"]');
  return {
    get mode() { return ui.mode; },
    get flags() { return ui.flags; },
    get result() { return result; },
    get debrief() { return ui.debrief; },
    unmount() {
      forwardRun?.stop();
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
  };
}
