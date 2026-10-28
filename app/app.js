import * as S from '../engine/sim.js';
import { avatarSVG } from './avatars.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAVE_KEY = 'critical-path-save-v0.2';
const OWNER = { ld: 'Designer', mp: 'Producer', faculty: 'Faculty' };
const VERDICT = (credit) => credit >= 1 ? ['best', 'Best move'] : credit >= 0.6 ? ['ok', 'Reasonable, not the best'] : credit >= 0.3 ? ['partial', 'Partly right'] : ['poor', 'This will cost you'];

function person(role) {
  if (role === 'sup') return { name: game.supervisor.name, role: game.supervisor.role, avatar: game.supervisor.avatar };
  return game.team[role];
}
function face(role, mood, size, extraLabel = '') {
  const p = person(role);
  return avatarSVG(p.avatar, mood ?? S.moodFor(game, role), { size, label: p.name + extraLabel });
}

let content, game, lastOutcome = null, feed = [];

async function loadJson(path) {
  const res = await fetch(new URL(path, import.meta.url));
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

async function init() {
  // A bundled build embeds the content; the dev build fetches the JSON files.
  content = window.CP_CONTENT ?? {
    world: await loadJson('../content/world.json'),
    project: await loadJson('../content/projects/intro-psych-online.json'),
    deck: await loadJson('../content/scenarios/core-deck.json'),
  };
  const saved = readSave();
  if (saved && !saved.over) {
    game = saved;
    showGame();
  } else {
    newGame(new URLSearchParams(location.search).get('seed') ?? randomSeed());
  }
}

function newGame(seed) {
  game = S.createGame({ ...content, seed });
  lastOutcome = null;
  feed = [];
  $('end').hidden = true;
  $('game').hidden = true;
  $('intro').hidden = false;
  $('brief').innerHTML = `<strong>${esc(game.project.title)}.</strong> ${esc(game.project.brief)} Launch is week ${game.launchWeek}.`;
  $('cast').innerHTML = ['ld', 'mp', 'faculty', 'sup'].map((r) => {
    const p = person(r);
    return `<figure class="cast-member">${face(r, 'happy', 72)}<figcaption><strong>${esc(p.name)}</strong><span>${esc(p.role)}</span></figcaption></figure>`;
  }).join('');
  renderClock();
  save();
}

function showGame() {
  $('intro').hidden = true;
  $('game').hidden = false;
  render();
}

// ---------- rendering ----------

function render() {
  renderClock();
  renderTasks();
  renderTeam();
  renderTurn();
  save();
}

function renderClock() {
  const dots = Array.from({ length: game.actionPointsPerWeek }, (_, i) => `<span class="${i < game.actionPoints ? 'full' : ''}"></span>`).join('');
  $('clock').innerHTML = game.over
    ? '<strong>Launched</strong>'
    : `<strong>Week ${game.week}</strong> of ${game.launchWeek}<br>Action Points <span class="ap" aria-label="${game.actionPoints} left">${dots}</span>`;
}

function renderTasks() {
  $('tasks').innerHTML = game.tasks.map((t) => {
    const pct = S.percentDone(t);
    let tag = '<span class="tag blocked">waiting</span>';
    if (S.taskComplete(t)) tag = '<span class="tag done">done</span>';
    else if (t.known >= 0.5) tag = `<span class="tag rework">rework ${Math.round(t.known)}h</span>`;
    else if (S.taskReady(game, t)) tag = '<span class="tag active">in progress</span>';
    return `<li>
      <div class="task-head"><span>${esc(t.name)}</span>${tag}</div>
      <div class="task-meta">${esc(t.phase)} · ${OWNER[t.owner]} · ${Math.round(t.effort)}h planned</div>
      <div class="bar" aria-label="${pct}% done"><i style="width:${pct}%"></i></div>
    </li>`;
  }).join('');
}

function meter(label, value) {
  const cls = value < 45 ? 'low' : value < 65 ? 'mid' : 'ok';
  return `<div class="meter"><span>${label}</span><div class="bar ${cls}"><i style="width:${Math.round(value)}%"></i></div><span class="val">${Math.round(value)}</span></div>`;
}

function renderTeam() {
  const { ld, mp, faculty } = game.team;
  const row = (r, body) => `<div class="person">${face(r, null, 52)}<div class="person-body">${body}</div></div>`;
  $('team').innerHTML = [
    row('ld', `<div class="name">${esc(ld.name)}</div><div class="role">${esc(ld.role)} · ${ld.hoursPerWeek}h/week here</div>${meter('Morale', ld.morale)}`),
    row('mp', `<div class="name">${esc(mp.name)}</div><div class="role">${esc(mp.role)} · ${mp.hoursPerWeek}h/week here</div>${meter('Morale', mp.morale)}`),
    row('faculty', `<div class="name">${esc(faculty.name)}</div><div class="role">Faculty partner</div>${meter('Trust', faculty.trust)}${meter('Responsiveness', 100 * S.effectiveResponsiveness(game))}`),
    row('sup', `<div class="name">${esc(game.supervisor.name)}</div><div class="role">Supervisor PM · you can escalate to Jordan</div>`),
  ].join('');
}

function renderTurn() {
  const last = game.log.at(-1);
  $('report').innerHTML = last && last.week === game.week - 1
    ? `<div class="report"><strong>Week ${last.week} recap.</strong> ${weekSummary(last)}</div>`
    : '';

  const ev = S.currentEvent(game);
  if (ev) {
    const who = ev.who ?? 'ld';
    $('event').innerHTML = `<div class="event pop">
      <div class="event-head">${face(who, ev.mood, 84)}<div><div class="kicker">Situation · ${esc(ev.title)}</div><div class="who">${esc(person(who).name)}</div></div></div>
      <p>${esc(ev.text)}</p>
      <p class="prompt">What do you do?</p>
      <div class="choices">${S.choicesInOrder(game, ev).map((c, i) => `<button data-choice="${esc(c.id)}"><span class="letter">${'ABCDEF'[i]}</span><span>${esc(c.label)}</span></button>`).join('')}</div>
    </div>`;
  } else if (lastOutcome) {
    const [cls, verdict] = VERDICT(lastOutcome.credit);
    const who = lastOutcome.who ?? 'ld';
    $('event').innerHTML = `<div class="event">
      <div class="event-head">${face(who, lastOutcome.reaction, 84)}<div><div class="kicker">Situation · ${esc(lastOutcome.title)}</div><div class="who">${esc(person(who).name)}</div></div></div>
      <p class="outcome">${esc(lastOutcome.text)}</p>
      <div class="verdict ${cls}"><strong>${verdict}.</strong> ${esc(lastOutcome.why)}</div>
    </div>`;
  } else {
    $('event').innerHTML = '';
  }

  const blocked = Boolean(ev) || game.actionPoints <= 0;
  $('actions').innerHTML = `<div class="actions">${S.ACTIONS.map((a) => `<button data-action="${a.id}" ${blocked ? 'disabled' : ''}>${esc(a.label)}<span class="help">${esc(a.help)}</span></button>`).join('')}</div>`;
  $('feed').innerHTML = feed.filter((f) => f.week === game.week).map((f) => `<li>${esc(f.text)}</li>`).join('');
  $('end-week').disabled = Boolean(ev);
  $('end-week').textContent = game.week === game.launchWeek ? 'Launch the course' : `End week ${game.week}`;
}

function weekSummary(entry) {
  const n = (r) => (r === 'faculty' ? game.team[r].name : game.team[r].name.split(' ')[0]);
  const parts = [`${n('ld')} put in ${entry.hours.ld}h, ${n('mp')} ${entry.hours.mp}h, ${n('faculty')} ${entry.hours.faculty}h.`];
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
    <div class="grade">${r.grade}</div>
    <h2>${r.launchedOnTime ? `Launched on time in week ${r.finishedWeek}` : 'Launch day arrived before the course was finished'}</h2>
    <p>Overall score ${r.overall}. ${r.launchedOnTime ? 'Students open a finished course.' : `About ${100 - s.scope}% of the planned work wasn't done by the first day of term.`}</p>
    <div class="scores">${Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => `<div class="score"><div class="k">${label[k]}</div><div class="v">${v}</div></div>`).join('')}</div>
    <h2>Debrief</h2>
    <p class="muted">Situations you handled with the best move are folded; open any of them to review.</p>
    ${lessons.length ? lessons.map(renderLesson).join('') : '<p>No situations came up this run. Try another seed.</p>'}
    <div class="row">
      <button class="primary" id="again">Play a new run</button>
      <button id="replay">Replay this run (same events)</button>
    </div>`;
  $('again').onclick = () => { clearSave(); newGame(randomSeed()); };
  $('replay').onclick = () => { const seed = game.seed; clearSave(); newGame(seed); };
}

function renderLesson(l) {
  if (l.kind === 'pattern') {
    return `<div class="lesson"><h3>${esc(l.title)}</h3><div class="tier">${esc(l.concept)}</div><p>${esc(l.independent)}</p></div>`;
  }
  const [cls, verdict] = VERDICT(l.credit);
  return `<details class="lesson" ${l.credit < 1 ? 'open' : ''}>
    <summary class="lesson-head">${face(l.who ?? 'ld', l.credit >= 1 ? 'happy' : l.credit >= 0.6 ? 'neutral' : 'worried', 44)}<div><h3>Week ${l.week}: ${esc(l.title)}</h3>
    <div class="tier"><span class="chip ${cls}">${verdict}</span> ${esc(l.tierLabel)} · ${Math.round(l.credit * 100)}% credit</div></div></summary>
    <dl>
      <dt>You chose</dt><dd>${esc(l.chosen)} <span class="muted">${esc(l.why)}</span></dd>
      ${l.bestLabel ? `<dt>Best move</dt><dd>${esc(l.bestLabel)} <span class="muted">${esc(l.bestWhy)}</span></dd>` : ''}
      <dt>The idea</dt><dd>${esc(l.concept)}</dd>
      <dt>Handling it without escalating</dt><dd>${esc(l.independent)}</dd>
      <dt>When to escalate</dt><dd>${esc(l.escalateWhen)}</dd>
      ${l.sop ? `<dt>Where it's in the SOPs</dt><dd>${esc(l.sop)}</dd>` : ''}
    </dl>
  </details>`;
}

// ---------- input ----------

document.addEventListener('click', (e) => {
  const choice = e.target.closest('[data-choice]');
  const action = e.target.closest('[data-action]');
  if (choice) {
    const ev = S.currentEvent(game);
    const res = S.chooseOption(game, choice.dataset.choice);
    lastOutcome = { title: ev.title, text: res.outcome, why: res.why, credit: res.credit, reaction: res.reaction, who: res.who };
    render();
  } else if (action) {
    const note = S.takeAction(game, action.dataset.action);
    const label = S.ACTIONS.find((a) => a.id === note.actionId).label;
    feed.push({ week: game.week, text: `${label}: ${note.detail}` });
    render();
  }
});

$('start').onclick = showGame;
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
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); } catch { /* storage unavailable */ }
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
