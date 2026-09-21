/*  Icons und die kleinen Pflanzenbilder in der Platzübersicht. */
import { clamp01, lerp, rng, hash, TAU } from '../core/util.js';

const P = {
  couch: 'M3 12v-2a3 3 0 013-3h12a3 3 0 013 3v2M2 12h20v5H2zM5 17v2M19 17v2M6 12V9M18 12V9',
  sprout: 'M12 21v-8M12 13c0-4 3-7 8-7 0 4-3 7-8 7zM12 15c0-3-2.5-5.5-6.5-5.5C5.5 13 8 15 12 15z',
  flask: 'M9 3h6M10 3v6L4.6 18.2A2 2 0 006.3 21h11.4a2 2 0 001.7-2.8L14 9V3M7.5 14h9',
  gauge: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 12l4-4M12 12h.01',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  droplets: 'M12 3c3 4 5 6.5 5 9a5 5 0 01-10 0c0-2.5 2-5 5-9z',
  droplet: 'M12 3c3 4 5 6.5 5 9a5 5 0 01-10 0c0-2.5 2-5 5-9z',
  mushroom: 'M4 11a8 8 0 0116 0c0 1-.9 1.5-2 1.5H6c-1.1 0-2-.5-2-1.5zM10 12.5v6a2 2 0 004 0v-6',
  layers: 'M12 2l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  dome: 'M3 18a9 9 0 0118 0zM3 18h18M12 9v9M6.5 11.5l11 0',
  cupola: 'M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9zM12 3v18M4.5 7.5l7.5 4.5 7.5-4.5M12 12l-7.5 4.5M12 12l7.5 4.5M12 15.2a3.2 3.2 0 110-6.4 3.2 3.2 0 010 6.4z',
  wind: 'M3 8h11a3 3 0 10-3-3M3 12h15a3 3 0 11-3 3M3 16h8',
  bug: 'M8 6a4 4 0 118 0M6 10h12M7 10v4a5 5 0 0010 0v-4M3 12h3M18 12h3M4 17l2.5-2M20 17l-2.5-2M4 7l2.5 2M20 7l-2.5 2',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  coffee: 'M4 8h13v6a5 5 0 01-10 0zM17 9h2a2.5 2.5 0 010 5h-2M4 21h14M8 2v3M12 2v3',
  disc: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 14a2 2 0 110-4 2 2 0 010 4z',
  telescope: 'M4 14l10-5 2 4-10 5zM14 9l4-2 2 4-4 2M8 16l-2 5M12 14l2 7',
  lamp: 'M8 3h8l3 7H5zM12 10v8M8 21h8',
  cat: 'M5 9l1-5 3 3h6l3-3 1 5v5a7 7 0 01-14 0zM9 12h.01M15 12h.01M12 15l-1 1h2z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  leaf: 'M4 20C4 10 10 4 20 4c0 10-6 16-16 16zM4 20c3-6 6-9 12-12',
  sun: 'M12 17a5 5 0 110-10 5 5 0 010 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  salt: 'M12 3l7 4v10l-7 4-7-4V7zM12 3v18M5 7l7 4 7-4',
  co2: 'M8 10a4 4 0 100 4M13 9h3a2 2 0 010 4h-3zM13 9v8M19 9h2M19 13h2',
  mail: 'M2 5h20v14H2zM3 7l9 6 9-6',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  info: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 11v6M12 7.5v.01',
  alert: 'M12 3l9.5 17h-19zM12 10v4M12 17v.01',
  clock: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 7v5l3 2',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  star: 'M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z',
  download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 13l5-5 5 5M4 3h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  settings: 'M12 15a3 3 0 110-6 3 3 0 010 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.5 19l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 13.6H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 7.5l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
  chart: 'M3 21h18M6 17V9M11 17V4M16 17v-6M21 17v-9',
  scissors: 'M6 4l12 12M18 4L6 16M8 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM21 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  bee: 'M12 21c-3.5 0-6-2.5-6-6s2.5-8 6-8 6 4.5 6 8-2.5 6-6 6zM6 12h12M6.5 16h11M10 5L7 2M14 5l3-3',
  thermo: 'M14 14V5a2 2 0 10-4 0v9a4 4 0 104 0zM12 17v-6',
  seed: 'M12 20c-4 0-7-3-7-7s3-9 7-9 7 5 7 9-3 7-7 7zM12 8v9',
  book: 'M4 4h7a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H4zM20 4h-3a3 3 0 00-3 3v13a2.5 2.5 0 012.5-2.5H20z',
  rocket: 'M5 15l-2 6 6-2M9 19l-4-4c0-6 4-12 10-13 1 6-3 13-6 17zM14 9a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-6h8v6',
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1z',
  flag: 'M5 21V4h13l-2.5 4L18 12H5',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  beaker: 'M9 3h6M10 3v7l-5 8a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-8V3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 110-6 3 3 0 010 6z',
  refresh: 'M3 12a9 9 0 0115-6.7L21 8M21 4v4h-4M21 12a9 9 0 01-15 6.7L3 16M3 20v-4h4',
};

export function icon(name, cls = '') {
  const d = P[name] || P.info;
  return `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="${d}"/></svg>`;
}
export function iconEl(name, cls = '') {
  const wrap = document.createElement('span');
  wrap.innerHTML = icon(name, cls);
  return wrap.firstElementChild;
}
export const hasIcon = n => !!P[n];

/* ───────────────── Pflanzenbild für die Platzkachel ───────────────── */

const hex = n => '#' + n.toString(16).padStart(6, '0');

function leafPath(x, y, len, ang, wid) {
  const dx = Math.sin(ang) * len, dy = -Math.cos(ang) * len;
  const px = Math.cos(ang) * wid, py = Math.sin(ang) * wid;
  return `M${x} ${y} Q${x + dx * .45 + px} ${y + dy * .45 + py} ${x + dx} ${y + dy} Q${x + dx * .45 - px} ${y + dy * .45 - py} ${x} ${y}Z`;
}

/**
 * Kleines SVG einer Pflanze — wächst mit dem Fortschritt.
 * @param {object} p Pflanzendefinition
 * @param {number} prog 0…1
 * @param {number} health 0…1
 * @param {string} seed
 * @param {number} stageIdx
 */
export function plantSvg(p, prog, health = 1, seed = 'a', stageIdx = 0) {
  const r = rng(hash(seed + p.id));
  const W = 100, H = 100, cx = 50, base = 88;
  const leaf = hex(p.color.leaf), acc = hex(p.color.accent);
  const wilt = 1 - clamp01(health);
  const stem = `hsl(${p.archetype === 'woody' ? 28 : 105},${28 - wilt * 18}%,${26 + wilt * 14}%)`;
  const n = Math.pow(clamp01(prog), 0.7);
  const parts = [];

  if (prog < 0.05) {
    const h = 6 + prog * 130;
    parts.push(`<path d="M${cx} ${base} L${cx} ${base - h}" stroke="${stem}" stroke-width="2.4" fill="none"/>`);
    parts.push(`<path d="${leafPath(cx, base - h, 9, -1.1, 4)}" fill="#8fd07a"/>`);
    parts.push(`<path d="${leafPath(cx, base - h, 9, 1.1, 4)}" fill="#7bbf68"/>`);
    return svgWrap(W, H, parts.join(''));
  }

  const tall = { leafy: 34, root: 30, herb: 52, bush: 58, vine: 68, grass: 62, flower: 60, fungus: 26, woody: 72 }[p.archetype] || 40;
  const h = 8 + n * tall;

  if (p.archetype === 'fungus') {
    for (let i = 0; i < Math.round(2 + n * 6); i++) {
      const x = cx + (r() - .5) * 46, sh = (8 + r() * 14) * (0.4 + n);
      parts.push(`<path d="M${x} ${base} L${x + (r() - .5) * 3} ${base - sh}" stroke="#e0d6c0" stroke-width="${2.5 + n * 2}" stroke-linecap="round"/>`);
      const cw = (7 + r() * 8) * (0.5 + n);
      parts.push(`<ellipse cx="${x}" cy="${base - sh}" rx="${cw}" ry="${cw * .42}" fill="${leaf}" opacity=".92"/>`);
    }
    return svgWrap(W, H, parts.join(''));
  }

  if (p.archetype === 'grass') {
    for (let i = 0; i < Math.round(8 + n * 16); i++) {
      const x = cx + (r() - .5) * 40, bh = h * (.6 + r() * .55);
      const bend = (r() - .5) * 18 * (1 + wilt);
      parts.push(`<path d="M${x} ${base} Q${x + bend * .4} ${base - bh * .6} ${x + bend} ${base - bh}" stroke="${leaf}" stroke-width="${1.6 + n}" fill="none" stroke-linecap="round" opacity=".9"/>`);
      if (stageIdx >= 3 && r() < .5) parts.push(`<ellipse cx="${x + bend}" cy="${base - bh - 3}" rx="2.4" ry="${5 * n}" fill="${acc}"/>`);
    }
    return svgWrap(W, H, parts.join(''));
  }

  /* Stiel */
  if (p.archetype !== 'leafy' && p.archetype !== 'root') {
    const sw = p.archetype === 'woody' ? 5 + n * 4 : 2 + n * 2;
    parts.push(`<path d="M${cx} ${base} Q${cx + wilt * 8} ${base - h * .55} ${cx + wilt * 14} ${base - h}" stroke="${stem}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`);
  }

  /* Blätter */
  const nLeaf = { leafy: 12, root: 8, herb: 8, bush: 12, vine: 14, flower: 8, woody: 18 }[p.archetype] || 10;
  const count = Math.max(2, Math.round(3 + n * nLeaf));
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let ax, ay, ang, len;
    if (p.archetype === 'leafy' || p.archetype === 'root') {
      ax = cx; ay = base - 2;
      ang = (i % 2 ? 1 : -1) * (0.55 + t * 0.85) + (r() - .5) * .2;
      len = (14 + n * 26) * (1 - t * .35);
    } else {
      const y = base - h * (0.25 + t * 0.72);
      ax = cx + (base - y) / h * wilt * 12; ay = y;
      ang = (i % 2 ? 1 : -1) * (0.75 + r() * .5) + wilt * .5;
      len = (10 + n * 18) * (1 - t * .3);
    }
    const c = i % 3 === 0 ? leaf : hex(Math.max(0, p.color.leaf - 0x0a1408));
    parts.push(`<path d="${leafPath(ax, ay, len, ang, len * .34)}" fill="${c}" opacity="${0.88 - wilt * .35}"/>`);
  }

  /* Blüten / Früchte / Knollen */
  if (p.archetype === 'root' && stageIdx >= 3) {
    const rr = 6 + n * 9;
    parts.push(`<ellipse cx="${cx}" cy="${base - 1}" rx="${rr}" ry="${rr * (p.id === 'moehre' ? 1.5 : 0.95)}" fill="${acc}"/>`);
    parts.push(`<ellipse cx="${cx - rr * .3}" cy="${base - rr * .3}" rx="${rr * .28}" ry="${rr * .22}" fill="#fff" opacity=".22"/>`);
  }
  if ((p.archetype === 'bush' || p.archetype === 'vine' || p.archetype === 'woody') && stageIdx >= 3) {
    const fr = stageIdx >= 4;
    for (let i = 0; i < Math.round(2 + n * 4); i++) {
      const y = base - h * (0.4 + r() * 0.5);
      const x = cx + (r() - .5) * 30;
      if (fr) {
        const rr = 3.4 + n * 3.6;
        parts.push(`<circle cx="${x}" cy="${y}" r="${rr}" fill="${acc}"/>`);
        parts.push(`<circle cx="${x - rr * .32}" cy="${y - rr * .32}" r="${rr * .3}" fill="#fff" opacity=".3"/>`);
      } else {
        parts.push(`<g transform="translate(${x} ${y})">${flowerSvg(acc, 3.2 + n * 2)}</g>`);
      }
    }
  }
  if (p.archetype === 'flower' && stageIdx >= 3) {
    const open = clamp01((n - .55) / .35);
    const heads = Math.max(1, Math.round(1 + n * 2));
    for (let i = 0; i < heads; i++) {
      const x = cx + (i - (heads - 1) / 2) * 16 + wilt * 10, y = base - h * (0.9 + r() * .1);
      parts.push(`<g transform="translate(${x} ${y})">${flowerSvg(acc, 5 + open * 7, p.id === 'sonnenblume' ? 16 : 9)}</g>`);
    }
  }
  return svgWrap(W, H, parts.join(''));
}

function flowerSvg(color, rad, petals = 6) {
  let s = '';
  for (let k = 0; k < petals; k++) {
    const a = k * TAU / petals;
    s += `<ellipse cx="${Math.sin(a) * rad * .62}" cy="${-Math.cos(a) * rad * .62}" rx="${rad * .42}" ry="${rad * .68}" transform="rotate(${a * 180 / Math.PI})" fill="${color}"/>`;
  }
  s += `<circle r="${rad * .32}" fill="#ffd977"/>`;
  return s;
}

function svgWrap(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" class="slot__plant" preserveAspectRatio="xMidYMax meet">${inner}</svg>`;
}

/** Kleines Icon für Listen — vereinfachte Pflanze. */
export function plantIcon(p) {
  return plantSvg(p, 0.85, 1, p.id, 3);
}
