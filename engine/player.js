// The player's own avatar and name: the choices the avatar maker offers, a default, a seeded random
// pick, and a cleaner for anything read back from storage or a profile code.
import { makeRng } from './rng.js';

export const SKINS = ['#f3d2b8', '#e8b994', '#d8a982', '#c08a5e', '#9a6644', '#6e4630'];
export const HAIRS = ['#2b211c', '#5a3a26', '#8a5a34', '#c98e4e', '#e3c27a', '#9a9a9a', '#b5452f'];
export const STYLES = ['short', 'long', 'bob', 'curly', 'bald'];
export const SHIRTS = ['#3b5b8c', '#2f7d6d', '#a8843b', '#b85c4a', '#6b5a8e', '#55657a', '#d08a3c', '#3f6f3f'];
export const STYLE_LABEL = { short: 'Short', long: 'Long', bob: 'Bob', curly: 'Curly', bald: 'None' };
export const MAX_NAME = 24;

export function defaultPlayer() {
  return { name: '', avatar: { skin: SKINS[2], hair: HAIRS[1], style: 'short', shirt: SHIRTS[0], glasses: false, beard: false } };
}

export function randomPlayer(seed = String(Date.now())) {
  const r = makeRng(`player:${seed}`);
  const pick = (xs) => xs[Math.floor(r.next() * xs.length)];
  return { name: '', avatar: { skin: pick(SKINS), hair: pick(HAIRS), style: pick(STYLES), shirt: pick(SHIRTS), glasses: r.next() < 0.3, beard: r.next() < 0.2 } };
}

const oneOf = (x, xs, dflt) => (xs.includes(x) ? x : dflt);

// Anything → a valid player (unknown colours and styles fall back to the default).
export function cleanPlayer(x) {
  const d = defaultPlayer();
  if (!x || typeof x !== 'object') return null;
  const a = x.avatar ?? {};
  return {
    name: String(x.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME),
    avatar: {
      skin: oneOf(a.skin, SKINS, d.avatar.skin),
      hair: oneOf(a.hair, HAIRS, d.avatar.hair),
      style: oneOf(a.style, STYLES, d.avatar.style),
      shirt: oneOf(a.shirt, SHIRTS, d.avatar.shirt),
      glasses: a.glasses === true,
      beard: a.beard === true,
    },
  };
}

export const displayName = (player) => player?.name || 'You';
