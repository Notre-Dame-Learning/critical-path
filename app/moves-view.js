// The "This week" panel for weekly moves v2: what you're noticing (signals), the focus for the weekly
// meeting with the faculty partner (free), and team moves for Action Points. Pure HTML builders; app.js
// wires the clicks (data-meeting, data-move). Design: "Weekly moves v2" tab of the framework doc.
import * as S from '../engine/sim.js';

const LEVEL = { 3: 'urgent', 2: 'watch', 1: 'note' };

// Signals: symptoms a PM would notice, most pressing first. Hints only at Coordinator rank.
export function signalsHtml(signals, esc) {
  if (!signals.length) return `<div class="signals quiet"><h3>What you're noticing</h3><p class="muted small">Nothing stands out this week.</p></div>`;
  return `<div class="signals"><h3>What you're noticing</h3><ul>${signals.map((s) => `<li class="sig ${LEVEL[s.level]}"><span class="dot" aria-label="${LEVEL[s.level]}"></span><span>${esc(s.text)}${s.hint ? `<span class="hint">${esc(s.hint)}</span>` : ''}</span></li>`).join('')}</ul></div>`;
}

// The weekly meeting: one focus a week, free. Once picked, it shows what came of it.
export function meetingHtml(game, options, esc, { blocked = false } = {}) {
  const fac = S.say(game, '{faculty}');
  const picked = game.weekFlags.meeting;
  if (picked) {
    const entry = [...game.actionsTaken].reverse().find((a) => a.week === game.week && a.actionId === 'meeting');
    const label = options.find((o) => o.id === picked)?.label ?? (picked === 'status' ? 'Routine status' : picked);
    return `<div class="meeting"><h3>Weekly meeting with ${esc(fac)}</h3><p class="picked"><strong>${esc(label)}.</strong> ${esc(entry?.detail ?? '')}</p></div>`;
  }
  return `<div class="meeting"><h3>Weekly meeting with ${esc(fac)}</h3>
    <p class="muted small">You meet every week anyway. Pick one focus (free); if you don't, it's a routine status meeting.</p>
    <div class="focus">${options.map((o) => `<button data-meeting="${esc(o.id)}" ${blocked ? 'disabled' : ''}>${esc(o.label)}<span class="help">${esc(o.help)}</span></button>`).join('')}</div></div>`;
}

const costTag = (o) => (o.cost > 1 ? ` <span class="cost">${o.cost} AP</span>` : '');

// Team moves: risks and situation moves first (when the board offers them), then the core menu with
// per-person buttons for check-ins and extra hours.
export function movesHtml(game, options, esc, face, { blocked = false } = {}) {
  const dis = (o) => (blocked || !o.affordable ? 'disabled' : '');
  const btn = (o) => `<button data-move="${esc(o.id)}" ${dis(o)}>${esc(o.label)}${costTag(o)}<span class="help">${esc(o.help)}</span></button>`;
  const people = (prefix, label, help) => {
    const os = options.filter((o) => o.id.startsWith(`${prefix}:`));
    if (!os.length) return '';
    const off = os.every((o) => dis(o));
    return `<div class="action-who${off ? ' off' : ''}"><div>${esc(label)}<span class="help">${esc(help)}</span></div>
      <div class="who-buttons">${os.map((o) => `<button data-move="${esc(o.id)}" ${dis(o)} aria-label="${esc(o.label)}" title="${esc(o.help)}">${face(o.who, null, 28)}<span>${esc(game.team[o.who].short)}</span></button>`).join('')}</div></div>`;
  };
  const risk = options.filter((o) => o.kind === 'risk');
  const context = options.filter((o) => o.kind === 'context');
  const core = options.filter((o) => o.kind === 'core' && !/^(checkin|overtime):/.test(o.id));
  return `<div class="moves"><h3>Team moves <span class="muted small">${game.actionPoints} Action Point${game.actionPoints === 1 ? '' : 's'} left</span></h3>
    ${risk.length ? `<div class="group"><div class="group-h">Head off a risk</div><div class="actions">${risk.map(btn).join('')}</div></div>` : ''}
    ${context.length ? `<div class="group"><div class="group-h">This week's options</div><div class="actions">${context.map(btn).join('')}</div></div>` : ''}
    <div class="group"><div class="actions">
      ${people('checkin', 'Check in one-on-one', 'Half an hour. Lifts morale and surfaces problems in their work.')}
      ${core.map(btn).join('')}
      ${people('overtime', 'Ask for extra hours', '+5 hours this week; lower morale and more mistakes.')}
    </div></div></div>`;
}

// Debrief: situations the player headed off, and scope moved to after launch.
export function avoidedHtml(avoided, deferred, game, esc) {
  if (!avoided.length && !deferred.length) return '';
  const name = (id) => game.tasks.find((t) => t.id === id)?.name ?? id;
  return `<section class="avoided"><h2>What you avoided</h2>
    ${avoided.map((a) => `<div class="lesson folded"><strong>${esc(a.title)}</strong><p class="small">${esc(a.move.replace(/\.?$/, '.'))} The situation never came up. <span class="muted">${esc(a.concept)}</span></p></div>`).join('')}
    ${deferred.length ? `<p class="small">Moved to after launch: ${deferred.map((d) => `about ${Math.round(d.hours)} hours of ${esc(name(d.task).toLowerCase())}`).join('; ')}. It counts against course complete.</p>` : ''}
  </section>`;
}
