// Daily Mission screen: the desk card, the brief (where the project stands, the situation, your answer),
// the play-forward and the result card with XP and the streak. Design: "Daily Mission" tab of the doc.
// The HTML builders are pure (esc and avatarSVG passed in), so they can be tested in Node.
import * as S from '../engine/sim.js';
import * as M from '../engine/mission.js';
import * as P from '../engine/progression.js';
import { TRACKS, TRACK_LABEL, levelOf } from '../engine/tracks.js';
import { icon } from './icons.js';

export const MISSION_KEY = 'critical-path-mission-v1';
const MIN_ANSWER = 15;
const pct = (x) => `${Math.round(x * 100)}%`;
const VERDICT = (credit) => credit >= 0.95 ? ['best', 'Best move'] : credit >= 0.6 ? ['ok', 'Reasonable, not the best'] : credit >= 0.3 ? ['partial', 'Partly right'] : ['poor', 'This will cost you'];
const UNAVAILABLE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

// The player's local calendar date, so "today" turns over at their midnight.
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- today's pick (kept all day) ----------

let memory = null; // when browser storage is blocked
function readStored(store) {
  try { const raw = store?.getItem(MISSION_KEY); if (raw) return JSON.parse(raw); } catch { /* blocked */ }
  return memory;
}
function writeStored(store, value) {
  memory = value;
  try { store?.setItem(MISSION_KEY, JSON.stringify(value)); } catch { /* blocked: memory only */ }
}

// Today's mission: picked once a day and kept, so recording a result (which changes the profile) or a reload
// never swaps it. The player id is per browser and only seeds the pick.
// ctx = { date, world, deck, projects (unlocked), newId? }
export function todaysPick(store, profile, ctx) {
  const stored = readStored(store) ?? {};
  const playerId = stored.playerId ?? (ctx.newId ?? (() => Math.random().toString(36).slice(2, 10)))();
  if (stored.date === ctx.date && stored.pick && ctx.projects.some((p) => p.id === stored.pick.projectId)) {
    if (!stored.playerId) writeStored(store, { ...stored, playerId });
    return stored.pick;
  }
  const pick = M.pickMission(profile ?? {}, { date: ctx.date, playerId, world: ctx.world, deck: ctx.deck, projects: ctx.projects });
  if (pick) {
    const g = M.setupMission(pick, ctx);
    const ev = ctx.deck.events.find((e) => e.id === pick.eventId);
    pick.title = g ? S.say(g, ev.title) : ev.title;
  }
  writeStored(store, { playerId, date: ctx.date, pick });
  return pick;
}

// Today's recorded mission, if the player has done it.
export const doneToday = (profile, pick) => (profile?.missions ?? []).filter((m) => m.date === pick?.date && m.eventId === pick?.eventId).at(-1) ?? null;

// ---------- the desk card ----------

export function missionCardHtml(profile, pick, esc, { projects, hardOpen = false } = {}) {
  if (!pick) return `<div class="mission-card"><div class="mc-text"><span class="kicker">Daily mission</span><p class="small muted">No mission could be set up today. Try a full project run instead.</p></div></div>`;
  const project = projects.find((p) => p.id === pick.projectId);
  const streak = M.streak(profile?.missions ?? [], pick.date);
  const done = doneToday(profile, pick);
  const streakChip = streak ? `<span class="chip ok">${streak}-day streak</span>` : '';
  if (done) {
    const [cls, verdict] = VERDICT(done.credit);
    return `<div class="mission-card done">${icon('finished', { size: 44, tone: 'teal' })}
      <div class="mc-text"><span class="kicker">Daily mission · done</span>
        <strong>${esc(pick.title ?? 'Today\'s situation')}</strong>
        <span class="small"><span class="chip ${cls}">${esc(verdict)}</span>${streakChip} A new mission tomorrow.</span></div>
      <div class="mc-go"><button type="button" data-mission="practice">Play it again <small>(practice, no XP)</small></button></div>
    </div>`;
  }
  return `<div class="mission-card">${icon('situation', { size: 44, tone: 'gold' })}
    <div class="mc-text"><span class="kicker">Today's mission · ${esc(TRACK_LABEL[pick.track])}</span>
      <strong>One situation, about 10 minutes</strong>
      <span class="small">${esc(pick.reason)}. It comes up in ${esc(project?.title ?? pick.projectId)}, week ${pick.stagedWeek}; then the same future is played with your answer and the best one.</span>
      ${streakChip ? `<span class="small">${streakChip}</span>` : ''}</div>
    <div class="mc-go"><button type="button" class="primary" data-mission="standard">Start today's mission</button>${hardOpen ? '<button type="button" data-mission="hard">Write your answer <small>(Hard, 1.5× XP)</small></button>' : ''}</div>
  </div>`;
}

// ---------- the brief ----------

function personOf(g, role) {
  if (role === 'sup') return g.supervisor;
  return g.team[role];
}

function standingHtml(b, g, esc) {
  const v = b.schedule.variance;
  const label = b.schedule.label;
  const words = label === 'on-track' ? 'On track' : `${Math.abs(v)} week${Math.abs(v) === 1 ? '' : 's'} ${v > 0 ? 'ahead' : 'behind'}`;
  const meter = (name, value) => { const cls = value < 45 ? 'low' : value < 65 ? 'mid' : 'ok'; return `<div class="meter"><span>${esc(name)}</span><div class="bar ${cls}"><i style="width:${Math.round(value)}%"></i></div><span class="val">${Math.round(value)}</span></div>`; };
  return `<div class="ms-standing">
    <div><div class="kicker">${esc(b.project)}</div><div class="status-word ${label}">${esc(words)}</div>
      <div class="small muted">Week ${b.week} of ${b.launchWeek} · ${b.weeksLeft} week${b.weeksLeft === 1 ? '' : 's'} to launch · ${b.schedule.actualPct}% of the work done</div></div>
    <div class="phases">${b.phases.map((p) => `<div class="phase ${p.status}"><div class="phase-bar"><i style="width:${p.pct}%"></i></div><div class="phase-label"><span>${esc(p.phase)}</span><span>${p.pct}%</span></div></div>`).join('')}</div>
    <div class="ms-meters">${Object.entries(b.morale).map(([r, m]) => meter(`${g.team[r].short} · morale`, m)).join('')}${meter(`${g.team.faculty.short} · trust`, b.trust)}</div>
  </div>`;
}

export function briefHtml(pick, g, esc, { avatarSVG, ui = {}, canGrade = false } = {}) {
  const b = M.missionBriefing(g);
  const ev = S.currentEvent(g);
  const who = ev.who ?? 'ld';
  const p = personOf(g, who);
  const head = `<div class="event-head">${avatarSVG(p.avatar, ev.mood ?? 'neutral', { size: 80, label: p.name })}<div><div class="kicker">Situation · ${esc(b.situation.title)}</div><div class="who">${esc(p.name)}</div></div></div>
    <p>${esc(b.situation.text)}</p>`;
  const options = (prompt) => `<p class="prompt">${prompt}</p>
    <div class="choices">${b.choices.map((c, i) => `<button type="button" data-ms-choice="${esc(c.id)}"><span class="letter">${'ABCDEF'[i]}</span><span>${esc(c.label)}</span></button>`).join('')}</div>`;
  let body;
  if (pick.mode !== 'hard') body = options('What do you do?');
  else if (ui.stage === 'pick') {
    body = `<div class="your-answer"><div class="kicker">You wrote</div><p>${esc(ui.text)}</p></div>
      ${ui.error ? `<p class="small muted">${esc(ui.error)}</p>` : ''}${options('Which option is closest to what you wrote?')}`;
  } else {
    const grading = ui.stage === 'grading';
    body = `<label class="prompt" for="ms-answer">What do you do? Write it the way you'd explain it to ${esc(g.supervisor.short)}.</label>
      <textarea id="ms-answer" rows="5" ${grading ? 'disabled' : ''} placeholder="Who do you talk to, what do you propose, and what happens next?">${esc(ui.text ?? '')}</textarea>
      ${ui.error ? `<p class="small error">${esc(ui.error)}</p>` : ''}
      <div class="row">
        <button type="button" class="primary" id="ms-submit" ${grading || (ui.text ?? '').trim().length < MIN_ANSWER ? 'disabled' : ''}>${grading ? 'Grading your answer...' : canGrade ? 'Submit for grading' : 'Submit'}</button>
        ${grading ? '<button type="button" id="ms-stop">Stop</button>' : ''}
        ${ui.allowPick && !grading ? '<button type="button" id="ms-pick">Pick the closest option instead</button>' : ''}
      </div>`;
  }
  return `<div class="mission">
    <div class="ms-top"><div><span class="kicker">${pick.practice ? 'Practice' : 'Daily mission'} · ${esc(TRACK_LABEL[pick.track])}${pick.mode === 'hard' ? ' · Hard' : ''}</span>
      <h2>${esc(b.situation.title)}</h2><p class="small muted">${esc(pick.reason)}.${pick.practice ? ' Practice earns no XP.' : ''}</p></div>
      <button type="button" data-ms="exit">Back to your desk</button></div>
    ${standingHtml(b, g, esc)}
    <div class="event pop">${head}${body}</div>
  </div>`;
}

export const forwardHtml = () => `<div class="mission"><div class="ms-forward" role="status">
  <div class="pd-progress cq-indeterminate" role="progressbar" aria-label="Playing forward"><i></i></div>
  <p><strong>Playing the next weeks forward…</strong></p>
  <p class="small muted">The same random future, once with your answer and once with the best answer: three weeks on, then to launch ${M.ODDS_RUNS} times each.</p>
</div></div>`;

// ---------- grading (hard mode) ----------

// The option a graded written answer plays as: Claude's "closest", or the option nearest its credit.
export function gradedChoice(ev, reply) {
  const credit = Number(reply?.credit);
  if (!Number.isFinite(credit)) throw Object.assign(new Error('The grade had no credit.'), { code: 'invalid_json' });
  const creditOf = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
  const closest = ev.choices.find((c) => c.id === reply?.closest)
    ?? ev.choices.reduce((a, c) => (Math.abs(creditOf(c) - credit) < Math.abs(creditOf(a) - credit) ? c : a));
  return { choiceId: closest.id, credit: Math.max(0, Math.min(1, credit)), feedback: String(reply?.feedback ?? '') };
}

// ---------- recording and the result ----------

// Record a finished mission on the profile (practice records nothing): situation XP on improvement, the
// once-a-day bonus, the streak, plus level-ups and a promotion if the XP brought one.
export function recordResult(profile, pick, result, event) {
  const before = { ...P.newProfile(), ...(profile ?? {}) };
  const rankBefore = P.rankOf(before);
  const levels = Object.fromEntries(TRACKS.map((t) => [t, levelOf(before.xp?.[t] ?? 0)]));
  const { profile: after, gained } = M.recordMission(before, pick, result, event);
  const rankAfter = P.rankOf(after);
  return {
    profile: after, gained: gained.xp, bonus: gained.bonus,
    total: Math.round(Object.values(gained.xp).reduce((s, n) => s + n, 0) * 10) / 10,
    levelUps: TRACKS.filter((t) => levelOf(after.xp[t] ?? 0) > levels[t]).map((t) => ({ track: t, level: levelOf(after.xp[t]) })),
    promotion: rankAfter !== rankBefore ? rankAfter.label : null,
    streak: after.missionStreak,
  };
}

// What the result card says first: launch odds when they moved 10+ points, otherwise the three-week picture.
export function leadLine(result) {
  const { odds, weeks3 } = result;
  if (result.choiceId === result.bestId) return `From here the course launches on time in ${pct(odds.yours)} of ${M.ODDS_RUNS} futures.`;
  if (result.oddsMatter) return `With your answer the course launches on time in ${pct(odds.yours)} of ${M.ODDS_RUNS} futures; with the best answer, ${pct(odds.best)}.`;
  const y = weeks3.yours;
  const b = weeks3.best;
  const parts = [];
  if (Math.abs(y.trust - b.trust) >= 2) parts.push(`faculty trust ${y.trust} vs ${b.trust} with the best answer`);
  if (Math.abs(y.morale - b.morale) >= 2) parts.push(`team morale ${y.morale} vs ${b.morale}`);
  const dr = Math.round(y.rework - b.rework);
  if (Math.abs(dr) >= 1) parts.push(`${Math.abs(dr)} ${dr > 0 ? 'more' : 'fewer'} hours of rework`);
  if (!parts.length) return 'Three weeks on, the two futures look almost the same, and launch odds differ by under 10 points. The lesson is in how it was handled.';
  return `Three weeks on: ${parts.join('; ')}.`;
}

export function resultHtml(pick, result, esc, { written = null, record = null, g, avatarSVG } = {}) {
  const [cls, verdict] = VERDICT(result.credit);
  const best = result.choiceId === result.bestId;
  const ev = S.currentEvent(g) ?? g.deck.find((e) => e.id === result.eventId);
  const p = personOf(g, ev.who ?? 'ld');
  const cols = best ? ['Your answer'] : ['Your answer', 'Best answer'];
  const row = (label, f) => `<tr><th scope="row">${label}</th>${(best ? ['yours'] : ['yours', 'best']).map((k) => `<td>${f(k)}</td>`).join('')}</tr>`;
  const xpRows = record ? TRACKS.filter((t) => (record.gained[t] ?? 0) > 0) : [];
  const xp = pick.practice
    ? '<p class="small muted">Practice: nothing recorded, no XP.</p>'
    : record ? `<div class="xp-panel ms-xp">
        <h2>+${Math.round(record.total)} XP</h2>
        ${xpRows.length ? `<p class="small">${xpRows.map((t) => `${TRACK_LABEL[t]} +${Math.round(record.gained[t])}`).join(' · ')}${record.bonus ? `. ${TRACK_LABEL[pick.track]} includes the ${M.BONUS_XP} XP daily bonus.` : ''}</p>` : '<p class="small muted">No new XP: you have already done this well, so only a better answer adds more.</p>'}
        ${record.promotion ? `<p class="promotion">Promoted to <strong>${esc(record.promotion)}</strong>.</p>` : ''}
        ${record.levelUps.length ? `<p>${record.levelUps.map((l) => `${TRACK_LABEL[l.track]} reached L${l.level}`).join(' · ')}</p>` : ''}
        <p class="small">${record.streak}-day streak. A new mission tomorrow.</p>
      </div>` : '';
  return `<div class="mission">
    <div class="ms-top"><div><span class="kicker">${pick.practice ? 'Practice' : 'Daily mission'} · ${esc(TRACK_LABEL[pick.track])}${pick.mode === 'hard' ? ' · Hard' : ''}</span>
      <h2>${esc(S.say(g, ev.title))}</h2></div></div>
    <div class="event">
      <div class="event-head">${avatarSVG(p.avatar, result.credit >= 0.95 ? 'happy' : result.credit >= 0.6 ? 'neutral' : 'worried', { size: 64, label: p.name })}<div><div class="kicker">What happened</div><div class="who">${esc(p.name)}</div></div></div>
      <p class="outcome">${esc(result.outcome)}</p>
      <div class="verdict ${cls}"><strong>${esc(verdict)}${written ? ` · ${Math.round(result.credit * 100)}%` : ''}.</strong> ${esc(written?.feedback || result.why)}</div>
    </div>
    <p class="ms-lead"><strong>${esc(leadLine(result))}</strong></p>
    <div class="ms-compare"><table>
      <thead><tr><th></th>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>
      <tbody>
        ${row('Launches on time', (k) => pct(result.odds[k]))}
        ${row('Faculty trust, 3 weeks on', (k) => result.weeks3[k].trust)}
        ${row('Team morale, 3 weeks on', (k) => result.weeks3[k].morale)}
        ${row('Rework hours, 3 weeks on', (k) => result.weeks3[k].rework)}
      </tbody></table>
      <p class="small muted">Same random future for both; on-time odds over ${M.ODDS_RUNS} futures played by a steady PM.</p></div>
    ${xp}
    <div class="lesson"><dl>
      ${written ? `<dt>You wrote</dt><dd class="quote">${esc(written.text)}</dd>` : ''}
      ${result.bestLabel ? `<dt>Best move</dt><dd>${esc(result.bestLabel)} <span class="muted">${esc(result.bestWhy)}</span></dd>` : ''}
      <dt>The idea</dt><dd>${esc(result.debrief.concept)}</dd>
      <dt>Handling it without escalating</dt><dd>${esc(result.debrief.independent)}</dd>
      <dt>When to escalate</dt><dd>${esc(result.debrief.escalateWhen)}</dd>
      ${result.debrief.sop ? `<dt>Where it's in the SOPs</dt><dd>${esc(result.debrief.sop)}</dd>` : ''}
    </dl></div>
    <div class="row"><button type="button" class="primary" data-ms="exit">Back to your desk</button>${record?.profile ? '<button type="button" id="open-profile">Your profile</button>' : ''}</div>
  </div>`;
}

// ---------- the screen ----------

// Mount the mission in `root`. pick comes from todaysPick (mode and practice set by the button pressed).
// grader(prompt, { signal }) → JSON reply, or null off Claude. onRecord(pick, result, event) → recordResult's
// return (or null); not called for practice. schedule(fn) runs the play-forward after the "playing" card paints.
export function mountMission(root, { pick, world, deck, projects, esc, avatarSVG, grader = null, onRecord = () => null, onExit = () => {}, schedule = (fn) => setTimeout(fn, 30) }) {
  const g = M.setupMission(pick, { world, deck, projects });
  if (!g) { onExit(); return { unmount() {} }; }
  const ev = S.currentEvent(g);
  const ui = { stage: 'write', text: '', error: '', allowPick: false };
  let ctl = null;
  let done = false;

  const draw = (focus) => {
    root.innerHTML = briefHtml(pick, g, esc, { avatarSVG, ui, canGrade: Boolean(grader) });
    const box = root.querySelector('#ms-answer');
    if (box) box.oninput = () => { ui.text = box.value; const b = root.querySelector('#ms-submit'); if (b) b.disabled = box.value.trim().length < MIN_ANSWER; };
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  };

  const resolve = (choiceId, opts = {}, written = null) => {
    root.innerHTML = forwardHtml();
    schedule(() => {
      if (done) return;
      const result = M.resolveMission(g, choiceId, opts);
      let record = null;
      if (!pick.practice) { try { record = onRecord(pick, result, ev) ?? null; } catch { record = null; } }
      root.innerHTML = resultHtml(pick, result, esc, { written, record, g, avatarSVG });
      root.scrollIntoView?.({ block: 'start' });
    });
  };

  const submit = async () => {
    const text = ui.text.trim();
    if (text.length < MIN_ANSWER) return;
    if (!grader) { ui.stage = 'pick'; ui.error = ''; draw(); return; }
    ui.stage = 'grading';
    ui.error = '';
    draw();
    ctl = new AbortController();
    try {
      const reply = await grader(S.gradingPrompt(g, ev, text), { signal: ctl.signal });
      if (done) return;
      const c = gradedChoice(ev, reply);
      resolve(c.choiceId, { credit: c.credit, response: text, feedback: c.feedback }, { text, feedback: c.feedback });
    } catch (e) {
      if (done) return;
      const code = e?.code;
      if (code === 'cancelled' || e?.name === 'AbortError') ui.stage = 'write';
      else if (UNAVAILABLE.includes(code)) { ui.stage = 'pick'; ui.error = 'AI grading isn\'t available, so pick the option closest to what you wrote.'; }
      else {
        ui.stage = 'write';
        ui.allowPick = true;
        ui.error = code === 'rate_limited' ? 'Grading is busy right now. Try again in a minute, or pick the closest option instead.' : 'Grading didn\'t finish. Try again, or pick the closest option instead.';
      }
      draw();
    } finally { ctl = null; }
  };

  const onClick = (e) => {
    if (e.target.closest('[data-ms="exit"]')) { onExit(); return; }
    const choice = e.target.closest('[data-ms-choice]');
    if (choice) {
      const written = pick.mode === 'hard' && ui.text.trim() ? { text: ui.text.trim(), feedback: '' } : null;
      resolve(choice.dataset.msChoice, written ? { response: written.text } : {}, written);
      return;
    }
    if (e.target.closest('#ms-submit')) { submit(); return; }
    if (e.target.closest('#ms-stop')) { ctl?.abort(); return; }
    if (e.target.closest('#ms-pick')) { ui.stage = 'pick'; ui.error = ''; draw(); }
  };
  root.addEventListener('click', onClick);
  draw(pick.mode === 'hard' ? '#ms-answer' : null);
  return {
    unmount() { done = true; ctl?.abort(); root.removeEventListener('click', onClick); root.innerHTML = ''; },
  };
}
