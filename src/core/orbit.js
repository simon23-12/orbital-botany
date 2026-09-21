/*  Orbitmechanik der Station Hedera — alles echt gerechnet.
 *
 *  Kreisbahn, 600 km über NN, Inklination 51,6°.
 *  Aus der Höhe folgt die Umlaufzeit, daraus Tag/Nacht-Wechsel alle ~48 Minuten,
 *  daraus wiederum die Solarleistung. Der Beta-Winkel (Winkel zwischen Bahnebene
 *  und Sonnenrichtung) wandert langsam durch — in Hochphasen gibt es tagelang
 *  gar keinen Erdschatten mehr.
 */
import { TAU, DEG, clamp01 } from './util.js';

export const R_EARTH = 6371;          // km, mittlerer Erdradius
export const ALT = 600;               // km, Bahnhöhe
export const A = R_EARTH + ALT;       // km, Bahnradius
export const MU = 398600.4418;        // km³/s², geozentrische Gravitationskonstante
export const INCL = 51.6;             // °, Bahnneigung

/** Umlaufzeit in ms — 3. Keplersches Gesetz. ≈ 96,5 min */
export const PERIOD = TAU * Math.sqrt(A ** 3 / MU) * 1000;
/** Bahngeschwindigkeit in km/s ≈ 7,56 */
export const V_ORB = Math.sqrt(MU / A);
/** Grenz-Betawinkel: darüber liegt die Bahn ganz im Sonnenlicht. ≈ 66,1° */
export const BETA_CRIT = Math.asin(R_EARTH / A) / DEG;
/** Sichtbarer Erdhorizont vom Fenster aus, in km */
export const HORIZON = Math.sqrt(A ** 2 - R_EARTH ** 2);
/** Winkeldurchmesser der Erde vom Orbit aus, in ° ≈ 132° */
export const EARTH_ANGULAR = 2 * Math.asin(R_EARTH / A) / DEG;

/* Fester Bezugspunkt, damit Phase & Beta nach jedem Reload identisch sind. */
const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);
const BETA_CYCLE = 70.6 * 86400_000;   // ms — Präzession der Bahnebene
const BETA_AMP = INCL * 1.45;          // °, maximaler Betawinkel ≈ 74,8
const BETA_P0 = -23.087196;            // rad, so gewählt, dass die Mission bei β≈22° startet

/** Betawinkel in Grad zum Zeitpunkt t. */
export function beta(t) {
  return BETA_AMP * Math.sin(TAU * (t - EPOCH) / BETA_CYCLE + BETA_P0);
}

/** Anteil eines Umlaufs im Erdschatten (0 … ~0,37). */
export function eclipseFraction(t) {
  const b = beta(t) * DEG;
  const cosb = Math.cos(b);
  if (cosb <= 1e-6) return 0;
  const x = Math.sqrt(ALT * ALT + 2 * R_EARTH * ALT) / (A * cosb);
  if (x >= 1) return 0;                       // Beta-Hochphase: Dauersonne
  return Math.acos(x) / Math.PI;
}

/** Bahnphase 0…1. 0 = Sonnenhöchststand über dem Subsatellitenpunkt, 0,5 = Schattenmitte. */
export function phase(t) {
  const p = ((t - EPOCH) % PERIOD) / PERIOD;
  return p < 0 ? p + 1 : p;
}

/**
 * Sonnenstand & Beleuchtung.
 * @returns {{phase:number, lit:boolean, sun:number, betaDeg:number,
 *            nextChange:number, eclipseMs:number, sunAz:number, sunEl:number}}
 */
export function solar(t) {
  const p = phase(t);
  const f = eclipseFraction(t);
  const half = f / 2;
  const d = Math.abs(p - 0.5);                // Abstand zur Schattenmitte
  const lit = f === 0 || d > half;

  // weicher Terminator: die Ein-/Austrittsflanke dauert ~30 s
  let sun = 1;
  if (f > 0) {
    const edge = 0.0055;                      // ≈ 32 s in Bahnphase
    sun = clamp01((d - half) / edge + 0.5);
  }

  // Zeit bis zum nächsten Wechsel
  let nextChange;
  if (f === 0) nextChange = Infinity;
  else if (lit) {
    const enter = 0.5 - half;
    nextChange = ((p < enter ? enter - p : 1 + enter - p) % 1) * PERIOD;
  } else {
    nextChange = (0.5 + half - p) * PERIOD;
  }

  // Sonnenrichtung relativ zur Station (für die 3D-Szene)
  const ang = p * TAU;
  const b = beta(t) * DEG;
  return {
    phase: p, lit, sun, betaDeg: beta(t), nextChange,
    eclipseMs: f * PERIOD,
    sunAz: ang,
    sunEl: b,
    fraction: f,
  };
}

/** Position der Station auf der Bahn (Einheitsvektor, Bahnebene um Inklination gekippt). */
export function stationVector(t, out = { x: 0, y: 0, z: 0 }) {
  const a = phase(t) * TAU;
  const i = INCL * DEG;
  const x = Math.cos(a), z = Math.sin(a);
  out.x = x;
  out.y = z * Math.sin(i);
  out.z = z * Math.cos(i);
  return out;
}

/** Zurückgelegte Strecke seit Missionsbeginn, km. */
export function distanceTravelled(ms) { return V_ORB * ms / 1000; }
/** Anzahl Umläufe zwischen zwei Zeitpunkten. */
export function orbits(from, to) { return (to - from) / PERIOD; }

/** Mittlerer Sonnenlicht-Anteil über ein volles Umlauf-Fenster — für die Offline-Rechnung. */
export function meanSun(t0, t1) {
  if (t1 - t0 >= PERIOD) {
    // über ganze Umläufe mitteln: 1 − Schattenanteil (Beta wandert langsam, Mittelwert reicht)
    const mid = (t0 + t1) / 2;
    return 1 - eclipseFraction(mid);
  }
  // kurze Spanne: in Schritten abtasten
  const steps = 12; let s = 0;
  for (let i = 0; i < steps; i++) s += solar(t0 + (t1 - t0) * (i + 0.5) / steps).sun;
  return s / steps;
}

/* ═══════════════════ Bodenspur ═══════════════════
 *
 * Wo steht die Station gerade über der Erde? Die Bahn ist um 51,6° geneigt,
 * die Erde dreht sich darunter in einem Sterntag weg — deshalb verschiebt sich
 * jeder Umlauf um gut 22° nach Westen und die Bodenspur bildet das bekannte
 * Wellenmuster über der Weltkarte.
 */
const OMEGA_E = 360 / 86164.0905;   // °/s, siderische Erdrotation
const NODE_DRIFT = -5.0;            // °/Tag, Knotendrift durch die Erdabplattung (J2)
const LON0 = 47;                    // °, Knotenlängengrad zur Epoche

/** Geografische Position des Subsatellitenpunkts. */
export function groundTrack(t) {
  const u = phase(t) * TAU;                    // Argument der Breite
  const i = INCL * DEG;
  const lat = Math.asin(Math.sin(i) * Math.sin(u)) / DEG;
  const dLon = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)) / DEG;
  const secs = (t - EPOCH) / 1000;
  const node = LON0 + NODE_DRIFT * (secs / 86400);
  let lon = dLon + node - OMEGA_E * secs;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat, lon };
}

/** Bewegungsrichtung über Grund: 0° = Nord, 90° = Ost. */
export function groundHeading(t) {
  const a = groundTrack(t), b = groundTrack(t + 30_000);
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
  const dLat = b.lat - a.lat;
  return (Math.atan2(dLon * Math.cos(a.lat * DEG), dLat) / DEG + 360) % 360;
}

/* Grobe Regionen entlang der befliegbaren Breiten. Land wird vor Wasser geprüft. */
const REGIONS = [
  ['Nordamerika · Westküste', 32, 52, -130, -114], ['Rocky Mountains', 31, 52, -114, -102],
  ['Great Plains', 29, 52, -102, -88], ['Große Seen', 41, 50, -92, -76],
  ['Nordamerika · Ostküste', 30, 48, -83, -66], ['Grönlandsee', 52, 60, -60, -20],
  ['Mexiko', 15, 31, -117, -87], ['Karibik', 9, 26, -87, -60],
  ['Amazonasbecken', -12, 6, -75, -48], ['Anden', -30, 8, -80, -66],
  ['Brasilianisches Hochland', -25, -5, -58, -38], ['Gran Chaco', -33, -18, -66, -56],
  ['Pampa', -40, -30, -66, -54], ['Patagonien', -52, -39, -74, -62],
  ['Sahara', 18, 32, -14, 32], ['Sahelzone', 10, 18, -16, 38],
  ['Westafrika', 4, 14, -18, 8], ['Kongobecken', -6, 5, 10, 30],
  ['Ostafrika · Rift Valley', -12, 6, 30, 42], ['Kalahari', -30, -16, 14, 30],
  ['Südafrika', -35, -28, 16, 33], ['Madagaskar', -26, -11, 43, 51],
  ['Iberische Halbinsel', 36, 44, -10, 3], ['Mittelmeer', 30, 45, -6, 36],
  ['Mitteleuropa', 45, 55, 3, 24], ['Britische Inseln', 49, 52, -11, 2],
  ['Skandinavien', 52, 60, 4, 31], ['Osteuropa', 44, 52, 22, 45],
  ['Naher Osten', 12, 38, 34, 60], ['Kaspisches Becken', 36, 48, 47, 62],
  ['Zentralasien', 36, 52, 55, 88], ['Himalaya', 26, 38, 72, 98],
  ['Indien', 8, 32, 68, 90], ['Südostasien', -10, 24, 92, 128],
  ['Ostchina', 20, 45, 100, 122], ['Japan', 30, 46, 128, 146],
  ['Indonesien', -11, 6, 95, 141], ['Australien', -39, -11, 113, 154],
  ['Neuseeland', -47, -34, 166, 179], ['Sibirien', 45, 52, 60, 140],
];
const OCEANS = [
  ['Nordatlantik', 0, 52, -70, -10], ['Südatlantik', -52, 0, -50, 20],
  ['Nordpazifik', 0, 52, 130, 180], ['Nordpazifik', 0, 52, -180, -105],
  ['Südpazifik', -52, 0, 150, 180], ['Südpazifik', -52, 0, -180, -75],
  ['Indischer Ozean', -45, 25, 20, 118], ['Arabisches Meer', 5, 25, 55, 75],
  ['Südlicher Ozean', -52, -45, -180, 180],
  ['Golf von Mexiko', 18, 31, -97, -81], ['Karibisches Meer', 9, 22, -85, -60],
  ['Südchinesisches Meer', 2, 23, 105, 121], ['Nordsee', 51, 52, -2, 9],
  ['Schwarzes Meer', 41, 47, 28, 42], ['Rotes Meer', 13, 30, 33, 43],
];
const inBox = (lat, lon, [, a, b, c, d]) => lat >= Math.min(a, b) && lat <= Math.max(a, b) && lon >= c && lon <= d;

/** Name der überflogenen Region. */
export function regionAt(lat, lon) {
  for (const r of REGIONS) if (inBox(lat, lon, r)) return r[0];
  for (const r of OCEANS) if (inBox(lat, lon, r)) return r[0];
  return Math.abs(lat) > 45 ? 'Hohe Breiten' : 'Offener Ozean';
}

/** Formatierte Koordinaten, z. B. „12,4° N · 33,8° O". */
export function formatCoords(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'O' : 'W';
  const f = v => Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${f(lat)}° ${ns} · ${f(lon)}° ${ew}`;
}
