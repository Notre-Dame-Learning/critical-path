// app/difficulty-picker.js
// Start-screen pace picker: Standard or Story. The first run defaults to Story;
// after that the last level picked is remembered (per browser, a convenience only).
import { DIFFICULTY } from '../engine/difficulty.js';

const KEY = 'critical-path-difficulty';

export function defaultDifficulty(store) {
  const last = safeGet(store, KEY);
  return last && DIFFICULTY[last] ? last : 'story'; // nothing saved = first run
}

export function rememberDifficulty(store, level) {
  try { store?.setItem(KEY, level); } catch { /* storage unavailable */ }
}

export function difficultyHtml(selected, esc = (s) => s) {
  return Object.entries(DIFFICULTY).map(([id, d]) => `<label class="mode"><input type="radio" name="difficulty" value="${esc(id)}" ${id === selected ? 'checked' : ''}>
          <span><strong>${esc(d.label)}</strong><small>${esc(d.blurb)}</small></span></label>`).join('');
}

export function pickedDifficulty(root) {
  const el = root.querySelector('input[name="difficulty"]:checked');
  return el && DIFFICULTY[el.value] ? el.value : 'standard';
}

function safeGet(store, key) {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
