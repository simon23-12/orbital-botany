/*  Spieleraktionen. Jede gibt {ok, msg} zurück und löst Events aus. */

import { BY_ID as PLANT_BY_ID, cycleMs, pollenWindow } from '../data/plants.js';
import { MOD_BY_ID } from '../data/modules.js';
import { RES_BY_ID } from '../data/research.js';
import { SHOP_BY_ID, freightFor } from '../data/shop.js';
import * as S from './state.js';
import { harvestValue, analyse } from './sim.js';
import { clamp, clamp01, uid, HOUR } from '../core/util.js';
import { emit } from '../core/events.js';

const ok = (msg, extra) => ({ ok: true, msg, ...extra });
const no = msg => ({ ok: false, msg });
const slotById = (st, id) => st.slots.find(s => s.id === id);

/* ───────────────────────── Anbau ───────────────────────── */

export function plantSeed(st, slotId, plantId) {
  const s = slotById(st, slotId);
  const p = PLANT_BY_ID[plantId];
  if (!s) return no('Platz nicht gefunden');
  if (s.plant) return no('Platz ist belegt');
  if (!p) return no('Unbekannte Kultur');
  if (p.level > st.level) return no(`Erst ab Stufe ${p.level} freigegeben`);
  if ((st.seeds[plantId] || 0) < 1) return no('Kein Saatgut vorhanden');
  if (st.substrate < 1) return no('Keine Substratpads mehr — nachbestellen');
  const mod = MOD_BY_ID[s.mod];
  if (mod?.dark && p.archetype !== 'fungus') return no('In der Pilzkammer wächst nur Pilzkultur');
  if (!mod?.dark && p.archetype === 'fungus') return no('Pilze brauchen die dunkle Kammer');

  st.seeds[plantId]--;
  if (!st.seeds[plantId]) delete st.seeds[plantId];
  st.substrate--;
  Object.assign(s, {
    plant: plantId, planted: Date.now(), prog: 0, moist: 1, nut: 1,
    health: 1, pollen: 0, dead: false, sick: null, harvestAt: 0,
  });
  st.water = Math.max(0, st.water - S.CONST.SLOT_WATER * S.waterBuffer(st));
  st.nutrients = Math.max(0, st.nutrients - p.n / 2);
  st.stats.planted++;
  st.codex[plantId] = Object.assign({ seen: true, harvested: 0 }, st.codex[plantId], { seen: true });
  emit('plant:sow', { slot: s, plant: p });
  return ok(`${p.name} ausgesät`);
}

export function waterSlot(st, slotId, quiet = false) {
  const s = slotById(st, slotId);
  if (!s?.plant || s.dead) return no('Nichts zu gießen');
  const p = PLANT_BY_ID[s.plant];
  const cap = S.CONST.SLOT_WATER * S.waterBuffer(st);
  const needW = (1 - s.moist) * cap;
  const needN = (1 - s.nut) * (p.n / 2);
  if (needW < 0.05 && needN < 0.2) return no('Tablett ist versorgt');
  if (st.water < 0.05) return no('Wassertank leer');
  const gotW = Math.min(needW, st.water);
  st.water -= gotW;
  s.moist = clamp01(s.moist + gotW / cap);
  const gotN = Math.min(needN, st.nutrients);
  st.nutrients -= gotN;
  if (needN > 0) s.nut = clamp01(s.nut + gotN / (p.n / 2));
  if (!quiet) emit('slot:water', s);
  return ok(`Gegossen — ${gotW.toFixed(2)} L`, { water: gotW, nut: gotN });
}

export function waterAll(st) {
  let n = 0, w = 0;
  for (const s of st.slots) {
    if (!s.plant || s.dead) continue;
    const r = waterSlot(st, s.id, true);
    if (r.ok) { n++; w += r.water; }
  }
  emit('slot:water', null);
  return n ? ok(`${n} Tabletts gegossen · ${w.toFixed(1)} L`) : no('Alles versorgt');
}

export function pollinate(st, slotId) {
  const s = slotById(st, slotId);
  if (!s?.plant) return no('Kein Platz');
  const p = PLANT_BY_ID[s.plant];
  if (!p.pollinate) return no('Diese Kultur braucht keine Bestäubung');
  if (s.pollen) return no('Bereits bestäubt');
  const win = pollenWindow(p);
  if (!win || s.prog < win[0]) return no('Blüht noch nicht');
  s.pollen = 1;
  st.stats.pollinated++;
  emit('slot:pollinate', s);
  return ok(`${p.name} bestäubt — Fruchtansatz gesichert`);
}

export function treat(st, slotId) {
  const s = slotById(st, slotId);
  if (!s?.sick) return no('Kein Befall');
  if (!(st.flags.beneficials > 0)) return no('Keine Nützlingskarte vorrätig');
  st.flags.beneficials--;
  s.sick = null;
  return ok('Nützlinge ausgesetzt — Befall beendet');
}

export function harvest(st, slotId) {
  const s = slotById(st, slotId);
  if (!s?.plant) return no('Kein Platz');
  const p = PLANT_BY_ID[s.plant];
  if (s.dead) return clearSlot(st, slotId);
  if (s.prog < 1) return no('Noch nicht erntereif');
  const v = harvestValue(st, s);
  st.credits += v.credits;
  st.stats.earned += v.credits;
  st.stats.harvested++;
  st.stats.massG += v.massG;
  const ups = S.addXp(st, v.xp);
  const c = st.codex[s.plant] ||= { seen: true, harvested: 0 };
  c.harvested++; c.best = Math.max(c.best || 0, v.quality);
  let seedBack = 0;
  if (S.hasRes(st, 'seedbank') && Math.random() < 0.35) {
    seedBack = 1; st.seeds[s.plant] = (st.seeds[s.plant] || 0) + 1;
  }
  Object.assign(s, { plant: null, prog: 0, moist: 0, nut: 0, health: 1, pollen: 0, dead: false, sick: null, harvestAt: 0 });
  emit('harvest', { plant: p, value: v, levelUps: ups, seedBack });
  return ok(`${p.name} geerntet`, { value: v, levelUps: ups, seedBack, plant: p });
}

export function clearSlot(st, slotId) {
  const s = slotById(st, slotId);
  if (!s?.plant) return no('Platz ist leer');
  const p = PLANT_BY_ID[s.plant];
  Object.assign(s, { plant: null, prog: 0, moist: 0, nut: 0, health: 1, pollen: 0, dead: false, sick: null, harvestAt: 0 });
  return ok(`${p.name} entfernt und Platz gereinigt`);
}

/* ───────────────────────── Licht & Klima ───────────────────────── */

export function setLamp(st, modId, patch) {
  const l = S.lampOf(st, modId);
  Object.assign(l, patch);
  if (l.ppfd != null) l.ppfd = clamp(Math.round(l.ppfd), 0, 900);
  if (l.hours != null) l.hours = clamp(Math.round(l.hours), 0, 24);
  if (l.shade != null) l.shade = clamp01(l.shade);
  emit('lamp', modId);
  return ok('Lichtprogramm gespeichert');
}
export function setClimate(st, patch) {
  if (patch.temp != null) st.tempTarget = clamp(+patch.temp, 5, 32);
  if (patch.co2 != null) {
    const max = S.hasRes(st, 'co2') ? 1600 : 1200;
    st.co2Target = clamp(+patch.co2, 400, max);
  }
  return ok('Klimasollwerte übernommen');
}

/* ───────────────────────── Handel ───────────────────────── */

export function cartTotal(st, cart) {
  let goods = 0, mass = 0;
  for (const [id, qty] of Object.entries(cart)) {
    if (!qty) continue;
    if (id.startsWith('seed:')) {
      const p = PLANT_BY_ID[id.slice(5)];
      if (!p) continue;
      goods += p.seed * qty; mass += 0.02 * qty;
    } else {
      const it = SHOP_BY_ID[id];
      if (!it) continue;
      goods += it.price * qty; mass += (it.mass || 0.1) * qty;
    }
  }
  const freight = Object.values(cart).some(q => q > 0) ? freightFor(mass) : 0;
  return { goods, mass, freight, total: goods + freight };
}

export function placeOrder(st, cart) {
  const t = cartTotal(st, cart);
  if (!t.total) return no('Der Warenkorb ist leer');
  if (st.credits < t.total) return no('Nicht genug Guthaben');
  const items = {};
  for (const [id, q] of Object.entries(cart)) if (q > 0) items[id] = q;
  st.credits -= t.total;
  st.stats.spent += t.total;
  const now = Date.now();
  const order = { id: uid(), items, placedAt: now, arrivesAt: now + S.deliveryMs(st), mass: t.mass, cost: t.total };
  st.orders.push(order);
  emit('order', order);
  return ok(`Auftrag erteilt — Andocken in ${(S.deliveryMs(st) / HOUR).toFixed(0)} Stunden`, { order });
}

/* ───────────────────────── Ausbau & Forschung ───────────────────────── */

export function buildModule(st, id) {
  const def = MOD_BY_ID[id];
  if (!def) return no('Unbekanntes Modul');
  const m = st.modules[id];
  if (m?.built) return no('Bereits gebaut');
  if (m?.building) return no('Wird bereits montiert');
  if (st.level < def.level) return no(`Erst ab Stufe ${def.level}`);
  if (st.credits < def.cost) return no('Nicht genug Guthaben');
  st.credits -= def.cost;
  st.stats.spent += def.cost;
  st.modules[id] = { built: false, building: true, readyAt: Date.now() + (def.buildHours || 8) * HOUR, slots: 0 };
  emit('module:order', id);
  return ok(`${def.name} beauftragt — Montage in ${def.buildHours || 8} Stunden`);
}

export function expandModule(st, id, idx) {
  const def = MOD_BY_ID[id];
  const ex = def?.expand?.[idx];
  const m = st.modules[id];
  if (!ex || !m?.built) return no('Ausbau nicht verfügbar');
  m.expansions ||= [];
  if (m.expansions.includes(idx)) return no('Bereits ausgebaut');
  if (idx > 0 && !m.expansions.includes(idx - 1)) return no('Vorheriger Ausbau fehlt');
  if (st.level < ex.level) return no(`Erst ab Stufe ${ex.level}`);
  if (st.credits < ex.cost) return no('Nicht genug Guthaben');
  st.credits -= ex.cost;
  st.stats.spent += ex.cost;
  m.expansions.push(idx);
  m.slots = (m.slots || def.slots) + ex.slots;
  S.makeSlots(st, id, ex.slots);
  emit('module:expand', id);
  return ok(`${ex.name} montiert — ${ex.slots} zusätzliche Plätze`);
}

export function startResearch(st, id) {
  const r = RES_BY_ID[id];
  if (!r) return no('Unbekanntes Vorhaben');
  if (st.research.done.includes(id)) return no('Bereits abgeschlossen');
  if (st.research.active) return no('Es läuft bereits ein Vorhaben');
  if (st.level < r.level) return no(`Erst ab Stufe ${r.level}`);
  if (r.req.some(q => !st.research.done.includes(q))) return no('Voraussetzung fehlt');
  if (st.credits < r.cost) return no('Nicht genug Guthaben');
  st.credits -= r.cost;
  st.stats.spent += r.cost;
  const hours = r.hours / S.researchSpeed(st);
  st.research.active = { id, startedAt: Date.now(), endsAt: Date.now() + hours * HOUR };
  emit('research:start', id);
  return ok(`${r.name} läuft — fertig in ${hours.toFixed(1)} Stunden`);
}

export function useCo2Cartridge(st) {
  if (!(st.flags.co2cart > 0)) return no('Keine Patrone vorrätig');
  st.flags.co2cart--;
  st.co2Target = Math.min(1600, st.co2Target + 300);
  return ok('CO₂ angehoben');
}
