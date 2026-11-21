// Plan editor, step 4: the on-time odds meter. "~86% on time" from a seeded 200-run quick simulation of
// the current plan, so the same plan always shows the same number. It recomputes 400 ms after the last
// edit and runs in slices of 25 between frames, so editing never stalls; while it runs the old number
// dims. If 200 runs would take more than about 1.5 s (a slow phone), it drops to 100 runs and says so.
// The exact 500-run figure is computed only on Submit.
// Design: "Plan editor screen" tab, On-time odds meter. The scheduler is injected so Node tests can step it.
import { onTimeOdds } from '../engine/plan.js';

export const METER = { runs: 200, slowRuns: 100, slice: 25, delay: 400, budgetMs: 1500, seed: 'meter' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only the parts of a plan that playPlan reads: windows, estimates, links and the touchpoint calendar.
// Risks, backups' names in prose and the gate don't move the odds, so editing them never recomputes.
export function oddsKey(plan) {
  const tasks = Object.keys(plan.tasks).sort().map((id) => { const t = plan.tasks[id]; return [id, t.start, t.end, t.est, t.deps]; });
  const tp = Object.keys(plan.touchpoints ?? {}).sort((a, b) => a - b).map((w) => [w, plan.touchpoints[w]]);
  return JSON.stringify([tasks, tp]);
}

// The odds mean something once every task has weeks and the links have no loop.
export function oddsBlocked(blockers) {
  const b = (blockers ?? []).find((x) => x.code === 'unplaced' || x.code === 'loop');
  if (!b) return null;
  return b.code === 'loop' ? 'Untangle the loop to see the odds' : 'Place every task to see the odds';
}

// A meter over one project. request(plan, blockers) after every edit; state() for drawing.
export function createOddsMeter(ctx, { onUpdate = () => {}, schedule = defaultSchedule, now = defaultNow, ...opts } = {}) {
  const o = { ...METER, ...opts };
  const cache = new Map();
  let runs = o.runs;
  let reduced = false;
  let job = null; // { key, plan, from, onTime, startedAt, handle }
  let timer = null;
  let st = { status: 'idle', share: null, runs, reduced, reason: null };

  const set = (patch) => { st = { ...st, ...patch, runs, reduced }; onUpdate(st); };
  const cancel = () => {
    if (timer) { schedule.cancel(timer); timer = null; }
    if (job?.handle) schedule.cancel(job.handle);
    job = null;
  };

  const step = () => {
    if (!job) return;
    const t0 = now();
    const n = Math.min(o.slice, runs - job.from);
    job.onTime += onTimeOdds(job.plan, ctx, { runs: n, from: job.from, seed: o.seed }).onTime;
    job.from += n;
    job.spent += now() - t0;
    // After the first slice, check the budget: a slow device drops to the smaller run count for good.
    if (job.from === n && !reduced && runs > o.slowRuns && (job.spent / n) * runs > o.budgetMs) {
      reduced = true;
      runs = o.slowRuns;
    }
    if (job.from >= runs) {
      const share = job.onTime / runs;
      cache.set(`${runs}|${job.key}`, share);
      job = null;
      set({ status: 'done', share });
      return;
    }
    job.handle = schedule.frame(step);
  };

  return {
    request(plan, blockers) {
      cancel();
      const reason = oddsBlocked(blockers);
      if (reason) { set({ status: 'waiting', reason }); return; }
      const key = oddsKey(plan);
      const hit = cache.get(`${runs}|${key}`);
      if (hit !== undefined) { set({ status: 'done', share: hit, reason: null }); return; }
      set({ status: 'running', reason: null });
      timer = schedule.later(() => {
        timer = null;
        job = { key, plan, from: 0, onTime: 0, spent: 0, handle: null };
        step();
      }, o.delay);
    },
    state: () => st,
    stop: cancel,
  };
}

const defaultNow = () => (globalThis.performance?.now?.() ?? Date.now());
const defaultSchedule = {
  later: (fn, ms) => ({ t: setTimeout(fn, ms) }),
  frame: (fn) => (globalThis.requestAnimationFrame ? { r: requestAnimationFrame(() => fn()) } : { t: setTimeout(fn, 0) }),
  cancel: (h) => { if (h?.t) clearTimeout(h.t); if (h?.r) cancelAnimationFrame(h.r); },
};

// The header's meter: the number, an 8-cell bar, and a word for the state.
export function oddsHtml(st) {
  if (!st || st.status === 'idle') return '<div class="pe-odds" aria-live="polite"></div>';
  if (st.status === 'waiting') {
    return `<div class="pe-odds waiting" aria-live="polite"><span class="pe-odds-num">–</span><span class="small muted">${esc(st.reason)}</span></div>`;
  }
  const pct = st.share == null ? null : Math.round(st.share * 100);
  const running = st.status === 'running';
  const cells = Array.from({ length: 8 }, (_, i) => `<i class="${pct != null && pct >= (i + 1) * 12.5 - 6.25 ? 'on' : ''}"></i>`).join('');
  const level = pct == null ? '' : pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low';
  const label = pct == null ? 'Working out the odds' : `About ${pct}% on time${running ? ', updating' : ''}, from ${st.runs} simulated runs`;
  return `<div class="pe-odds ${level}${running ? ' running' : ''}" aria-live="polite" aria-busy="${running}" aria-label="${esc(label)}" title="${esc(label)}">
    <span class="pe-odds-num">${pct == null ? '…' : `~${pct}%`}</span>
    <span class="pe-odds-bar" aria-hidden="true">${cells}</span>
    <span class="small muted">on time${st.reduced ? ` · ${st.runs} runs` : ''}</span>
  </div>`;
}

// The phone's sticky line: "6/8 checks · ~71% on time".
export function miniHtml(passed, total, st) {
  const pct = st?.status === 'done' || (st?.status === 'running' && st.share != null) ? `~${Math.round(st.share * 100)}% on time` : st?.status === 'waiting' ? String(st.reason ?? '').replace(/^\w/, (c) => c.toLowerCase()) : '';
  return `<div class="pe-mini" aria-hidden="true"><strong>${passed}/${total}</strong> checks${pct ? ` · <span class="${st?.status === 'running' ? 'dim' : ''}">${pct}</span>` : ''}</div>`;
}
