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
