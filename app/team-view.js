// The team panel: last week's recap per person (where their hours went, as a bar in their shirt colour),
// morale or trust with the change since the week before, and the week's headline (finished work, rework
// found, schedule pressure). Pure HTML builders; app.js passes face() and esc().
import * as S from '../engine/sim.js';
import { icon } from './icons.js';
import { displayName } from '../engine/player.js';

const SCALE = 22; // hours at full bar width, so people compare at a glance

function tint(hex, f) {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f));
  return `#${c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

const taskName = (game, id) => game.tasks.find((t) => t.id === id)?.name ?? id;
const short = (s) => String(s).replace(/^Faculty /, '').replace(/\s*\(.*\)$/, '').replace(/:.*$/, '');

// One person's week as segments: each task's new work, rework fixed, and hours left idle.
export function weekSegments(game, entry, role) {
  if (!entry?.work) return [];
  const shirt = (role === 'faculty' ? game.team.faculty.avatar?.shirt : game.team[role].avatar?.shirt) ?? '#55657a';
  const segs = [];
  let fix = 0;
  (entry.work[role] ?? []).forEach((w, i) => {
    if (w.new > 0) segs.push({ kind: 'work', task: w.task, label: short(taskName(game, w.task)), hours: w.new, color: tint(shirt, i % 2 ? 1.35 : 1) });
    fix += w.fix;
  });
  if (fix >= 0.5) segs.push({ kind: 'fix', label: 'fixing rework', hours: Math.round(fix * 10) / 10 });
  const idle = entry.idle?.[role] ?? 0;
  if (idle >= 0.5) segs.push({ kind: 'idle', label: role === 'faculty' && !(entry.work[role] ?? []).length ? 'nothing due' : 'waiting', hours: idle });
  return segs;
}

function hoursBar(segs, esc) {
  const total = segs.reduce((s, x) => s + x.hours, 0);
  if (!total) return '<div class="hbar empty"><span class="muted small">No hours last week</span></div>';
  const bar = segs.map((x) => `<i class="seg ${x.kind}" style="width:${Math.min(100, (100 * x.hours) / SCALE)}%${x.color ? `;background:${x.color}` : ''}" title="${esc(x.label)}: ${x.hours}h"></i>`).join('');
  const legend = segs.map((x) => `<span class="lg ${x.kind}"><b${x.color ? ` style="background:${x.color}"` : ''}></b>${esc(x.label)} ${Math.round(x.hours)}h</span>`).join('');
  return `<div class="hbar" role="img" aria-label="${esc(segs.map((x) => `${x.label} ${Math.round(x.hours)} hours`).join(', '))}">${bar}</div><div class="legend">${legend}</div>`;
}

function meterRow(label, value, delta) {
  const cls = value < 45 ? 'low' : value < 65 ? 'mid' : 'ok';
  const d = Math.round(delta ?? 0);
  return `<div class="meter2"><span>${label}</span><div class="bar ${cls}"><i style="width:${Math.round(value)}%"></i></div><span class="val">${Math.round(value)}${d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : ''}</span></div>`;
}

// The week's headline chips.
export function recapHtml(game, esc) {
  const last = game.log.at(-1);
  if (!last) return `<div class="recap-head"><div class="recap-title">${icon('recap', { size: 34, tone: 'blue' })}<div><strong>Week ${game.week} is the first week</strong><span class="muted small">After you end it, each person's hours show here.</span></div></div></div>`;
  const chips = [];
  if (last.completed.length) chips.push(`<span class="rchip good">${icon('finished', { size: 22, tone: 'teal' })}Finished: ${esc(last.completed.map((id) => taskName(game, id)).join(', '))}</span>`);
  if (last.discovered >= 1) chips.push(`<span class="rchip warn">${icon('rework', { size: 22, tone: 'amber' })}${Math.round(last.discovered)}h of rework surfaced</span>`);
  if (last.pressure >= 0.3) chips.push(`<span class="rchip bad">${icon('pressure', { size: 22, tone: 'rose' })}The team feels the schedule pressure</span>`);
  if (!chips.length) chips.push('<span class="rchip">A steady week: nothing finished, no rework found</span>');
  return `<div class="recap-head"><div class="recap-title">${icon('recap', { size: 34, tone: 'blue' })}<div><strong>Last week (week ${last.week})</strong><span class="muted small">Where everyone's hours went</span></div></div><div class="rchips">${chips.join('')}</div></div>`;
}

export function teamHtml(game, { face, esc, player = null, playerFace = null }) {
  const last = game.log.at(-1);
  const prev = game.log.at(-2);
  const card = (role, title, sub, body, cls = '') => `<div class="mate ${cls}">${face(role, null, 52)}<div class="mate-body"><div class="mate-top"><span class="name">${esc(title)}</span><span class="role">${esc(sub)}</span></div>${body}</div></div>`;
  const you = playerFace ? `<div class="mate you">${playerFace}<div class="mate-body"><div class="mate-top"><span class="name">${esc(displayName(player))}</span><span class="role">Project manager · that's you</span></div>
    <div class="ap-big" aria-label="${game.actionPoints} Action Points left">${Array.from({ length: game.actionPointsPerWeek }, (_, i) => `<span class="${i < game.actionPoints ? 'full' : ''}"></span>`).join('')}<small>${game.actionPoints} Action Point${game.actionPoints === 1 ? '' : 's'} left this week</small></div></div></div>` : '';
  const staff = S.STAFF.map((r) => {
    const p = game.team[r];
    const before = prev?.morale?.[r] ?? (last ? null : undefined);
    const delta = last?.morale && before != null ? p.morale - before : 0;
    return card(r, p.name, p.role, `${last ? hoursBar(weekSegments(game, last, r), esc) : ''}${meterRow('Morale', p.morale, delta)}`);
  });
  const f = game.team.faculty;
  const fDelta = last?.trust != null && prev?.trust != null ? f.trust - prev.trust : 0;
  const fac = card('faculty', f.name, 'Faculty partner', `${last ? hoursBar(weekSegments(game, last, 'faculty'), esc) : ''}${meterRow('Trust', f.trust, fDelta)}`, 'faculty');
  const sup = `<div class="mate sup">${face('sup', null, 40)}<div class="mate-body"><div class="mate-top"><span class="name">${esc(game.supervisor.name)}</span><span class="role">${esc(game.supervisor.role)} · you can escalate to ${esc(game.supervisor.short)}</span></div></div></div>`;
  return `${recapHtml(game, esc)}${you}${staff.join('')}${fac}${sup}`;
}
