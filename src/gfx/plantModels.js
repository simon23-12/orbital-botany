/*  Modellierte Pflanzen aus Blender (tools/plants_blender.py).
 *
 *  Je Art liegen mehrere Wachstumsschritte in drei Varianten vor. Ein Tablett
 *  zeigt einen ganzen Bestand: jede Pflanze bekommt ihren Platz, ihre Drehung,
 *  ihre Größe, ihre Variante und einen leicht versetzten Entwicklungsstand —
 *  so sieht kein Tablett aus wie das andere, und doch ist jedes über die
 *  Platz-ID nach dem Neuladen wieder genau gleich. Zwischen zwei Schritten
 *  wächst die Pflanze stufenlos über ihre Höhe.
 *
 *  Dateiformat je Teilnetz (Offsets in index.json): Positionen int16×3,
 *  Normalen int8×3, Farben uint8×3 (sRGB), aufgefüllt auf 4 Byte, dann
 *  Indizes uint16 bzw. uint32. Die .bin.gz ist vorkomprimiert.
 */
import * as THREE from 'three';
import { rng, hash, clamp, clamp01, lerp, TAU } from '../core/util.js';

const BASE = './assets/plants/';

/** Welt-Einheiten je Meter im Tablett (das Tablett selbst skaliert mit 0,62). */
const WU_PER_M = 1.1;
/** Halbe Nutzfläche eines Tabletts in Metern (x, z). */
const HX = .22, HZ = .165;

/**
 * Bestand je Art. grid = [Spalten, Reihen]; scatter = n Pflanzen frei verteilt.
 * Die Dichten folgen üblichen Pflanzabständen, auf 0,25 m² gerechnet.
 */
const LAYOUT = {
  kresse:     { scatter: 120, s: [.9, 1.3] },
  radieschen: { grid: [4, 3], jit: .014 },
  salat:      { grid: [2, 2], jit: .01 },
  rucola:     { grid: [4, 2], jit: .014 },
  spinat:     { grid: [3, 2], jit: .012 },
  basilikum:  { grid: [2, 2], jit: .02, s: [1.05, 1.25] },
  bohne:      { grid: [3, 2], jit: .015, s: [.85, 1.0] },
  tagetes:    { grid: [3, 2], jit: .02, s: [.85, 1.05] },
  zinnie:     { grid: [3, 1], jit: .015, stagger: .07 },
  erdbeere:   { grid: [2, 2], jit: .02, s: [1.15, 1.35] },
  microtom:   { grid: [2, 2], jit: .015, s: [1.05, 1.2] },
  chili:      { grid: [2, 1], jit: .015 },
  moehre:     { grid: [5, 3], jit: .008, s: [.85, 1.12] },
};

/* Abstimmung aufs Raumlicht: Die Tabletts hängen direkt unter hellen LED-Paneelen,
   und AgX bleicht helle Töne aus. Etwas dunklere, sattere Albedo als in der
   Blender-Vorschau hält Grün grün und Rot rot. */
const ALBEDO = { leaf: .6, stem: .6, petal: .48, fruit: .6, root: .6 };
const SATURATION = { leaf: 1.35, stem: 1.3, petal: 1.7, fruit: 1.6, root: 1.4 };

let indexP = null;
const store = new Map();          // id → { state: 'loading'|'ready'|'failed', entry, models }

function loadIndex() {
  return indexP ||= fetch(BASE + 'index.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
}

async function inflate(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;          // schon entpackt ausgeliefert
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  return ds.arrayBuffer();
}

const SRGB = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
});

function decode(buf, sub, posScale) {
  const nv = sub.nv;
  const qp = new Int16Array(buf, sub.off, nv * 3);
  const qn = new Int8Array(buf, sub.off + nv * 6, nv * 3);
  const qc = new Uint8Array(buf, sub.off + nv * 9, nv * 3);
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) {
    pos[i] = qp[i] * posScale;
    nrm[i] = qn[i] / 127;
  }
  const sat = SATURATION[sub.mat] ?? 1.35, alb = ALBEDO[sub.mat] ?? .6;
  const petal = sub.mat === 'petal';
  for (let i = 0; i < nv * 3; i += 3) {
    const r = SRGB[qc[i]], g = SRGB[qc[i + 1]], b = SRGB[qc[i + 2]];
    const l = r * .2126 + g * .7152 + b * .0722;
    // bunte Blüten dunkler: AgX schiebt helles Orange und Rot sonst ins Lachsfarbene
    const mx = Math.max(r, g, b), chroma = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    const a = petal ? alb * (1 - .45 * chroma) : alb;
    col[i] = Math.max(0, l + (r - l) * sat) * a;
    col[i + 1] = Math.max(0, l + (g - l) * sat) * a;
    col[i + 2] = Math.max(0, l + (b - l) * sat) * a;
  }
  const io = sub.off + nv * 12;
  const idx = sub.wide ? new Uint32Array(buf, io, sub.ni) : new Uint16Array(buf, io, sub.ni);
  return { mat: sub.mat, pos, nrm, col, idx: idx.slice() };
}

/** Lädt die Modelle einer Art im Hintergrund. */
export function requestPlantModel(id) {
  if (!LAYOUT[id] || store.has(id)) return;
  const rec = { state: 'loading' };
  store.set(id, rec);
  loadIndex().then(async ix => {
    const e = ix?.plants?.[id];
    if (!e) { rec.state = 'failed'; return; }
    const res = await fetch(BASE + e.file);
    if (!res.ok) throw new Error(res.status);
    const buf = await inflate(await res.arrayBuffer());
    rec.models = e.models.map(row => row.map(subs => subs.map(s => decode(buf, s, ix.posScale))));
    rec.entry = e;
    rec.state = 'ready';
  }).catch(err => { rec.state = 'failed'; console.warn('Pflanzenmodell', id, err); });
}

export function hasPlantModel(id) { return store.get(id)?.state === 'ready'; }
export function isModeled(id) { return !!LAYOUT[id]; }

/* ── Materialien: Farbe kommt aus den Ecken, Zustand färbt über die Grundfarbe ── */
const matCache = new Map();
const WILT = new THREE.Color(0xb49a58), DEAD = new THREE.Color(0x7a6440);

function material(kind, health) {
  const hb = Math.round(clamp01(health) * 5);
  const k = kind + hb;
  let m = matCache.get(k);
  if (m) return m;
  const common = { vertexColors: true, metalness: 0 };
  switch (kind) {
    case 'leaf':
      // wenig Sheen: unter der Lampe liegt fast jedes Blatt streifend im Licht und würde weiß
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: .58, side: THREE.DoubleSide,
        sheen: .08, sheenRoughness: .5, sheenColor: new THREE.Color(0xd4ffd8), clearcoat: .06, clearcoatRoughness: .55 });
      break;
    case 'petal':
      // Blütenblätter sind samtig matt; Glanz vom Paneel darüber würde sie ausbleichen
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: .82, specularIntensity: .25, side: THREE.DoubleSide,
        sheen: .1, sheenRoughness: .45, sheenColor: new THREE.Color(0xffffff) });
      break;
    case 'fruit':
      m = new THREE.MeshPhysicalMaterial({ ...common, roughness: .3, clearcoat: .7, clearcoatRoughness: .18 });
      break;
    case 'root':
      m = new THREE.MeshStandardMaterial({ ...common, roughness: .55 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ ...common, roughness: .65 });
  }
  const h = hb / 5;
  if (h < 1) m.color.set(0xffffff).lerp(h < .1 ? DEAD : WILT, (1 - h) * (kind === 'fruit' ? .45 : .8));
  matCache.set(k, m);
  return m;
}

/* ── Bestand anlegen ── */
function placements(id, r) {
  const L = LAYOUT[id];
  const out = [];
  if (L.scatter) {
    const minD = Math.sqrt((4 * HX * HZ) / L.scatter) * .62;
    for (let i = 0, tries = 0; i < L.scatter && tries < L.scatter * 30; tries++) {
      const x = (r() * 2 - 1) * HX, z = (r() * 2 - 1) * HZ;
      if (out.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < minD * minD)) continue;
      out.push({ x, z }); i++;
    }
  } else {
    const [cx, cz] = L.grid;
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
      const st = L.stagger ? (i % 2 ? L.stagger : -L.stagger) : 0;
      out.push({
        x: ((i + .5) / cx * 2 - 1) * HX * (cx > 1 ? 1 : 0) + (r() - .5) * 2 * L.jit,
        z: ((j + .5) / cz * 2 - 1) * HZ * (cz > 1 ? 1 : 0) + st + (r() - .5) * 2 * L.jit,
      });
    }
  }
  const [s0, s1] = L.s || [.9, 1.08];
  for (const o of out) { o.rot = r() * TAU; o.s = lerp(s0, s1, r()); o.v = Math.floor(r() * 3); o.j = r(); }
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(),
  _s = new THREE.Vector3(), _n = new THREE.Matrix3(), _a = new THREE.Vector3();

/**
 * Baut den Bestand eines Tabletts als je ein Netz pro Material.
 * @returns {THREE.Group|null} null, solange die Modelle noch laden
 */
export function buildModelBed(p, prog, health, seed, dead) {
  const rec = store.get(p.id);
  if (rec?.state !== 'ready') { requestPlantModel(p.id); return null; }
  const { entry, models } = rec;
  const keys = entry.keys;
  const r = rng(hash(seed + p.id + 'bed'));
  const plan = placements(p.id, r);
  const acc = new Map();                                 // mat → Liste [netz, matrix]
  // Streuung im Entwicklungsstand: nicht bei der Aussaat, nicht bei der Ernte
  const spread = Math.min(1, prog * 12) * Math.min(1, (1 - prog) * 8);
  for (const o of plan) {
    const pi = clamp01(prog + (o.j - .62) * .07 * spread);
    let k = 0;
    while (k < keys.length - 1 && keys[k + 1] <= pi + 1e-6) k++;
    const v = o.v % entry.variants;
    const hs = entry.heights[v];
    let grow = 1;
    if (k < keys.length - 1) {
      const f = (pi - keys[k]) / (keys[k + 1] - keys[k]);
      grow = clamp(lerp(hs[k], hs[k + 1], f) / hs[k], 1, 1.45);
    }
    // Keimlinge sind in Wirklichkeit kaum zentimetergroß — etwas größer, damit man die Saat sieht
    const sc = o.s * grow * lerp(1.5, 1, clamp01(pi / .25));
    const wilt = dead ? 1 : 1 - health;
    _e.set((o.j - .5) * wilt * .9, o.rot, (r() - .5) * wilt * .9, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_v.set(o.x, 0, o.z), _q, _s.set(sc, sc * lerp(1, .7, wilt), sc));
    for (const sub of models[v][k]) {
      if (!acc.has(sub.mat)) acc.set(sub.mat, []);
      acc.get(sub.mat).push([sub, _m.clone()]);
    }
  }
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(WU_PER_M / .62);
  g.add(inner);
  const hl = dead ? .02 : health;
  for (const [mat, list] of acc) {
    let nv = 0, ni = 0;
    for (const [s] of list) { nv += s.pos.length / 3; ni += s.idx.length; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const [s, m] of list) {
      _n.getNormalMatrix(m);
      const e = m.elements, n = s.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2], o3 = (vo + i) * 3;
        pos[o3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        _a.set(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]).applyMatrix3(_n).normalize();
        nrm[o3] = _a.x; nrm[o3 + 1] = _a.y; nrm[o3 + 2] = _a.z;
      }
      col.set(s.col, vo * 3);
      for (let i = 0; i < s.idx.length; i++) idx[io + i] = s.idx[i] + vo;
      vo += n; io += s.idx.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material(mat, hl));
    mesh.userData.dynamic = true;                        // nicht mit der Raumgeometrie verschmelzen
    mesh.castShadow = mesh.receiveShadow = true;
    inner.add(mesh);
  }
  return g;
}
