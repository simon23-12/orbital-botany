/*  Modellierte Einrichtung aus Blender (tools/lounge_blender.py).
 *
 *  Couch, Pflanzenregal, Feuerlöscher und Bodenbelag der Lounge liegen als
 *  ein vorkomprimiertes Paket vor. Die Farbe steckt in den Ecken — samt der
 *  in Blender gebackenen Umgebungsverdeckung —, Gewebe, Holz und Bodenbelag
 *  bekommen zusätzlich eine feine Struktur über dreiachsig projizierte UVs.
 *
 *  Das Paket wird beim Start geladen. Fehlt es, bauen die Räume ihre alten,
 *  einfachen Formen.
 *
 *  Dateiformat je Teilnetz (Offsets in index.json): Positionen int16×3,
 *  Normalen int8×3, Farben uint8×3 (sRGB), aufgefüllt auf 4 Byte, UV int16×2,
 *  dann Indizes uint16 bzw. uint32.
 */
import * as THREE from 'three';

const BASE = './assets/props/';

const store = new Map();        // name → [{ geo, mat }]
let loadP = null;

const SRGB = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
});

async function inflate(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;          // schon entpackt ausgeliefert
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

function decode(buf, sub, ps, us) {
  const nv = sub.nv;
  const qp = new Int16Array(buf, sub.off, nv * 3);
  const qn = new Int8Array(buf, sub.off + nv * 6, nv * 3);
  const qc = new Uint8Array(buf, sub.off + nv * 9, nv * 3);
  const uo = sub.off + Math.ceil(nv * 12 / 4) * 4;
  const qu = new Int16Array(buf, uo, nv * 2);
  const io = uo + nv * 4;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  for (let i = 0; i < nv * 3; i++) {
    pos[i] = qp[i] * ps;
    nrm[i] = qn[i] / 127;
    col[i] = SRGB[qc[i]];
  }
  for (let i = 0; i < nv * 2; i++) uv[i] = qu[i] * us;
  const idx = sub.wide ? new Uint32Array(buf, io, sub.ni) : new Uint16Array(buf, io, sub.ni);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Lädt das Paket. Löst immer auf — true, wenn die Modelle bereitstehen. */
export function loadProps() {
  return loadP ||= (async () => {
    try {
      const ix = await (await fetch(BASE + 'index.json', { cache: 'no-cache' })).json();
      const res = await fetch(BASE + ix.file);
      if (!res.ok) throw new Error(res.status);
      const buf = await inflate(await res.arrayBuffer());
      for (const [name, p] of Object.entries(ix.props)) {
        store.set(name, p.subs.map(s => ({ geo: decode(buf, s, p.posScale, p.uvScale), mat: s.mat })));
      }
      return true;
    } catch (err) {
      console.warn('Einrichtung', err);
      return false;
    }
  })();
}

export function hasProp(name) { return store.has(name); }

/* ── Feinstruktur: kleine, kachelbare Graustufenbilder ── */
function canvasTex(w, h, draw, repeat, srgb = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Leinenbindung: Kette und Schuss, leicht unregelmäßig. 1 Kachel = 2 cm. */
function weave() {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
    const n = 16, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const over = (i + j) % 2 === 0;
      const g = x.createLinearGradient(i * s, j * s, over ? i * s : (i + 1) * s, over ? (j + 1) * s : j * s);
      const v = 150 + Math.random() * 40;
      g.addColorStop(0, `rgb(${v - 60},${v - 60},${v - 60})`);
      g.addColorStop(.5, `rgb(${v},${v},${v})`);
      g.addColorStop(1, `rgb(${v - 60},${v - 60},${v - 60})`);
      x.fillStyle = g;
      x.fillRect(i * s + .5, j * s + .5, s - 1, s - 1);
    }
  }, 50);
}

/** Holzmaserung entlang u, als Farbmultiplikator. 1 Kachel = 50 cm. */
function grain() {
  return canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * h, a = .03 + Math.random() * .09, amp = 2 + Math.random() * 6, f = 1 + Math.random() * 3;
      x.strokeStyle = `rgba(90,55,25,${a})`; x.lineWidth = .6 + Math.random() * 2;
      x.beginPath();
      for (let px = 0; px <= w; px += 8) {
        const py = y + Math.sin(px / w * Math.PI * 2 * f + i) * amp;
        px ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.stroke();
    }
  }, 2, true);
}

/** Feine Körnung eines Verbundbelags. 1 Kachel = 25 cm. */
function speckle() {
  return canvasTex(256, 256, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - .5) * 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }, 4);
}

const mats = new Map();
function material(kind) {
  if (mats.has(kind)) return mats.get(kind);
  const c = { vertexColors: true };
  let m;
  switch (kind) {
    case 'fabric': {
      const t = weave();
      m = new THREE.MeshPhysicalMaterial({ ...c, roughness: .92, bumpMap: t, bumpScale: 1.2,
        sheen: .3, sheenRoughness: .7, sheenColor: new THREE.Color(0x6a7f98), specularIntensity: .25 });
      break;
    }
    case 'wood': m = new THREE.MeshStandardMaterial({ ...c, map: grain(), roughness: .55 }); break;
    case 'floor': {
      const t = speckle();
      m = new THREE.MeshStandardMaterial({ ...c, roughness: .62, metalness: .1, bumpMap: t, bumpScale: .5, roughnessMap: t });
      break;
    }
    case 'metal': m = new THREE.MeshStandardMaterial({ ...c, roughness: .34, metalness: .9 }); break;
    case 'paint': m = new THREE.MeshPhysicalMaterial({ ...c, roughness: .35, clearcoat: .7, clearcoatRoughness: .15 }); break;
    case 'plastic': m = new THREE.MeshStandardMaterial({ ...c, roughness: .45 }); break;
    case 'rubber': m = new THREE.MeshStandardMaterial({ ...c, roughness: .82 }); break;
    case 'ceramic': m = new THREE.MeshPhysicalMaterial({ ...c, roughness: .4, clearcoat: .35, clearcoatRoughness: .3 }); break;
    case 'clay': m = new THREE.MeshStandardMaterial({ ...c, roughness: .9 }); break;
    case 'soil': m = new THREE.MeshStandardMaterial({ ...c, roughness: 1 }); break;
    case 'leaf': m = new THREE.MeshStandardMaterial({ ...c, roughness: .55, side: THREE.DoubleSide }); break;
    case 'stem': m = new THREE.MeshStandardMaterial({ ...c, roughness: .6 }); break;
    case 'glow': m = new THREE.MeshBasicMaterial({ ...c, color: new THREE.Color(2.2, 2.2, 2.2) }); break;
    default: m = new THREE.MeshStandardMaterial({ ...c, roughness: .6 });
  }
  mats.set(kind, m);
  return m;
}

/** Neue Instanz eines Modells (Geometrie und Materialien werden geteilt). */
export function makeProp(name, { shadows = true } = {}) {
  const parts = store.get(name);
  if (!parts) return null;
  const g = new THREE.Group();
  g.name = name;
  for (const p of parts) {
    const mesh = new THREE.Mesh(p.geo, material(p.mat));
    mesh.castShadow = shadows && p.mat !== 'glow';
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  // Wird je Raum mit allem Statischen gleichen Materials verschmolzen (mergeStatic
  // behält dabei die Eckfarben) — ein Feuerlöscher je Modul kostet so keine
  // zusätzlichen Zeichenaufrufe.
  return g;
}
