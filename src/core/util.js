/* Kleine Helfer — Zahlen, Zeit, DOM, Zufall. */

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const clamp01 = v => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => b === a ? 0 : (v - a) / (b - a);
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/* deterministischer Zufall (mulberry32) — für alles, was nach Reload gleich bleiben soll */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length) % arr.length];

/* ---------- Zahlen ---------- */
export function num(v, dec = 0) {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return num(v / 1e9, 2) + ' Mrd';
  if (a >= 1e6) return num(v / 1e6, 2) + ' Mio';
  if (a >= 1e4) return num(v / 1e3, 1) + 'k';
  if (a >= 100) return num(v, 0);
  if (a >= 10) return num(v, 1);
  return num(v, a < 1 && a > 0 ? 2 : 1);
}
/** Liter hübsch: <1 L → ml */
export function vol(l) {
  if (Math.abs(l) < 1) return num(l * 1000, 0) + ' ml';
  if (Math.abs(l) < 100) return num(l, 1) + ' L';
  return num(l, 0) + ' L';
}
export function watt(w) {
  if (Math.abs(w) >= 1000) return num(w / 1000, 2) + ' kW';
  return num(w, 0) + ' W';
}
export function grams(g) {
  if (Math.abs(g) >= 1000) return num(g / 1000, 2) + ' kg';
  return num(g, g < 10 ? 1 : 0) + ' g';
}

/* ---------- Zeit ---------- */
export function dur(ms, opts = {}) {
  const { short = false, max = 2 } = opts;
  if (ms <= 0) return short ? '0s' : 'jetzt';
  const d = Math.floor(ms / DAY);
  const h = Math.floor(ms % DAY / HOUR);
  const m = Math.floor(ms % HOUR / MIN);
  const s = Math.floor(ms % MIN / 1000);
  const parts = [];
  if (d) parts.push(short ? d + 'd' : d + (d === 1 ? ' Tag' : ' Tage'));
  if (h) parts.push(short ? h + 'h' : h + ' Std');
  if (m && parts.length < max) parts.push(short ? m + 'm' : m + ' Min');
  if (s && !d && !h && parts.length < max) parts.push(short ? s + 's' : s + ' Sek');
  return parts.slice(0, max).join(' ') || (short ? '0s' : 'jetzt');
}
export function clockStr(t) {
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function dateStr(t) {
  return new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' });
}
export function dateFull(t) {
  return new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/** Missionstag seit Ankunft */
export function missionDay(t, t0) { return Math.floor((t - t0) / DAY) + 1; }

/* ---------- DOM ---------- */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'data' && typeof v === 'object') for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** **fett** und *grün* im Mailtext */
export function richText(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}
