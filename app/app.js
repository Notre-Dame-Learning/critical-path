import * as S from '../engine/sim.js';
import * as M from '../engine/moves.js';
import { signalsHtml, meetingHtml, movesHtml, avoidedHtml, stepperHtml } from './moves-view.js';
import { teamHtml } from './team-view.js';
import { icon } from './icons.js';
import { defaultPlayer, randomPlayer, cleanPlayer } from '../engine/player.js';
import { deskHtml, avatarMakerHtml } from './home-view.js';
import { avatarSVG } from './avatars.js';
import { createGameAt } from '../engine/difficulty.js';
import { defaultDifficulty, rememberDifficulty, difficultyHtml, pickedDifficulty } from './difficulty-picker.js';
import { pickSeed, runCodeHtml } from './run-code.js';
import * as C from '../engine/conversation.js';
import { nextTip, seenTips, markSeen, tipsEnabled, setTipsEnabled } from './coach.js';
import * as P from '../engine/progression.js';
import { loadProfile, saveProfile, xpPanelHtml, profileHtml } from './profile-view.js';
import * as I from '../engine/impact.js';
import * as G from '../engine/debrief-gm.js';
import { mountPlanEditor } from './plan-screen.js';
import { mountCritique, roundChoices } from './critique-screen.js';
import { CHECKS as PLAN_CHECKS } from '../engine/plan.js';
import { todaysPick, missionCardHtml, mountMission, recordResult, localDate } from './mission-screen.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAVE_KEY = 'critical-path-save-v0.3';
const OWNER = { ld: 'Design', mp: 'Media', gd: 'Graphics', faculty: 'Faculty' };
const VERDICT = (credit) => credit >= 0.95 ? ['best', 'Best move'] : credit >= 0.6 ? ['ok', 'Reasonable, not the best'] : credit >= 0.3 ? ['partial', 'Partly right'] : ['poor', 'This will cost you'];

let content, game, lastOutcome = null, feed = [];
let selectedProject = null;
// Ranks are recognition only unless ?locks=1 (Progression tab, open question 1).
const LOCKS = new URLSearchParams(location.search).get('locks') === '1';
let profileReturn = 'intro';
// The avatar maker on the start screen: null when closed, else the draft being edited.
let maker = null;
let planner = null;
let critic = null;
let missionView = null;
// Hard mode: the player's written answer for the current situation, and where it is in grading.
let hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
// Hard mode, six situations: a conversation with the stakeholder, played by Claude (engine/conversation.js).
// stage: opening | player | waiting | judging | error
let talk = null;

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
      conversations: await loadJson('../content/conversations.json'),
      stakeholders: await loadJson('../content/stakeholders.json'),
      risks: await loadJson('../content/risks.json'),
      plans: Object.fromEntries(await Promise.all(manifest.projects.map(async (id) => [id, await loadJson(`../content/plans/${id}.json`).catch(() => null)]))),
      flaws: Object.fromEntries(await Promise.all(PLAN_CHECKS.map(async (c) => [c.id, await loadJson(`../content/flaws/${c.flaw}.json`)]))),
      critique: await loadJson('../content/critique-samples.json').catch(() => null),
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
  $('profile').hidden = true;
  closePlannerView();
  $('intro').hidden = false;
  $('desk').hidden = false;
  $('stepper').innerHTML = '';
  renderDesk();
  renderClock();
  renderProjects();
  renderAiNote();
  $('difficulty').innerHTML = difficultyHtml(defaultDifficulty(localStore()), esc);
  $('run-code-box').innerHTML = runCodeHtml('', esc);
  $('tips-on').checked = tipsEnabled(localStore());
  const w = content.world;
  const cast = [...w.people.map((p) => [p, p.role]), [w.supervisor, w.supervisor.role]];
  $('cast').innerHTML = cast.map(([p, role]) => `<figure class="cast-member">${avatarSVG(p.avatar, 'happy', { size: 64, label: p.name })}<figcaption><strong>${esc(p.name)}</strong><span>${esc(role)}</span></figcaption></figure>`).join('');
}

// ---------- your desk (start screen) and the avatar maker ----------

function renderDesk() {
  const profile = loadProfile(localStore()) ?? P.newProfile();
  $('desk').innerHTML = maker
    ? avatarMakerHtml(maker.draft, esc, { avatarSVG, mood: maker.mood })
    : deskHtml(profile, esc, { avatarSVG, mission: missionCard(profile) });
  const name = $('av-name');
  if (name) name.oninput = () => { maker.draft.name = name.value; };
}

// ---------- the Daily Mission ----------

// Today's pick from the unlocked projects; null if no situation could be staged (or something failed).
function missionPick(profile) {
  try {
    const open = P.unlocked(profile, { locks: LOCKS });
    const projects = content.projects.filter((p) => open.projects.includes(p.id));
    return todaysPick(localStore(), profile, { date: localDate(), world: content.world, deck: content.deck, projects });
  } catch { return null; }
}

function missionCard(profile) {
  const open = P.unlocked(profile, { locks: LOCKS });
  return missionCardHtml(profile, missionPick(profile), esc, { projects: content.projects, hardOpen: open.modes.includes('hard') });
}

function showMission(kind) {
  const profile = loadProfile(localStore()) ?? P.newProfile();
  const base = missionPick(profile);
  if (!base) return;
  const pick = { ...base, mode: kind === 'hard' ? 'hard' : 'standard', practice: kind === 'practice' };
  closePlannerView();
  for (const id of ['intro', 'desk', 'end', 'game', 'profile']) $(id).hidden = true;
  $('mission').hidden = false;
  missionView = mountMission($('mission'), {
    pick, world: content.world, deck: content.deck, projects: content.projects, esc, avatarSVG,
    grader: aiState === 'ready' && sample ? (prompt, opts) => sample.json(prompt, opts) : null,
    onRecord: (pk, result, event) => {
      const rec = recordResult(loadProfile(localStore()) ?? P.newProfile(), pk, result, event);
      saveProfile(localStore(), rec.profile);
      return rec;
    },
    onExit: showIntro,
  });
  window.scrollTo?.(0, 0);
}

function closeMissionView() {
  missionView?.unmount();
  missionView = null;
  $('mission').hidden = true;
}

function openMaker() {
  const current = player();
  maker = { draft: structuredClone(current ?? defaultPlayer()), mood: 'happy' };
  renderDesk();
  $('desk').scrollIntoView?.({ block: 'start' });
}

function saveMaker() {
  const profile = loadProfile(localStore()) ?? P.newProfile();
  profile.player = cleanPlayer(maker.draft);
  saveProfile(localStore(), profile);
  maker = null;
  renderDesk();
}

function makerClick(e) {
  if (e.target.closest('#edit-avatar') || e.target.closest('#make-avatar')) { openMaker(); return true; }
  if (!maker) return false;
  const part = e.target.closest('[data-av]');
  const tog = e.target.closest('[data-av-toggle]');
  const mood = e.target.closest('[data-av-mood]');
  if (part) maker.draft.avatar[part.dataset.av] = part.dataset.val;
  else if (tog) maker.draft.avatar[tog.dataset.avToggle] = !maker.draft.avatar[tog.dataset.avToggle];
  else if (mood) maker.mood = mood.dataset.avMood;
  else if (e.target.closest('#av-random')) maker.draft = { ...randomPlayer(), name: maker.draft.name };
  else if (e.target.closest('#av-save')) { saveMaker(); return true; }
  else if (e.target.closest('#av-cancel')) { maker = null; renderDesk(); return true; }
  else return false;
  renderDesk();
  return true;
}

function renderProjects() {
  const w = content.world;
  const open = P.unlocked(loadProfile(localStore()) ?? P.newProfile(), { locks: LOCKS });
  if (!open.projects.includes(selectedProject)) selectedProject = open.projects[0];
  const hardBox = $('mode-hard');
  if (hardBox) { hardBox.disabled = !open.modes.includes('hard'); if (hardBox.disabled) { hardBox.checked = false; $('mode-standard').checked = true; } }
  $('projects').innerHTML = content.projects.map((p) => {
    if (!open.projects.includes(p.id)) {
      const at = P.RANKS.find((r) => r.unlocks.projects.includes(p.id));
      return `<div class="project locked"><span class="project-body"><span class="project-top"><strong>${esc(p.title)}</strong></span><span class="small muted">Unlocks at ${esc(at?.label ?? 'a higher rank')}</span></span></div>`;
    }
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
  const chosen = content.projects.find((p) => p.id === selectedProject);
  $('plan-entry').innerHTML = open.plan.includes('build') && chosen
    ? `<button type="button" id="open-plan">Build the plan for ${esc(chosen.title)}</button><small class="muted">Or plan it before you run it: set each task's weeks, links and backup, and eight checks grade the plan as you go.</small>`
    : '<small class="muted">Build the Plan unlocks at Project Manager.</small>';
  $('critique-entry').innerHTML = critiqueEntryHtml(open);
}

// Critique the Plan: the sample rounds (all on Intro to Psychology for now), easiest first, yours marked.
function critiqueEntryHtml(open) {
  const rounds = roundChoices(content.critique, P.rankOf(loadProfile(localStore()) ?? P.newProfile()).id)
    .filter((r) => content.plans?.[r.project] && content.projects.some((p) => p.id === r.project));
  if (!rounds.length) return '';
  if (!open.plan.includes('critique')) return '<small class="muted">Critique the Plan unlocks at Senior PM.</small>';
  const title = content.projects.find((p) => p.id === rounds[0].project)?.title ?? '';
  return `<span class="small"><strong>Critique a plan</strong> · review another PM's draft for ${esc(title)}, flag what's wrong, and see what it would have cost.</span>
    <span class="cq-rounds">${rounds.map((r) => `<button type="button" data-critique="${esc(r.id)}">${esc(r.rank)} round${r.yours ? ' <span class="chip ok">your rank</span>' : ''}</button>`).join('')}</span>`;
}

function startGame() {
  const project = content.projects.find((p) => p.id === selectedProject);
  const mode = $('mode-hard').checked ? 'hard' : 'standard';
  const seed = pickSeed({ typed: $('run-code')?.value, search: location.search, random: randomSeed });
  const difficulty = pickedDifficulty($('difficulty'));
  rememberDifficulty(localStore(), difficulty);
  setTipsEnabled(localStore(), $('tips-on').checked);
  game = createGameAt(S, { world: content.world, project, deck: content.deck, seed, mode, difficulty });
  game.projectRef = project.id;
  game.runId = `${seed}:${Date.now().toString(36)}`;
  lastOutcome = null;
  feed = [];
  hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
  talk = null;
  showGame();
}

function showGame() {
  $('intro').hidden = true;
  $('desk').hidden = true;
  $('end').hidden = true;
  $('game').hidden = false;
  render();
  window.scrollTo?.(0, 0);
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
    : `<span class="clock-me">${playerFace(40)}<span><strong>Week ${game.week}</strong> of ${game.launchWeek}${game.mode === 'hard' ? ' · Hard' : ''}<br>Action Points <span class="ap" aria-label="${game.actionPoints} left">${dots}</span></span></span>`;
}

// Locked design (owner, Nov 20): the status card (schedule gauge, phase bars, in-progress chips, full plan)
// looks right as it is. Change its layout or styles only when the owner asks.
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

// The player's avatar, from the profile (the avatar maker on the start screen).
function player() {
  return loadProfile(localStore())?.player ?? null;
}
// Your face follows the schedule: happy when on track or ahead, worried when behind, frustrated when far behind.
function playerMood() {
  if (!game || !game.log.length) return 'happy';
  const label = S.scheduleStatus(game).label;
  return label === 'far-behind' ? 'frustrated' : label === 'behind' ? 'worried' : 'happy';
}
function playerFace(size, mood = playerMood()) {
  const p = player() ?? defaultPlayer();
  return avatarSVG(p.avatar, mood, { size, label: p.name || 'You' });
}

function renderTeam() {
  $('team').innerHTML = teamHtml(game, { face, esc });
}

function renderCoach() {
  const tip = tipsEnabled(localStore()) ? nextTip(game, seenTips(localStore())) : null;
  $('coach').innerHTML = tip ? `<div class="coach" role="note">
      ${face('sup', 'happy', 48)}
      <div><div class="kicker">${esc(game.supervisor.short)}'s tip</div><p>${esc(tip.text)}</p>
      <div class="row"><button class="primary" data-tip-ok="${esc(tip.id)}">Got it</button><button data-tip-off>Turn tips off</button></div></div>
    </div>` : '';
}

function renderTurn() {
  renderCoach();

  const ev = S.currentEvent(game);
  if (ev) {
    if (hard.eventId !== ev.id) hard = { eventId: ev.id, text: '', stage: 'write', error: '', allowPick: false };
    const conv = talkable(ev);
    if (conv) {
      if (talk?.eventId !== ev.id) startTalk(ev, conv);
      $('event').innerHTML = renderTalk(ev);
      const line = $('talk-line');
      if (line) {
        line.value = talk.draft;
        line.oninput = () => { talk.draft = line.value; $('talk-send').disabled = line.value.trim().length < 2; };
      }
      const log = $('talk-log');
      if (log) log.scrollTop = log.scrollHeight;
    } else {
    $('event').innerHTML = renderEvent(ev);
    const box = $('answer');
    if (box) {
      box.value = hard.text;
      box.oninput = () => { hard.text = box.value; $('submit-answer').disabled = box.value.trim().length < 15; };
    }
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

  // Weekly moves v2: signals, the meeting focus (free) and team moves (Action Points).
  const hints = P.rankOf(loadProfile(localStore()) ?? P.newProfile()).id === 'coordinator';
  $('stepper').innerHTML = stepperHtml(game, { situation: Boolean(ev) });
  $('actions').innerHTML = `<div class="steps ${ev ? 'waiting' : ''}">${signalsHtml(M.signals(game, { hints }), esc)
    + meetingHtml(game, M.meetingOptions(game), esc, { blocked: Boolean(ev), facultyFace: face('faculty', null, 52) })
    + movesHtml(game, M.moveOptions(game), esc, face, { blocked: Boolean(ev) })}</div>`;
  const launch = game.week === game.launchWeek;
  $('end-head').innerHTML = `${icon('end', { size: 44, tone: 'rose' })}<div class="step-title"><span class="step-n">Step 4</span><h3>${launch ? 'Launch day' : 'End the week'}</h3><span class="small muted">${ev ? 'Handle the situation first.' : game.weekFlags.meeting ? 'The team works through the week, then you see where the hours went.' : 'No meeting focus picked: it will be a routine status meeting.'}</span></div>`;
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

function renderEnd() {
  $('game').hidden = true;
  $('stepper').innerHTML = '';
  const r = game.result;
  const s = r.scores;
  const label = { scope: 'Course complete', quality: 'Quality', team: 'Team health', faculty: 'Faculty trust', judgment: 'Judgment' };
  const lessons = S.debrief(game);
  // Progression: add this run to the profile once (applyRun ignores a run it has already counted).
  if (!game.xp) {
    const res = P.applyRun(loadProfile(localStore()) ?? P.newProfile(), game);
    saveProfile(localStore(), res.profile);
    game.xp = { total: res.total, gained: res.gained, newBadges: res.newBadges, promotion: res.promotion, levelUps: res.levelUps, duplicate: res.duplicate };
    save();
  }
  const xpPanel = xpPanelHtml({ ...game.xp, profile: loadProfile(localStore()) ?? P.newProfile() }, esc);
  $('profile').hidden = true;
  $('end').hidden = false;
  $('end').innerHTML = `
    <div class="kicker">${esc(game.project.title)}${game.mode === 'hard' ? ' · Hard mode' : ''}${game.difficulty === 'story' ? ' · Story' : ''}</div>
    <div class="grade">${r.grade}</div>
    <h2>${r.launchedOnTime ? `Launched on time in week ${r.finishedWeek}` : 'Launch day arrived before the course was finished'}</h2>
    <p>Overall score ${r.overall}. ${r.launchedOnTime ? 'Students open a finished course.' : `About ${100 - s.scope}% of the planned work wasn't done by launch.`}</p>
    <div class="scores">${Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => `<div class="score"><div class="k">${label[k]}</div><div class="v">${v}</div></div>`).join('')}</div>
    ${xpPanel}
    <section class="coach-debrief" id="coach-debrief" aria-live="polite"></section>
    ${avoidedHtml(M.avoided(game), game.v2?.deferred ?? [], game, esc)}
    <h2>Situation by situation</h2>
    <p class="muted small">Situations you handled with the best move are folded; open any of them to review.</p>
    ${lessons.length ? lessons.map(renderLesson).join('') : '<p>No situations came up this run.</p>'}
    <p class="muted small">Run code: <strong>${esc(game.seed)}</strong>. Type it on the start screen to replay these situations.</p>
    <div class="row">
      <button class="primary" id="again">Play another project</button>
      <button id="replay">Replay this run (same events)</button>
    </div>`;
  renderCoachDebrief();
  $('again').onclick = () => { clearSave(); showIntro(); };
  $('replay').onclick = () => {
    const { seed, mode, projectRef, difficulty } = game;
    clearSave();
    const project = content.projects.find((p) => p.id === projectRef);
    game = createGameAt(S, { world: content.world, project, deck: content.deck, seed, mode, difficulty });
    game.projectRef = projectRef;
    game.runId = `${seed}:${Date.now().toString(36)}`;
    lastOutcome = null;
    feed = [];
    showGame();
  };
}

// ---------- AI end-of-run debrief (engine/impact.js + engine/debrief-gm.js) ----------

// The engine finds the moves that mattered by replaying the run; the template text shows at once and
// Claude's wording replaces it when it passes the checks. Cached on the game so re-renders are instant.
function renderCoachDebrief() {
  const box = $('coach-debrief');
  if (!box) return;
  if (game.coach) { paintCoachDebrief(); return; }
  box.innerHTML = '<p class="muted small">Working out which of your moves mattered most…</p>';
  setTimeout(() => {
    if (!game?.over || game.coach) return;
    const project = content.projects.find((p) => p.id === game.projectRef);
    let report;
    try { report = I.impactReport({ world: content.world, project, deck: content.deck }, game); } catch { report = null; }
    if (!report?.exact) { game.coach = { none: true }; paintCoachDebrief(); return; }
    const packet = G.debriefPacket(game, report);
    game.coach = { packet, debrief: G.fallbackDebrief(packet), source: 'engine' };
    save();
    paintCoachDebrief();
    if (aiState === 'ready') askCoach();
  }, 30);
}

async function askCoach() {
  const run = game;
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await sample.json(G.debriefPrompt(run.coach.packet, problems));
      const checked = G.checkDebrief(reply, run.coach.packet);
      if (checked.ok) {
        run.coach.debrief = checked.debrief;
        run.coach.source = 'claude';
        if (run === game) { save(); paintCoachDebrief(); }
        return;
      }
      problems = checked.problems;
    } catch { return; } // Claude unavailable: the engine's text stays
  }
}

function paintCoachDebrief() {
  const box = $('coach-debrief');
  if (!box || !game.coach) return;
  if (game.coach.none) { box.innerHTML = ''; return; }
  const { packet, debrief, source } = game.coach;
  const card = (m, i) => {
    const p = packet.moves.find((x) => x.ref === m.ref) ?? {};
    const label = p.kind === 'kept' ? 'Good call' : p.kind === 'missed' ? 'Missed chance' : 'Habit';
    return `<div class="move-card ${esc(p.kind ?? '')}">
      <div class="kicker">${i + 1}. ${label}${p.week ? ` · week ${p.week}` : ''} · ${esc(p.title ?? '')}</div>
      <p>${esc(m.what_happened)}</p>
      <p class="small"><strong>${esc(String(m.concept ?? '').replace(/[.\s]+$/, ''))}.</strong> ${esc(m.why)}</p>
      ${p.sop ? `<p class="small muted">${esc(p.sop)}</p>` : ''}
    </div>`;
  };
  const cf = debrief.counterfactual;
  box.innerHTML = `<h2>What mattered most</h2>
    <p class="headline">${esc(debrief.headline)}</p>
    ${debrief.moves.map(card).join('')}
    ${cf ? `<div class="counterfactual"><p>${esc(cf.text)}</p><button class="primary" id="replay-from" data-week="${packet.replay_offer.week}">Replay from week ${packet.replay_offer.week}</button></div>` : ''}
    <p class="takeaway"><strong>Takeaway:</strong> ${esc(debrief.takeaway)}</p>
    <p class="muted small">${source === 'claude' ? 'Written by Claude from the simulation\'s numbers.' : 'From the simulation\'s numbers'}; points are averages over ${packet.futures} replays with different luck.</p>`;
  const btn = $('replay-from');
  if (btn) btn.onclick = () => replayFrom(Number(btn.dataset.week));
}

// Go back to the start of a week with its situation waiting, and play on from there.
function replayFrom(week) {
  const project = content.projects.find((p) => p.id === game.projectRef);
  const back = I.replay({ world: content.world, project, deck: content.deck }, I.recordOf(game), { untilWeek: week });
  back.runId = `${back.seed}:${Date.now().toString(36)}:w${week}`;
  game = back;
  lastOutcome = null;
  feed = [];
  hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
  talk = null;
  showGame();
}

function renderLesson(l) {
  if (l.kind === 'pattern') {
    return `<div class="lesson"><h3>${esc(l.title)}</h3><div class="tier">${esc(l.concept)}</div><p>${esc(l.independent)}</p></div>`;
  }
  const [cls, verdict] = VERDICT(l.credit);
  const written = l.response
    ? `<dt>You wrote</dt><dd class="quote">${esc(l.response)}</dd>${l.feedback ? `<dt>Feedback</dt><dd>${esc(l.feedback)}</dd>` : `<dt>Closest option you picked</dt><dd>${esc(l.chosen)} <span class="muted">${esc(l.why)}</span></dd>`}`
    : `<dt>You chose</dt><dd>${esc(l.chosen)} <span class="muted">${esc(l.why)}</span></dd>`;
  const talked = game.conversations?.find((c) => c.week === l.week && c.title === l.title);
  const talkRows = talked ? `
      <dt>Conversation</dt><dd>${esc(talked.outcome)} · rubric ${talked.total}/10${talked.change !== null ? ` · ${talked.meter} ${talked.change >= 0 ? '+' : ''}${talked.change}` : ''}${talked.slipped ? ' · the commitment slipped' : ''}</dd>
      ${talked.best ? `<dt>Your strongest line</dt><dd class="quote">${esc(talked.best)}</dd>` : ''}
      ${talked.weakest ? `<dt>Your weakest line</dt><dd class="quote">${esc(talked.weakest)}</dd>` : ''}
      <dt>What was really going on</dt><dd>${esc(talked.talkTo === 'director' ? 'The media director' : person(talked.talkTo).name)} ${esc(talked.hiddenConcern)}.${talked.revealed ? ' You uncovered it.' : ' An open question about their situation would have brought it out.'}</dd>` : '';
  return `<details class="lesson" ${l.credit < 0.95 ? 'open' : ''}>
    <summary class="lesson-head">${face(l.who ?? 'ld', l.credit >= 0.95 ? 'happy' : l.credit >= 0.6 ? 'neutral' : 'worried', 44)}<div><h3>Week ${l.week}: ${esc(l.title)}</h3>
    <div class="tier"><span class="chip ${cls}">${verdict}</span> ${l.response ? 'Written answer' : esc(l.tierLabel)} · ${Math.round(l.credit * 100)}% credit</div></div></summary>
    <dl>
      ${talked ? talkRows : written}
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

// ---------- hard mode conversations ----------

const UNAVAILABLE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
const playerLines = () => (talk?.transcript ?? []).filter((m) => m.from === 'player');

// A conversation runs for the six talkable situations in hard mode while Claude is available,
// unless the player has fallen back to picking the closest option.
function talkable(ev) {
  if (game.mode !== 'hard' || aiState !== 'ready' || !content.conversations || !content.stakeholders) return null;
  if (hard.eventId === ev.id && hard.stage === 'pick') return null;
  return C.conversationFor(game, ev.id, content.conversations);
}

function startTalk(ev, conv) {
  talk = { eventId: ev.id, conv, packet: C.contextPacket(game, conv, content.stakeholders), transcript: [], stage: 'opening', draft: '', error: '', fails: 0, retry: null };
  askReply();
}

async function callClaude(prompt, retry) {
  talk.retry = retry;
  talk.error = '';
  talk.ctl = new AbortController();
  try {
    return await sample.json(prompt, { signal: talk.ctl.signal });
  } finally {
    if (talk) talk.ctl = null;
  }
}

function talkFailed(e) {
  if (!talk) return;
  const code = e?.code;
  if (UNAVAILABLE.includes(code)) {
    aiState = 'none';
    talk = null;
    hard.stage = 'write';
    hard.error = 'Claude isn\'t available here, so write what you would do, then pick the closest option.';
  } else {
    talk.stage = 'error';
    talk.error = code === 'rate_limited' ? 'Claude is busy right now. Try again in a minute, or pick the closest option instead.' : 'The conversation didn\'t go through. Try again, or pick the closest option instead.';
  }
  renderTurn();
}

async function askReply() {
  const id = talk.eventId;
  talk.stage = talk.transcript.length ? 'waiting' : 'opening';
  renderTurn();
  try {
    const reply = C.checkReply(await callClaude(C.turnPrompt(talk.packet, talk.transcript), askReply));
    if (!reply) throw { code: 'invalid_json' };
    if (talk?.eventId !== id) return;
    talk.transcript.push({ from: 'stakeholder', text: reply });
    talk.stage = 'player';
    renderTurn();
  } catch (e) { talkFailed(e); }
}

function sendLine() {
  const text = talk?.draft.trim();
  if (!text || talk.stage !== 'player') return;
  talk.transcript.push({ from: 'player', text: text.slice(0, 1200) });
  talk.draft = '';
  if (playerLines().length >= C.MAX_TURNS) requestVerdict(false);
  else askReply();
}

function endTalk(escalated) {
  if (!talk || talk.stage !== 'player') return;
  if (escalated && talk.draft.trim()) talk.transcript.push({ from: 'player', text: talk.draft.trim().slice(0, 1200) });
  if (!playerLines().length) return;
  talk.draft = '';
  requestVerdict(escalated);
}

async function requestVerdict(escalated) {
  talk.stage = 'judging';
  talk.escalated = escalated;
  renderTurn();
  try {
    const raw = await callClaude(C.verdictPrompt(talk.packet, talk.transcript, { escalated }), () => requestVerdict(escalated));
    const checked = C.checkVerdict(raw, talk.packet, talk.transcript, { escalated });
    if (!checked.ok) {
      talk.fails += 1;
      if (talk.fails >= 2) { pickInsteadOfTalk('Claude\'s verdict didn\'t come back in a usable form, so pick the option closest to what you said.'); return; }
      requestVerdict(escalated);
      return;
    }
    const ev = S.currentEvent(game);
    const res = C.applyVerdict(game, talk.conv, checked.verdict, talk.transcript);
    const v = checked.verdict;
    const feedback = [
      `Outcome: ${v.outcome} (rubric ${C.rubricTotal(v.rubric)}/10).`,
      v.hidden_concern_revealed ? 'You found out what was really going on.' : '',
      v.no_escalation_path,
    ].filter(Boolean).join(' ');
    lastOutcome = { title: S.say(game, ev.title), text: res.outcome, why: res.why, credit: res.credit, reaction: res.reaction, who: res.who, feedback, graded: true };
    talk = null;
    hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
    render();
  } catch (e) { talkFailed(e); }
}

function retryTalk() {
  if (talk?.retry) talk.retry();
}

function pickInsteadOfTalk(message = '') {
  if (!talk) return;
  talk.ctl?.abort();
  hard = { eventId: talk.eventId, text: playerLines().map((m) => m.text).join('\n'), stage: 'pick', error: message, allowPick: false };
  talk = null;
  renderTurn();
}

function renderTalk(ev) {
  const who = ev.who ?? 'ld';
  const them = talk.packet.stakeholder.name;
  const busy = talk.stage === 'opening' || talk.stage === 'waiting' || talk.stage === 'judging';
  const n = playerLines().length;
  const bubbles = talk.transcript.map((m) => `<div class="bubble ${m.from === 'player' ? 'me' : 'them'}"><strong>${m.from === 'player' ? 'You' : esc(them)}</strong><p>${esc(m.text)}</p></div>`).join('');
  const status = talk.stage === 'opening' || talk.stage === 'waiting' ? `<p class="muted small" role="status">${esc(them)} is replying…</p>`
    : talk.stage === 'judging' ? '<p class="muted small" role="status">Wrapping up the conversation…</p>' : '';
  const controls = talk.stage === 'error'
    ? `<p class="small error">${esc(talk.error)}</p><div class="row"><button class="primary" id="talk-retry">Try again</button><button id="talk-pick">Pick the closest option instead</button></div>`
    : `<label class="prompt" for="talk-line">Your reply to ${esc(them)} <span class="muted small">(${Math.min(n + 1, C.MAX_TURNS)} of ${C.MAX_TURNS})</span></label>
      <textarea id="talk-line" rows="3" ${busy ? 'disabled' : ''} placeholder="Ask, propose, agree a date…"></textarea>
      <div class="row">
        <button class="primary" id="talk-send" ${busy || talk.draft.trim().length < 2 ? 'disabled' : ''}>Send</button>
        <button id="talk-end" ${busy || !n ? 'disabled' : ''}>End the conversation</button>
        <button id="talk-escalate" ${busy ? 'disabled' : ''}>Escalate to ${esc(game.supervisor.short)}</button>
      </div>`;
  return `<div class="event pop">
    <div class="event-head">${face(who, ev.mood, 80)}<div><div class="kicker">Situation · ${esc(S.say(game, ev.title))}</div><div class="who">Talk it through with ${esc(them)}</div></div></div>
    <p>${esc(S.say(game, ev.text))}</p>
    <div class="talk-log" id="talk-log" aria-live="polite">${bubbles}</div>
    ${status}${controls}</div>`;
}

// ---------- Build the Plan ----------

function showPlanner() {
  const project = content.projects.find((p) => p.id === selectedProject);
  $('intro').hidden = true;
  $('desk').hidden = true;
  $('end').hidden = true;
  $('game').hidden = true;
  $('profile').hidden = true;
  $('planner').hidden = false;
  planner?.unmount();
  const rank = P.rankOf(loadProfile(localStore()) ?? P.newProfile()).id;
  planner = mountPlanEditor($('planner'), {
    project, world: content.world, deck: content.deck, prompts: content.risks ?? null, store: localStore(), rank, onExit: showIntro,
    baseline: content.plans?.[project.id] ?? null, flaws: content.flaws ?? {},
    // A submitted plan goes on the profile: XP by check, only what beats this project's best plan.
    onScored: (score, { standIn }) => {
      const res = P.applyPlanRound(loadProfile(localStore()) ?? P.newProfile(), { project: project.id, score, standIn, at: new Date().toISOString() });
      saveProfile(localStore(), res.profile);
      return res;
    },
  });
  window.scrollTo?.(0, 0);
}

function showCritique(id) {
  const round = content.critique?.rounds?.find((r) => r.id === id);
  const project = content.projects.find((p) => p.id === round?.project);
  if (!round || !project) return;
  $('intro').hidden = true;
  $('desk').hidden = true;
  $('end').hidden = true;
  $('game').hidden = true;
  $('profile').hidden = true;
  $('planner').hidden = false;
  planner?.unmount();
  planner = null;
  critic?.unmount();
  critic = mountCritique($('planner'), {
    sample: round, project, world: content.world, deck: content.deck, flawFiles: content.flaws ?? {}, baseline: content.plans[project.id], onExit: showIntro,
    // Hard mode on the start screen pre-selects written fixes; Claude grades them where the page can ask it.
    fixMode: $('mode-hard')?.checked ? 'write' : 'pick',
    grader: aiState === 'ready' && sample ? (prompt, opts) => sample.json(prompt, opts) : null,
    // A finished review goes on the profile: XP on the flaws' tracks, only what beats your best on this round.
    onScored: (r, result) => {
      const res = P.applyCritiqueRound(loadProfile(localStore()) ?? P.newProfile(), { round: r, result, at: new Date().toISOString() });
      saveProfile(localStore(), res.profile);
      return res;
    },
  });
  window.scrollTo?.(0, 0);
}

function closePlannerView() {
  closeMissionView();
  critic?.unmount();
  critic = null;
  planner?.unmount();
  planner = null;
  $('planner').hidden = true;
}

// ---------- profile ----------

function showProfile() {
  profileReturn = !$('end').hidden ? 'end' : 'intro';
  closeMissionView();
  const profile = loadProfile(localStore()) ?? P.newProfile();
  $('intro').hidden = true;
  $('desk').hidden = true;
  $('end').hidden = true;
  $('game').hidden = true;
  $('profile').hidden = false;
  $('profile').innerHTML = profileHtml(profile, esc);
  $('profile').scrollIntoView?.({ block: 'start' });
}

function closeProfile() {
  $('profile').hidden = true;
  if (profileReturn === 'end' && game?.over) { $('end').hidden = false; renderEnd(); } else showIntro();
}

async function copyProfileCode() {
  const code = P.exportCode(loadProfile(localStore()) ?? P.newProfile());
  $('profile-code').value = code;
  try { await navigator.clipboard.writeText(code); $('profile-msg').textContent = 'Copied. Paste it on the other device.'; } catch { $('profile-msg').textContent = 'Copy the code from the box above.'; }
}

function importProfileCode() {
  const p = P.importCode($('profile-code').value);
  if (!p) { $('profile-msg').textContent = 'That isn\'t a profile code. It starts with CP1.'; return; }
  saveProfile(localStore(), p);
  $('profile').innerHTML = profileHtml(p, esc);
  $('profile-msg').textContent = 'Profile loaded.';
}

// ---------- input ----------

document.addEventListener('change', (e) => {
  if (e.target.name === 'project') {
    selectedProject = e.target.value;
    renderProjects();
  }
});

document.addEventListener('click', (e) => {
  if (makerClick(e)) return;
  if (e.target.closest('#open-profile')) { showProfile(); return; }
  if (e.target.closest('#open-plan')) { showPlanner(); return; }
  const mission = e.target.closest('[data-mission]');
  if (mission) { showMission(mission.dataset.mission); return; }
  const crit = e.target.closest('[data-critique]');
  if (crit) { showCritique(crit.dataset.critique); return; }
  if (e.target.closest('#profile-close')) { closeProfile(); return; }
  if (e.target.closest('#profile-copy')) { copyProfileCode(); return; }
  if (e.target.closest('#profile-import')) { importProfileCode(); return; }
  const tipOk = e.target.closest('[data-tip-ok]');
  if (tipOk) { markSeen(localStore(), tipOk.dataset.tipOk); renderCoach(); return; }
  if (e.target.closest('[data-tip-off]')) { setTipsEnabled(localStore(), false); renderCoach(); return; }
  if (e.target.closest('#submit-answer')) { submitAnswer(); return; }
  if (e.target.closest('#talk-send')) { sendLine(); return; }
  if (e.target.closest('#talk-end')) { endTalk(false); return; }
  if (e.target.closest('#talk-escalate')) { endTalk(true); return; }
  if (e.target.closest('#talk-retry')) { retryTalk(); return; }
  if (e.target.closest('#talk-pick')) { pickInsteadOfTalk(); return; }
  if (e.target.closest('#stop-grading')) { gradingCtl?.abort(); return; }
  if (e.target.closest('#pick-instead')) { hard.stage = 'pick'; hard.error = ''; renderTurn(); return; }
  const choice = e.target.closest('[data-choice]');
  const meeting = e.target.closest('[data-meeting]');
  const move = e.target.closest('[data-move]');
  if (choice) {
    const ev = S.currentEvent(game);
    const written = game.mode === 'hard' && hard.text.trim() ? { response: hard.text.trim() } : {};
    const res = S.chooseOption(game, choice.dataset.choice, written);
    lastOutcome = { title: S.say(game, ev.title), text: res.outcome, why: res.why, credit: res.credit, reaction: res.reaction, who: res.who };
    hard = { eventId: null, text: '', stage: 'write', error: '', allowPick: false };
    render();
  } else if (meeting && !meeting.disabled) {
    M.setMeetingFocus(game, meeting.dataset.meeting);
    render();
  } else if (move && !move.disabled) {
    const label = M.moveOptions(game).find((o) => o.id === move.dataset.move)?.label ?? move.dataset.move;
    const note = M.takeMove(game, move.dataset.move);
    feed.push({ week: game.week, text: `${label}: ${note.detail}` });
    render();
  }
});

$('start').onclick = startGame;
$('end-week').onclick = () => {
  M.endWeek(game);
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
function localStore() {
  try { return localStorage; } catch { return null; }
}
function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

init().catch((err) => {
  $('main').innerHTML = `<div class="card"><h2>Couldn't start the game</h2><p>${esc(err.message)}. Open it through a local web server (npm start) rather than as a file.</p></div>`;
});
