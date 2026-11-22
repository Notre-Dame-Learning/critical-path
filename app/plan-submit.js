// Plan editor, step 5: Submit, scoring and the debrief. Design: "Plan editor screen" tab (Build flow,
// Debrief) and the "Build the Plan baselines" tab (500 runs of the player's plan and the baseline, the
// 100-point score, the plan beside the baseline, a lesson for each failed check, XP by check).
//
// The stand-in calendar: the touchpoint calendar (the Weeks tab) waits on an open question (v1 slots or
// weekly moves v2). Until the player can plan it, a plan with no calendar at all is played and checked with
// the standard calendar the baselines use, re-fitted to the player's own task weeks, and the baseline's
// director gate. For every baseline's own windows this reproduces its calendar exactly, so the stand-in
// neither helps nor hurts a plan that matches the model plan. The two checks it decides (Quality built in,
// Stakeholders) and the 10 stakeholder points are labelled as the standard calendar's and earn no XP.
// Delete STAND_IN (and the labels go with it) once the Weeks tab ships.
//
// The top half is pure and runs in Node; createSubmitRun takes an injected scheduler like the odds meter.
import { standardTouchpoints, onTimeOdds, scorePlan, workOrder, loadReport, CHECKS } from '../engine/plan.js';
import { CALENDAR_CHECKS, TRACK_LABEL } from '../engine/progression.js';

export const STAND_IN = true;
export const SUBMIT = { runs: 500, slice: 25, seed: 'score' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- the stand-in calendar ----------

export function needsStandIn(plan, baseline) {
  return STAND_IN && Boolean(baseline) && Object.keys(plan.touchpoints ?? {}).length === 0 && plan.gate == null;
}

// The baseline's calendar rules applied to this plan's windows: a working session each week the faculty
// partner has open work (else a check-in), an internal review every third week from week 3 until QA (else a
// Friday summary), the baseline's overtime weeks, and its director gate if that still falls before QA.
export function standInCalendar(plan, project, baseline) {
  const overtime = {};
  for (const [w, slots] of Object.entries(baseline.touchpoints ?? {})) {
    const ot = (slots ?? []).find((s) => s?.startsWith('overtime:'));
    if (ot) overtime[w] = ot.split(':')[1];
  }
  const qa = project.tasks.find((t) => t.isQA);
  const qaStart = plan.tasks[qa?.id]?.start ?? plan.launchWeek;
  if (!qa) return { touchpoints: {}, gate: null };
  const safe = { ...plan, tasks: Object.fromEntries(Object.entries(plan.tasks).map(([id, t]) => [id, t.start == null ? { ...t, start: 99, end: -1 } : t])) };
  if (safe.tasks[qa.id].start === 99) safe.tasks[qa.id] = { ...safe.tasks[qa.id], start: plan.launchWeek };
  const touchpoints = Object.fromEntries(Object.entries(standardTouchpoints(safe, project, { overtime })).map(([w, s]) => [String(w), s]));
  const join = plan.joinWeek ?? 1;
  const gate = baseline.gate != null && baseline.gate >= join && baseline.gate < qaStart ? baseline.gate : Math.max(join, qaStart - 1);
  return { touchpoints, gate };
}

// The plan the checks, the odds and the score read: the player's own, or with the stand-in calendar.
export function effectivePlan(plan, project, baseline) {
  if (!needsStandIn(plan, baseline)) return { plan, standIn: false };
  return { plan: { ...plan, ...standInCalendar(plan, project, baseline) }, standIn: true };
}

// Checks run on the effective plan, with the calendar's two marked.
export function markStandIn(checks, standIn) {
  return standIn ? checks.map((c) => (CALENDAR_CHECKS.includes(c.id) ? { ...c, standIn: true } : c)) : checks;
}

// ---------- the submit run ----------

// The baseline's 500-run odds per project don't change within a session: worked out once.
const baselineCache = new Map();
export const clearBaselineCache = () => baselineCache.clear();

// 500 seeded runs of the player's plan, then (unless cached) of the baseline, in slices between frames,
// then the score. Both use the same seeds, so they meet the same luck.
export function createSubmitRun(ctx, baseline, { onProgress = () => {}, onDone = () => {}, schedule = defaultSchedule, ...opts } = {}) {
  const o = { ...SUBMIT, ...opts };
  let job = null;
  const cancel = () => { if (job?.handle) schedule.cancel(job.handle); job = null; };
  const key = `${ctx.project.id}|${o.runs}|${o.seed}`;
  const step = () => {
    if (!job) return;
    const target = job.phase === 'player' ? job.plan : baseline;
    const n = Math.min(o.slice, o.runs - job.from);
    job.onTime += onTimeOdds(target, ctx, { runs: n, from: job.from, seed: o.seed }).onTime;
    job.from += n;
    if (job.from >= o.runs) {
      if (job.phase === 'player') {
        job.player = job.onTime / o.runs;
        if (baselineCache.has(key)) return finish();
        Object.assign(job, { phase: 'baseline', from: 0, onTime: 0 });
      } else {
        baselineCache.set(key, job.onTime / o.runs);
        return finish();
      }
    }
    onProgress(progressOf(job, o.runs, baselineCache.has(key)));
    job.handle = schedule.frame(step);
    return undefined;
  };
  const finish = () => {
    const { plan, player } = job;
    job = null;
    const score = scorePlan(plan, baseline, ctx, { runs: o.runs, seed: o.seed, playerOdds: player, baselineOdds: baselineCache.get(key) });
    onDone({ ...score, runs: o.runs });
  };
  return {
    start(plan) {
      cancel();
      job = { phase: 'player', plan, from: 0, onTime: 0, player: null, handle: null };
      onProgress(progressOf(job, o.runs, baselineCache.has(key)));
      job.handle = schedule.frame(step);
    },
    stop: cancel,
    running: () => job !== null,
  };
}

function progressOf(job, runs, baseCached) {
  const total = baseCached ? runs : runs * 2;
  const done = job.phase === 'player' ? job.from : runs + job.from;
  return { phase: job.phase, done, total, share: done / total };
}

const defaultSchedule = {
  frame: (fn) => (globalThis.requestAnimationFrame ? { r: requestAnimationFrame(() => fn()) } : { t: setTimeout(fn, 0) }),
  cancel: (h) => { if (h?.t) clearTimeout(h.t); if (h?.r) cancelAnimationFrame(h.r); },
};

// ---------- the debrief ----------

const nameOf = (project, world, role) => (role === 'faculty' ? 'the faculty partner' : world.people.find((p) => p.id === project.team[role])?.short ?? role);
const weeksWord = (n) => plural(Math.abs(n), 'week');

// How the player's window for a task differs from the model plan's, in a few words.
export function windowDiff(mine, model) {
  if (mine.start == null || model.start == null) return '';
  const ds = mine.start - model.start;
  const dl = (mine.end - mine.start) - (model.end - model.start);
  const parts = [];
  if (ds) parts.push(`starts ${weeksWord(ds)} ${ds < 0 ? 'earlier' : 'later'}`);
  if (dl) parts.push(`${weeksWord(dl)} ${dl < 0 ? 'shorter' : 'longer'}`);
  return parts.join(', ');
}

// Everything the debrief draws. `flaws` maps a check id to its flaw file (concept, SOP step, explanation).
export function debriefModel(score, { plan, baseline, project, world, flaws = {}, standIn = false, xp = null }) {
  const checks = markStandIn(score.checks, standIn);
  const pct = (x) => Math.round(x * 100);
  const passed = checks.filter((c) => c.status !== 'fail').length;
  const peak = Object.entries(loadReport(plan, project, world)).sort((a, b) => b[1].peak.share - a[1].peak.share)[0];
  const calendarPts = standIn ? 5 * checks.filter((c) => c.standIn && c.status !== 'fail').length + score.parts.stakeholders : 0;
  const parts = [
    { id: 'odds', label: 'On-time odds', points: score.parts.odds, max: 40, detail: `${pct(score.odds.player)}% of ${score.runs ?? 500} runs on time; the model plan ${pct(score.odds.baseline)}%` },
    { id: 'checks', label: 'Checks', points: score.parts.checks, max: 40, detail: `${passed} of ${checks.length} pass, 5 points each` },
    { id: 'load', label: 'Team load', points: score.parts.load, max: 10, detail: `Peak ${pct(peak[1].peak.share)}% (${nameOf(project, world, peak[0])})${score.parts.load === 10 ? ', at or under 85%' : score.parts.load === 5 ? ', over 85% but under 100%' : ', over 100%'}` },
    { id: 'stakeholders', label: 'Stakeholder plan', points: score.parts.stakeholders, max: 10, detail: standIn ? 'From the standard calendar until you can plan the Weeks tab' : 'Faculty contact every 2 weeks (5) and a director gate before QA (5)', standIn },
  ];
  const rows = workOrder(plan, project).map((t) => {
    const mine = plan.tasks[t.id];
    const model = baseline.tasks[t.id] ?? {};
    return {
      id: t.id, name: t.name, owner: nameOf(project, world, t.owner), locked: Boolean(mine.locked),
      mine: { start: mine.start, end: mine.end }, model: { start: model.start, end: model.end },
      diff: mine.locked ? '' : windowDiff(mine, model),
      flagged: checks.some((c) => c.status === 'fail' && !c.standIn && (c.tasks ?? []).includes(t.id)),
    };
  });
  const lessons = CHECKS.map((def) => checks.find((c) => c.id === def.id))
    .filter((c) => c && c.status === 'fail' && !c.standIn)
    .map((c) => {
      const f = flaws[c.id] ?? {};
      return { id: c.id, name: c.name, status: c.status, reason: c.reason, concept: f.concept ?? '', sop: f.sop_ref ?? '', explanation: f.explanation ?? '', title: f.title ?? '' };
    });
  const xpRows = xp ? Object.entries(xp.gained ?? {}).filter(([, g]) => g > 0).map(([t, g]) => ({ track: t, label: TRACK_LABEL[t] ?? t, xp: g })) : [];
  return {
    project: { id: project.id, title: project.title }, launchWeek: plan.launchWeek, joinWeek: plan.joinWeek ?? 1,
    total: score.total, parts, calendarPts, standIn, rows, lessons,
    odds: { player: pct(score.odds.player), baseline: pct(score.odds.baseline), runs: score.runs ?? 500 },
    changed: rows.filter((r) => r.diff).length,
    xp: xp ? { total: xp.total, rows: xpRows, promotion: xp.promotion, levelUps: xp.levelUps ?? [], repeat: xpRows.length === 0 } : null,
    headline: headlineFor(score, passed, checks.length),
  };
}

function headlineFor(score, passed, n) {
  const gap = Math.round((score.odds.baseline - score.odds.player) * 100);
  if (score.total >= 90) return `A launch-ready plan: ${passed} of ${n} checks pass and it finishes on time as often as the model plan.`;
  if (gap <= 5) return `On time about as often as the model plan, but ${n - passed} check${n - passed === 1 ? '' : 's'} would worry a director.`;
  return `This plan finishes on time ${gap} points less often than the model plan. The lessons below say where the weeks go.`;
}

// ---------- HTML ----------

export function checkingHtml(p) {
  const pct = Math.round((p?.share ?? 0) * 100);
  const what = p?.phase === 'baseline' ? 'Playing the model plan the same 500 times' : 'Playing your plan 500 times, with this project\'s situations';
  return `<section class="pd-checking card" aria-live="polite" aria-busy="true">
    <span class="kicker">Checking your plan</span>
    <h2>${esc(what)}…</h2>
    <div class="pd-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Checking your plan"><i style="width:${pct}%"></i></div>
    <p class="small muted">${p ? `${p.done} of ${p.total} runs` : ''}</p>
    <button type="button" data-pe="cancel-submit">Back to the plan</button>
  </section>`;
}

export function debriefHtml(m) {
  const pctX = (w) => `${(((w - 1) / m.launchWeek) * 100).toFixed(3)}%`;
  const widthX = (a, b) => `${(((b - a + 1) / m.launchWeek) * 100).toFixed(3)}%`;
  const bar = (cls, w, label) => (w.start == null ? '' : `<i class="${cls}" style="left:${pctX(w.start)};width:${widthX(w.start, w.end)}" title="${esc(label)}: weeks ${w.start}–${w.end}"></i>`);
  const parts = m.parts.map((p) => `<li class="pd-part${p.standIn ? ' standin' : ''}">
      <span class="pd-part-head"><strong>${esc(p.label)}</strong><span><b>${fmt(p.points)}</b>/${p.max}</span></span>
      <span class="pd-meter" aria-hidden="true"><i style="width:${((p.points / p.max) * 100).toFixed(1)}%"></i></span>
      <small class="muted">${esc(p.detail)}</small></li>`).join('');
  const rows = m.rows.map((r) => `<div class="pd-row${r.flagged ? ' flagged' : ''}${r.locked ? ' locked' : ''}">
      <span class="pd-name"><span>${r.flagged ? '<b aria-hidden="true">✗ </b>' : ''}${esc(r.name)}</span><small>${esc(r.owner)}${r.diff ? ` · ${esc(r.diff)}` : r.locked ? ' · done before you joined' : ''}</small></span>
      <span class="pd-track" role="img" aria-label="${esc(`${r.name}: yours weeks ${r.mine.start}–${r.mine.end}; model plan weeks ${r.model.start}–${r.model.end}`)}">${bar('ghost', r.model, 'Model plan')}${bar('mine', r.mine, 'Your plan')}</span>
    </div>`).join('');
  const weeks = Array.from({ length: m.launchWeek }, (_, i) => `<span class="${i + 1 === m.launchWeek ? 'launch' : i + 2 === m.launchWeek ? 'pre' : ''}">${i + 1}</span>`).join('');
  const lessons = m.lessons.length
    ? m.lessons.map((l) => `<li class="pd-lesson ${l.status}">
        <h4><span class="pe-icon" aria-hidden="true">${l.status === 'warn' ? '!' : '✗'}</span>${esc(l.name)}${l.concept ? ` <span class="muted">· ${esc(l.concept)}</span>` : ''}</h4>
        <p class="small"><strong>In your plan:</strong> ${esc(l.reason)}.</p>
        ${l.explanation ? `<p class="small">${esc(l.explanation)}</p>` : ''}
        ${l.sop ? `<p class="small muted">SOP: ${esc(l.sop)}</p>` : ''}</li>`).join('')
    : '<li class="pd-lesson pass"><p class="small">Every check you control passes. Compare your bars with the model plan\'s for what it did differently.</p></li>';
  const xp = !m.xp ? '' : m.xp.repeat
    ? '<p class="small muted">No new XP: this doesn\'t beat your best plan for this project on any track.</p>'
    : `<p class="pd-xp"><strong>+${fmt(m.xp.total)} XP</strong> ${m.xp.rows.map((r) => `<span class="chip ok">${esc(r.label)} +${fmt(r.xp)}</span>`).join(' ')}</p>
       ${m.xp.promotion ? `<p class="small"><strong>Promoted to ${esc(m.xp.promotion)}.</strong></p>` : ''}
       ${m.xp.levelUps.map((u) => `<p class="small">${esc(TRACK_LABEL[u.track] ?? u.track)} reached level ${u.level}.</p>`).join('')}`;
  return `<div class="pd">
    <section class="pd-score card">
      <div class="pd-total"><span class="kicker">Plan score · ${esc(m.project.title)}</span><span class="grade">${m.total}</span><span class="small muted">out of 100</span></div>
      <div class="pd-summary"><p>${esc(m.headline)}</p>
        <div class="pd-odds" role="img" aria-label="${esc(`Your plan on time in ${m.odds.player}% of runs; the model plan in ${m.odds.baseline}%`)}">
          <span><b>${m.odds.player}%</b><small>your plan</small></span><span class="pd-vs muted">vs</span><span><b>${m.odds.baseline}%</b><small>model plan</small></span>
          <small class="muted">on time, ${m.odds.runs} runs each</small></div>
        ${xp}</div>
      <ul class="pd-parts">${parts}</ul>
      ${m.standIn ? `<p class="small muted pd-note">You can't plan the meeting calendar yet, so your plan was played with the standard calendar fitted to your task weeks. ${m.calendarPts} of your points come from it and earn no XP.</p>` : ''}
    </section>
    <section class="pd-lessons card"><h3>What to take from it</h3><ul>${lessons}</ul></section>
    <section class="pd-compare card" style="--weeks:${m.launchWeek}">
      <h3>Your plan beside the model plan</h3>
      <p class="small muted"><span class="pd-key mine"></span> your weeks <span class="pd-key ghost"></span> the model plan's · ${m.changed ? `${plural(m.changed, 'task')} ${m.changed === 1 ? 'differs' : 'differ'}` : 'the same weeks throughout'}</p>
      <div class="pd-rows">
        <div class="pd-row pd-axis" aria-hidden="true"><span class="pd-name">Week</span><span class="pd-track pd-weeks">${weeks}</span></div>
        ${rows}
      </div>
    </section>
    <div class="pd-actions"><button type="button" class="primary" data-pe="debrief-edit">Back to your plan</button><button type="button" data-pe="exit">Done</button></div>
  </div>`;
}

const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
