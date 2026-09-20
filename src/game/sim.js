/*  Simulation.
 *
 *  Alles läuft in Echtzeit. Beim Laden der Seite wird die verstrichene Zeit
 *  in Schritten nachgerechnet — Wachstum, Wasser, Energie, Lieferungen.
 *
 *  Wachstumsmodell nach Liebigs Minimumgesetz: Es zählt der knappste Faktor.
 */

import { BY_ID as PLANT_BY_ID, cycleMs, waterRate, nutrientRate, stageAt, pollenWindow, TRAY_AREA } from '../data/plants.js';
import { MOD_BY_ID } from '../data/modules.js';
import { RES_BY_ID } from '../data/research.js';
import { SHOP_BY_ID } from '../data/shop.js';
import * as S from './state.js';
import { solar, PERIOD, meanSun } from '../core/orbit.js';
import { clamp, clamp01, lerp, HOUR, MIN, DAY, rng, hash } from '../core/util.js';
import { emit } from '../core/events.js';

const { CONST } = S;

/* Sonnenlicht im freien Orbit: Solarkonstante 1361 W/m², davon ~45 % PAR,
 * umgerechnet mit 4,57 µmol/J ergibt ~2800 µmol/m²/s — mehr als volle Erdsonne. */
export const SUN_PPFD = 1361 * 0.45 * 4.57;

/* Ab welchem Vielfachen des Sollwerts Licht schadet: Das Photosystem II
 * bleicht aus, wenn mehr Energie ankommt, als abgeführt werden kann. */
export const OVERLIGHT = 3.0;

/* ───────────────────────── Faktoren ───────────────────────── */

/** Lichtqualität: Sättigungskurve, 1,0 genau beim Sollwert. */
export function qLight(dli, need) {
  if (need <= 0.5) return 1;                     // Pilze
  if (dli <= 0) return 0;
  const sat = dli / need;
  const k = 2.2;
  const q = (1 - Math.exp(-k * sat)) / (1 - Math.exp(-k));
  return clamp(q, 0, 1.12);
}
/** Bodenfeuchte: zu trocken ist schlimm, zu nass erstickt die Wurzel. */
export function qWater(m) {
  if (m <= 0.02) return 0;
  if (m < 0.25) return m / 0.25 * 0.85;
  if (m > 0.97) return 0.92;                     // Staunässe
  return 1;
}
/** Nährstoffladung — leere Tabletts zehren von den Reserven der Pflanze. */
export function qNut(n) {
  if (n <= 0) return 0.45;
  if (n < 0.25) return lerp(0.45, 1, n / 0.25);
  return 1;
}
/** Temperatur: flaches Optimum, fällt zu den Grenzen hin ab. */
export function qTemp(t, [lo, opt, hi]) {
  if (t <= lo || t >= hi) return 0;
  const d = t < opt ? (opt - t) / (opt - lo) : (t - opt) / (hi - opt);
  return clamp(1 - 0.82 * d * d, 0.18, 1);
}
/** CO₂-Zuschlag — wirkt nur, wenn genug Licht da ist. */
export function qCO2(ppm, light) {
  const b = 1 + 0.30 * clamp01((ppm - 420) / 900);
  return 1 + (b - 1) * clamp01(light);
}
export function qPh(ph, [lo, hi]) {
  if (ph >= lo && ph <= hi) return 1;
  const d = ph < lo ? lo - ph : ph - hi;
  return clamp(1 - d * 0.45, 0.15, 1);
}

/** Effektive Lichtmenge (DLI) eines Anbauplatzes, mol/m²/Tag. */
export function slotDLI(st, slot, sunFrac) {
  const mod = MOD_BY_ID[slot.mod];
  if (mod?.dark) return 0;
  if (mod?.sunlit) {
    const shade = st.lamps.dome?.shade ?? 0.85;
    return SUN_PPFD * (1 - shade) * sunFrac * 86400 / 1e6;
  }
  const lamp = S.lampOf(st, slot.mod);
  if (!lamp.on) return 0;
  const hours = clamp(lamp.hours, 0, 24);
  return lamp.ppfd * S.lightBonus(st) * hours * 3600 / 1e6;
}

/** Vollständige Faktoranalyse eines Anbauplatzes — auch für die Anzeige. */
export function analyse(st, slot, sunFrac = null) {
  const p = PLANT_BY_ID[slot.plant];
  if (!p) return null;
  const sf = sunFrac ?? (1 - solar(Date.now()).fraction);
  const dli = slotDLI(st, slot, sf);
  const light = qLight(dli, p.dli);
  const water = qWater(slot.moist);
  const nut = qNut(slot.nut);
  const temp = qTemp(st.tempTarget, p.temp);
  const ph = qPh(CONST.BASE_PH, p.ph);
  const co2 = qCO2(st.co2Target, light);
  const min = Math.min(light, water, nut, temp, ph);
  let limiting = 'Licht';
  if (water === min) limiting = 'Wasser';
  else if (nut === min) limiting = 'Nährstoffe';
  else if (temp === min) limiting = 'Temperatur';
  else if (ph === min) limiting = 'pH-Wert';
  const bonus = co2 * S.growthBonus(st) * (p.archetype === 'woody' && S.hasRes(st, 'grafting') ? 1.25 : 1)
    * (slot.sick ? 0.45 : 1);
  const over = p.dli > 0.5 && dli > p.dli * OVERLIGHT;
  return { dli, light, water, nut, temp, ph, co2, min, limiting, over, rate: min * bonus, need: p.dli, p };
}

/* ───────────────────────── Energiebilanz ───────────────────────── */

export function powerReport(st, t = Date.now()) {
  const sun = solar(t);
  const peak = S.solarPeak(st);
  const gen = peak * sun.sun;
  let lamps = 0;
  for (const m of S.growModules(st)) lamps += S.lampWatts(st, m.id);
  const base = S.baseLoad(st);
  const load = base + lamps;
  const meanGen = peak * (1 - sun.fraction);
  return { gen, lamps, base, load, net: gen - load, peak, sun, meanGen, meanNet: meanGen - load };
}

/* ───────────────────────── Ein Simulationsschritt ───────────────────────── */

function step(st, t, dt, log) {
  const hours = dt / HOUR;
  const sun = solar(t);
  const sunFrac = 1 - sun.fraction;          // Anteil Sonnenlicht je Umlauf

  /* — Energie — */
  const peak = S.solarPeak(st);
  const gen = peak * (dt >= PERIOD ? (1 - sun.fraction) : sun.sun);
  let lampW = 0;
  for (const m of S.growModules(st)) lampW += S.lampWatts(st, m.id);
  const load = S.baseLoad(st) + lampW;
  const netWh = (gen - load) * hours;
  const cap = S.batteryCap(st) * 1000;
  const before = st.battery * 1000;
  let after = before + netWh;
  let brownout = 1;
  if (after < 0) {
    // Akku leer → Lampen werden abgeregelt; Grundlast hat Vorrang
    const avail = before + gen * hours - S.baseLoad(st) * hours;
    brownout = lampW > 0 ? clamp01(avail / (lampW * hours)) : 1;
    after = 0;
    if (!st.flags.brownout) { st.flags.brownout = true; log.push({ type: 'power' }); }
  } else if (st.flags.brownout && after > cap * 0.25) {
    st.flags.brownout = false;
  }
  st.battery = clamp(after, 0, cap) / 1000;

  /* — Pflanzen — */
  const rec = S.recovery(st);
  const wFac = S.waterFactor(st);
  const nFac = S.nutrientFactor(st);
  const grow = S.growthBonus(st);
  const autoW = S.autoWater(st);
  const slotCap = CONST.SLOT_WATER * S.waterBuffer(st);
  const sickChance = S.hasRes(st, 'quarantine') ? 0 : 0.012 * (dt / DAY);
  let anyPollen = false;

  for (const s of st.slots) {
    if (!s.plant || s.dead) continue;
    const p = PLANT_BY_ID[s.plant];
    if (!p) { s.plant = null; continue; }

    const mod = MOD_BY_ID[s.mod];
    let dli = slotDLI(st, s, sunFrac);
    if (!mod?.sunlit && !mod?.dark) dli *= brownout;

    const fLight = qLight(dli, p.dli);
    const fWater = qWater(s.moist);
    const fNut = qNut(s.nut);
    const fTemp = qTemp(st.tempTarget, p.temp);
    const fPh = qPh(CONST.BASE_PH, p.ph);
    const minF = Math.min(fLight, fWater, fNut, fTemp, fPh);
    const bonus = qCO2(st.co2Target, fLight) * grow
      * (p.archetype === 'woody' && S.hasRes(st, 'grafting') ? 1.25 : 1)
      * (s.sick ? 0.45 : 1);

    /* Wasserverbrauch: hängt am Licht — mehr Photosynthese, mehr Transpiration. */
    const transp = waterRate(p) * dt * (0.3 + 0.7 * clamp01(fLight)) * wFac * (s.prog < 0.15 ? 0.4 : 1);
    const used = Math.min(transp, s.moist * slotCap);
    s.moist = clamp01(s.moist - used / slotCap);
    st.stats.waterUsed += used;
    const back = used * rec;
    st.water = Math.min(S.waterCap(st), st.water + back);
    st.stats.waterRecovered += back;

    /* Nährstoffe: drei Ladungen je Kultur */
    s.nut = clamp01(s.nut - dt / cycleMs(p) * 2 * nFac);

    /* Bewässerungsautomatik — Docht hält knapp am Leben, Tropfer versorgt voll. */
    if (autoW) {
      const target = autoW === 2 ? 0.85 : 0.45;
      if (s.moist < target * 0.75) {
        const need = (target - s.moist) * slotCap;
        const take = Math.min(need, st.water);
        st.water -= take;
        s.moist = clamp01(s.moist + take / slotCap);
      }
      if (autoW === 2 && s.nut < 0.35) {
        const ng = Math.min(p.n / 2, st.nutrients);
        if (ng > 0) { st.nutrients -= ng; s.nut = clamp01(s.nut + ng / (p.n / 2)); }
      }
    }

    /* Wachstum */
    let rate = minF * bonus / cycleMs(p);
    let next = s.prog + rate * dt;

    /* Bestäubungssperre */
    const win = p.pollinate ? pollenWindow(p) : null;
    if (win && !s.pollen) {
      if (S.autoPollinate(st, p)) { s.pollen = 1; st.stats.pollinated++; }
      else if (next > win[1]) { next = win[1]; anyPollen = true; }
      else if (next > win[0]) anyPollen = true;
    }
    s.prog = clamp01(next);

    /* Gesundheit — reife Kulturen halten sich deutlich länger */
    let dh = 0;
    const ripe = s.prog >= 1 ? 0.35 : 1;
    if (fWater === 0) dh -= ripe * dt / (20 * HOUR);
    else if (fLight === 0 && p.dli > 0.5) dh -= ripe * dt / (26 * HOUR);
    else if (fTemp === 0) dh -= ripe * dt / (14 * HOUR);
    else if (dli > p.dli * OVERLIGHT && p.dli > 0.5 && s.prog < 1) dh -= dt / (70 * HOUR);
    else if (s.sick) dh -= dt / (60 * HOUR);
    else dh += dt / (20 * HOUR);
    s.health = clamp01(s.health + dh);

    if (!s.sick && sickChance > 0 && Math.random() < sickChance) {
      s.sick = Math.random() < 0.5 ? 'Echter Mehltau' : 'Trauermücken';
      log.push({ type: 'sick', slot: s.id, name: p.name, what: s.sick });
    }

    if (s.health <= 0) {
      s.dead = true; s.health = 0; st.stats.deaths++;
      log.push({ type: 'death', name: p.name, slot: s.id });
      emit('plant:death', { slot: s, plant: p });
    } else if (s.prog >= 1 && !s.harvestAt) {
      s.harvestAt = t;
      log.push({ type: 'ready', name: p.name, slot: s.id });
    }
  }
  st.flags.pollenDue = anyPollen;

  /* — CO₂ & Atmosphäre (langsame Annäherung an den Sollwert) — */
  st.co2 = lerp(st.co2 ?? st.co2Target, st.co2Target, clamp01(hours / 6));
}

/* ───────────────────────── Zeitgesteuerte Ereignisse ───────────────────────── */

function processTimed(st, t, log) {
  /* Lieferungen */
  for (const o of st.orders) {
    if (o.done || o.arrivesAt > t) continue;
    o.done = true;
    st.stats.deliveries++;
    for (const [id, qty] of Object.entries(o.items)) {
      if (id.startsWith('seed:')) {
        const pid = id.slice(5);
        st.seeds[pid] = (st.seeds[pid] || 0) + qty;
      } else {
        const item = SHOP_BY_ID[id];
        if (!item) continue;
        if (item.give) {
          if (item.give.water) st.water = Math.min(S.waterCap(st), st.water + item.give.water * qty);
          if (item.give.nutrients) st.nutrients = Math.min(S.nutriCap(st), st.nutrients + item.give.nutrients * qty);
          if (item.give.substrate) st.substrate += item.give.substrate * qty;
          if (item.give.beneficials) st.flags.beneficials = (st.flags.beneficials || 0) + item.give.beneficials * qty;
          if (item.give.co2cart) st.flags.co2cart = (st.flags.co2cart || 0) + qty;
        }
        if (item.perk || item.effect) {
          if (!st.comfort.includes(item.id)) st.comfort.push(item.id);
          if (item.effect?.mood) st.mood = clamp(st.mood + item.effect.mood, 0, 10);
        }
      }
    }
    log.push({ type: 'delivery', order: o });
    emit('delivery', o);
  }
  st.orders = st.orders.filter(o => !o.done || t - o.arrivesAt < 6 * HOUR);

  /* Modulbau */
  for (const [id, m] of Object.entries(st.modules)) {
    if (m.building && m.readyAt <= t) {
      m.building = false; m.built = true;
      const def = MOD_BY_ID[id];
      m.slots = def?.slots || 0;
      S.makeSlots(st, id, m.slots);
      if (def && !def.sunlit && !def.dark) st.lamps[id] = { ppfd: 220, hours: 16, on: true };
      if (def?.sunlit) st.lamps[id] = { shade: 0.88, on: true };
      log.push({ type: 'module', id, name: def?.name || id });
    }
  }

  /* Forschung */
  const r = st.research.active;
  if (r && r.endsAt <= t) {
    st.research.done.push(r.id);
    st.research.active = null;
    st.stats.researchDone++;
    log.push({ type: 'research', id: r.id, name: RES_BY_ID[r.id]?.name });
    emit('research:done', r.id);
  }
}

/* ───────────────────────── Nachholrechnung ───────────────────────── */

/**
 * Simuliert von st.seen bis `now`.
 * @returns {{ms:number, log:Array}} Zusammenfassung für den „Während du weg warst"-Bericht
 */
export function catchUp(st, now = Date.now()) {
  const from = st.seen || now;
  let gap = now - from;
  const log = [];
  if (gap < 0) { st.seen = now; return { ms: 0, log }; }          // Uhr zurückgestellt
  if (gap < 250) { st.seen = now; return { ms: gap, log }; }

  /* Schrittweite: fein bei kurzen Pausen, gröber bei langen. */
  const MAXSTEPS = 900;
  let dt = Math.max(15_000, Math.min(HOUR, gap / MAXSTEPS));
  let t = from;
  let guard = 0;
  while (t < now && guard++ < MAXSTEPS + 40) {
    const s = Math.min(dt, now - t);
    processTimed(st, t + s, log);
    step(st, t + s / 2, s, log);
    t += s;
  }
  if (t < now) { processTimed(st, now, log); step(st, now, now - t, log); }
  st.seen = now;
  return { ms: gap, log };
}

/** Ein Schritt im laufenden Spiel. */
export function live(st, now = Date.now()) {
  const dt = Math.min(now - st.seen, 5 * MIN);
  if (dt <= 0) { st.seen = now; return []; }
  const log = [];
  processTimed(st, now, log);
  step(st, now, dt, log);
  st.seen = now;
  return log;
}

/* ───────────────────────── Hilfsrechnungen für die Anzeige ───────────────────────── */

/** Verbleibende Zeit bis zur Ernte, ms — bei gleichbleibenden Bedingungen. */
export function etaHarvest(st, slot) {
  const p = PLANT_BY_ID[slot.plant];
  if (!p || slot.dead) return Infinity;
  if (slot.prog >= 1) return 0;
  const a = analyse(st, slot);
  if (!a || a.rate <= 0) return Infinity;
  const win = p.pollinate ? pollenWindow(p) : null;
  if (win && !slot.pollen && slot.prog >= win[1] - 1e-6) return Infinity;
  return (1 - slot.prog) * cycleMs(p) / a.rate;
}
/** Zeit, bis das Tablett trocken ist. */
export function etaDry(st, slot) {
  const p = PLANT_BY_ID[slot.plant];
  if (!p || slot.dead || S.autoWater(st)) return Infinity;
  const a = analyse(st, slot);
  const rate = waterRate(p) * (0.3 + 0.7 * clamp01(a?.light ?? 1)) * S.waterFactor(st);
  if (rate <= 0) return Infinity;
  return slot.moist * CONST.SLOT_WATER * S.waterBuffer(st) / rate;
}
/** Ertrag inklusive Gesundheits- und Forschungsmodifikatoren. */
export function harvestValue(st, slot) {
  const p = PLANT_BY_ID[slot.plant];
  if (!p) return { credits: 0, xp: 0, massG: 0 };
  const q = 0.45 + 0.55 * slot.health;
  const pollBonus = S.hasRes(st, 'pollinator2') && p.pollinate ? 1.1 : 1;
  return {
    credits: Math.round(p.value * q * pollBonus * S.sellFactor(st)),
    xp: Math.round(p.xp * (0.7 + 0.3 * slot.health)),
    massG: Math.round(p.yieldG * q * pollBonus),
    quality: q,
  };
}
