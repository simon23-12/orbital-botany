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
    padWash: { queue: 0, nextAt: 0 },   // Pads in der Spülung
    filter: { health: 1, spares: 1 },   // Wasserfilter und Ersatzpatronen
    hydroDrift: 0,                      // Abweichung der Nährlösung
    panelFault: null,                   // ausgefallenes Paneelsegment
    lampPriority: [],                   // Reihenfolge beim Lastabwurf, wichtigstes zuerst
    stipend: { since: now },            // Missionszulage sammelt sich ab hier
    contracts: [],                      // Aufträge von der Erde
    photoReq: null,                     // aktueller Fotowunsch
    experiment: null,                   // laufendes Laborexperiment
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
      experiments: 0, contracts: 0, photoRequests: 0, firstFinds: 0,
      filters: 0, calibrations: 0, repairs: 0, dockings: 0, thinned: 0, workouts: 0, contacts: 0,
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
  if (hasRes(st, 'solarclean')) p *= 1.2;
  if (st.panelFault && !st.panelFault.repairedAt) p *= 1 - st.panelFault.loss;
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
  let r = CONST.RECOVERY;
  if (hasRes(st, 'recycle3')) r = 0.96;
  else if (hasRes(st, 'urine')) r = 0.92;
  else if (hasRes(st, 'recycle2')) r = 0.88;
  // Ein zugesetzter Filter kostet bis zu zehn Prozentpunkte
  return r - FILTER_MAX_LOSS * (1 - filterHealth(st));
}

/* ── Wartung ── */
export const FILTER_DAYS = 6;              // so lange hält eine Patrone
export const FILTER_MAX_LOSS = 0.10;
export const filterHealth = st => clamp01(st.filter?.health ?? 1);
/** Drift der Nährlösung in der Hydroponik, 0 = frisch kalibriert, 1 = stark verschoben. */
export const HYDRO_DRIFT_H = 36;
export const hydroDrift = st => clamp01(st.hydroDrift ?? 0);
export const hydroFactor = st => 1 - 0.15 * hydroDrift(st);
/** Angezeigte Messwerte aus der Drift: EC sinkt, pH steigt. */
export function hydroReadings(st) {
  const d = hydroDrift(st);
  return { ec: 1.8 - 0.7 * d, ph: 5.9 + 1.1 * d };
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
export function researchSpeed(st, now = Date.now()) {
  return (st.comfort.includes('coffeemaker') ? 1.12 : 1) * (isFit(st, now) ? 1.08 : 1);
}
/** Training am Ergometer hält einen Tag lang wach und konzentriert. */
export const isFit = (st, now = Date.now()) => (st.flags.fitUntil || 0) > now;
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
/** Pad-Aufbereitung: je Pad 10 Minuten und 1 L Spülwasser. */
export const PAD_WASH_MS = 10 * 60 * 1000;
export const PAD_RINSE_L = 1;
export function queuePadWash(st, now = Date.now()) {
  if (!hasRes(st, 'padwash')) return false;
  const w = st.padWash ||= { queue: 0, nextAt: 0 };
  if (!w.queue) w.nextAt = now + PAD_WASH_MS;
  w.queue++;
  return true;
}

export const waterBuffer = st => hasRes(st, 'autowater') ? 1.6 : 1;

/** Grundlast aller gebauten Module in Watt. Anbaumodule ziehen den Großteil nur
 *  für belegte Plätze (Pumpen, Lüfter, Sensoren), das Labor nur, wenn etwas läuft. */
export function moduleLoad(st, m) {
  if (!st.modules[m.id]?.built) return 0;
  const slots = moduleSlots(st, m.id);
  if (slots > 0) {
    const used = st.slots.filter(s => s.mod === m.id && s.plant).length;
    return m.power * (0.25 + 0.75 * used / slots);
  }
  if (m.id === 'lab') return m.power * (st.research.active || st.experiment ? 1 : 0.35);
  return m.power;
}
export function baseLoad(st) {
  let w = 0;
  for (const m of MODULES) w += moduleLoad(st, m);
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

/** Module mit Lampen in der Reihenfolge, in der sie beim Strommangel versorgt werden. */
export function lampOrder(st) {
  const ids = growModules(st).filter(m => !m.sunlit && !m.dark).map(m => m.id);
  const pri = (st.lampPriority || []).filter(id => ids.includes(id));
  return [...pri, ...ids.filter(id => !pri.includes(id))];
}

/** Lampenleistung eines Moduls in Watt, wenn eingeschaltet. */
export function lampWatts(st, moduleId) {
  const mod = MOD_BY_ID[moduleId];
  if (!mod || mod.sunlit || mod.dark) return 0;
  const lamp = lampOf(st, moduleId);
  if (!lamp.on) return 0;
  const used = slotsOf(st, moduleId).filter(s => s.plant).length;
  if (!used) return 0;
  // Mittel über den Tag: Die Lampen brennen nur während der Lichtzeit
  return lamp.ppfd * CONST.TRAY_AREA * used / ledEfficacy(st) * clamp(lamp.hours ?? 16, 0, 24) / 24;
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
