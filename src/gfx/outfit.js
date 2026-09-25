/*  Ausstattung der Innenräume: Rackwände, Staubeutel, Laptops, Handläufe,
 *  Feuerlöscher, Lüftungsgitter, Kabelbündel, Wegweiser.
 *
 *  Die ISS ist innen kein glatter Zylinder: Alle vier Seiten sind mit Racks
 *  verkleidet, dazwischen Klettflächen, Beschriftungen, festgezurrte Beutel,
 *  überall Laptops und Handläufe. Genau dieses Gewimmel macht die Räume
 *  glaubwürdig. Alles Statische teilt sich wenige Materialien und wird später
 *  je Raum zu einem Netz verschmolzen — die Zahl der Zeichenaufrufe bleibt klein.
 */
import * as THREE from 'three';
import { TAU, rng } from '../core/util.js';

const cache = new Map();
const once = (key, make) => cache.has(key) ? cache.get(key) : (cache.set(key, make()), cache.get(key));

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ───────────────────── Rackwand ─────────────────────
   Eine Kachel ist eine Rackfront: Rahmen, Schubladen und Klappen in
   verschiedenen Größen, Etiketten, Klettpunkte, ein paar Warnaufkleber.
   Farbe und Relief entstehen aus demselben Zufallsplan. */
function rackPlan(seed = 7) {
  const r = rng(seed);
  const panels = [];
  const cols = [[0, .5], [.5, 1]];
  for (const [x0, x1] of cols) {
    let y = .04;
    while (y < .96) {
      const h = Math.min(.96 - y, [.08, .12, .16, .22, .3][Math.floor(r() * 5)]);
      const split = h < .2 && r() < .45;
      if (split) {
        const m = x0 + (x1 - x0) * (.35 + r() * .3);
        panels.push({ x0: x0 + .02, x1: m - .006, y0: y, y1: y + h - .01, kind: r() });
        panels.push({ x0: m + .006, x1: x1 - .02, y0: y, y1: y + h - .01, kind: r() });
      } else panels.push({ x0: x0 + .02, x1: x1 - .02, y0: y, y1: y + h - .01, kind: r() });
      y += h;
    }
  }
  return { panels, r };
}

export function rackTextures() {
  return once('rack', () => {
    const S = 1024;
    const plan = rackPlan(11);
    const color = canvas(S, S, (x) => {
      x.fillStyle = '#d9d7d0'; x.fillRect(0, 0, S, S);
      // leichte Unruhe im Anstrich
      for (let i = 0; i < 3000; i++) {
        x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '60,60,60'},${Math.random() * .04})`;
        x.fillRect(Math.random() * S, Math.random() * S, 3, 3);
      }
      // Rackholme
      x.fillStyle = '#b9b8b2';
      x.fillRect(0, 0, S * .02, S); x.fillRect(S * .49, 0, S * .02, S); x.fillRect(S * .98, 0, S * .02, S);
      const r = rng(5);
      for (const p of plan.panels) {
        const X = p.x0 * S, Y = p.y0 * S, W = (p.x1 - p.x0) * S, H = (p.y1 - p.y0) * S;
        const shade = 214 + Math.floor(r() * 22);
        x.fillStyle = p.kind < .12 ? '#c9cdd2' : p.kind < .2 ? '#e8e6de' : `rgb(${shade},${shade - 2},${shade - 7})`;
        x.fillRect(X, Y, W, H);
        x.strokeStyle = 'rgba(70,72,74,.55)'; x.lineWidth = 3; x.strokeRect(X, Y, W, H);
        // Griffmulden und Verschlüsse
        x.fillStyle = 'rgba(60,62,66,.65)';
        if (W > 90) { x.fillRect(X + W / 2 - 24, Y + 8, 48, 7); }
        for (const [cx, cy] of [[X + 10, Y + 10], [X + W - 10, Y + 10], [X + 10, Y + H - 10], [X + W - 10, Y + H - 10]]) {
          x.beginPath(); x.arc(cx, cy, 3.2, 0, TAU); x.fill();
        }
        // Etikett
        if (r() < .7 && W > 70 && H > 40) {
          const lw = Math.min(W * .5, 150), lh = 22;
          const lx = X + 14 + r() * Math.max(1, W - lw - 28), ly = Y + H - lh - 14;
          x.fillStyle = '#f7f6f0'; x.fillRect(lx, ly, lw, lh);
          x.fillStyle = 'rgba(40,40,40,.75)';
          for (let k = 0; k < 3; k++) x.fillRect(lx + 5, ly + 5 + k * 5.5, lw * (.5 + r() * .4), 2.2);
        }
        // Klettpunkte
        if (p.kind > .55 && p.kind < .75) {
          x.fillStyle = 'rgba(70,72,76,.8)';
          for (let k = 0; k < 2; k++) x.fillRect(X + W * (.2 + k * .45), Y + H * .35, 26, 26);
        }
        // Lüftungsschlitze
        if (p.kind > .9 && H > 60) {
          x.fillStyle = 'rgba(40,42,46,.7)';
          for (let k = 0; k < Math.floor(H / 12) - 2; k++) x.fillRect(X + 16, Y + 14 + k * 12, W - 32, 5);
        }
        // Warnaufkleber
        if (p.kind > .76 && p.kind < .8) {
          x.fillStyle = '#e2b02a'; x.fillRect(X + 12, Y + 12, 40, 16);
          x.fillStyle = '#222'; for (let k = 0; k < 4; k++) x.fillRect(X + 14 + k * 10, Y + 12, 5, 16);
        }
        if (p.kind > .8 && p.kind < .82) { x.fillStyle = '#c0392b'; x.fillRect(X + 12, Y + 12, 22, 22); }
        if (p.kind > .82 && p.kind < .85) { x.fillStyle = '#3b6fb0'; x.fillRect(X + 12, Y + 12, 60, 14); }
      }
    });
    const bump = canvas(512, 512, (x) => {
      const s = 512;
      x.fillStyle = '#808080'; x.fillRect(0, 0, s, s);
      x.fillStyle = '#9a9a9a';
      x.fillRect(0, 0, s * .02, s); x.fillRect(s * .49, 0, s * .02, s); x.fillRect(s * .98, 0, s * .02, s);
      for (const p of plan.panels) {
        const X = p.x0 * s, Y = p.y0 * s, W = (p.x1 - p.x0) * s, H = (p.y1 - p.y0) * s;
        x.fillStyle = '#3c3c3c'; x.fillRect(X - 1.5, Y - 1.5, W + 3, H + 3);
        x.fillStyle = p.kind < .5 ? '#8c8c8c' : '#848484'; x.fillRect(X + 1, Y + 1, W - 2, H - 2);
        x.fillStyle = '#505050'; if (W > 45) x.fillRect(X + W / 2 - 12, Y + 4, 24, 4);
      }
    });
    const map = tex(color), bumpMap = tex(bump, { srgb: false });
    return { map, bumpMap };
  });
}

/** Material für Modulwände mit Rackverkleidung. Die Farbe tönt nur. */
export function rackMaterial(tint = 0xffffff, repU = 6, repV = 3) {
  const { map, bumpMap } = rackTextures();
  const m = map.clone(), b = bumpMap.clone();
  m.repeat.set(repU, repV); b.repeat.set(repU, repV);
  m.needsUpdate = b.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map: m, bumpMap: b, bumpScale: 1.6, color: tint, roughness: .74, metalness: .06, side: THREE.BackSide,
  });
}

/** Helle Wandpaneele mit Fugen, Nieten und Beschriftungsfeldern (Knoten, Stirnwände). */
export function panelTexture() {
  return once('panel', () => {
    const c = canvas(512, 512, (x) => {
      x.fillStyle = '#dcdedb'; x.fillRect(0, 0, 512, 512);
      const img = x.getImageData(0, 0, 512, 512);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - .5) * 6;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      x.putImageData(img, 0, 0);
      const cells = [[0, 0, 256, 256], [256, 0, 256, 128], [256, 128, 256, 128], [0, 256, 128, 256], [128, 256, 384, 256]];
      for (const [px, py, w, h] of cells) {
        x.strokeStyle = 'rgba(80,86,92,.55)'; x.lineWidth = 3; x.strokeRect(px + 2, py + 2, w - 4, h - 4);
        x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1; x.strokeRect(px + 5, py + 5, w - 10, h - 10);
        x.fillStyle = 'rgba(90,96,102,.5)';
        for (const [rx, ry] of [[px + 12, py + 12], [px + w - 12, py + 12], [px + 12, py + h - 12], [px + w - 12, py + h - 12]]) {
          x.beginPath(); x.arc(rx, ry, 3, 0, 7); x.fill();
        }
      }
      x.fillStyle = 'rgba(120,124,128,.35)'; x.fillRect(30, 180, 90, 14); x.fillRect(300, 60, 120, 10); x.fillRect(170, 420, 140, 12);
      x.fillStyle = 'rgba(60,110,170,.55)'; x.fillRect(290, 180, 60, 18);
      x.fillStyle = 'rgba(210,160,50,.6)'; x.fillRect(40, 320, 50, 8);
    });
    return tex(c);
  });
}

/** Gesteppte Polsterung, wie in der Cupola und an Schlafplätzen. */
function paddingTexture() {
  return once('padding', () => tex(canvas(256, 256, (x, w, h) => {
    x.fillStyle = '#e9e7e0'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '90,90,90'},${Math.random() * .06})`;
      x.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    x.strokeStyle = 'rgba(120,118,110,.55)'; x.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(0, i * 128); x.lineTo(w, i * 128); x.stroke(); }
    for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, h); x.stroke(); }
    x.fillStyle = 'rgba(80,80,80,.35)';
    for (const [a, b] of [[64, 64], [192, 64], [64, 192], [192, 192]]) { x.beginPath(); x.arc(a, b, 5, 0, TAU); x.fill(); }
  })));
}

/** Beige Nomex-Beutel mit Gurten. */
function bagTexture() {
  return once('bag', () => tex(canvas(256, 256, (x, w, h) => {
    x.fillStyle = '#d8ceb4'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,250' : '70,60,40'},${Math.random() * .07})`;
      x.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    x.fillStyle = 'rgba(120,108,80,.55)'; x.fillRect(0, 118, w, 20);        // Gurt
    x.fillStyle = 'rgba(90,80,60,.5)'; x.fillRect(118, 0, 20, h);
    x.fillStyle = '#f5f3ec'; x.fillRect(30, 30, 70, 40);                       // Etikett
    x.fillStyle = 'rgba(40,40,40,.7)'; for (let k = 0; k < 4; k++) x.fillRect(36, 38 + k * 7, 50 - k * 6, 3);
    x.strokeStyle = 'rgba(80,70,50,.5)'; x.lineWidth = 2; x.strokeRect(4, 4, w - 8, h - 8);
  })));
}

/* ───────────────────── Materialien ───────────────────── */
export function outfitMats() {
  return once('mats', () => ({
    rail: new THREE.MeshStandardMaterial({ color: 0x8aa2bc, roughness: .42, metalness: .55 }),
    padding: new THREE.MeshStandardMaterial({ map: paddingTexture(), color: 0xffffff, roughness: .92, metalness: 0, side: THREE.DoubleSide }),
    bag: new THREE.MeshStandardMaterial({ map: bagTexture(), color: 0xffffff, roughness: .95, metalness: 0 }),
    bagWhite: new THREE.MeshStandardMaterial({ map: bagTexture(), color: 0xf2f2f4, roughness: .95, metalness: 0 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x5b5448, roughness: .9 }),
    laptop: new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: .45, metalness: .35 }),
    arm: new THREE.MeshStandardMaterial({ color: 0x6d747c, roughness: .4, metalness: .8 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb8231f, roughness: .38, metalness: .25 }),
    black: new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: .55, metalness: .2 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: .5, metalness: .6 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: .7, metalness: .1 }),
    cableBlue: new THREE.MeshStandardMaterial({ color: 0x3e5f86, roughness: .6, metalness: .1 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xd4d9de, roughness: .5, metalness: .35 }),
    ledPanel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e4, emissiveIntensity: 2.2, roughness: .3 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: .15, metalness: .6 }),
  }));
}

/* ───────────────────── Einzelteile ───────────────────── */

/** Handlauf: Stange mit zwei Füßen, liegt entlang +Y, Füße nach −Z. */
export function handrail(len = .6) {
  const O = outfitMats();
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(.035, len, .035), O.rail);
  bar.position.z = .06;
  g.add(bar);
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.035, .04, .07), O.rail);
    foot.position.set(0, s * (len / 2 - .02), .025);
    g.add(foot);
  }
  return g;
}

/** Festgezurrter Staubeutel (Cargo Transfer Bag). Rückseite bei z = 0. */
export function stowageBag(w = .5, h = .35, d = .3, white = false) {
  const O = outfitMats();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 2, 2, 1), white ? O.bagWhite : O.bag);
  // Beutel sind weich: Ecken leicht einziehen
  const pos = body.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = (Math.abs(x) / (w / 2)) * (Math.abs(y) / (h / 2));
    pos.setZ(i, z * (1 - .12 * k));
    pos.setX(i, x * (1 - .04 * (Math.abs(y) / (h / 2))));
  }
  body.geometry.computeVertexNormals();
  body.position.z = d / 2;
  g.add(body);
  for (const sx of [-.28, .28]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(.035, h + .03, d + .025), O.strap);
    strap.position.set(sx * w, 0, d / 2);
    g.add(strap);
  }
  return g;
}

/** Bildschirminhalt eines Laptops: Bodenspur über einer Weltkarte. */
function laptopScreenTexture(kind = 0) {
  return once('laptop' + kind, () => tex(canvas(256, 160, (x, w, h) => {
    x.fillStyle = kind === 1 ? '#0b1a12' : '#0a1220'; x.fillRect(0, 0, w, h);
    if (kind === 1) {
      // Pflanzenwerte
      x.fillStyle = '#5fd98e'; x.font = '10px monospace';
      ['DLI 14.2', 'EC  1.8', 'pH  6.1', 'T  22.4°C', 'RH 64 %'].forEach((t, i) => x.fillText(t, 10, 20 + i * 14));
      x.strokeStyle = '#5fd98e'; x.lineWidth = 1.5; x.beginPath();
      for (let i = 0; i < 120; i++) { const y = 130 - Math.sin(i * .09) * 16 - i * .2; i ? x.lineTo(110 + i, y) : x.moveTo(110, y); }
      x.stroke();
      return;
    }
    // Weltkarte grob
    x.fillStyle = '#1d3b5c'; x.fillRect(8, 18, w - 16, h - 34);
    x.fillStyle = '#3f7a55';
    for (const [a, b, c, d] of [[30, 40, 50, 30], [60, 70, 30, 40], [115, 38, 60, 32], [130, 76, 26, 40], [190, 90, 34, 22], [170, 40, 60, 28]]) x.fillRect(a, b, c, d);
    x.strokeStyle = '#ffd36a'; x.lineWidth = 1.6; x.beginPath();
    for (let i = 0; i <= w - 16; i++) { const y = 18 + (h - 34) / 2 - Math.sin(i / (w - 16) * TAU * 1.5) * 34; i ? x.lineTo(8 + i, y) : x.moveTo(8, y); }
    x.stroke();
    x.fillStyle = '#9fd4ff'; x.font = '9px monospace'; x.fillText('HEDERA  ALT 600 km  INCL 51.6°', 8, 12);
    x.fillText('AOS 00:14:32   β 22°', 8, h - 5);
  }), { repeat: false }));
}

/** Laptop an einem Schwenkarm. Befestigung bei (0,0,0), Arm nach +Z, Bildschirm zeigt nach +Z. */
export function laptop(kind = 0) {
  const O = outfitMats();
  const g = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .32, 8), O.arm);
  arm.rotation.x = Math.PI / 2; arm.position.z = .16;
  g.add(arm);
  const base = new THREE.Mesh(new THREE.BoxGeometry(.36, .02, .25), O.laptop);
  base.position.set(0, -.02, .38);
  g.add(base);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(.3, .14), O.black);
  keys.rotation.x = -Math.PI / 2; keys.position.set(0, -.009, .4);
  g.add(keys);
  const lid = new THREE.Group();
  lid.position.set(0, -.01, .26);
  lid.rotation.x = -.28;
  const back = new THREE.Mesh(new THREE.BoxGeometry(.36, .23, .012), O.laptop);
  back.position.y = .115;
  lid.add(back);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.32, .19),
    new THREE.MeshBasicMaterial({ map: laptopScreenTexture(kind), toneMapped: false }));
  scr.position.set(0, .115, .007);
  scr.userData.dynamic = true;                // bleibt eigenständig
  lid.add(scr);
  g.add(lid);
  return g;
}

/** Feuerlöscher mit Halterung. Rückseite bei z = 0, steht entlang +Y. */
export function extinguisher() {
  const O = outfitMats();
  const g = new THREE.Group();
  const bottle = new THREE.Mesh(new THREE.CapsuleGeometry(.07, .34, 6, 14), O.red);
  bottle.position.set(0, 0, .09);
  g.add(bottle);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.03, .04, .07, 10), O.black);
  head.position.set(0, .25, .09);
  g.add(head);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .16, 6), O.black);
  nozzle.rotation.z = Math.PI / 2; nozzle.position.set(.07, .27, .09);
  g.add(nozzle);
  for (const y of [-.12, .12]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(.18, .03, .12), O.arm);
    band.position.set(0, y, .05);
    g.add(band);
  }
  return g;
}

/** Lüftungsgitter, flach, zeigt nach +Z. */
export function vent(w = .45, h = .22) {
  const O = outfitMats();
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, .03), O.frame);
  g.add(frame);
  const n = Math.max(3, Math.round(h / .035));
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * .86, .012, .03), O.grille);
    s.position.set(0, -h * .4 + i * (h * .8 / (n - 1)), .012);
    s.rotation.x = .5;
    g.add(s);
  }
  return g;
}

/** Wegweiser mit Pfeil. Fläche zeigt nach +Z. */
export function sign(text, { w = .56, h = .14, color = '#1f6b3a' } = {}) {
  const key = 'sign' + text + color;
  const t = once(key, () => tex(canvas(512, 128, (x, W, H) => {
    x.fillStyle = color; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 5; x.strokeRect(6, 6, W - 12, H - 12);
    x.fillStyle = '#fff'; x.font = '600 58px "Space Grotesk", system-ui, sans-serif';
    x.textBaseline = 'middle'; x.fillText(text.toUpperCase(), 34, H / 2 + 3);
    // Pfeil nach vorn (durch die Luke)
    x.beginPath(); x.moveTo(W - 34, H / 2); x.lineTo(W - 74, H / 2 - 26); x.lineTo(W - 74, H / 2 + 26); x.closePath(); x.fill();
  }), { repeat: false }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: t, roughness: .5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .25 }));
  return m;
}

/** Kabelbündel entlang einer Strecke mit Schellen. */
export function cableRun(from, to, count = 3) {
  const O = outfitMats();
  const g = new THREE.Group();
  const dir = to.clone().sub(from);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  for (let i = 0; i < count; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, len, 6), i === 1 ? O.cableBlue : O.cable);
    c.quaternion.copy(q);
    c.position.copy(from).lerp(to, .5).addScaledVector(side, (i - (count - 1) / 2) * .032);
    g.add(c);
  }
  const clamps = Math.max(2, Math.round(len / .6));
  for (let i = 0; i <= clamps; i++) {
    const cl = new THREE.Mesh(new THREE.BoxGeometry(count * .036 + .03, .03, .05), O.arm);
    cl.quaternion.copy(q);
    cl.position.copy(from).lerp(to, i / clamps);
    g.add(cl);
  }
  return g;
}

/** Spiegelreflexkamera mit Tele, wie sie in der Cupola schwebt. Objektiv entlang −Z. */
export function camera() {
  const O = outfitMats();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(.15, .11, .08), O.black);
  g.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(.04, .1, .09), O.laptop);
  grip.position.set(.07, -.005, .005);
  g.add(grip);
  const prism = new THREE.Mesh(new THREE.BoxGeometry(.06, .04, .06), O.black);
  prism.position.set(0, .07, 0);
  g.add(prism);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.042, .038, .28, 20), O.laptop);
  lens.rotation.x = Math.PI / 2; lens.position.set(0, -.005, -.18);
  g.add(lens);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(.046, .046, .04, 20), O.black);
  ring.rotation.x = Math.PI / 2; ring.position.set(0, -.005, -.26);
  g.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(.036, 20), O.lens);
  glass.position.set(0, -.005, -.281); glass.rotation.y = Math.PI;
  g.add(glass);
  g.userData.dynamic = true;
  return g;
}

/** Flaches LED-Leuchtfeld, zeigt nach +Z. */
export function ledPanel(w = .5, h = .12) {
  const O = outfitMats();
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(w + .04, h + .04, .03), O.frame);
  g.add(housing);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), O.ledPanel);
  face.position.z = .016;
  g.add(face);
  return g;
}

/* ───────────────────── Module ausstatten ─────────────────────
   Platziert Ausstattung in einem zylindrischen Modul (Raumkoordinaten).
   Ein Punkt an der Wand wird über den Winkel phi von oben (0 = Decke,
   ± = Seiten) und die Lage t entlang der Achse beschrieben. */
export function dressModule(g, o) {
  const { len, rad, axis = 'x', floorY = -rad * .72 } = o;
  const zones = new Set(o.zones || ['ceiling', 'ends']);
  const r = rng(o.seed ?? 3);
  const place = (obj, t, phi, inset = 0, spin = 0) => {
    // Lage auf der Wand, Blick zur Achse
    const y = Math.cos(phi) * (rad - inset), s = Math.sin(phi) * (rad - inset);
    const pos = axis === 'x' ? new THREE.Vector3(t, y, s) : new THREE.Vector3(s, y, t);
    obj.position.copy(pos);
    const inward = axis === 'x' ? new THREE.Vector3(0, -y, -s).normalize() : new THREE.Vector3(-s, -y, 0).normalize();
    const alongV = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    // lokales +Z nach innen, +Y entlang der Achse
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(alongV, inward), alongV, inward);
    obj.quaternion.setFromRotationMatrix(m);
    if (spin) obj.rotateZ(spin);
    g.add(obj);
    return obj;
  };
  const half = len / 2;

  if (zones.has('ceiling')) {
    // Handläufe links und rechts der Decke, versetzt
    for (let t = -half + .8; t < half - .5; t += 1.35) {
      place(handrail(.55), t + (r() - .5) * .2, .62, 0);
      place(handrail(.55), t + .6 + (r() - .5) * .2, -.62, 0);
    }
    // Lüftungsgitter in der Decke
    for (let t = -half + 1.2; t < half - .8; t += 2.1) place(vent(.5, .22), t, .32, 0, Math.PI / 2);
    // Kabelbündel an einer Deckenkante
    const a = -.95;
    const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    const wall = (t, phi, rr) => axis === 'x' ? new THREE.Vector3(t, Math.cos(phi) * rr, Math.sin(phi) * rr) : new THREE.Vector3(Math.sin(phi) * rr, Math.cos(phi) * rr, t);
    p1.copy(wall(-half + .4, a, rad - .06)); p2.copy(wall(half - .4, a, rad - .06));
    g.add(cableRun(p1, p2, 3));
  }

  if (zones.has('upper')) {
    // Festgezurrte Beutel an den oberen Seitenwänden
    const n = o.bags ?? Math.max(2, Math.round(len / 2.2));
    for (let i = 0; i < n; i++) {
      const t = -half + .9 + (len - 1.8) * (n > 1 ? i / (n - 1) : .5) + (r() - .5) * .3;
      const side = i % 2 ? 1 : -1;
      const b = stowageBag(.42 + r() * .2, .3 + r() * .12, .26, r() < .4);
      place(b, t, side * (.95 + r() * .15), .02, (r() - .5) * .2);
    }
  }

  if (zones.has('ends')) {
    for (const [end, info] of [[-1, o.neg], [1, o.pos]]) {
      if (!info) continue;
      const x = end * (half - .09);
      const at = (lx, ly, lz) => axis === 'x' ? new THREE.Vector3(x, ly, lz * 1) : new THREE.Vector3(lz, ly, x);
      const face = axis === 'x' ? new THREE.Euler(0, -end * Math.PI / 2, 0) : new THREE.Euler(0, end > 0 ? Math.PI : 0, 0);
      // Wegweiser über der Luke: wohin es dort geht
      if (info.to) {
        const sg = sign(info.to);
        sg.position.copy(at(0, 1.08, 0));
        sg.rotation.copy(face);
        g.add(sg);
      }
      // Feuerlöscher neben jeder Luke — Pflicht auf jeder Station
      if (info.extinguisher !== false) {
        const ex = extinguisher();
        ex.position.copy(at(0, .05, 1.25 * (end > 0 ? 1 : -1)));
        ex.rotation.copy(face);
        g.add(ex);
      }
      // Laptop am Eingang
      if (info.laptop) {
        const lp = laptop(info.laptop - 1);
        const side = end > 0 ? -1 : 1;
        lp.position.copy(at(0, .15, 1.3 * side));
        lp.rotation.copy(face);
        lp.rotateY(side * -.35);
        g.add(lp);
      }
      // Handläufe beiderseits der Luke
      for (const s of [-1, 1]) {
        const hr = handrail(.7);
        hr.position.copy(at(0, 0, s * (.8 + .32)));
        hr.rotation.copy(face);
        g.add(hr);
      }
    }
  }
}

/** Quader mit weich gerundeten Kanten — Polster, Kissen, Matratzen. */
export function softBox(w, h, d, r = Math.min(w, h, d) * .22) {
  const g = new THREE.BoxGeometry(w, h, d, 8, 6, 8);
  const p = g.attributes.position;
  const inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-inner.x, Math.min(inner.x, v.x)), Math.max(-inner.y, Math.min(inner.y, v.y)), Math.max(-inner.z, Math.min(inner.z, v.z)));
    v.sub(c);
    if (v.lengthSq() > 1e-10) v.setLength(r);
    p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}
