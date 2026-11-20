// Round "medallion" icons drawn in the same flat style as the portraits: a soft tinted disc, warm fills
// and a dark ink outline. icon(name, { size, tone }) returns inline SVG.
const INK = '#2b2622';
const TONE = { amber: '#fbe3b4', teal: '#cfe8df', blue: '#d9e4f3', rose: '#f6d8d2', gold: '#f1e2bd', lilac: '#e4def3', grey: '#e7e2d6' };
const S = `fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
const F = (c) => `fill="${c}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"`;

const GLYPHS = {
  // sections
  notice: `<path d="M10 24 Q24 11 38 24 Q24 37 10 24 Z" ${F('#fff')}/><circle cx="24" cy="24" r="5.5" ${F('#6aa7d8')}/><circle cx="25.5" cy="22.5" r="1.4" fill="#fff"/>`,
  meeting: `<path d="M9 14 h18 a3 3 0 0 1 3 3 v8 a3 3 0 0 1 -3 3 h-10 l-5 4 v-4 h-3 a3 3 0 0 1 -3 -3 v-8 a3 3 0 0 1 3 -3 z" ${F('#f4d58d')}/><path d="M33 20 h6 a3 3 0 0 1 3 3 v7 a3 3 0 0 1 -3 3 h-1 v4 l-5 -4 h-8 a3 3 0 0 1 -3 -3" ${F('#a9d3c4')}/>`,
  moves: `<circle cx="16" cy="19" r="5" ${F('#e8b994')}/><circle cx="32" cy="19" r="5" ${F('#c08a5e')}/><path d="M7 37 q0 -9 9 -9 q9 0 9 9 z" ${F('#3b5b8c')}/><path d="M23 37 q0 -9 9 -9 q9 0 9 9 z" ${F('#2f7d6d')}/>`,
  end: `<path d="M15 39 V10" ${S}/><path d="M15 11 h19 l-4 6 l4 6 h-19 z" ${F('#e07a6a')}/>`,
  recap: `<path d="M10 37 h28" ${S}/><rect x="12" y="24" width="6" height="13" rx="1.5" ${F('#a9d3c4')}/><rect x="21" y="15" width="6" height="22" rx="1.5" ${F('#f4d58d')}/><rect x="30" y="20" width="6" height="17" rx="1.5" ${F('#e07a6a')}/>`,
  situation: `<path d="M24 9 L40 37 H8 Z" ${F('#f4d58d')}/><path d="M24 19 v9" ${S}/><circle cx="24" cy="32.5" r="1.6" fill="${INK}"/>`,
  // meeting focus
  'work-session': `<rect x="11" y="9" width="20" height="28" rx="2" ${F('#fff')}/><path d="M15 16 h12 M15 21 h12 M15 26 h7" ${S}/><path d="M28 34 L38 18 l4 3 L32 37 l-5 1 z" ${F('#f4d58d')}/>`,
  'sign-offs': `<rect x="11" y="9" width="22" height="28" rx="2" ${F('#fff')}/><path d="M15 16 h14 M15 21 h10" ${S}/><circle cx="31" cy="31" r="8" ${F('#7cc49a')}/><path d="M27.5 31 l2.5 2.5 l4.5 -5" ${S}/>`,
  preview: `<rect x="9" y="12" width="26" height="24" rx="3" ${F('#fff')}/><path d="M9 19 h26" ${S}/><path d="M15 9 v6 M29 9 v6" ${S}/><path d="M28 30 h12 m-4 -4 l4 4 l-4 4" ${S}/>`,
  'show-finished': `<path d="M24 8 l4.6 9.6 l10.4 1.4 l-7.6 7.2 l1.9 10.4 L24 31.6 l-9.3 5 l1.9 -10.4 L9 19 l10.4 -1.4 z" ${F('#f4d58d')}/>`,
  'keep-short': `<circle cx="24" cy="25" r="13" ${F('#fff')}/><path d="M24 17 v8 l5 4" ${S}/><path d="M20 9 h8" ${S}/>`,
  workload: `<rect x="10" y="27" width="28" height="7" rx="1.5" ${F('#a9d3c4')}/><rect x="12" y="20" width="24" height="7" rx="1.5" ${F('#f4d58d')}/><rect x="14" y="13" width="20" height="7" rx="1.5" ${F('#e8b994')}/><path d="M8 38 h32" ${S}/>`,
  status: `<rect x="12" y="10" width="24" height="29" rx="3" ${F('#fff')}/><rect x="18" y="7" width="12" height="6" rx="2" ${F('#a9d3c4')}/><path d="M17 20 h14 M17 25 h14 M17 30 h9" ${S}/>`,
  // team moves
  checkin: `<path d="M8 13 h26 a3 3 0 0 1 3 3 v12 a3 3 0 0 1 -3 3 h-14 l-7 6 v-6 h-5 a3 3 0 0 1 -3 -3 v-12 a3 3 0 0 1 3 -3 z" ${F('#fff')}/><path d="M21 27 c-6 -4 -7 -7 -5 -9 c1.5 -1.5 3.5 -1 5 1 c1.5 -2 3.5 -2.5 5 -1 c2 2 1 5 -5 9 z" ${F('#e07a6a')}/>`,
  review: `<circle cx="21" cy="21" r="10" ${F('#d9e4f3')}/><path d="M28.5 28.5 L39 39" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M16 21 l3 3 l6 -6" ${S}/>`,
  overtime: `<circle cx="22" cy="26" r="12" ${F('#fff')}/><path d="M22 19 v7 l4 3" ${S}/><circle cx="35" cy="13" r="7" ${F('#f4d58d')}/><path d="M35 9.5 v7 M31.5 13 h7" ${S}/>`,
  'status-update': `<rect x="8" y="13" width="32" height="22" rx="3" ${F('#fff')}/><path d="M9 15 l15 11 l15 -11" ${S}/><circle cx="38" cy="13" r="5" ${F('#e07a6a')}/>`,
  'team-meeting': `<ellipse cx="24" cy="31" rx="15" ry="5" ${F('#e8b994')}/><circle cx="12" cy="20" r="4.5" ${F('#f3d2b8')}/><circle cx="24" cy="16" r="4.5" ${F('#c08a5e')}/><circle cx="36" cy="20" r="4.5" ${F('#9a6644')}/>`,
  defer: `<rect x="8" y="12" width="24" height="24" rx="3" ${F('#fff')}/><path d="M8 19 h24 M14 9 v6 M26 9 v6" ${S}/><path d="M22 29 h18 m-5 -5 l5 5 l-5 5" ${S}/>`,
  placeholder: `<rect x="10" y="12" width="20" height="24" rx="2" fill="#fff" stroke="${INK}" stroke-width="2.4" stroke-dasharray="4 3"/><path d="M27 30 L37 14 l4 3 L31 33 l-5 1 z" ${F('#f4d58d')}/>`,
  backup: `<circle cx="20" cy="18" r="6" ${F('#e8b994')}/><path d="M8 38 q0 -11 12 -11 q12 0 12 11 z" ${F('#6b5a8e')}/><circle cx="36" cy="16" r="6" ${F('#7cc49a')}/><path d="M36 12.5 v7 M32.5 16 h7" ${S}/>`,
  prevent: `<path d="M24 8 L38 13 V23 Q38 34 24 40 Q10 34 10 23 V13 Z" ${F('#a9d3c4')}/><path d="M18 24 l4.5 4.5 l8 -9" ${S}/>`,
  // recap
  finished: `<circle cx="24" cy="24" r="13" ${F('#7cc49a')}/><path d="M18 24 l4.5 4.5 l8 -9" ${S}/>`,
  rework: `<path d="M30 10 a8 8 0 0 0 -8 10 L11 31 a3.5 3.5 0 0 0 5 5 L27 25 a8 8 0 0 0 10 -8 l-5 3 l-4 -1 l-1 -4 z" ${F('#f4d58d')}/>`,
  pressure: `<path d="M10 34 a14 14 0 0 1 28 0" ${F('#fff')}/><path d="M10 34 a14 14 0 0 1 6 -11.5" fill="none" stroke="#7cc49a" stroke-width="4"/><path d="M32 22.5 a14 14 0 0 1 6 11.5" fill="none" stroke="#e07a6a" stroke-width="4"/><path d="M24 34 l7 -9" ${S}/><circle cx="24" cy="34" r="2.4" fill="${INK}"/>`,
  edit: `<path d="M14 34 L32 14 l4 4 L18 38 l-6 1 z" ${F('#f4d58d')}/>`,
};

export const ICONS = Object.keys(GLYPHS);

export function icon(name, { size = 40, tone = 'grey', label = '' } = {}) {
  const g = GLYPHS[name] ?? GLYPHS.status;
  return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 48 48" ${label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'}><circle cx="24" cy="24" r="24" fill="${TONE[tone] ?? TONE.grey}"/>${g}</svg>`;
}
