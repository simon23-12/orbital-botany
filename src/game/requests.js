/*  Nebeneinkünfte: Missionszulage, Erstfund-Prämie, Aufträge von der Erde,
 *  Fotowünsche mit Überflugfenstern und Laborexperimente.
 *
 *  Die Zustellung der Nachrichten übernimmt game/mail.js — hier entstehen nur
 *  die Vorlagen, damit kein Ring zwischen den Modulen entsteht.
 */

import { PLANTS, BY_ID as PL, cycleMs } from '../data/plants.js';
import { MOD_BY_ID } from '../data/modules.js';
import { CONTRACT_TEMPLATES, PHOTO_TARGETS, PHOTO_REQUEST_MAIL, EXP_BY_ID } from '../data/requests.js';
import { groundTrack, regionAt, solar } from '../core/orbit.js';
import * as S from './state.js';
import { HOUR, DAY, MIN, uid, clamp } from '../core/util.js';

/* ───────────────────────── Missionszulage ───────────────────────── */

/** Tagessatz in Credits — wächst mit der Stufe. */
export const stipendRate = st => 60 + 15 * st.level;
/** Mehr als drei Tage sammelt sich nicht an. */
export const STIPEND_CAP = 3 * DAY;

export function stipendDue(st, now = Date.now()) {
  const since = st.stipend?.since ?? now;
  const span = clamp(now - since, 0, STIPEND_CAP);
  return { credits: Math.floor(stipendRate(st) * span / DAY), span, full: span >= STIPEND_CAP };
}

export function collectStipend(st, now = Date.now()) {
  const d = stipendDue(st, now);
  if (d.credits < 1) return 0;
  st.credits += d.credits;
  st.stats.earned += d.credits;
  st.stipend = { since: now };
  return d.credits;
}

/* ───────────────────────── Erstfund-Prämie ───────────────────────── */

export const firstFindBonus = p => ({ credits: Math.round(p.value * .75 + 30), xp: Math.round(p.xp * .5) });

/* ───────────────────────── Aufträge ───────────────────────── */

const fmtDue = t => new Date(t).toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
const fill = (text, map) => String(text).replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m);

/** Kann die Station diese Kultur überhaupt ziehen? */
function growable(st, p) {
  if (p.level > st.level) return false;
  const mods = Object.entries(st.modules).filter(([, m]) => m.built).map(([id]) => MOD_BY_ID[id]).filter(d => d && (d.slots || 0) > 0);
  if (p.archetype === 'fungus') return mods.some(d => d.dark);
  return mods.some(d => !d.dark);
}

export const openContracts = (st, now = Date.now()) => (st.contracts || []).filter(c => !c.done && c.due > now);

/** Neuen Auftrag zusammenstellen; liefert die Mailvorlage oder null. */
export function makeContract(st, now = Date.now()) {
  st.contracts ||= [];
  const open = openContracts(st, now);
  if (open.length >= 2) return null;
  const taken = new Set(open.map(c => c.plant));
  const pool = PLANTS.filter(p => growable(st, p) && !taken.has(p.id));
  if (!pool.length) return null;
  // Neuere Kulturen etwas häufiger, damit Aufträge mitwachsen
  const weights = pool.map(p => 1 + p.level * .6);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let p = pool[0];
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { p = pool[i]; break; } }

  const cyc = cycleMs(p) / HOUR;
  const qty = clamp(Math.round(60 / cyc), 1, 4);
  const due = now + (Math.max(36, cyc * Math.ceil(qty / 2)) * 1.3 + 24) * HOUR;
  const bonus = Math.round(p.value * qty * .5 + 40);
  const xp = Math.round(p.xp * qty * .4);
  const tpl = CONTRACT_TEMPLATES[Math.floor(Math.random() * CONTRACT_TEMPLATES.length)];
  const c = { id: uid(), plant: p.id, qty, have: 0, due, bonus, xp, from: tpl.from, at: now, done: false };
  st.contracts.push(c);
  const map = { qty, plant: p.name, due: fmtDue(due), bonus: bonus.toLocaleString('de-DE') };
  return { id: null, from: tpl.from, subject: fill(tpl.subject, map), body: fill(tpl.body, map), sig: tpl.sig };
}

/** Bei der Ernte: zählt auf den ältesten offenen Auftrag dieser Kultur. */
export function creditContract(st, plantId, now = Date.now()) {
  const c = openContracts(st, now).filter(x => x.plant === plantId).sort((a, b) => a.due - b.due)[0];
  if (!c) return null;
  c.have++;
  if (c.have < c.qty) return { contract: c, completed: false };
  c.done = true; c.doneAt = now;
  st.credits += c.bonus;
  st.stats.earned += c.bonus;
  st.stats.contracts = (st.stats.contracts || 0) + 1;
  const ups = S.addXp(st, c.xp);
  return { contract: c, completed: true, levelUps: ups };
}

/** Abgelaufene und erledigte Aufträge nach einer Weile wegräumen. */
export function pruneContracts(st, now = Date.now()) {
  st.contracts = (st.contracts || []).filter(c => (c.done ? now - c.doneAt : now - c.due) < 2 * DAY);
}

/* ───────────────────────── Fotowünsche ───────────────────────── */

const PHOTO_BONUS = 3;
const SCAN_H = 30;

function matches(target, t) {
  const g = groundTrack(t);
  return regionAt(g.lat, g.lon) === target.region && solar(t).lit === target.lit;
}

/** Überflugfenster für ein Ziel: Abtasten im 20-s-Raster, Kanten auf eine Sekunde genau. */
export function scanWindows(target, from, until) {
  const step = 20_000;
  const out = [];
  const edge = (a, b, stateA) => {
    for (let i = 0; i < 5; i++) { const m = (a + b) / 2; if (matches(target, m) === stateA) a = m; else b = m; }
    return Math.round(b);
  };
  let prev = matches(target, from), start = prev ? from : 0;
  for (let t = from + step; t <= until; t += step) {
    const cur = matches(target, t);
    if (cur !== prev) {
      const e = edge(t - step, t, prev);
      if (cur) start = e; else out.push({ start, end: e });
      prev = cur;
    }
  }
  if (prev) out.push({ start, end: until });
  return out.filter(w => w.end - w.start >= 60_000);
}

const fmtWhen = (t, now) => {
  const d = new Date(t), n = new Date(now);
  const day = d.toDateString() === n.toDateString() ? 'heute'
    : new Date(now + DAY).toDateString() === d.toDateString() ? 'morgen'
    : d.toLocaleDateString('de-DE', { weekday: 'long' });
  return `${day} um ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
};

/** Neuen Fotowunsch auswählen; liefert die Mailvorlage oder null. */
export function makePhotoRequest(st, now = Date.now()) {
  const req = st.photoReq;
  if (req && !req.done && req.expires > now) return null;
  if (now < (st.flags.nextPhotoReqAt || 0)) return null;
  const until = now + SCAN_H * HOUR;
  const cands = PHOTO_TARGETS.filter(t => t.region !== req?.region)
    .map(target => ({ target, windows: scanWindows(target, now + 2 * MIN, until) }))
    .filter(c => c.windows.length >= 2);
  // Lieber ein Ziel, dessen erstes Fenster in den nächsten Stunden liegt
  const soon = cands.filter(c => c.windows[0].start - now < 6 * HOUR);
  const pool = soon.length ? soon : cands;
  if (pool.length) {
    const { target, windows } = pool[Math.floor(Math.random() * pool.length)];
    st.photoReq = { id: uid(), region: target.region, lit: target.lit, why: target.why, at: now, expires: until, done: false, windows };
    const map = {
      region: target.region, when: target.lit ? 'auf der Tagseite' : 'bei Nacht',
      first: fmtWhen(windows[0].start, now), why: target.why,
    };
    return { id: null, from: PHOTO_REQUEST_MAIL.from, subject: fill(PHOTO_REQUEST_MAIL.subject, map),
      body: fill(PHOTO_REQUEST_MAIL.body, map), sig: PHOTO_REQUEST_MAIL.sig };
  }
  st.flags.nextPhotoReqAt = now + HOUR;
  return null;
}

/** Abgelaufenen Wunsch wegräumen und den nächsten ansetzen. */
export function prunePhotoRequest(st, now = Date.now()) {
  const req = st.photoReq;
  if (!req) return;
  if (req.done && now - req.doneAt > 12 * HOUR) st.photoReq = null;
  else if (!req.done && req.expires <= now) {
    st.photoReq = null;
    st.flags.nextPhotoReqAt = now + (2 + Math.random() * 4) * HOUR;
  }
}

/** Wo steht der aktive Wunsch gerade? { req, open, next } — Fenster als {start, end}. */
export function photoWindow(st, now = Date.now()) {
  const req = st.photoReq;
  if (!req || req.done || req.expires <= now) return { req: req?.done ? req : null, open: null, next: null };
  req.windows = (req.windows || []).filter(w => w.end > now);
  if (!req.windows.length) req.windows = scanWindows(req, now, req.expires);
  const open = req.windows.find(w => w.start <= now && w.end > now) || null;
  const next = req.windows.find(w => w.start > now) || null;
  return { req, open, next };
}

/** Passt eine Aufnahme zum Wunsch? Dann gilt der dreifache Satz. */
export function photoRequestHit(st, info, now = Date.now()) {
  const req = st.photoReq;
  return !!(req && !req.done && req.expires > now && info.region === req.region && !!info.lit === req.lit);
}
export function completePhotoRequest(st, now = Date.now()) {
  const req = st.photoReq;
  req.done = true; req.doneAt = now;
  st.flags.nextPhotoReqAt = now + (4 + Math.random() * 6) * HOUR;
  st.stats.photoRequests = (st.stats.photoRequests || 0) + 1;
}
export { PHOTO_BONUS };

/* ───────────────────────── Laborexperimente ───────────────────────── */

export const experimentReward = (st, e) => ({ credits: e.base + e.perLevel * st.level, xp: e.xp + Math.round(st.level * e.xp / 8) });

export function startExperiment(st, id, now = Date.now()) {
  const e = EXP_BY_ID[id];
  if (!e) return null;
  if (st.experiment) return null;
  st.experiment = { id, startedAt: now, endsAt: now + e.hours * HOUR };
  return st.experiment;
}

/** In der Simulation: fertiges Experiment auszahlen. */
export function finishExperiment(st, t, log) {
  const x = st.experiment;
  if (!x || x.endsAt > t) return;
  const e = EXP_BY_ID[x.id];
  st.experiment = null;
  if (!e) return;
  const r = experimentReward(st, e);
  st.credits += r.credits;
  st.stats.earned += r.credits;
  st.stats.experiments = (st.stats.experiments || 0) + 1;
  S.addXp(st, r.xp);
  log.push({ type: 'experiment', name: e.name, credits: r.credits });
}
