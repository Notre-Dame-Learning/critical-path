// Run codes: a typed seed on the start screen, so a playtest can fix the situations
// a player sees (the Playtest kit's fellow-1 / fellow-2) even where a ?seed= URL
// can't reach the page, such as a page hosted in Claude. Same code, project and
// pace give the same situations.

// Lower-case, spaces to dashes, letters / digits / dashes only, at most 32 characters.
export function normalizeRunCode(typed) {
  return String(typed ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 32);
}

// The seed for a new run: a typed code wins, then ?seed= in the URL, then a random one.
export function pickSeed({ typed, search = '', random }) {
  const code = normalizeRunCode(typed);
  if (code) return code;
  const fromUrl = new URLSearchParams(search).get('seed');
  return fromUrl || random();
}

export function runCodeHtml(value = '', esc = (s) => s) {
  return `<label class="run-code"><span><strong>Run code</strong> <small>optional</small></span>
        <input type="text" id="run-code" inputmode="text" autocomplete="off" spellcheck="false" maxlength="40" placeholder="e.g. fellow-1" value="${esc(value)}">
        <small>The same code, project and pace give the same situations, so two people (or two tries) can compare runs. Leave blank for a fresh run.</small></label>`;
}
