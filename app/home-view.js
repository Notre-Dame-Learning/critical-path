// The start screen's "your desk" card: your avatar and name, your rank on the career path, XP and the
// gate to the next rank, your eight skill tracks, badges and recent runs. Also the avatar maker.
// Pure HTML builders (avatarSVG and esc passed in), so they can be tested in Node.
import { RANKS, TRACKS, ACHIEVEMENTS, rankOf, nextRank, totalXp } from '../engine/progression.js';
import { TRACK_LABEL, LEVELS, levelOf } from '../engine/tracks.js';
import { SKINS, HAIRS, STYLES, SHIRTS, STYLE_LABEL, MAX_NAME, defaultPlayer, displayName } from '../engine/player.js';
import { icon } from './icons.js';

const SHORT_RANK = { coordinator: 'Coordinator', pm: 'Project Manager', senior: 'Senior PM', program: 'Program Manager', director: 'Portfolio Director' };
const PROJECT_TITLE = {
  'intro-psych-online': 'Intro to Psychology', 'ai-ethics-documentary': 'AI Ethics documentary', 'rescue-sustainable-business': 'Rescue',
  'global-health-cases': 'Global Health', 'a11y-sprint-ochem': 'Accessibility sprint', 'teaching-ai-microcourse': 'Teaching with AI', 'stats-refresh-sprint': 'Stats refresh',
};

// A rosette for a badge: gold when earned, grey when not.
function rosette(earned, size = 30) {
  const c = earned ? '#e3b05c' : '#d6d1c4';
  const r = earned ? '#b85c4a' : '#bdb7a8';
  return `<svg class="rosette" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><path d="M14 24 L9 38 L15 35 L18 39 L20 26 Z M26 24 L31 38 L25 35 L22 39 L20 26 Z" fill="${r}" stroke="#2b2622" stroke-width="1.8" stroke-linejoin="round"/><circle cx="20" cy="17" r="12" fill="${c}" stroke="#2b2622" stroke-width="2"/><circle cx="20" cy="17" r="7" fill="none" stroke="#2b2622" stroke-width="1.6" opacity=".55"/></svg>`;
}

// The career path: five ranks as stepping stones, with you standing on yours.
function careerPath(profile, face) {
  const at = RANKS.indexOf(rankOf(profile));
  return `<ol class="career" aria-label="Career path">${RANKS.map((r, i) => `<li class="${i < at ? 'past' : i === at ? 'here' : 'ahead'}"><span class="stone">${i === at ? face : `<b>${i + 1}</b>`}</span><span class="rank-name">${SHORT_RANK[r.id] ?? r.label}</span></li>`).join('')}</ol>`;
}

function trackTile(track, xp) {
  const level = levelOf(xp);
  const lo = LEVELS[level - 1];
  const hi = LEVELS[level] ?? null;
  const pct = hi === null ? 100 : Math.round((100 * (xp - lo)) / (hi - lo));
  return `<div class="skill"><span class="lv">L${level}</span><span class="skill-name">${TRACK_LABEL[track]}</span><span class="skill-bar"><i style="width:${Math.max(3, Math.min(100, pct))}%"></i></span></div>`;
}

export function deskHtml(profile, esc, { avatarSVG, mission = '' }) {
  const p = profile ?? {};
  const player = p.player ?? null;
  const rank = rankOf(p);
  const next = nextRank(p);
  const xp = totalXp(p);
  const runs = [...(p.runs ?? [])].reverse().slice(0, 4);
  const face = avatarSVG((player ?? defaultPlayer()).avatar, 'happy', { size: 120, label: displayName(player) });
  const small = avatarSVG((player ?? defaultPlayer()).avatar, 'happy', { size: 40, label: displayName(player) });
  const nextBlock = next ? `<div class="next-rank">
      <div class="next-top"><span>Next: <strong>${esc(next.label)}</strong></span><span class="muted small">${Math.min(xp, next.xp)} / ${next.xp} XP</span></div>
      <div class="xp-bar"><i style="width:${Math.min(100, Math.round((100 * xp) / next.xp))}%"></i></div>
      <ul class="gate"><li class="${next.xpMet ? 'met' : ''}">${next.xpMet ? '✓' : '○'} ${next.xp} XP</li><li class="${next.gateMet ? 'met' : ''}">${next.gateMet ? '✓' : '○'} ${esc(next.gate)}</li></ul>
    </div>` : '<p class="muted small">Top of the ladder.</p>';
  return `<div class="desk-top">
      <div class="me">
        <div class="me-face">${face}<button class="edit-face" id="edit-avatar" aria-label="Edit your avatar">${icon('edit', { size: 34, tone: 'gold' })}</button></div>
        <div class="me-text">
          <span class="kicker">${player ? 'Welcome back' : 'Welcome to ODL'}</span>
          <h2>${esc(displayName(player) === 'You' ? 'New project manager' : displayName(player))}</h2>
          <span class="rank-chip">${esc(rank.label)}</span>
          <span class="muted small">${xp} XP · ${(p.runs ?? []).length} run${(p.runs ?? []).length === 1 ? '' : 's'} · ${(p.achievements ?? []).length} of ${ACHIEVEMENTS.length} badges</span>
          ${player ? '' : '<button class="primary" id="make-avatar">Make your avatar</button>'}
        </div>
      </div>
      ${nextBlock}
    </div>
    ${mission}
    ${careerPath(p, small)}
    <div class="desk-grid">
      <div><h3>Your skills</h3><div class="skills">${TRACKS.map((t) => trackTile(t, p.xp?.[t] ?? 0)).join('')}</div></div>
      <div>
        <h3>Badges</h3>
        <div class="rosettes">${ACHIEVEMENTS.map((a) => { const got = (p.achievements ?? []).includes(a.id); return `<span class="ros ${got ? 'earned' : ''}" title="${esc(`${a.label}: ${a.why}`)}">${rosette(got)}<small>${esc(a.label)}</small></span>`; }).join('')}</div>
        <h3>Recent runs</h3>
        ${runs.length ? `<ul class="recent">${runs.map((r) => `<li><span class="grade-chip g${esc(String(r.grade).charAt(0))}">${esc(r.grade)}</span><span>${esc(PROJECT_TITLE[r.project] ?? r.project)}${r.mode === 'hard' ? ' · Hard' : ''}</span><span class="muted small">${r.onTime ? 'on time' : 'late'} · +${Math.round(r.xp)} XP</span></li>`).join('')}</ul>` : '<p class="muted small">No runs yet. Pick a project below to start your first.</p>'}
        ${(p.runs ?? []).length ? '<button id="open-profile">Full profile</button>' : ''}
      </div>
    </div>`;
}

const swatches = (name, list, current, esc) => `<div class="swatches" role="radiogroup" aria-label="${name}">${list.map((c) => `<button type="button" class="sw ${c === current ? 'on' : ''}" data-av="${name}" data-val="${esc(c)}" style="background:${c}" aria-label="${name} ${esc(c)}" aria-pressed="${c === current}"></button>`).join('')}</div>`;

// The avatar maker: a live preview with a few moods, and the parts to pick.
export function avatarMakerHtml(draft, esc, { avatarSVG, mood = 'happy' }) {
  const a = draft.avatar;
  const moods = ['happy', 'neutral', 'worried', 'frustrated'];
  return `<div class="maker">
    <div class="maker-preview">
      ${avatarSVG(a, mood, { size: 168, label: displayName(draft) })}
      <div class="mood-row" role="group" aria-label="Try a mood">${moods.map((m) => `<button type="button" class="${m === mood ? 'on' : ''}" data-av-mood="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <p class="muted small">Your team sees this face too: it shows how your week is going.</p>
    </div>
    <div class="maker-parts">
      <h2>Make your avatar</h2>
      <label class="part"><span>Your name</span><input id="av-name" maxlength="${MAX_NAME}" placeholder="What should the team call you?" value="${esc(draft.name)}"></label>
      <div class="part"><span>Skin</span>${swatches('skin', SKINS, a.skin, esc)}</div>
      <div class="part"><span>Hair</span><div class="seg-row">${STYLES.map((s) => `<button type="button" class="${s === a.style ? 'on' : ''}" data-av="style" data-val="${s}">${STYLE_LABEL[s]}</button>`).join('')}</div></div>
      <div class="part"><span>Hair colour</span>${swatches('hair', HAIRS, a.hair, esc)}</div>
      <div class="part"><span>Top</span>${swatches('shirt', SHIRTS, a.shirt, esc)}</div>
      <div class="part"><span>Extras</span><div class="seg-row"><button type="button" class="${a.glasses ? 'on' : ''}" data-av-toggle="glasses">Glasses</button><button type="button" class="${a.beard ? 'on' : ''}" data-av-toggle="beard">Beard</button></div></div>
      <div class="row"><button type="button" id="av-random">Surprise me</button><button type="button" class="primary" id="av-save">Save my avatar</button><button type="button" id="av-cancel">Cancel</button></div>
    </div>
  </div>`;
}
