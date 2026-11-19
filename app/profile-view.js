// Progression screens: the end-of-run XP panel, the profile screen and the start-screen rank line.
// Pure HTML builders (esc is the app's escaper), so they can be tested in Node.
import { TRACKS, TRACK_LABEL, LEVELS, levelOf, rankOf, nextRank, totalXp, ACHIEVEMENTS } from '../engine/progression.js';

const PROFILE_KEY = 'critical-path-profile-v1';

export function loadProfile(store) {
  try { const raw = store?.getItem(PROFILE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function saveProfile(store, profile) {
  try { store?.setItem(PROFILE_KEY, JSON.stringify(profile)); return true; } catch { return false; }
}

const projectTitle = { 'intro-psych-online': 'Intro to Psychology', 'ai-ethics-documentary': 'AI Ethics documentary', 'rescue-sustainable-business': 'Rescue' };

function trackBar(track, xp, gained = 0) {
  const level = levelOf(xp);
  const lo = LEVELS[level - 1];
  const hi = LEVELS[level] ?? null;
  const pct = hi === null ? 100 : Math.round((100 * (xp - lo)) / (hi - lo));
  return `<div class="track"><div class="track-head"><span>${TRACK_LABEL[track]}</span><span class="muted">L${level}${hi === null ? ' · max' : ` · ${Math.max(1, Math.ceil(hi - xp))} XP to L${level + 1}`}${gained ? ` · <strong>+${Math.round(gained)}</strong>` : ''}</span></div>
    <div class="bar" role="img" aria-label="${TRACK_LABEL[track]} level ${level}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div></div>`;
}

export function rankLineHtml(profile, esc) {
  if (!profile?.runs?.length) return '';
  return `<p class="rank-line"><strong>${esc(rankOf(profile).label)}</strong> · ${totalXp(profile)} XP · ${profile.runs.length} run${profile.runs.length === 1 ? '' : 's'} <button id="open-profile">Your profile</button></p>`;
}

// After a run: XP gained by track, promotion, new badges and level-ups.
export function xpPanelHtml(res, esc) {
  if (!res || res.duplicate) return '';
  const badge = (id) => ACHIEVEMENTS.find((a) => a.id === id);
  const gainedTracks = TRACKS.filter((t) => (res.gained[t] ?? 0) > 0);
  return `<div class="xp-panel">
    <h2>+${Math.round(res.total)} XP</h2>
    ${res.promotion ? `<p class="promotion">Promoted to <strong>${esc(res.promotion)}</strong>.</p>` : ''}
    ${res.levelUps.length ? `<p>${res.levelUps.map((l) => `${TRACK_LABEL[l.track]} reached L${l.level}`).join(' · ')}</p>` : ''}
    ${res.newBadges.length ? `<p>New: ${res.newBadges.map((id) => `<span class="badge earned" title="${esc(badge(id).why)}">${esc(badge(id).label)}</span>`).join(' ')}</p>` : ''}
    <div class="tracks">${gainedTracks.map((t) => trackBar(t, res.profile.xp[t], res.gained[t])).join('')}</div>
    <button id="open-profile">Your profile</button>
  </div>`;
}

export function profileHtml(profile, esc) {
  const rank = rankOf(profile);
  const next = nextRank(profile);
  const runs = [...(profile.runs ?? [])].reverse().slice(0, 10);
  return `<h2>Your profile</h2>
    <p class="rank-big"><strong>${esc(rank.label)}</strong> · ${totalXp(profile)} XP</p>
    ${next ? `<p class="muted small">Next: ${esc(next.label)}. ${next.xpMet ? 'XP done' : `${next.xp - totalXp(profile)} more XP`}; ${next.gateMet ? 'gate met' : esc(next.gate)}.</p>` : ''}
    <div class="tracks">${TRACKS.map((t) => trackBar(t, profile.xp?.[t] ?? 0)).join('')}</div>
    <h3>Achievements</h3>
    <div class="badges">${ACHIEVEMENTS.map((a) => `<span class="badge${profile.achievements?.includes(a.id) ? ' earned' : ''}" title="${esc(a.why)}">${esc(a.label)}</span>`).join(' ')}</div>
    <h3>Runs</h3>
    ${runs.length ? `<ul class="runs">${runs.map((r) => `<li>${esc(projectTitle[r.project] ?? r.project)}${r.mode === 'hard' ? ' · Hard' : ''}${r.difficulty === 'story' ? ' · Story' : ''} · ${r.onTime ? 'on time' : 'late'} · ${esc(r.grade)} · +${Math.round(r.xp)} XP</li>`).join('')}</ul>` : '<p class="muted">No finished runs yet.</p>'}
    <h3>Move your profile</h3>
    <p class="muted small">Your profile lives in this browser. Copy its code to move it to another device.</p>
    <div class="row"><button id="profile-copy">Copy my profile code</button></div>
    <label class="prompt" for="profile-code">Paste a profile code</label>
    <textarea id="profile-code" rows="2" placeholder="CP1.…"></textarea>
    <p class="small" id="profile-msg" role="status"></p>
    <div class="row"><button id="profile-import">Use this code</button><button class="primary" id="profile-close">Back</button></div>`;
}
