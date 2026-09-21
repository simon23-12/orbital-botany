/*  Spielzustand: Anlegen, Migrieren, abgeleitete Werte. */

import { MODULES, MOD_BY_ID } from '../data/modules.js';
import { RES_BY_ID } from '../data/research.js';
import { BY_ID as PLANT_BY_ID, TRAY_AREA } from '../data/plants.js';
import { clamp, clamp01, uid, HOUR } from '../core/util.js';

export const SAVE_VERSION = 3;

/* ── Physikalische Grundwerte der Station ────────────────────────────── */
export const CONST = {
  SOLAR_PEAK: 2400,          // W Spitzenleistung der Ausgangs-Paneele
  BATTERY_KWH: 1.6,          // kWh Akkubank
  LED_EFFICACY: 2.5,         // µmol pro Joule (Grundausstattung)
  WATER_CAP: 220,            // L Tankvolumen
  NUTRI_CAP: 4000,           // g Nährsalzvorrat
  RECOVERY: 0.76,            // Wasserrückgewinnung ohne Ausbau
  SLOT_WATER: 6.0,           // L Fassungsvermögen des Tablett-Reservoirs
  TRAY_AREA,                 // m² je Anbauplatz
  CREW_CO2: 1000,            // g CO₂ pro Tag, die du selbst ausatmest
  DELIVERY_H: 12,            // Stunden Lieferzeit
  BASE_TEMP: 20.5,           // °C Stationstemperatur
  BASE_CO2: 1100,            // ppm — im Orbit deutlich über Erdniveau
  BASE_PH: 6.1,
};

export function freshState(name = 'Kommandant') {
  const now = Date.now();
  const st = {
    v: SAVE_VERSION,
    name,
    t0: now,                 // Missionsbeginn
    seen: now,               // zuletzt simuliert
    created: now,
    credits: 420,
    xp: 0,
    level: 1,
    mood: 3,

    water: 180,
    nutrients: 800,
    substrate: 12,
    battery: CONST.BATTERY_KWH * 0.85,
    co2Target: CONST.BASE_CO2,
    tempTarget: CONST.BASE_TEMP,

    modules: { lounge: { built: true }, cupola: { built: true }, grow_a: { built: true, slots: 4 }, lab: { built: true }, systems: { built: true }, cargo: { built: true } },
    lamps: { grow_a: { ppfd: 220, hours: 16, on: true } },
    slots: [],

    seeds: { kresse: 2 },
    research: { done: [], active: null },
    orders: [],
    mail: { items: [], seriesIdx: 0, nextSeriesAt: now + 30 * HOUR, nextFlavorAt: now + 40 * HOUR, cooldowns: {} },
    comfort: [],
    codex: {},               // id -> {seen, harvested}

    stats: {
      planted: 0, harvested: 0, deaths: 0, massG: 0, earned: 0, spent: 0,
      waterUsed: 0, waterRecovered: 0, deliveries: 0, pollinated: 0, researchDone: 0, photos: 0,
    },
    flags: {},
    settings: { music: true, musicVol: 0.55, sfx: true, sfxVol: 0.6, quality: 'auto', bloom: true, reduceMotion: false },
  };
  makeSlots(st, 'grow_a', 4);
  return st;
}

export function makeSlots(st, moduleId, n) {
  for (let i = 0; i < n; i++) {
    st.slots.push({
      id: uid(), mod: moduleId, plant: null, planted: 0, prog: 0,
      moist: 0, nut: 0, health: 1, pollen: 0, dead: false, note: '',
      sick: null, harvestAt: 0,
    });
  }
}

/* ── Fortschritt ─────────────────────────────────────────────────────── */
export const xpToNext = lvl => Math.round(120 * Math.pow(lvl, 1.9));
export function levelProgress(st) {
  const need = xpToNext(st.level);
  return { have: st.xp, need, pct: clamp01(st.xp / need) };
}
export function addXp(st, amount) {
  st.xp += amount;
  let ups = 0;
  while (st.xp >= xpToNext(st.level) && st.level < 30) { st.xp -= xpToNext(st.level); st.level++; ups++; }
  return ups;
}

/* ── Abgeleitete Stationswerte ───────────────────────────────────────── */
export const hasRes = (st, id) => st.research.done.includes(id);

export function solarPeak(st) {
  let p = CONST.SOLAR_PEAK;
  if (hasRes(st, 'solar2')) p *= 1.65;
  if (hasRes(st, 'solar3')) p *= 2.2;
  return p;
}
export function batteryCap(st) {
  return CONST.BATTERY_KWH * (hasRes(st, 'battery') ? 2 : 1);
}
export function ledEfficacy(st) {
  return CONST.LED_EFFICACY * (hasRes(st, 'led2') ? 1.16 : 1);
}
export function lightBonus(st) {
  return hasRes(st, 'led3') ? 1.12 : 1;
}
export function recovery(st) {
  if (hasRes(st, 'recycle3')) return 0.96;
  if (hasRes(st, 'recycle2')) return 0.88;
  return CONST.RECOVERY;
}
export function waterCap(st) {
  let c = CONST.WATER_CAP;
  if (st.modules.hydro?.built) c += 140;
  if (st.modules.vertical?.built) c += 220;
  if (st.modules.dome?.built) c += 160;
  return c;
}
export function nutriCap(st) {
  return CONST.NUTRI_CAP * (st.modules.hydro?.built ? 2 : 1) * (st.modules.vertical?.built ? 1.6 : 1);
}
export function growthBonus(st) {
  let g = 1;
  if (hasRes(st, 'aeroponics')) g *= 1.22;
  if (hasRes(st, 'farred')) g *= 1.06;
  if (hasRes(st, 'grafting')) g *= 1.0;   // wirkt nur auf Gehölze, siehe sim.js
  for (const c of st.comfort) if (c === 'bonsaishelf') g *= 1.01;
  return g;
}
export function waterFactor(st) {
  return hasRes(st, 'aeroponics') ? 0.7 : 1;
}
export function nutrientFactor(st) {
  return hasRes(st, 'microbiome') ? 0.82 : 1;
}
export function sellFactor(st) {
  let f = 1;
  if (hasRes(st, 'market')) f *= 1.3;
  if (hasRes(st, 'analysis')) f *= 1.1;
  return f;
}
export function deliveryMs(st) {
  return (hasRes(st, 'express') ? 5 : CONST.DELIVERY_H) * HOUR;
}
export function researchSpeed(st) {
  return st.comfort.includes('coffeemaker') ? 1.12 : 1;
}
export function autoPollinate(st, p) {
  if (hasRes(st, 'pollinator2')) return true;
  if (hasRes(st, 'pollinator')) return ['microtom', 'weizen', 'paprika', 'chili', 'bohne'].includes(p.id);
  return false;
}
/** 0 = von Hand, 1 = Dochtbewässerung (hält knapp am Leben), 2 = Tropfautomatik. */
export function autoWater(st) {
  if (hasRes(st, 'autowater2')) return 2;
  if (hasRes(st, 'autowater')) return 1;
  return 0;
}
export const waterBuffer = st => hasRes(st, 'autowater') ? 1.6 : 1;

/** Grundlast aller gebauten Module in Watt. */
export function baseLoad(st) {
  let w = 0;
  for (const m of MODULES) if (st.modules[m.id]?.built) w += m.power;
  return w;
}
/** Anbauplätze eines Moduls. */
export function moduleSlots(st, id) {
  const m = st.modules[id];
  if (!m?.built) return 0;
  return m.slots ?? MOD_BY_ID[id]?.slots ?? 0;
}
export function slotsOf(st, moduleId) {
  return st.slots.filter(s => s.mod === moduleId);
}
export function builtModules(st) {
  return MODULES.filter(m => st.modules[m.id]?.built);
}
export function growModules(st) {
  return builtModules(st).filter(m => moduleSlots(st, m.id) > 0);
}
/** Lampeneinstellung eines Moduls (Kuppel nutzt Sonne). */
export function lampOf(st, moduleId) {
  if (!st.lamps[moduleId]) st.lamps[moduleId] = { ppfd: 220, hours: 16, on: true };
  return st.lamps[moduleId];
}

/** Lampenleistung eines Moduls in Watt, wenn eingeschaltet. */
export function lampWatts(st, moduleId) {
  const mod = MOD_BY_ID[moduleId];
  if (!mod || mod.sunlit || mod.dark) return 0;
  const lamp = lampOf(st, moduleId);
  if (!lamp.on) return 0;
  const used = slotsOf(st, moduleId).filter(s => s.plant).length;
  if (!used) return 0;
  return lamp.ppfd * CONST.TRAY_AREA * used / ledEfficacy(st);
}

/* ── Migration ───────────────────────────────────────────────────────── */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const st = raw;
  st.v = st.v || 1;
  if (st.v < 3) {
    st.comfort ||= []; st.codex ||= {}; st.flags ||= {};
    st.mail ||= { items: [], seriesIdx: 0, cooldowns: {} };
    st.mail.cooldowns ||= {};
    st.settings = Object.assign({ music: true, musicVol: .55, sfx: true, sfxVol: .6, quality: 'auto', bloom: true }, st.settings);
    st.v = SAVE_VERSION;
  }
  // Sicherheitsnetz: fehlende Felder aus dem frischen Zustand ergänzen
  const fresh = freshState(st.name || 'Kommandant');
  for (const k of Object.keys(fresh)) if (st[k] === undefined) st[k] = fresh[k];
  for (const k of Object.keys(fresh.stats)) if (st.stats[k] === undefined) st.stats[k] = 0;
  // Die Cupola gab es in früheren Ständen noch nicht
  if (!st.modules.cupola) st.modules.cupola = { built: true };
  st.slots = (st.slots || []).filter(s => s && s.id);
  for (const s of st.slots) if (s.plant && !PLANT_BY_ID[s.plant]) { s.plant = null; s.dead = false; }
  st.research.done = (st.research.done || []).filter(id => RES_BY_ID[id]);
  st.credits = Math.max(0, +st.credits || 0);
  st.water = clamp(+st.water || 0, 0, waterCap(st));
  st.nutrients = clamp(+st.nutrients || 0, 0, nutriCap(st));
  st.battery = clamp(+st.battery || 0, 0, batteryCap(st));
  return st;
}
