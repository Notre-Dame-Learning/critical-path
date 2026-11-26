// Estimate drill screen (a Daily Mission kind for the Estimating track): the task and the owner's quote,
// what similar work took on past courses, three numbers from the player, then the 60 futures with the
// range laid over them. Engine: engine/estimate.js. Design: "Daily Mission" tab of the framework doc.
// The HTML builders are pure (esc and avatarSVG passed in), so they can be tested in Node.
import * as E from '../engine/estimate.js';
import { TRACK_LABEL, TRACKS } from '../engine/tracks.js';

const h = (x) => `${Math.round(x * 10) / 10} h`;
const RANGE_LABEL = ['Best case', 'Most likely', 'Worst case'];
export const VERDICT = (credit) => credit >= 0.9 ? ['best', 'Well judged'] : credit >= 0.6 ? ['ok', 'Close'] : credit >= 0.3 ? ['partial', 'Partly right'] : ['poor', 'Off the mark'];

const top = (pick, brief, esc, sub = '') => `<div class="ms-top"><div><span class="kicker">${pick.practice ? 'Practice' : 'Daily mission'} · ${esc(TRACK_LABEL.estimating)} · Estimate drill</span>
  <h2>${esc(pick.title ?? 'Estimate drill')}</h2><p class="small muted">${esc(pick.reason)}.${pick.practice ? ' Practice earns no XP.' : ''}${sub}</p></div>
  <button type="button" data-ms="exit">Back to your desk</button></div>`;

export const loadingHtml = (text, detail = '') => `<div class="mission"><div class="ms-forward" role="status">
  <div class="pd-progress cq-indeterminate" role="progressbar" aria-label="${text}"><i></i></div>
  <p><strong>${text}</strong></p>${detail ? `<p class="small muted">${detail}</p>` : ''}
</div></div>`;

// The evidence table: the same kind of work on past courses, quoted vs taken.
export function historyHtml(brief, esc) {
  if (!brief.history.length) return '';
  return `<div class="es-history"><h3>How similar work went on past courses</h3>
    <table><thead><tr><th scope="col">Course and task</th><th scope="col">Quoted</th><th scope="col">Took</th></tr></thead><tbody>
    ${brief.history.map((r) => `<tr><th scope="row">${esc(r.project)}<span class="small muted">${esc(r.task)}</span></th>
      <td>${esc(r.quotedBy)}: ${r.quote[1]} h <span class="small muted">(${r.quote[0]}–${r.quote[2]})</span></td>
      <td>${Math.round(r.took.p50)} h <span class="small muted">(${Math.round(r.took.p10)}–${Math.round(r.took.p90)})</span></td></tr>`).join('')}
    </tbody></table>
    <p class="small muted">Quoted: likely (best–worst). Took: typical (most runs fell between), over ${E.HISTORY_RUNS} runs of each course ${E.MIX_NOTE}; fixing rework counts.</p></div>`;
}

export function briefHtml(pick, brief, esc, { avatarSVG, ui = {} } = {}) {
  const p = brief.person;
  const t = brief.task;
  const weeks = t.weeks ? `planned for week${t.weeks[0] === t.weeks[1] ? ` ${t.weeks[0]}` : `s ${t.weeks[0]}–${t.weeks[1]}`} of ${brief.launchWeek}` : `launch in week ${brief.launchWeek}`;
  const vals = ui.values ?? ['', '', ''];
  const field = (i) => `<label class="es-field"><span>${RANGE_LABEL[i]}</span><span class="es-input"><input type="number" inputmode="numeric" min="1" max="500" step="1" id="es-v${i}" value="${esc(vals[i])}" aria-label="${RANGE_LABEL[i]}, hours"><span>h</span></span></label>`;
  return `<div class="mission">
    ${top(pick, brief, esc)}
    <div class="event pop">
      <div class="event-head">${p ? avatarSVG(p.avatar, 'neutral', { size: 80, label: p.name }) : ''}<div><div class="kicker">${esc(brief.project)} · ${esc(t.phase)}</div><div class="who">${esc(t.name)}</div>
        <div class="small muted">${esc(p ? `${p.name}, ${p.role}` : '')} · ${esc(weeks)}</div></div></div>
      <p>You ask ${esc(p?.short ?? 'the owner')} how long it will take. “${esc(E.shortName(t.name))}? Best case ${brief.quote[0]} hours, most likely ${brief.quote[1]}, worst case ${brief.quote[2]}.”</p>
    </div>
    ${historyHtml(brief, esc)}
    <div class="es-answer">
      <p class="prompt">How many hours will it really take, rework included?</p>
      <p class="small muted">Aim for a range that catches about 8 in 10 futures, and no wider than it needs to be.</p>
      <div class="es-fields">${[0, 1, 2].map(field).join('')}</div>
      ${ui.error ? `<p class="small error">${esc(ui.error)}</p>` : ''}
      <div class="row"><button type="button" class="primary" id="es-submit">Play it ${E.DRILL_RUNS} times</button></div>
    </div>
  </div>`;
}

// The 60 futures as a histogram of whole hours, your range shaded behind and the owner's quote as a
// dashed bracket above. Bars inside your range are the futures it caught.
export function stripSvg(result, brief, { width = 640, height = 150 } = {}) {
  const [lo, likely, hi] = result.range;
  const [qlo, , qhi] = brief.quote;
  const bins = new Map();
  for (const x of result.actual) { const b = Math.round(x); bins.set(b, (bins.get(b) ?? 0) + 1); }
  const xs = [...bins.keys(), lo, hi, qlo, qhi];
  const min = Math.min(...xs) - 1;
  const max = Math.max(...xs) + 1;
  const padL = 12; const padR = 12; const base = height - 26; const topY = 30;
  const X = (v) => padL + ((v - min) / (max - min)) * (width - padL - padR);
  const bw = Math.max(3, Math.min(22, (X(min + 1) - X(min)) * 0.8));
  const most = Math.max(...bins.values());
  const bars = [...bins.entries()].map(([b, n]) => {
    const inside = b >= lo - 0.5 && b <= hi + 0.5;
    const bh = Math.max(2, (n / most) * (base - topY - 8));
    return `<rect class="${inside ? 'es-in' : 'es-out'}" x="${(X(b) - bw / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"><title>${n} future${n === 1 ? '' : 's'} took about ${b} h</title></rect>`;
  }).join('');
  const step = Math.max(1, Math.ceil((max - min) / 8 / 5) * 5);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${base}" y2="${base + 4}" class="es-axis"/><text x="${X(v)}" y="${base + 16}" text-anchor="middle">${v}</text>`);
  return `<svg class="es-strip" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hours the task took in ${result.actual.length} futures: your range ${lo} to ${hi} hours caught ${result.score.caught}">
    <rect class="es-band" x="${(X(lo) - bw / 2).toFixed(1)}" y="${topY - 4}" width="${Math.max(2, X(hi) - X(lo) + bw).toFixed(1)}" height="${base - topY + 4}" rx="4"/>
    <path class="es-quote" d="M${X(qlo)} ${topY - 4} v-8 H${X(qhi)} v8"/><text class="es-qlabel" x="${(X(qlo) + X(qhi)) / 2}" y="${topY - 16}" text-anchor="middle">${brief.person?.short ?? 'Quote'}'s quote</text>
    ${bars}
    <line class="es-likely" x1="${X(likely)}" x2="${X(likely)}" y1="${topY}" y2="${base}"/>
    <line x1="${padL}" x2="${width - padR}" y1="${base}" y2="${base}" class="es-axis"/>${ticks.join('')}
    <text x="${width - padR}" y="${height - 2}" text-anchor="end" class="es-unit">hours</text>
  </svg>`;
}

// The headline: how many futures the range caught, and whether it was too wide or too narrow.
export function leadLine(result) {
  const s = result.score;
  const [lo, , hi] = result.range;
  const caught = `Your range of ${lo}–${hi} h caught ${s.caught} of ${s.runs} futures`;
  if (s.caught < E.TARGET * s.runs) {
    const under = result.actual.filter((x) => x < lo - 0.5).length;
    return `${caught}. ${under > s.runs - s.caught - under ? `${under} came in under it` : `${s.runs - s.caught - under} ran over it`}.`;
  }
  if (s.widthPart < 1) return `${caught}, but it was ${s.extraHours} h wider than it needed to be.`;
  return `${caught}, and it was no wider than it needed to be.`;
}

export function resultHtml(pick, result, brief, esc, { record = null, avatarSVG, chartWidth = 640 } = {}) {
  const [cls, verdict] = VERDICT(result.credit);
  const s = result.score;
  const p = brief.person;
  const xpRows = record ? TRACKS.filter((t) => (record.gained[t] ?? 0) > 0) : [];
  const xp = pick.practice
    ? '<p class="small muted">Practice: nothing recorded, no XP.</p>'
    : record ? `<div class="xp-panel ms-xp">
        <h2>+${Math.round(record.total)} XP</h2>
        ${xpRows.length ? `<p class="small">${xpRows.map((t) => `${TRACK_LABEL[t]} +${Math.round(record.gained[t])}`).join(' · ')}${record.bonus ? `, including the 10 XP daily bonus` : ''}.</p>` : '<p class="small muted">No new XP: you have already estimated this task as well, so only a better range adds more.</p>'}
        ${record.promotion ? `<p class="promotion">Promoted to <strong>${esc(record.promotion)}</strong>.</p>` : ''}
        ${record.levelUps.length ? `<p>${record.levelUps.map((l) => `${TRACK_LABEL[l.track]} reached L${l.level}`).join(' · ')}</p>` : ''}
        <p class="small">${record.streak}-day streak. A new mission tomorrow.</p>
      </div>` : '';
  const row = (label, [lo, hi], caught) => `<tr><th scope="row">${label}</th><td>${lo}–${hi} h</td><td>${caught} of ${s.runs}</td></tr>`;
  return `<div class="mission">
    ${top(pick, brief, esc)}
    <div class="event">
      <div class="event-head">${p ? avatarSVG(p.avatar, result.credit >= 0.9 ? 'happy' : result.credit >= 0.5 ? 'neutral' : 'worried', { size: 64, label: p.name }) : ''}<div><div class="kicker">${esc(brief.project)}</div><div class="who">${esc(brief.task.name)}</div></div></div>
      <div class="verdict ${cls}"><strong>${esc(verdict)} · ${Math.round(result.credit * 100)}%.</strong> ${esc(leadLine(result))}</div>
    </div>
    <figure class="es-figure">${stripSvg(result, brief, { width: chartWidth, height: chartWidth < 500 ? 170 : 150 })}
      <figcaption class="small muted"><span class="es-key es-key-in"></span> futures your range caught · <span class="es-key es-key-out"></span> futures it missed · <span class="es-key es-key-likely"></span> your most likely · dashed: ${esc(p?.short ?? 'the owner')}'s quote. ${E.DRILL_RUNS} futures ${E.MIX_NOTE}.</figcaption></figure>
    <div class="ms-compare"><table>
      <thead><tr><th></th><th scope="col">Range</th><th scope="col">Caught</th></tr></thead>
      <tbody>
        ${row('Your range', [result.range[0], result.range[2]], s.caught)}
        ${row(`${esc(p?.short ?? 'The owner')}'s quote`, [result.quote.range[0], result.quote.range[2]], result.quote.caught)}
        ${row('A fair range', s.fair, s.fairCaught)}
      </tbody></table>
      <p class="small muted">A fair range runs from the 10th to the 90th percentile of the futures. Your most likely was ${result.range[1]} h; the typical future took ${h(s.p50)}.</p></div>
    ${result.lessons.length ? `<div class="es-why"><h3>Why the work took what it took</h3><ul>${result.lessons.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
    ${xp}
    <div class="lesson"><dl>
      <dt>The idea</dt><dd>${esc(result.debrief.concept)}</dd>
      <dt>Doing it yourself</dt><dd>${esc(result.debrief.independent)}</dd>
      <dt>When to escalate</dt><dd>${esc(result.debrief.escalateWhen)}</dd>
      <dt>Where it's in the SOPs</dt><dd>${esc(result.debrief.sop)}</dd>
      <dt>How it's scored</dt><dd>Full marks for catching ${Math.round(E.TARGET * 100)}% of the futures, times a width score: a range up to a quarter of the typical hours wider than the fair range loses nothing, then marks fall to a quarter. Yours: catch ${Math.round(s.coverPart * 100)}% × width ${Math.round(s.widthPart * 100)}%.</dd>
    </dl></div>
    <div class="row"><button type="button" class="primary" data-ms="exit">Back to your desk</button>${record?.profile ? '<button type="button" id="open-profile">Your profile</button>' : ''}</div>
  </div>`;
}

// Mount the drill in `root`. Same contract as mission-screen's mountMission: onRecord(pick, result, event)
// returns recordResult's value (not called for practice); schedule(fn) runs heavy work after a paint.
export function mountDrill(root, { pick, world, deck, projects, plans = {}, esc, avatarSVG, onRecord = () => null, onExit = () => {}, schedule = (fn) => setTimeout(fn, 30) }) {
  const ctx = { world, deck, projects, plans };
  const ui = { values: ['', '', ''], error: '' };
  let brief = null;
  let done = false;

  const draw = (focus) => {
    root.innerHTML = briefHtml(pick, brief, esc, { avatarSVG, ui });
    [0, 1, 2].forEach((i) => { const el = root.querySelector(`#es-v${i}`); if (el) el.oninput = () => { ui.values[i] = el.value; }; });
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  };

  const submit = () => {
    const range = ui.values.map((v) => (String(v).trim() === '' ? NaN : Number(v)));
    const err = E.checkRange(range);
    if (err) { ui.error = err; draw('#es-v0'); return; }
    root.innerHTML = loadingHtml(`Playing ${brief.project} forward ${E.DRILL_RUNS} times…`, 'Each future is a full run of the project; the task\'s hours, rework included, are counted at launch.');
    schedule(() => {
      if (done) return;
      const result = E.resolveDrill(pick, range, ctx, brief);
      let record = null;
      if (!pick.practice) { try { record = onRecord(pick, result, E.drillEvent(pick)) ?? null; } catch { record = null; } }
      // Draw the chart at the width it gets, so its labels stay readable on a phone.
      const chartWidth = Math.round(Math.max(300, Math.min(640, root.clientWidth || 640)));
      root.innerHTML = resultHtml(pick, result, brief, esc, { record, avatarSVG, chartWidth });
      root.scrollIntoView?.({ block: 'start' });
    });
  };

  const onClick = (e) => {
    if (e.target.closest('[data-ms="exit"]')) { onExit(); return; }
    if (e.target.closest('#es-submit')) submit();
  };
  const onKey = (e) => { if (e.key === 'Enter' && e.target?.id?.startsWith?.('es-v')) { e.preventDefault?.(); submit(); } };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.innerHTML = loadingHtml('Pulling up past courses…');
  schedule(() => {
    if (done) return;
    brief = E.drillBrief(pick, ctx);
    draw('#es-v0');
  });
  return {
    unmount() { done = true; root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); root.innerHTML = ''; },
  };
}
