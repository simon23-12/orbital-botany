/*  Wiederverwendbare Materialien und prozedurale Texturen. */
import * as THREE from 'three';

const cache = new Map();

function canvasTex(key, w, h, draw, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Hüllblech: Paneelfugen, Nieten, Gebrauchsspuren. */
export function hullTexture() {
  return canvasTex('hull', 1024, 1024, (x, w, h) => {
    x.fillStyle = '#d8d9d6'; x.fillRect(0, 0, w, h);
    // Grundrauschen
    const img = x.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 16;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    // Paneelfugen
    x.strokeStyle = 'rgba(70,74,80,.55)'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      const y = i * h / 8;
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
    }
    for (let i = 0; i <= 12; i++) {
      const px = i * w / 12;
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px, h); x.stroke();
    }
    // Nieten
    x.fillStyle = 'rgba(90,94,100,.45)';
    for (let i = 0; i <= 8; i++) for (let j = 0; j < 60; j++) {
      x.beginPath(); x.arc(j * w / 60 + 6, i * h / 8, 2.1, 0, 7); x.fill();
    }
    // Schmutz / Ausgasungsspuren
    for (let i = 0; i < 60; i++) {
      const gx = Math.random() * w, gy = Math.random() * h;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, 40 + Math.random() * 130);
      g.addColorStop(0, 'rgba(120,112,100,.16)'); g.addColorStop(1, 'rgba(120,112,100,0)');
      x.fillStyle = g; x.fillRect(gx - 180, gy - 180, 360, 360);
    }
    // Warnmarkierungen
    x.fillStyle = 'rgba(210,150,40,.55)';
    for (let i = 0; i < 6; i++) {
      const bx = Math.random() * w, by = Math.random() * h;
      x.save(); x.translate(bx, by); x.rotate(Math.random() * 3);
      for (let k = 0; k < 6; k++) x.fillRect(k * 9, 0, 5, 16);
      x.restore();
    }
  }, { srgb: true });
}

/** Multilayer-Isolation: goldene, zerknitterte Folie. */
export function mliTexture() {
  return canvasTex('mli', 512, 512, (x, w, h) => {
    x.fillStyle = '#c9a04a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const gx = Math.random() * w, gy = Math.random() * h;
      const len = 12 + Math.random() * 90, a = Math.random() * Math.PI;
      x.strokeStyle = `rgba(${Math.random() < .5 ? '255,225,150' : '120,85,25'},${.05 + Math.random() * .16})`;
      x.lineWidth = .6 + Math.random() * 2.2;
      x.beginPath(); x.moveTo(gx, gy);
      x.lineTo(gx + Math.cos(a) * len, gy + Math.sin(a) * len); x.stroke();
    }
    // Nähte
    x.strokeStyle = 'rgba(90,65,20,.5)'; x.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const y = i * h / 6;
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
    }
  }, { srgb: true });
}

/** Solarzellen mit Sammelschienen. */
export function solarTexture() {
  return canvasTex('solar', 512, 512, (x, w, h) => {
    x.fillStyle = '#0a1834'; x.fillRect(0, 0, w, h);
    const cells = 16;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const v = 0.72 + Math.random() * 0.18;
      x.fillStyle = `rgb(${Math.round(16 * v)},${Math.round(34 * v)},${Math.round(78 * v)})`;
      x.fillRect(i * w / cells + 1.5, j * h / cells + 1.5, w / cells - 3, h / cells - 3);
    }
    x.strokeStyle = 'rgba(190,205,230,.34)'; x.lineWidth = 1.1;
    for (let i = 0; i < cells; i++) for (let k = 1; k < 4; k++) {
      const px = i * w / cells + k * (w / cells) / 4;
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px, h); x.stroke();
    }
    x.strokeStyle = 'rgba(210,220,245,.5)'; x.lineWidth = 2.6;
    for (let j = 0; j <= cells; j++) {
      const y = j * h / cells;
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
    }
  }, { srgb: true });
}

/** Geriffeltes Bodenblech für die Innenräume. */
export function floorTexture() {
  return canvasTex('floor', 512, 512, (x, w, h) => {
    x.fillStyle = '#4c515a'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const px = i * 32, py = j * 32;
      x.save(); x.translate(px + 16, py + 16); x.rotate((i + j) % 2 ? .78 : -.78);
      x.fillRect(-9, -2.2, 18, 4.4); x.restore();
    }
    x.strokeStyle = 'rgba(0,0,0,.30)'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * 128); x.lineTo(w, i * 128); x.stroke();
    }
  }, { srgb: true });
}

/** Gewebe für Couch und Decke. */
export function fabricTexture(color = '#3a4356') {
  return canvasTex('fabric' + color, 256, 256, (x, w, h) => {
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .08})`;
      x.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    x.strokeStyle = 'rgba(0,0,0,.05)'; x.lineWidth = 1;
    for (let i = 0; i < w; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
    for (let i = 0; i < h; i += 4) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
  }, { srgb: true });
}

/* ── Materialfabrik ── */
export function mats() {
  if (cache.has('__mats')) return cache.get('__mats');
  const hull = hullTexture();
  hull.repeat.set(2, 1);
  const m = {
    hull: new THREE.MeshStandardMaterial({ map: hull, color: 0xf2f2ee, roughness: .62, metalness: .18 }),
    hullDark: new THREE.MeshStandardMaterial({ map: hull, color: 0x8d9299, roughness: .55, metalness: .45 }),
    mli: new THREE.MeshStandardMaterial({ map: mliTexture(), color: 0xffcf7a, roughness: .38, metalness: .92 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: .34, metalness: .95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: .55, metalness: .6 }),
    solar: new THREE.MeshStandardMaterial({
      map: solarTexture(), color: 0x93a6d8, roughness: .22, metalness: .78,
      emissive: 0x0a1630, emissiveIntensity: .5, side: THREE.DoubleSide,
    }),
    radiator: new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: .28, metalness: .35, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xdff1ff, roughness: .035, metalness: 0, transmission: .96, thickness: .35,
      transparent: true, opacity: .45, ior: 1.5, side: THREE.DoubleSide,
      clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.2,
    }),
    glow: new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: .9 }),
    panelLit: new THREE.MeshStandardMaterial({ color: 0x101820, roughness: .3, metalness: .4, emissive: 0x2a5f7a, emissiveIntensity: .55 }),
  };
  cache.set('__mats', m);
  return m;
}

export function clearMaterialCache() { cache.clear(); }
