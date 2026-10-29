// Original drawn portraits for the cast, with five expressions.
// spec: { skin, hair, style: 'long'|'short'|'bob'|'curly', shirt, glasses, beard }
// mood: 'happy' | 'neutral' | 'worried' | 'sad' | 'frustrated'

export const MOODS = ['happy', 'neutral', 'worried', 'sad', 'frustrated'];
const INK = '#2b2622';

export function avatarSVG(spec, mood = 'neutral', { size = 64, label = '' } = {}) {
  const s = spec ?? { skin: '#d8a982', hair: '#3a2c24', style: 'short', shirt: '#55657a' };
  const m = MOODS.includes(mood) ? mood : 'neutral';
  if (s.species === 'retriever') return retrieverSVG(s, m, size, label);
  return `<svg class="avatar mood-${m}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${esc(label || 'Team member')}, ${m}">
  <circle cx="60" cy="60" r="60" class="avatar-bg"/>
  <clipPath id="clip-${uid}"><circle cx="60" cy="60" r="60"/></clipPath>
  <g clip-path="url(#clip-${uid++})">
    ${hairBack(s)}
    <path d="M18 124 Q18 90 60 88 Q102 90 102 124 Z" fill="${s.shirt}"/>
    <path d="M50 88 Q60 96 70 88" fill="none" stroke="${shade(s.shirt)}" stroke-width="2"/>
    <rect x="52" y="72" width="16" height="18" rx="6" fill="${shade(s.skin, 0.9)}"/>
    <ellipse cx="60" cy="54" rx="24" ry="28" fill="${s.skin}"/>
    <ellipse cx="36" cy="57" rx="4" ry="6" fill="${s.skin}"/>
    <ellipse cx="84" cy="57" rx="4" ry="6" fill="${s.skin}"/>
    ${s.beard ? `<path d="M37 58 Q38 84 60 86 Q82 84 83 58 Q78 74 60 75 Q42 74 37 58 Z" fill="${s.hair}"/>` : ''}
    ${hairFront(s)}
    ${face(m, s)}
    ${s.glasses ? `<g fill="none" stroke="${INK}" stroke-width="2"><circle cx="50" cy="55" r="7.5"/><circle cx="70" cy="55" r="7.5"/><path d="M57.5 55 Q60 53 62.5 55"/></g>` : ''}
    ${extras(m)}
  </g>
</svg>`;
}

let uid = 0;

// A golden retriever in a shirt and tie, with the same five moods.
function retrieverSVG(s, m, size, label) {
  const fur = s.fur ?? '#d9a24e', dark = shade(fur, 0.72), light = shade(fur, 1.18);
  const id = uid++;
  const brows = {
    happy: ['M44 46 Q49 42 54 45', 'M66 45 Q71 42 76 46'],
    neutral: ['M44 46 L54 45', 'M66 45 L76 46'],
    worried: ['M44 48 L54 43', 'M66 43 L76 48'],
    sad: ['M44 49 Q49 44 54 43', 'M66 43 Q71 44 76 49'],
    frustrated: ['M44 43 L54 48', 'M66 48 L76 43'],
  }[m];
  const mouth = {
    happy: `<path d="M50 74 Q60 84 70 74" fill="#7a2e2a" stroke="${INK}" stroke-width="2"/><path d="M56 79 Q60 88 64 79 Z" fill="#e8737a"/>`,
    neutral: `<path d="M52 75 Q60 79 68 75" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
    worried: `<path d="M52 77 Q56 73 60 76 Q64 79 68 75" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
    sad: `<path d="M52 79 Q60 72 68 79" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
    frustrated: `<path d="M52 77 L68 75" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  }[m];
  const eyes = m === 'happy'
    ? `<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><path d="M45 55 Q49 50 53 55"/><path d="M67 55 Q71 50 75 55"/></g>`
    : `<g fill="${INK}"><ellipse cx="49" cy="55" rx="3.2" ry="3.6"/><ellipse cx="71" cy="55" rx="3.2" ry="3.6"/></g><g fill="#fff"><circle cx="50" cy="54" r="1"/><circle cx="72" cy="54" r="1"/></g>`;
  const earDrop = m === 'sad' || m === 'worried' ? 6 : 0;
  return `<svg class="avatar mood-${m}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${esc(label || 'Supervisor')}, ${m}">
  <circle cx="60" cy="60" r="60" class="avatar-bg"/>
  <clipPath id="clip-${id}"><circle cx="60" cy="60" r="60"/></clipPath>
  <g clip-path="url(#clip-${id})">
    <path d="M18 124 Q18 92 60 90 Q102 92 102 124 Z" fill="${s.shirt}"/>
    <path d="M48 90 L60 100 L72 90 Z" fill="#f4f1ea"/>
    <path d="M57 98 L63 98 L65 122 L60 126 L55 122 Z" fill="${s.tie}"/>
    <path d="M32 ${40 + earDrop} Q20 ${56 + earDrop} 26 ${80 + earDrop} Q34 ${86 + earDrop} 40 ${70 + earDrop} Z" fill="${dark}"/>
    <path d="M88 ${40 + earDrop} Q100 ${56 + earDrop} 94 ${80 + earDrop} Q86 ${86 + earDrop} 80 ${70 + earDrop} Z" fill="${dark}"/>
    <ellipse cx="60" cy="54" rx="27" ry="29" fill="${fur}"/>
    <ellipse cx="60" cy="73" rx="16" ry="13" fill="${light}"/>
    <ellipse cx="60" cy="66" rx="6" ry="4.5" fill="${INK}"/>
    <path d="M60 70 L60 74" stroke="${INK}" stroke-width="2"/>
    ${mouth}
    ${eyes}
    ${brows.map((d) => `<path d="${d}" fill="none" stroke="${dark}" stroke-width="2.8" stroke-linecap="round"/>`).join('')}
    ${extras(m)}
  </g>
</svg>`;
}

function hairBack(s) {
  if (s.style === 'long') return `<path d="M33 52 Q31 18 60 17 Q89 18 87 52 L92 104 Q60 112 28 104 Z" fill="${s.hair}"/>`;
  if (s.style === 'bob') return `<path d="M31 54 Q29 17 60 16 Q91 17 89 54 L90 76 Q76 82 60 80 Q44 82 30 76 Z" fill="${s.hair}"/>`;
  return '';
}

function hairFront(s) {
  switch (s.style) {
    case 'long':
      return `<path d="M35 46 Q38 21 60 21 Q83 21 85 46 Q74 33 58 33 Q46 34 35 46 Z" fill="${s.hair}"/>`;
    case 'bob':
      return `<path d="M34 50 Q35 21 60 20 Q86 21 86 48 Q72 38 64 30 Q56 40 34 50 Z" fill="${s.hair}"/>`;
    case 'curly':
      return `<g fill="${s.hair}">${[[40, 34], [48, 26], [58, 23], [68, 24], [77, 29], [83, 38], [37, 43], [53, 30], [64, 31]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join('')}</g>`;
    default:
      return `<path d="M35 48 Q33 20 60 20 Q87 20 85 48 Q81 33 64 31 Q44 31 35 48 Z" fill="${s.hair}"/>`;
  }
}

function face(m, s) {
  const blush = `<g fill="#e07a6a" opacity="0.28"><ellipse cx="45" cy="64" rx="5" ry="3"/><ellipse cx="75" cy="64" rx="5" ry="3"/></g>`;
  const dotEyes = `<g fill="${INK}"><ellipse cx="50" cy="55" rx="2.6" ry="3.2"/><ellipse cx="70" cy="55" rx="2.6" ry="3.2"/></g>`;
  const brow = (d) => `<path d="${d}" fill="none" stroke="${shade(s.hair, 0.8)}" stroke-width="2.6" stroke-linecap="round"/>`;
  const mouth = (d, fill = 'none') => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  switch (m) {
    case 'happy':
      return `${blush}<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><path d="M46 56 Q50 51 54 56"/><path d="M66 56 Q70 51 74 56"/></g>${brow('M45 45 Q50 42 55 44')}${brow('M65 44 Q70 42 75 45')}${mouth('M50 66 Q60 77 70 66 Z', '#7a2e2a')}`;
    case 'worried':
      return `${dotEyes}${brow('M45 47 L55 43')}${brow('M65 43 L75 47')}${mouth('M51 70 Q55 66 60 69 Q65 72 69 68')}`;
    case 'sad':
      return `${dotEyes}${brow('M45 48 Q50 43 55 42')}${brow('M65 42 Q70 43 75 48')}${mouth('M51 72 Q60 64 69 72')}`;
    case 'frustrated':
      return `${dotEyes}${brow('M45 43 L55 47')}${brow('M65 47 L75 43')}${mouth('M52 70 L68 68')}`;
    default:
      return `${dotEyes}${brow('M45 45 L55 45')}${brow('M65 45 L75 45')}${mouth('M53 68 Q60 70 67 68')}`;
  }
}

function extras(m) {
  if (m === 'sad') return `<path d="M46 61 Q43 67 46 69 Q49 67 46 61 Z" fill="#6aa7d8"/>`;
  if (m === 'worried') return `<path d="M86 34 Q82 41 86 43 Q90 41 86 34 Z" fill="#6aa7d8"/>`;
  if (m === 'frustrated') return `<g stroke="#c0443c" stroke-width="2.4" stroke-linecap="round"><path d="M86 26 L92 22"/><path d="M88 32 L96 31"/><path d="M84 21 L86 14"/></g>`;
  return '';
}

function shade(hex, f = 0.82) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function esc(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
