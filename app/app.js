import * as S from '../engine/sim.js';
import { avatarSVG } from './avatars.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAVE_KEY = 'critical-path-save-v0.3';
const OWNER = { ld: 'Design', mp: 'Media', gd: 'Graphics', faculty: 'Faculty' };
const VERDICT = (credit) => credit >= 0.95 ? ['best', 'Best move'] : credit >= 0.6 ? ['ok', 'Reasonable, not the best'] : credit >= 0.3 ? ['partial', 'Partly right'] : ['poor', 'This will cost you'];

let content, game, lastOutcome = null, feed = [];
let selectedProject = null;
// Hard mode: the player's written answer for the current situation, and where it is in grading.
let hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };

// ---------- AI grading availability (hard mode) ----------
// Inside Claude the page can ask Claude to grade; elsewhere (e.g. GitHub Pages) it can't,
// and hard mode falls back to "write your answer, then pick the closest option".
let sample = null;
let aiState = 'checking';
(async () => {
  try {
    if (window.claude?.use) sample = await window.claude.use('sample');
  } catch { sample = null; }
  aiState = sample ? 'ready' : 'none';
  renderAiNote();
})();

function renderAiNote() {
  const note = $('ai-note');
  if (!note) return;
  note.textContent = aiState === 'ready'
    ? 'Hard mode uses Claude to grade your answers. The first answer asks your permission and uses your Claude account.'
    : aiState === 'checking' ? '' : 'AI grading isn\'t available here, so in hard mode you write your answer, then pick the option closest to it.';
}

// ---------- loading ----------

async function loadJson(path) {
  const res = await fetch(new URL(path, import.meta.url));
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

async function init() {
  // A bundled build embeds the content; the dev build fetches the JSON files.
  if (window.CP_CONTENT) {
    content = window.CP_CONTENT;
  } else {
    const manifest = await loadJson('../content/projects.json');
    content = {
      world: await loadJson('../content/world.json'),
      deck: await loadJson('../content/scenarios/core-deck.json'),
      projects: await Promise.all(manifest.projects.map((id) => loadJson(`../content/projects/${id}.json`))),
    };
  }
  selectedProject = content.projects[0].id;
  const saved = readSave();
  if (saved && !saved.over && saved.version === 3) {
    game = saved;
    showGame();
  } else {
    showIntro();
  }
}

function showIntro() {
  game = null;
  lastOutcome = null;
  feed = [];
  $('end').hidden = true;
  $('game').hidden = true;
  $('intro').hidden = false;
  renderClock();
  renderProjects();
  renderAiNote();
  const w = content.world;
  const cast = [...w.people.map((p) => [p, p.role]), [w.supervisor, w.supervisor.role]];
  $('cast').innerHTML = cast.map(([p, role]) => `<figure class="cast-member">${avatarSVG(p.avatar, 'happy', { size: 64, label: p.name })}<figcaption><strong>${esc(p.name)}</strong><span>${esc(role)}</span></figcaption></figure>`).join('');
}

function renderProjects() {
  const w = content.world;
  $('projects').innerHTML = content.projects.map((p) => {
    const fac = w.faculty.find((f) => f.id === p.team.faculty);
    const weeks = p.launchWeek - (p.startWeek ?? 1) + 1;
    const chip = p.difficulty === 'Hard' ? 'poor' : p.difficulty === 'Standard' ? 'best' : 'partial';
    return `<label class="project ${p.id === selectedProject ? 'selected' : ''}">
      <input type="radio" name="project" value="${esc(p.id)}" ${p.id === selectedProject ? 'checked' : ''}>
      ${avatarSVG(fac.avatar, 'neutral', { size: 56, label: fac.name })}
      <span class="project-body"><span class="project-top"><strong>${esc(p.title)}</strong><span class="chip ${chip}">${esc(p.difficulty)}</span></span>
      <span class="small">${esc(p.tagline)}</span>
      <span class="small muted">With ${esc(fac.name)} · ${weeks} weeks${p.startWeek ? `, you join in week ${p.startWeek}` : ''}</span></span>
    </label>`;
  }).join('');
}

function startGame() {
  const project = content.projects.find((p) => p.id === selectedProject);
  const mode = $('mode-hard').checked ? 'hard' : 'standard';
  const seed = new URLSearchParams(location.search).get('seed') ?? randomSeed();
  game = S.createGame({ world: content.world, project, deck: content.deck, seed, mode });
  game.projectRef = project.id;
  lastOutcome = null;
  feed = [];
  hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
  showGame();
}

function showGame() {
  $('intro').hidden = true;
  $('end').hidden = true;
  $('game').hidden = false;
  render();
}

// ---------- people ----------

function person(role) {
  if (role === 'sup') return { name: game.supervisor.name, short: game.supervisor.short, role: game.supervisor.role, avatar: game.supervisor.avatar };
  return game.team[role];
}
function face(role, mood, size) {
  const p = person(role);
  return avatarSVG(p.avatar, mood ?? S.moodFor(game, role), { size, label: p.name });
}

// ---------- rendering ----------

function render() {
  renderClock();
  renderStatus();
  renderTeam();
  renderTurn();
  save();
}

function renderClock() {
  if (!game) { $('clock').innerHTML = ''; return; }
  const dots = Array.from({ length: game.actionPointsPerWeek }, (_, i) => `<span class="${i < game.actionPoints ? 'full' : ''}"></span>`).join('');
  $('clock').innerHTML = game.over
    ? '<strong>Launched</strong>'
    : `<strong>Week ${game.week}</strong> of ${game.launchWeek}${game.mode === 'hard' ? ' · Hard' : ''}<br>Action Points <span class="ap" aria-label="${game.actionPoints} left">${dots}</span>`;
}

function renderStatus() {
  const st = S.scheduleStatus(game);
  const started = game.log.length > 0;
  const v = st.variance;
  const label = started ? st.label : 'on-track';
  // Gauge runs from 4 weeks behind to 3 weeks ahead.
  const pos = Math.max(0, Math.min(100, ((v + 4) / 7) * 100));
  const words = label === 'on-track' ? 'On track' : `${Math.abs(v)} week${Math.abs(v) === 1 ? '' : 's'} ${v > 0 ? 'ahead' : 'behind'}`;
  const phases = S.phaseProgress(game);
  const active = game.tasks.filter((t) => ['active', 'rework', 'ready'].includes(S.taskStatus(game, t)));
  const late = started && (label === 'behind' || label === 'far-behind');
  $('status').innerHTML = `
    <div class="status-top">
      <div class="status-head">
        <div class="kicker">${esc(game.project.title)}</div>
        <div class="status-word ${label}">${esc(words)}</div>
        <div class="small muted">${st.actualPct}% of the work done${started ? ` · ${st.plannedPct}% needed by now` : ''} · launch week ${game.launchWeek}${late ? ` · at this pace, ready around week ${st.projectedFinish}` : ''}</div>
      </div>
      <div class="gauge" role="img" aria-label="Schedule: ${esc(words)}">
        <div class="gauge-track">
          <span class="zone far" style="width:${(2 / 7) * 100}%"></span><span class="zone behind" style="width:${(1.25 / 7) * 100}%"></span><span class="zone ontrack" style="width:${(1.5 / 7) * 100}%"></span><span class="zone ahead" style="width:${(2.25 / 7) * 100}%"></span>
          <span class="marker ${started ? '' : 'idle'}" style="left:${started ? pos : (4 / 7) * 100}%"></span>
        </div>
        <div class="gauge-labels"><span>Far behind</span><span>Behind</span><span>On track</span><span>Ahead</span></div>
      </div>
    </div>
    <div class="phases">${phases.map((p) => `<div class="phase ${p.status}" style="flex-grow:${p.effort}">
      <div class="phase-bar"><i style="width:${p.pct}%"></i></div>
      <div class="phase-label"><span>${esc(p.phase)}</span><span>${p.pct}%</span></div></div>`).join('')}</div>
    <div class="now">
      <span class="now-label">In progress</span>
      ${active.length ? active.map((t) => {
        const ts = S.taskStatus(game, t);
        return `<span class="task-chip ${ts}">${esc(t.name)} <span class="muted">· ${OWNER[t.owner]} · ${S.percentDone(t)}%${ts === 'rework' ? ` · ${Math.round(t.known)}h rework` : ''}</span></span>`;
      }).join('') : '<span class="muted small">Nothing ready to start</span>'}
    </div>
    <details class="plan" id="plan-details" ${planOpen ? 'open' : ''}>
      <summary>Full plan (${game.tasks.length} tasks)</summary>
      <ol class="plan-list">${game.tasks.map((t) => {
        const s = S.taskStatus(game, t);
        return `<li class="${s}"><span class="dot" aria-hidden="true"></span><span class="plan-name">${esc(t.name)}</span><span class="muted">${OWNER[t.owner]}</span><span class="plan-pct">${s === 'done' ? 'Done' : s === 'waiting' ? 'Waiting' : `${S.percentDone(t)}%`}</span></li>`;
      }).join('')}</ol>
    </details>`;
  $('plan-details').ontoggle = (e) => { planOpen = e.target.open; };
}
let planOpen = false;

function meter(label, value) {
  const cls = value < 45 ? 'low' : value < 65 ? 'mid' : 'ok';
  return `<div class="meter"><span>${label}</span><div class="bar ${cls}"><i style="width:${Math.round(value)}%"></i></div><span class="val">${Math.round(value)}</span></div>`;
}

function renderTeam() {
  const row = (r, body) => `<div class="person">${face(r, null, 46)}<div class="person-body">${body}</div></div>`;
  const staff = S.STAFF.map((r) => {
    const p = game.team[r];
    return row(r, `<div class="name">${esc(p.name)}</div><div class="role">${esc(p.role)}</div>${meter('Morale', p.morale)}`);
  });
  const f = game.team.faculty;
  $('team').innerHTML = [
    ...staff,
    row('faculty', `<div class="name">${esc(f.name)}</div><div class="role">Faculty partner</div>${meter('Trust', f.trust)}`),
    row('sup', `<div class="name">${esc(game.supervisor.name)}</div><div class="role">${esc(game.supervisor.role)} · you can escalate to ${esc(game.supervisor.short)}</div>`),
  ].join('');
}

function renderTurn() {
  const last = game.log.at(-1);
  $('report').innerHTML = last && last.week === game.week - 1
    ? `<div class="report"><strong>Week ${last.week} recap.</strong> ${weekSummary(last)}</div>`
    : '';

  const ev = S.currentEvent(game);
  if (ev) {
    if (hard.eventId !== ev.id) hard = { eventId: ev.id, text: '', stage: 'write', error: '', allowPick: false };
    $('event').innerHTML = renderEvent(ev);
    const box = $('answer');
    if (box) {
      box.value = hard.text;
      box.oninput = () => { hard.text = box.value; $('submit-answer').disabled = box.value.trim().length < 15; };
    }
  } else if (lastOutcome) {
    const [cls, verdict] = VERDICT(lastOutcome.credit);
    const who = lastOutcome.who ?? 'ld';
    $('event').innerHTML = `<div class="event">
      <div class="event-head">${face(who, lastOutcome.reaction, 80)}<div><div class="kicker">Situation · ${esc(lastOutcome.title)}</div><div class="who">${esc(person(who).name)}</div></div></div>
      <p class="outcome">${esc(lastOutcome.text)}</p>
      <div class="verdict ${cls}"><strong>${esc(verdict)}${lastOutcome.graded ? ` · ${Math.round(lastOutcome.credit * 100)}%` : ''}.</strong> ${esc(lastOutcome.feedback || lastOutcome.why)}</div>
    </div>`;
  } else {
    $('event').innerHTML = '';
  }

  const blocked = Boolean(ev) || game.actionPoints <= 0;
  const acts = S.actionList(game);
  $('actions').innerHTML = `<div class="actions">${acts.map((a) => a.needsWho
    ? `<div class="action-who"><div>${esc(a.label)}<span class="help">${esc(a.help)}</span></div>
        <div class="who-buttons">${S.STAFF.map((r) => `<button data-action="overtime" data-who="${r}" ${blocked ? 'disabled' : ''} aria-label="Ask ${esc(game.team[r].name)} for extra hours">${face(r, null, 28)}<span>${esc(game.team[r].short)}</span></button>`).join('')}</div></div>`
    : `<button data-action="${a.id}" ${blocked ? 'disabled' : ''}>${esc(a.label)}<span class="help">${esc(a.help)}</span></button>`).join('')}</div>`;
  $('feed').innerHTML = feed.filter((f) => f.week === game.week).map((f) => `<li>${esc(f.text)}</li>`).join('');
  $('end-week').disabled = Boolean(ev);
  $('end-week').textContent = game.week === game.launchWeek ? 'Launch the course' : `End week ${game.week}`;
}

function renderEvent(ev) {
  const who = ev.who ?? 'ld';
  const head = `<div class="event-head">${face(who, ev.mood, 80)}<div><div class="kicker">Situation · ${esc(S.say(game, ev.title))}</div><div class="who">${esc(person(who).name)}</div></div></div>
    <p>${esc(S.say(game, ev.text))}</p>`;
  const options = (prompt) => `<p class="prompt">${prompt}</p>
    <div class="choices">${S.choicesInOrder(game, ev).map((c, i) => `<button data-choice="${esc(c.id)}"><span class="letter">${'ABCDEF'[i]}</span><span>${esc(S.say(game, c.label))}</span></button>`).join('')}</div>`;

  if (game.mode !== 'hard') return `<div class="event pop">${head}${options('What do you do?')}</div>`;

  if (hard.stage === 'pick') {
    return `<div class="event pop">${head}
      <div class="your-answer"><div class="kicker">You wrote</div><p>${esc(hard.text)}</p></div>
      ${hard.error ? `<p class="small muted">${esc(hard.error)}</p>` : ''}
      ${options('Which option is closest to what you wrote?')}</div>`;
  }
  const grading = hard.stage === 'grading';
  return `<div class="event pop">${head}
    <label class="prompt" for="answer">What do you do? Write it the way you'd explain it to ${esc(game.supervisor.short)}.</label>
    <textarea id="answer" rows="5" ${grading ? 'disabled' : ''} placeholder="Who do you talk to, what do you propose, and what happens next?"></textarea>
    ${hard.error ? `<p class="small error">${esc(hard.error)}</p>` : ''}
    <div class="row">
      <button class="primary" id="submit-answer" ${grading || hard.text.trim().length < 15 ? 'disabled' : ''}>${grading ? 'Grading your answer...' : aiState === 'ready' ? 'Submit for grading' : 'Submit'}</button>
      ${grading ? '<button id="stop-grading">Stop</button>' : ''}
      ${hard.allowPick && !grading ? '<button id="pick-instead">Pick the closest option instead</button>' : ''}
    </div></div>`;
}

function weekSummary(entry) {
  const n = (r) => (r === 'faculty' ? game.team.faculty.short : game.team[r].short);
  const parts = [`${n('ld')} ${entry.hours.ld}h, ${n('mp')} ${entry.hours.mp}h, ${n('gd')} ${entry.hours.gd}h, ${n('faculty')} ${entry.hours.faculty}h.`];
  if (entry.completed.length) parts.push(`Finished: ${entry.completed.map((id) => game.tasks.find((t) => t.id === id).name).join(', ')}.`);
  if (entry.discovered >= 1) parts.push(`${entry.discovered}h of rework surfaced.`);
  if (entry.pressure >= 0.3) parts.push('The team is feeling schedule pressure.');
  return esc(parts.join(' '));
}

function renderEnd() {
  $('game').hidden = true;
  const r = game.result;
  const s = r.scores;
  const label = { scope: 'Course complete', quality: 'Quality', team: 'Team health', faculty: 'Faculty trust', judgment: 'Judgment' };
  const lessons = S.debrief(game);
  $('end').hidden = false;
  $('end').innerHTML = `
    <div class="kicker">${esc(game.project.title)}${game.mode === 'hard' ? ' · Hard mode' : ''}</div>
    <div class="grade">${r.grade}</div>
    <h2>${r.launchedOnTime ? `Launched on time in week ${r.finishedWeek}` : 'Launch day arrived before the course was finished'}</h2>
    <p>Overall score ${r.overall}. ${r.launchedOnTime ? 'Students open a finished course.' : `About ${100 - s.scope}% of the planned work wasn't done by launch.`}</p>
    <div class="scores">${Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => `<div class="score"><div class="k">${label[k]}</div><div class="v">${v}</div></div>`).join('')}</div>
    <h2>Debrief</h2>
    <p class="muted small">Situations you handled with the best move are folded; open any of them to review.</p>
    ${lessons.length ? lessons.map(renderLesson).join('') : '<p>No situations came up this run.</p>'}
    <div class="row">
      <button class="primary" id="again">Play another project</button>
      <button id="replay">Replay this run (same events)</button>
    </div>`;
  $('again').onclick = () => { clearSave(); showIntro(); };
  $('replay').onclick = () => {
    const { seed, mode, projectRef } = game;
    clearSave();
    const project = content.projects.find((p) => p.id === projectRef);
    game = S.createGame({ world: content.world, project, deck: content.deck, seed, mode });
    game.projectRef = projectRef;
    lastOutcome = null;
    feed = [];
    showGame();
  };
}

function renderLesson(l) {
  if (l.kind === 'pattern') {
    return `<div class="lesson"><h3>${esc(l.title)}</h3><div class="tier">${esc(l.concept)}</div><p>${esc(l.independent)}</p></div>`;
  }
  const [cls, verdict] = VERDICT(l.credit);
  const written = l.response
    ? `<dt>You wrote</dt><dd class="quote">${esc(l.response)}</dd>${l.feedback ? `<dt>Feedback</dt><dd>${esc(l.feedback)}</dd>` : `<dt>Closest option you picked</dt><dd>${esc(l.chosen)} <span class="muted">${esc(l.why)}</span></dd>`}`
    : `<dt>You chose</dt><dd>${esc(l.chosen)} <span class="muted">${esc(l.why)}</span></dd>`;
  return `<details class="lesson" ${l.credit < 0.95 ? 'open' : ''}>
    <summary class="lesson-head">${face(l.who ?? 'ld', l.credit >= 0.95 ? 'happy' : l.credit >= 0.6 ? 'neutral' : 'worried', 44)}<div><h3>Week ${l.week}: ${esc(l.title)}</h3>
    <div class="tier"><span class="chip ${cls}">${verdict}</span> ${l.response ? 'Written answer' : esc(l.tierLabel)} · ${Math.round(l.credit * 100)}% credit</div></div></summary>
    <dl>
      ${written}
      ${l.bestLabel ? `<dt>Best move</dt><dd>${esc(l.bestLabel)} <span class="muted">${esc(l.bestWhy)}</span></dd>` : ''}
      <dt>The idea</dt><dd>${esc(l.concept)}</dd>
      <dt>Handling it without escalating</dt><dd>${esc(l.independent)}</dd>
      <dt>When to escalate</dt><dd>${esc(l.escalateWhen)}</dd>
      ${l.sop ? `<dt>Where it's in the SOPs</dt><dd>${esc(l.sop)}</dd>` : ''}
    </dl>
  </details>`;
}

// ---------- hard mode grading ----------

let gradingCtl = null;

async function submitAnswer() {
  const ev = S.currentEvent(game);
  const text = hard.text.trim();
  if (!ev || text.length < 15) return;
  if (aiState !== 'ready') {
    hard.stage = 'pick';
    hard.error = '';
    renderTurn();
    return;
  }
  hard.stage = 'grading';
  hard.error = '';
  renderTurn();
  gradingCtl = new AbortController();
  try {
    const g = await sample.json(S.gradingPrompt(game, ev, text), { signal: gradingCtl.signal });
    const credit = Number(g?.credit);
    if (!Number.isFinite(credit)) throw { code: 'invalid_json' };
    const creditOf = (c) => c.credit ?? S.TIER_CREDIT[c.tier];
    const closest = ev.choices.find((c) => c.id === g?.closest)
      ?? ev.choices.reduce((a, c) => (Math.abs(creditOf(c) - credit) < Math.abs(creditOf(a) - credit) ? c : a));
    const feedback = String(g.feedback ?? '');
    const res = S.chooseOption(game, closest.id, { credit, response: text, feedback });
    lastOutcome = { title: S.say(game, ev.title), text: res.outcome, why: res.why, credit: res.credit, reaction: res.reaction, who: res.who, feedback, graded: true };
    hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
    render();
  } catch (e) {
    const code = e?.code;
    if (code === 'cancelled') {
      hard.stage = 'write';
    } else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
      aiState = 'none';
      hard.stage = 'pick';
      hard.error = 'AI grading isn\'t available, so pick the option closest to what you wrote.';
    } else {
      hard.stage = 'write';
      hard.allowPick = true;
      hard.error = code === 'rate_limited'
        ? 'Grading is busy right now. Try again in a minute, or pick the closest option instead.'
        : 'Grading didn\'t finish. Try again, or pick the closest option instead.';
    }
    renderTurn();
  } finally {
    gradingCtl = null;
  }
}

// ---------- input ----------

document.addEventListener('change', (e) => {
  if (e.target.name === 'project') {
    selectedProject = e.target.value;
    renderProjects();
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#submit-answer')) { submitAnswer(); return; }
  if (e.target.closest('#stop-grading')) { gradingCtl?.abort(); return; }
  if (e.target.closest('#pick-instead')) { hard.stage = 'pick'; hard.error = ''; renderTurn(); return; }
  const choice = e.target.closest('[data-choice]');
  const action = e.target.closest('[data-action]');
  if (choice) {
    const ev = S.currentEvent(game);
    const written = game.mode === 'hard' && hard.text.trim() ? { response: hard.text.trim() } : {};
    const res = S.chooseOption(game, choice.dataset.choice, written);
    lastOutcome = { title: S.say(game, ev.title), text: res.outcome, why: res.why, credit: res.credit, reaction: res.reaction, who: res.who };
    hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
    render();
  } else if (action && !action.disabled) {
    const note = S.takeAction(game, action.dataset.action, action.dataset.who);
    const label = S.actionList(game).find((a) => a.id === note.actionId).label;
    feed.push({ week: game.week, text: `${label}${note.who ? ` (${game.team[note.who].short})` : ''}: ${note.detail}` });
    render();
  }
});

$('start').onclick = startGame;
$('end-week').onclick = () => {
  S.advanceWeek(game);
  lastOutcome = null;
  if (game.over) {
    renderClock();
    save();
    renderEnd();
  } else {
    render();
  }
};

// ---------- persistence (per-browser convenience only) ----------

function save() {
  try { if (game) localStorage.setItem(SAVE_KEY, JSON.stringify(game)); } catch { /* storage unavailable */ }
}
function readSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

init().catch((err) => {
  $('main').innerHTML = `<div class="card"><h2>Couldn't start the game</h2><p>${esc(err.message)}. Open it through a local web server (npm start) rather than as a file.</p></div>`;
});
