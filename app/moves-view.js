// The "This week" panel for weekly moves v2, laid out as steps: (1) what you're noticing, (2) the focus
// for the weekly meeting with the faculty partner (free), (3) team moves for Action Points, (4) end the
// week. Pure HTML builders; app.js wires the clicks (data-meeting, data-move).
// Design: "Weekly moves v2" tab of the framework doc.
import * as S from '../engine/sim.js';
import { icon } from './icons.js';

const LEVEL = { 3: 'urgent', 2: 'watch', 1: 'note' };
const LEVEL_WORD = { 3: 'Act soon', 2: 'Watch', 1: 'Note' };
const MOVE_ICON = { checkin: 'checkin', review: 'review', 'qa-review': 'review', overtime: 'overtime', 'status-update': 'status-update', 'team-meeting': 'team-meeting', defer: 'defer', placeholder: 'placeholder', backup: 'backup', prevent: 'prevent' };
const iconFor = (id) => MOVE_ICON[String(id).split(':')[0]] ?? 'status';

const stepHead = (n, name, tone, title, aside = '') => `<div class="step-head">${icon(name, { size: 44, tone })}<div class="step-title"><span class="step-n">Step ${n}</span><h3>${title}</h3></div>${aside}</div>`;

// Where the player is in the week: each step done, waiting or still open.
export function stepperHtml(game, { situation = false } = {}) {
  const meetingDone = Boolean(game.weekFlags.meeting);
  const spent = game.actionPoints < game.actionPointsPerWeek;
  const steps = [
    ['Notice', 'notice', true],
    ['Meeting', 'meeting', meetingDone],
    ['Moves', 'moves', game.actionPoints === 0],
    ['End week', 'end', false],
  ];
  const now = situation ? -1 : !meetingDone ? 1 : game.actionPoints > 0 ? 2 : 3;
  return `<ol class="stepper" aria-label="This week's steps">
    ${situation ? `<li class="st now sit">${icon('situation', { size: 26, tone: 'amber' })}<span>Situation first</span></li>` : ''}
    ${steps.map(([label, name, done], i) => `<li class="st ${done && i !== 0 ? 'done' : ''} ${i === now ? 'now' : ''} ${i === 2 && spent && !done ? 'part' : ''}">${icon(name, { size: 26, tone: i === now ? 'gold' : 'grey' })}<span>${label}</span></li>`).join('')}
  </ol>`;
}

// Signals: symptoms a PM would notice, most pressing first. Hints only at Coordinator rank.
export function signalsHtml(signals, esc) {
  const head = stepHead(1, 'notice', 'amber', 'What you\'re noticing');
  if (!signals.length) return `<section class="step signals quiet">${head}<p class="muted small">Nothing stands out this week.</p></section>`;
  return `<section class="step signals">${head}<ul>${signals.map((s) => `<li class="sig ${LEVEL[s.level]}"><span class="lvl">${LEVEL_WORD[s.level]}</span><span class="sig-text">${esc(s.text)}${s.hint ? `<span class="hint">${esc(s.hint)}</span>` : ''}</span></li>`).join('')}</ul></section>`;
}

// The weekly meeting: one focus a week, free. Once picked, it shows what came of it.
export function meetingHtml(game, options, esc, { blocked = false, facultyFace = '' } = {}) {
  const fac = S.say(game, '{faculty}');
  const picked = game.weekFlags.meeting;
  if (picked) {
    const entry = [...game.actionsTaken].reverse().find((a) => a.week === game.week && a.actionId === 'meeting');
    const label = options.find((o) => o.id === picked)?.label ?? (picked === 'status' ? 'Routine status' : picked);
    return `<section class="step meeting done">${stepHead(2, 'meeting', 'teal', `Weekly meeting with ${esc(fac)}`, '<span class="pill good">Done</span>')}
      <div class="picked">${icon(picked, { size: 40, tone: 'teal' })}<p><strong>${esc(label)}.</strong> ${esc(entry?.detail ?? '')}</p></div></section>`;
  }
  return `<section class="step meeting ${blocked ? '' : 'open'}">${stepHead(2, 'meeting', 'teal', `Weekly meeting with ${esc(fac)}`, `<span class="pill">Free · pick one</span>`)}
    <div class="meet-intro">${facultyFace}<p class="small">You meet ${esc(fac)} every week anyway. What should this week's meeting focus on? If you don't pick, it's a routine status meeting.</p></div>
    <div class="tiles focus">${options.map((o) => `<button class="tile" data-meeting="${esc(o.id)}" ${blocked ? 'disabled' : ''}>${icon(o.id, { size: 40, tone: 'teal' })}<span class="tile-text"><strong>${esc(o.label)}</strong><span class="help">${esc(o.help)}</span></span></button>`).join('')}</div></section>`;
}

const pips = (n) => `<span class="pips" aria-label="${n} Action Point${n === 1 ? '' : 's'}">${'<i></i>'.repeat(n)}</span>`;

// Team moves: risks and situation moves first (when the board offers them), then the core menu with
// per-person buttons for check-ins and extra hours, then what you've done this week.
export function movesHtml(game, options, esc, face, { blocked = false } = {}) {
  const dis = (o) => (blocked || !o.affordable ? 'disabled' : '');
  const tile = (o, tone) => `<button class="tile" data-move="${esc(o.id)}" ${dis(o)}>${icon(iconFor(o.id), { size: 40, tone })}<span class="tile-text"><strong>${esc(o.label)}</strong><span class="help">${esc(o.help)}</span></span>${pips(o.cost)}</button>`;
  const people = (prefix, label, help) => {
    const os = options.filter((o) => o.id.startsWith(`${prefix}:`));
    if (!os.length) return '';
    const off = os.every((o) => dis(o));
    return `<div class="tile people${off ? ' off' : ''}">${icon(prefix, { size: 40, tone: 'blue' })}<span class="tile-text"><strong>${esc(label)}</strong><span class="help">${esc(help)}</span>
      <span class="who-buttons">${os.map((o) => `<button data-move="${esc(o.id)}" ${dis(o)} aria-label="${esc(o.label)}" title="${esc(o.help)}">${face(o.who, null, 36)}<span>${esc(game.team[o.who].short)}</span></button>`).join('')}</span></span>${pips(1)}</div>`;
  };
  const risk = options.filter((o) => o.kind === 'risk');
  const context = options.filter((o) => o.kind === 'context');
  const core = options.filter((o) => o.kind === 'core' && !/^(checkin|overtime):/.test(o.id));
  const ap = game.actionPoints;
  const tokens = `<span class="ap-tokens" aria-hidden="true">${Array.from({ length: game.actionPointsPerWeek }, (_, i) => `<i class="${i < ap ? 'full' : ''}"></i>`).join('')}</span>`;
  const done = game.actionsTaken.filter((a) => a.week === game.week && a.actionId !== 'meeting');
  return `<section class="step moves ${ap > 0 && !blocked ? 'open' : ''}">${stepHead(3, 'moves', 'blue', 'Team moves', `<span class="pill ap-pill">${tokens}${ap} Action Point${ap === 1 ? '' : 's'} left</span>`)}
    ${risk.length ? `<div class="group risk"><div class="group-h">Head off a risk</div><div class="tiles">${risk.map((o) => tile(o, 'teal')).join('')}</div></div>` : ''}
    ${context.length ? `<div class="group context"><div class="group-h">This week's options</div><div class="tiles">${context.map((o) => tile(o, 'gold')).join('')}</div></div>` : ''}
    <div class="group"><div class="group-h">Always available</div><div class="tiles">
      ${people('checkin', 'Check in one-on-one', 'Half an hour. Lifts morale and surfaces problems in their work.')}
      ${core.map((o) => tile(o, 'blue')).join('')}
      ${people('overtime', 'Ask for extra hours', '+5 hours this week; lower morale and more mistakes.')}
    </div></div>
    ${done.length ? `<div class="group did"><div class="group-h">Done this week</div><ul class="did-list">${done.map((a) => `<li>${icon(iconFor(a.actionId), { size: 28, tone: 'grey' })}<span>${esc(a.detail)}</span></li>`).join('')}</ul></div>` : ''}
  </section>`;
}

// Debrief: situations the player headed off, and scope moved to after launch.
export function avoidedHtml(avoided, deferred, game, esc) {
  if (!avoided.length && !deferred.length) return '';
  const name = (id) => game.tasks.find((t) => t.id === id)?.name ?? id;
  return `<section class="avoided"><h2>What you avoided</h2>
    ${avoided.map((a) => `<div class="lesson folded avoided-item">${icon('prevent', { size: 36, tone: 'teal' })}<div><strong>${esc(a.title)}</strong><p class="small">${esc(a.move.replace(/\.?$/, '.'))} The situation never came up. <span class="muted">${esc(a.concept)}</span></p></div></div>`).join('')}
    ${deferred.length ? `<p class="small">Moved to after launch: ${deferred.map((d) => `about ${Math.round(d.hours)} hours of ${esc(name(d.task).toLowerCase())}`).join('; ')}. It counts against course complete.</p>` : ''}
  </section>`;
}
