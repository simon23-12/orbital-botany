/*  Innenräume der Station — begehbar.
 *
 *  Alle gebauten Module hängen an einem Knoten in der Mitte, als Ketten entlang
 *  der Achsen: in Flugrichtung Gewächsraum, Labor, Vertikalfarm; dagegen
 *  Technik und Frachtschleuse; seitlich die Lounge mit dem Panoramafenster,
 *  gegenüber Hydroponik und Pilzkammer; unten zur Erde die Cupola, oben das
 *  Kuppelgewächshaus. Zwischen den Modulen liegen kurze Durchstiege.
 *
 *  Man schwebt frei hindurch (Schwerelosigkeit, die Kamera bleibt aufrecht).
 *  Wände hält ein Abstandsfeld aus einfachen Grundkörpern ab. Die Sonne
 *  scheint mit echtem Stand und Schatten durch die Fenster; der Himmel wird
 *  nur dort gerechnet, wo man tatsächlich hinaussieht.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mats, floorTexture, fabricTexture } from './materials.js';
import { rackMaterial, panelTexture, outfitMats, dressModule, handrail, stowageBag, laptop, camera, ledPanel, sign, cableRun, vent, softBox } from './outfit.js';
import { buildPlant } from './plants3d.js';
import { BY_ID as PLANT_BY_ID, stageAt } from '../data/plants.js';
import { MOD_BY_ID } from '../data/modules.js';
import { clamp, clamp01, lerp, TAU, rng, hash } from '../core/util.js';

/* ───────────────────────── Bausteine ───────────────────────── */

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Wand mit ausgeschnittenem Fenster. */
function wallWithWindow(w, h, winW, winH, r, mat, depth = 0.22) {
  const shape = roundedRectShape(w, h, 0.25);
  const hole = roundedRectShape(winW, winH, r);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, mat);
}

/** Leuchtstreifen an der Decke. */
function lightStrip(len, color = 0xdfeaff, intensity = 1) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(len, 0.06, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 2.4 * intensity, roughness: .3 })
  );
  g.add(bar);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(len + .1, .1, .3), mats().hullDark);
  housing.position.y = .08;
  g.add(housing);
  const pl = new THREE.PointLight(color, 1.2 * intensity, len * 1.4, 2);
  g.add(pl);
  g.userData.lamp = bar;
  return g;
}

/** Bildschirmfläche mit animiertem Inhalt. */
const SCREEN_LABELS = [
  ['O₂', '21.0 %'], ['CO₂', '1100 ppm'], ['T', '22.4 °C'], ['RH', '58 %'], ['P', '101.2 kPa'], ['H₂O', '184 L'],
];
function screen(w, h, hue = 0.55) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.max(64, Math.round(256 * h / w));
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  // Gehäuse, damit der Bildschirm nicht als nackte Fläche in der Luft hängt
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + .05, h + .05, .035), outfitMats().laptop);
  bezel.position.z = -.02;
  m.add(bezel);
  const seed = Math.floor(hue * 97);
  const col = (l, a = 1) => `hsla(${hue * 360},80%,${l}%,${a})`;
  m.userData.draw = (t, lines) => {
    const W = c.width, H = c.height;
    ctx.fillStyle = '#060a12'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = col(60, .12); ctx.lineWidth = 1;
    for (let i = 0; i < H; i += 6) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke(); }
    // Kopfzeile
    ctx.fillStyle = col(55, .35); ctx.fillRect(0, 0, W, 16);
    ctx.fillStyle = col(85); ctx.font = 'bold 10px monospace';
    ctx.fillText('HEDERA · ECLSS', 6, 11);
    ctx.fillText(new Date().toISOString().slice(11, 19), W - 58, 11);
    // Messwerte
    ctx.font = '11px monospace';
    const rows = lines?.length ? lines.map(l => [l, '']) : SCREEN_LABELS.slice(seed % 3, seed % 3 + 4);
    rows.forEach(([k, v], i) => {
      ctx.fillStyle = col(70); ctx.fillText(k, 8, 32 + i * 14);
      ctx.fillStyle = col(88); ctx.fillText(v, 48, 32 + i * 14);
    });
    // Balken
    for (let i = 0; i < 6; i++) {
      const v = .35 + .45 * (.5 + .5 * Math.sin(t * .6 + i * 1.7 + seed));
      ctx.fillStyle = col(62, .85);
      ctx.fillRect(W - 90 + i * 14, 22 + (H * .45) * (1 - v), 9, (H * .45) * v);
    }
    // laufende Kurve
    ctx.strokeStyle = col(62); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const y = H * 0.8 + Math.sin(x * 0.06 + t * 1.4) * 10 + Math.sin(x * 0.21 + t * 0.7) * 5;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    tex.needsUpdate = true;
  };
  return m;
}

/** Ein Anbautablett mit LED-Panel darüber. */
function tray(size = 0.58, withLamp = true) {
  const M = mats();
  const g = new THREE.Group();
  const pan = new THREE.Mesh(new THREE.BoxGeometry(size, .07, size * .8),
    new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: .7, metalness: .3 }));
  pan.receiveShadow = true;
  g.add(pan);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(size * .92, .035, size * .72),
    new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: .95 }));
  soil.position.y = .05;
  g.add(soil);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(size + .03, .02, size * .8 + .03), M.metal);
  rim.position.y = .04;
  g.add(rim);
  if (withLamp) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(size * .95, .04, size * .7),
      new THREE.MeshStandardMaterial({ color: 0xf0f4ff, emissive: 0xffeaf6, emissiveIntensity: 1.5, roughness: .25 }));
    lamp.position.y = .74;
    g.add(lamp);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(size, .07, size * .75), M.hullDark);
    hood.position.y = .79;
    g.add(hood);
    const pl = new THREE.PointLight(0xffdcea, 1.1, 1.9, 2);
    pl.position.y = .6;
    g.add(pl);
    g.userData.lamp = lamp;
    g.userData.lampLight = pl;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .78, 6), M.metal);
      post.position.set(s * size * .46, .41, -size * .36);
      g.add(post);
    }
  }
  g.userData.anchor = new THREE.Object3D();
  g.userData.anchor.position.y = .07;
  g.add(g.userData.anchor);
  return g;
}

/* ───────────────────────── Raumdefinitionen ───────────────────────── */

/** Gepolsterte, warme Wandbespannung für die Lounge. */
function cozyWall(len, rad) {
  const m = outfitMats().padding.clone();
  m.map = m.map.clone(); m.map.needsUpdate = true;
  m.map.repeat.set(Math.round(TAU * rad / 1.5), Math.round(len / 1.5));
  m.color.set(0xecdcc4);
  m.side = THREE.BackSide;
  return m;
}

/** Durchmesser der Luken zwischen den Modulen */
const HATCH_R = 0.8;

/** Runde Stirnwand mit Durchstieg in der Mitte. */
function portWall(rad, mat) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rad, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, HATCH_R, 0, TAU, true);
  s.holes.push(hole);
  return new THREE.Mesh(new THREE.ShapeGeometry(s, 40), mat);
}

/**
 * Zylindrischer Modulrumpf von innen.
 * opts.ends = {neg, pos}: 'closed' (Stirnwand mit Deko-Luke), 'port'
 * (offener Durchstieg zum Nachbarmodul) oder 'open' (keine Wand).
 */
function shell(len, rad, M, opts = {}) {
  const g = new THREE.Group();
  const axis = opts.axis || 'x';                 // Längsachse des Moduls
  const along = v => axis === 'x' ? new THREE.Vector3(v, 0, 0) : new THREE.Vector3(0, 0, v);
  const ends = opts.ends || (opts.openEnds ? { neg: 'open', pos: 'open' } : { neg: 'closed', pos: 'closed' });

  /* Rackverkleidung rundum — eine Kachel ist gut 1,3 m breit und 1,6 m hoch */
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(rad, rad, len, 40, 1, true),
    opts.cozy ? cozyWall(len, rad) : rackMaterial(opts.color ?? 0xffffff, Math.max(4, Math.round(TAU * rad / 1.3)), Math.max(1, Math.round(len / 1.6)))
  );
  if (axis === 'x') wall.rotation.z = Math.PI / 2; else wall.rotation.x = Math.PI / 2;
  wall.receiveShadow = true;
  g.add(wall);

  /* Außenhaut: Von innen unsichtbar, aber aus der Kuppel oder durch ein
     Fenster sieht man sonst die Einrichtung anderer Module frei schweben. */
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(rad + .08, rad + .08, len + .1, 32, 1, true), M.hull);
  skin.rotation.copy(wall.rotation);
  g.add(skin);

  const ft = floorTexture(); ft.repeat.set(len / 1.4, rad);
  const floor = new THREE.Mesh(
    axis === 'x' ? new THREE.BoxGeometry(len, .08, rad * 1.42) : new THREE.BoxGeometry(rad * 1.42, .08, len),
    new THREE.MeshStandardMaterial({ map: ft, color: 0xe2e6ea, roughness: .68, metalness: .3 }));
  floor.position.y = -rad * .72;
  floor.receiveShadow = true;
  g.add(floor);

  // Spanten
  const nRib = Math.max(2, Math.round(len / 1.3));
  for (let i = 0; i <= nRib; i++) {
    const t = -len / 2 + i * len / nRib;
    const r = new THREE.Mesh(new THREE.TorusGeometry(rad * .995, .045, 8, 40), M.metal);
    if (axis === 'x') r.rotation.y = Math.PI / 2;
    r.position.copy(along(t));
    g.add(r);
  }
  // Kabelbahnen an der Decke
  for (const a of [2.1, 4.2]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, len * .96, 8), M.hullDark);
    const y = Math.sin(a) * rad * .9, o = Math.cos(a) * rad * .9;
    if (axis === 'x') { c.rotation.z = Math.PI / 2; c.position.set(0, y, o); }
    else { c.rotation.x = Math.PI / 2; c.position.set(o, y, 0); }
    g.add(c);
  }
  // Stirnwände
  const capTex = panelTexture().clone(); capTex.needsUpdate = true; capTex.repeat.set(.45, .45);
  const capMat = new THREE.MeshStandardMaterial({ map: capTex, color: 0xeceae4, roughness: .72, metalness: .1, side: THREE.DoubleSide });
  for (const [key, sgn] of [['neg', -1], ['pos', 1]]) {
    const kind = ends[key];
    if (kind === 'open') continue;
    const rot = new THREE.Euler();
    if (axis === 'x') rot.y = -sgn * Math.PI / 2; else if (sgn < 0) rot.y = Math.PI;
    if (kind === 'port') {
      const w = portWall(rad, capMat);
      w.position.copy(along(sgn * len / 2));
      w.rotation.copy(rot);
      g.add(w);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(HATCH_R + .04, .065, 10, 40), M.metal);
      ring.position.copy(along(sgn * (len / 2 - .03)));
      ring.rotation.copy(rot);
      g.add(ring);
      continue;
    }
    const cap = new THREE.Mesh(new THREE.CircleGeometry(rad, 32), capMat);
    cap.position.copy(along(sgn * len / 2));
    cap.rotation.copy(rot);
    g.add(cap);
    const hatch = new THREE.Mesh(new THREE.CircleGeometry(rad * .38, 24), M.hullDark);
    hatch.position.copy(along(sgn * (len / 2 - .01)));
    hatch.position.y = -rad * .18;
    hatch.rotation.copy(rot);
    g.add(hatch);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad * .4, .05, 8, 28), M.metal);
    ring.position.copy(hatch.position);
    ring.rotation.copy(rot);
    g.add(ring);
  }
  return g;
}

/* Begehbare Bereiche: Schnitt aus Grundkörpern, in Raumkoordinaten. Die
   Werte sind schon um den Abstand des Auges zur Wand verkleinert. */
const cylR = (axis, c, r, h) => ({ type: 'cyl', axis, c, r, h });
const boxR = (min, max) => ({ type: 'box', min, max });
const sphR = (c, r) => ({ type: 'sph', c, r });
const BIG = 50;

/* ───────────────────────── Die Räume ───────────────────────── */

const ROOMS = {

  /* ══ LOUNGE ══ */
  lounge(st, ctx, modId, ports = {}) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 7.6, RAD = 2.85;
    g.add(shell(LEN, RAD, M, { color: 0xb9bcb8, axis: 'z', ends: { neg: 'open', pos: 'port' }, cozy: true }));
    dressModule(g, { len: LEN, rad: RAD, axis: 'z', zones: ['ceiling', 'ends'], seed: 21,
      pos: { to: ports.nearName || 'Knoten', extinguisher: true } });
    // Außen hinter der Fensterwand
    const hullBack = new THREE.Mesh(new THREE.CircleGeometry(RAD + .08, 32), M.hull);
    hullBack.position.z = -3.95; hullBack.rotation.y = Math.PI;
    g.add(hullBack);
    ctx.dims = { outward: new THREE.Vector3(0, 0, -1), inDist: LEN / 2, outDist: LEN / 2 };
    ctx.walk = [[cylR('z', [0, 0, 0], RAD - .5, LEN / 2 - .35), boxR([-BIG, -1.2, -BIG], [BIG, BIG, BIG])]];
    ctx.profile = { fov: 70, earth: 1.5 };

    /* Panoramafenster an der Stirnseite */
    const wall = wallWithWindow(7.6, 7.6, 4.95, 2.92, .55, new THREE.MeshStandardMaterial({
      color: 0xdadfe2, roughness: .6, metalness: .25,
    }), .3);
    wall.position.z = -3.75;
    g.add(wall);
    // Rahmen
    const frameShape = roundedRectShape(5.22, 3.2, .66);
    frameShape.holes.push(roundedRectShape(4.95, 2.92, .55));
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: .16, bevelEnabled: true, bevelSize: .02, bevelThickness: .02 }), M.metal);
    frame.position.z = -3.65;
    g.add(frame);
    // Scheibe
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(4.95, 2.92), new THREE.MeshBasicMaterial({
      color: 0x9fc4e8, transparent: true, opacity: .035, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glass.position.z = -3.68;
    g.add(glass);
    // Streben
    for (const x of [-1.65, 1.65]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(.06, 2.92, .1), M.metal);
      b.position.set(x, 0, -3.66);
      g.add(b);
    }
    ctx.window = { mesh: glass, dir: new THREE.Vector3(0, -0.80, -0.60).normalize() };

    /* Couch */
    const fab = fabricTexture('#37506b');
    const couchMat = new THREE.MeshStandardMaterial({ map: fab, color: 0x9fb6cf, roughness: .92, metalness: 0 });
    const couch = new THREE.Group();
    const seat = new THREE.Mesh(softBox(2.7, .34, 1.0), couchMat);
    seat.position.y = .42; seat.castShadow = seat.receiveShadow = true;
    couch.add(seat);
    const back = new THREE.Mesh(softBox(2.7, .78, .26), couchMat);
    back.position.set(0, .78, .44); back.rotation.x = -.14;
    back.castShadow = true;
    couch.add(back);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(softBox(.24, .5, 1.0), couchMat);
      arm.position.set(s * 1.32, .55, 0); arm.castShadow = true;
      couch.add(arm);
    }
    for (let i = 0; i < 3; i++) {
      const cu = new THREE.Mesh(softBox(.82, .16, .82), couchMat);
      cu.position.set((i - 1) * .88, .62, -.02); cu.rotation.x = -.05;
      couch.add(cu);
    }
    // Kissen
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(softBox(.42, .42, .14),
        new THREE.MeshStandardMaterial({ map: fabricTexture('#7a5a48'), color: 0xd8b9a0, roughness: .95 }));
      k.position.set(s * .95, .78, .3); k.rotation.set(-.3, s * .3, s * .2);
      couch.add(k);
    }
    // Füße
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(.05, .04, .26, 8), M.metal);
      f.position.set(sx * 1.2, .13, sz * .36);
      couch.add(f);
    }
    couch.position.set(0, -RAD * .68, -1.1);
    couch.rotation.y = Math.PI;
    g.add(couch);
    ctx.couch = couch;

    // Decke (Komfortgegenstand)
    if (st.comfort.includes('blanket')) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(1.1, .07, .95),
        new THREE.MeshStandardMaterial({ map: fabricTexture('#8c4a3a'), color: 0xd4917a, roughness: .98 }));
      bl.position.set(-.8, .63, -.1); bl.rotation.set(.1, .2, .06);
      couch.add(bl);
    }

    /* Teppich */
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40),
      new THREE.MeshStandardMaterial({ map: fabricTexture('#4a4036'), color: 0xa08a70, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, -RAD * .72 + .045, -1.4);
    rug.receiveShadow = true;
    g.add(rug);

    /* Beistelltisch */
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.44, .44, .05, 28),
      new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: .45, metalness: .1 }));
    top.position.y = .42; top.castShadow = true;
    table.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.05, .08, .42, 12), M.metal);
    leg.position.y = .21; table.add(leg);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.24, .26, .04, 20), M.metal);
    table.add(base);
    table.position.set(0, -RAD * .72 + .04, -2.15);
    g.add(table);

    // Becher
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(.045, .038, .1, 14),
      new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: .35 }));
    mug.position.set(.14, .49, -.08);
    table.add(mug);

    /* Komfortgegenstände */
    if (st.comfort.includes('lamp')) {
      const lampG = new THREE.Group();
      const st1 = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 1.05, 8), M.metal);
      st1.position.y = .52; lampG.add(st1);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(.24, .26, 18, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xffe2b8, emissive: 0xffc77a, emissiveIntensity: 1.1, side: THREE.DoubleSide, roughness: .8 }));
      shade.position.y = 1.02; lampG.add(shade);
      const l = new THREE.PointLight(0xffb867, 3.2, 5.5, 2);
      l.position.y = .95; lampG.add(l);
      lampG.position.set(-1.95, -RAD * .72 + .04, -1.9);
      g.add(lampG);
    }
    if (st.comfort.includes('cat')) {
      const cat = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .12, 6, 12),
        new THREE.MeshStandardMaterial({ map: fabricTexture('#4a4a52'), color: 0xb9b9c4, roughness: 1 }));
      body.rotation.z = Math.PI / 2; body.position.y = .1;
      cat.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.075, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xb9b9c4, roughness: 1 }));
      head.position.set(.13, .19, 0); cat.add(head);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(.03, .05, 6),
          new THREE.MeshStandardMaterial({ color: 0x9a9aa6, roughness: 1 }));
        ear.position.set(.13, .25, s * .04); cat.add(ear);
      }
      cat.position.set(1.55, -1.2, -3.1);
      cat.rotation.y = -0.5;
      g.add(cat);
    }
    if (st.comfort.includes('telescope')) {
      const tel = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(.07, .085, .62, 16), M.hullDark);
      tube.rotation.set(-1.2, 0, .2); tube.position.y = .6;
      tel.add(tube);
      const tri = new THREE.Mesh(new THREE.ConeGeometry(.18, .52, 3), M.metal);
      tri.position.y = .26; tel.add(tri);
      tel.position.set(-1.5, -RAD * .72 + .04, -2.9);
      g.add(tel);
    }
    if (st.comfort.includes('record')) {
      const rec = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(.46, .1, .38),
        new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: .5 }));
      rec.add(box);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .01, 32),
        new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .28, metalness: .3 }));
      disc.position.y = .06; rec.add(disc);
      rec.userData.disc = disc;
      rec.position.set(1.9, -RAD * .72 + .1, -2.4);
      g.add(rec);
      ctx.record = disc;
    }
    if (st.comfort.includes('bonsaishelf')) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.22, .18, .09, 24),
        new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: .9 }));
      bowl.position.set(-.2, .47, .06);
      table.add(bowl);
      const moss = new THREE.Mesh(new THREE.SphereGeometry(.2, 18, 10, 0, TAU, 0, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x4f7a42, roughness: 1 }));
      moss.scale.y = .42; moss.position.set(-.2, .51, .06);
      table.add(moss);
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(.055, 0),
        new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: .9 }));
      stone.position.set(-.27, .56, .02);
      table.add(stone);
    }
    if (st.comfort.includes('guitar')) {
      const gt = new THREE.Group();
      const bodyG = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .08, 24), 
        new THREE.MeshStandardMaterial({ color: 0xc09050, roughness: .35, metalness: .05 }));
      bodyG.rotation.x = Math.PI / 2; gt.add(bodyG);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(.05, .58, .03),
        new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: .5 }));
      neck.position.y = .38; gt.add(neck);
      gt.position.set(2.1, -1.35, -1.2); gt.rotation.set(0, -.6, .28);
      g.add(gt);
    }
    if (st.comfort.includes('coffeemaker')) {
      const cm = new THREE.Mesh(new THREE.BoxGeometry(.3, .32, .28), M.metal);
      cm.position.set(-2.1, -1.32, .4);
      g.add(cm);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .1, 12), M.hullDark);
      head.position.set(-2.1, -1.5, .26);
      g.add(head);
    }

    /* Pflanzenregal an der Seitenwand */
    const shelf = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, .04, .3),
        new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: .6 }));
      b.position.y = i * .5;
      shelf.add(b);
      for (let k = 0; k < 3; k++) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(.09, .07, .13, 14),
          new THREE.MeshStandardMaterial({ color: 0xb08868, roughness: .85 }));
        pot.position.set((k - 1) * .45, i * .5 + .085, 0);
        shelf.add(pot);
        const bush = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 8),
          new THREE.MeshStandardMaterial({ color: 0x4e8a46, roughness: .9 }));
        bush.scale.set(1, .8, 1);
        bush.position.set((k - 1) * .45, i * .5 + .2, 0);
        shelf.add(bush);
      }
    }
    shelf.position.set(-2.3, -1.2, 1.2);
    shelf.rotation.y = Math.PI / 2;
    g.add(shelf);

    /* Licht */
    const strip = makeStrip(5.8, 0, RAD * .82, 0, 0xdce8ff, .5);
    strip.rotation.y = Math.PI / 2;
    g.add(strip);
    // Indirektes Licht: von der Decke nach unten, vom Fenster her kühl
    g.add(new THREE.HemisphereLight(0x8fb4dc, 0x40382e, 1.05));
    g.add(new THREE.AmbientLight(0x6a7688, .55));
    const bounce = new THREE.PointLight(0xffd9b0, 1.5, 7.5, 2);
    bounce.position.set(-.6, -1.2, .9);
    g.add(bounce);
    const winFill = new THREE.PointLight(0x9fc8ff, 2.2, 9, 2);
    winFill.position.set(0, .2, -2.6);
    g.add(winFill);
    ctx.winFill = winFill;

    ctx.camera = { pos: new THREE.Vector3(0.05, 0.4, 2.6), look: new THREE.Vector3(0.6, -0.6, -3.6) };
    return g;
  },

  /* ══ CUPOLA ══
   * Nachbau der ISS-Aussichtskuppel: sechs trapezförmige Seitenfenster um eine
   * runde Mittelscheibe. Es gibt bewusst keine Wandflächen zwischen den Rahmen —
   * dadurch ist der Blick nach draußen wirklich rundum frei.
   */
  cupola(st, ctx) {
    const M = mats();
    const O = outfitMats();
    const g = new THREE.Group();

    /* Der weite Ring liegt bewusst HINTER dem Auge — wie wenn man den Kopf in
       die Kuppel steckt. So füllen die sechs Fenster jedes Seitenverhältnis bis
       hinaus zu Ultrawide, ohne dass man seitlich am Rahmen vorbeisieht.
       Alles — Fenster, Kragen, Rückwand — hängt an denselben sechs Ecken.
       Vorher hatte der Kragen eigene Ecken und ließ Spalten ins All offen. */
    const R1 = 1.95, Z1 = 0.78;        // weiter Ring
    const R2 = 1.06, Z2 = -1.12;       // enger Ring, Fassung der Mittelscheibe
    const ZB = Z1 + 1.56;              // Rückwand mit Luke
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd8dee4, roughness: .5, metalness: .35 });
    const paneMat = new THREE.MeshBasicMaterial({
      color: 0x8fb8e0, transparent: true, opacity: .028, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const corner = (i, r, z) => {
      const a = i * TAU / 6 + Math.PI / 6;
      return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
    };
    const quad = (a, b, c, d, mat, uv) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv || [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, mat);
    };
    const hexShape = (r, holeR) => {
      const sh = new THREE.Shape();
      for (let i = 0; i <= 6; i++) { const p = corner(i, r, 0); i ? sh.lineTo(p.x, p.y) : sh.moveTo(p.x, p.y); }
      if (holeR) { const h = new THREE.Path(); h.absarc(0, 0, holeR, 0, TAU, true); sh.holes.push(h); }
      return sh;
    };

    for (let i = 0; i < 6; i++) {
      const aTop = corner(i, R1, Z1), aBot = corner(i, R2, Z2);
      const bTop = corner(i + 1, R1, Z1), bBot = corner(i + 1, R2, Z2);
      /* Pfosten mit Fensterlade-Kurbel */
      const post = new THREE.Mesh(new THREE.BoxGeometry(.09, .09, aTop.distanceTo(aBot)), frameMat);
      post.position.copy(aTop).lerp(aBot, .5); post.lookAt(aBot);
      g.add(post);
      const crank = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .06, 10), M.metal);
      crank.position.copy(aTop).lerp(aBot, .22).multiply(new THREE.Vector3(.93, .93, 1));
      crank.lookAt(0, 0, crank.position.z);
      crank.rotateX(Math.PI / 2);
      g.add(crank);
      /* Trapezscheibe */
      const pane = quad(aTop, bTop, bBot, aBot, paneMat);
      pane.renderOrder = 3;
      g.add(pane);
      /* Rahmenkante oben und unten */
      for (const [p1, p2, w] of [[aTop, bTop, .085], [aBot, bBot, .07]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, w, p1.distanceTo(p2)), frameMat);
        bar.position.copy(p1).lerp(p2, .5); bar.lookAt(p2);
        g.add(bar);
      }
      /* Kragen: sechs gepolsterte Flächen exakt auf den Ecken des weiten Rings */
      const cA = corner(i, R1, Z1), cB = corner(i + 1, R1, Z1), cC = corner(i + 1, R1, ZB), cD = corner(i, R1, ZB);
      g.add(quad(cA, cB, cC, cD, O.padding, [0, 0, 1.5, 0, 1.5, 1.2, 0, 0, 1.5, 1.2, 0, 1.2]));
      // Außenhaut dahinter
      const k = 1.06;
      g.add(quad(cD.clone().multiply(new THREE.Vector3(k, k, 1)), cC.clone().multiply(new THREE.Vector3(k, k, 1)),
        cB.clone().multiply(new THREE.Vector3(k, k, 1)), cA.clone().multiply(new THREE.Vector3(k, k, 1)), M.hull));
      /* Kanten des Kragens */
      const edge = new THREE.Mesh(new THREE.BoxGeometry(.07, .07, ZB - Z1), frameMat);
      edge.position.copy(cA).lerp(cD, .5).multiply(new THREE.Vector3(.985, .985, 1));
      g.add(edge);
    }

    /* Rahmenplatte am weiten Ring — verdeckt die Fuge zwischen Kragen und Fenstern */
    const topPlate = new THREE.Mesh(new THREE.ShapeGeometry(hexShape(R1), 1), frameMat);
    topPlate.geometry = new THREE.ShapeGeometry((() => { const sh = hexShape(R1); const h = new THREE.Path();
      for (let i = 0; i <= 6; i++) { const p = corner(-i, R1 * .92, 0); i ? h.lineTo(p.x, p.y) : h.moveTo(p.x, p.y); } sh.holes.push(h); return sh; })(), 1);
    topPlate.position.z = Z1;
    g.add(topPlate);

    /* Mittelscheibe — 80 cm, das größte Fenster, das je geflogen ist — in
       einer sechseckigen Fassung, die den engen Ring dicht abschließt */
    const CR = R2 * .84;
    const bottom = new THREE.Mesh(new THREE.ShapeGeometry(hexShape(R2, CR), 40), frameMat);
    bottom.position.z = Z2;
    g.add(bottom);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(CR, .04, 10, 48), frameMat);
    ring.position.z = Z2 + .01;
    g.add(ring);
    const centre = new THREE.Mesh(new THREE.CircleGeometry(CR, 48), paneMat);
    centre.position.z = Z2 - .01;
    centre.renderOrder = 3;
    g.add(centre);

    /* Rückwand mit Durchstieg nach oben in den Knoten */
    const back = new THREE.Mesh(new THREE.ShapeGeometry(hexShape(R1, HATCH_R), 40), O.padding);
    back.position.z = ZB;
    g.add(back);
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(HATCH_R + .04, .07, 10, 36), M.metal);
    hatch.position.z = ZB - .03;
    g.add(hatch);
    const up = sign('Knoten');
    up.position.set(0, HATCH_R + .28, ZB - .02); up.rotation.y = Math.PI;
    g.add(up);

    ctx.dims = { outward: new THREE.Vector3(0, 0, -1), inDist: ZB, outDist: 1.3 };
    ctx.walk = [
      [cylR('z', [0, 0, 1.2], 1.4, 1.05)],
      [cylR('z', [0, 0, -.35], .9, .55)],
    ];
    ctx.profile = { fov: 80 };

    /* Auf einer Kragenfläche: die Robotik-Arbeitsstation wie in der echten
       Cupola — zwei Laptops und die beiden Steuerknüppel für den Greifarm. */
    const faceAt = (i, u, v, inset) => {
      // Punkt auf Kragenfläche i: u quer (0…1), v längs (0 = Ring, 1 = Rückwand)
      const p = corner(i, R1, 0).lerp(corner(i + 1, R1, 0), u);
      p.multiplyScalar(1 - inset / (R1 * .866));
      p.z = Z1 + (ZB - Z1) * v;
      return p;
    };
    const faceNormal = i => { const a = (i + .5) * TAU / 6 + Math.PI / 6; return new THREE.Vector3(-Math.cos(a), -Math.sin(a), 0); };
    const mount = (obj, i, u, v, inset = .02) => {
      const n = faceNormal(i);
      obj.position.copy(faceAt(i, u, v, inset));
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1).cross(n).normalize(), new THREE.Vector3(0, 0, 1), n);
      obj.quaternion.setFromRotationMatrix(m);
      g.add(obj);
      return obj;
    };
    const RWS = 2;                     // Fläche mit der Arbeitsstation
    const panel = new THREE.Mesh(new THREE.BoxGeometry(.9, .42, .03), O.arm);
    mount(panel, RWS, .5, .66, .03);
    for (const u of [.28, .72]) {
      const lp = laptop(u < .5 ? 0 : 1);
      mount(lp, RWS, u, .2, .02);
      lp.scale.setScalar(1.15);
    }
    for (const u of [.25, .75]) {
      const stick = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(.14, .14, .06), O.black); stick.add(base);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.015, .018, .12, 8), O.arm);
      shaft.rotation.x = Math.PI / 2; shaft.position.z = .09; stick.add(shaft);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8), O.black); knob.position.z = .16; stick.add(knob);
      mount(stick, RWS, u, .64, .06);
    }
    const scr = screen(.34, .2, .5);
    mount(scr, RWS, .5, .42, .05);
    ctx.screens = [scr];

    /* Handläufe längs auf den übrigen Flächen, Leuchtfelder nahe der Rückwand */
    for (let i = 0; i < 6; i++) {
      if (i !== RWS) { const hr = handrail(.7); mount(hr, i, .5, .5, .01); }
      const led = ledPanel(.45, .08);
      mount(led, i, .5, .9, .02);
    }
    /* Kabel entlang zweier Kanten, ein Staubeutel, die Kamera schwebt am Fenster */
    g.add(cableRun(corner(3, R1 * .96, Z1 + .1), corner(3, R1 * .96, ZB - .1), 3));
    const bag = stowageBag(.38, .28, .22, true);
    mount(bag, 4, .5, .55, .02);
    const cam = camera();
    cam.position.set(.72, -.62, -.55);
    cam.lookAt(1.3, -1.1, -1.7);
    cam.rotateY(Math.PI);
    g.add(cam);
    ctx.floaters = [cam];

    /* Gedimmtes Licht — wer hinaussehen will, macht die Lampen aus */
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3;
      const led = new THREE.PointLight(0xfff0dc, .45, 3.2, 2);
      led.position.set(Math.cos(a) * R1 * .7, Math.sin(a) * R1 * .7, ZB - .35);
      g.add(led);
    }
    g.add(new THREE.AmbientLight(0x2a3442, .45));
    g.add(new THREE.HemisphereLight(0x6f92bb, 0x24282e, .35));
    /* Die Erde selbst ist die hellste Lichtquelle hier drin — ihr Albedo liegt
       bei rund 30 %, aus 600 km ist das ein Scheinwerfer von unten. */
    const earthGlow = new THREE.DirectionalLight(0xbcd6f5, 2.2);
    earthGlow.position.set(0, -4, -6);
    g.add(earthGlow, earthGlow.target);

    ctx.window = { mesh: centre, wide: true };
    ctx.camera = { pos: new THREE.Vector3(0, 0, .45), look: new THREE.Vector3(0, -1.6, -4.0) };
    return g;
  },

  /* ══ GEWÄCHSRÄUME (grow_a, hydro, vertical, mycology, dome) ══ */
  grow(st, ctx, modId, ports = {}) {
    const M = mats();
    const def = MOD_BY_ID[modId];
    const g = new THREE.Group();
    const slots = st.slots.filter(s => s.mod === modId);
    const n = slots.length;

    if (def.sunlit) return ROOMS.dome(st, ctx, modId, g, slots);
    if (modId === 'vertical') return ROOMS.tower(st, ctx, modId, g, slots, ports);

    const dark = !!def.dark;
    const LEN = clamp(4.5 + n * 0.5, 5, 11), RAD = 2.4;
    g.add(shell(LEN, RAD, M, { color: dark ? 0x6a6e72 : 0xeef0ee, ends: { neg: 'port', pos: ports.far ? 'port' : 'closed' } }));
    dressModule(g, { len: LEN, rad: RAD, zones: ['ceiling', 'ends'], seed: n + 5,
      neg: { to: ports.nearName, laptop: 2 }, pos: ports.far ? { to: ports.farName } : { extinguisher: true } });
    ctx.dims = { outward: new THREE.Vector3(1, 0, 0), inDist: LEN / 2, outDist: LEN / 2 };
    ctx.walk = [[cylR('x', [0, 0, 0], RAD - .45, LEN / 2 - .3), boxR([-BIG, -RAD * .72 + .5, -.82], [BIG, BIG, .82])]];

    /* Regale mit Tabletts — Gang in der Mitte, Regale an beiden Wänden */
    const perSide = Math.ceil(n / 2);
    const levels = perSide > 5 ? 3 : perSide > 3 ? 2 : 1;
    const perRow = Math.ceil(perSide / levels);
    const floorY = -RAD * .72 + .06;
    ctx.anchors = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const level = Math.floor(k / perRow);
      const col = k % perRow;
      const t = tray(.62, !dark);
      t.position.set((col - (perRow - 1) / 2) * .92, floorY + level * .95, side * 1.35);
      t.rotation.y = side < 0 ? 0 : Math.PI;
      t.traverse(o => { if (o.isMesh) { o.userData.slotId = slots[i].id; o.userData.pickable = true; } });
      g.add(t);
      ctx.anchors.push({ slot: slots[i], obj: t.userData.anchor, tray: t });
    }
    /* Regalgerüst und Stützen */
    for (const side of [-1, 1]) {
      for (let lv = 0; lv < levels; lv++) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(perRow * .94 + .3, .06, .8), M.metal);
        frame.position.set(0, floorY - .04 + lv * .95, side * 1.35);
        g.add(frame);
      }
      for (const px of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, levels * .95 + .2, 8), M.metal);
        post.position.set(px * (perRow * .47 + .14), floorY + levels * .475, side * 1.35);
        g.add(post);
      }
    }
    /* Wasserleitungen über den Regalen */
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, LEN * .88, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a8fb8, roughness: .3, metalness: .7 }));
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, floorY + levels * .95 + .22, side * 1.35);
      g.add(pipe);
    }
    /* Bedienkonsole seitlich am Eingang — die Stirnwand bleibt für die Luke frei */
    const con = screen(.72, .42, dark ? .78 : .42);
    con.position.set(-LEN / 2 + .6, -.3, -1.2);
    con.rotation.y = Math.PI / 2 - .55;
    g.add(con);
    ctx.screens = [con];

    g.add(makeStrip(LEN * .8, 0, RAD * .82, 0, dark ? 0x4a6fa8 : 0xe8f0ff, dark ? .35 : .7));
    g.add(new THREE.HemisphereLight(dark ? 0x3a4a6a : 0xb4cdf0, 0x33302a, dark ? .45 : 1.15));
    g.add(new THREE.AmbientLight(0x5f6b7d, dark ? .3 : .6));
    const aisle = new THREE.PointLight(0xdce8ff, dark ? .6 : 2.4, LEN * 1.5, 2);
    aisle.position.set(0, -.2, 0);
    g.add(aisle);
    const aisle2 = new THREE.PointLight(0xc8d8f0, dark ? .3 : 1.2, LEN, 2);
    aisle2.position.set(LEN * .3, -.9, 0);
    g.add(aisle2);

    ctx.camera = { pos: new THREE.Vector3(-LEN * .42, .3, .02), look: new THREE.Vector3(LEN * .5, -.7, 0) };
    return g;
  },

  /* ══ VERTIKALFARM ══ */
  tower(st, ctx, modId, g, slots, ports = {}) {
    const M = mats();
    const RAD = 3.1, LEN = 8.5;
    g.add(shell(LEN, RAD, M, { color: 0xe4e8ea, ends: { neg: 'port', pos: ports.far ? 'port' : 'closed' } }));
    dressModule(g, { len: LEN, rad: RAD, zones: ['ceiling', 'ends'], seed: 31,
      neg: { to: ports.nearName, laptop: 2 }, pos: ports.far ? { to: ports.farName } : { extinguisher: true } });
    ctx.dims = { outward: new THREE.Vector3(1, 0, 0), inDist: LEN / 2, outDist: LEN / 2 };
    ctx.walk = [[cylR('x', [0, 0, 0], RAD - .5, LEN / 2 - .3), boxR([-BIG, -RAD * .72 + .5, -1.15], [BIG, BIG, 1.15])]];
    ctx.anchors = [];
    const levels = 6;
    const perSide = Math.ceil(slots.length / 2);
    const perLevel = Math.max(1, Math.ceil(perSide / levels));
    const floorY = -RAD * .72 + .06;
    for (let i = 0; i < slots.length; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const lv = Math.floor(k / perLevel);
      const col = k % perLevel;
      const t = tray(.54, true);
      t.position.set((col - (perLevel - 1) / 2) * .84, floorY + lv * .9, side * 1.7);
      t.rotation.y = side < 0 ? 0 : Math.PI;
      t.traverse(o => { if (o.isMesh) { o.userData.slotId = slots[i].id; o.userData.pickable = true; } });
      g.add(t);
      ctx.anchors.push({ slot: slots[i], obj: t.userData.anchor, tray: t });
    }
    for (const side of [-1, 1]) {
      for (let lv = 0; lv < levels; lv++) {
        const shelfBar = new THREE.Mesh(new THREE.BoxGeometry(perLevel * .86 + .3, .05, .72), M.metal);
        shelfBar.position.set(0, floorY - .04 + lv * .9, side * 1.7);
        g.add(shelfBar);
      }
      for (const px of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, levels * .9, 8), M.metal);
        post.position.set(px * (perLevel * .43 + .16), floorY + levels * .45, side * 1.7);
        g.add(post);
      }
    }
    const con = screen(1.0, .6, .75);
    con.position.set(-LEN / 2 + .7, .4, -1.55);
    con.rotation.y = Math.PI / 2 - .55;
    g.add(con);
    ctx.screens = [con];
    g.add(makeStrip(LEN * .8, 0, RAD * .85, 0, 0xd8e4ff, .6));
    g.add(new THREE.HemisphereLight(0xb4cdf0, 0x33302a, 1.05));
    g.add(new THREE.AmbientLight(0x5f6b7d, .55));
    ctx.camera = { pos: new THREE.Vector3(-LEN * .42, .45, .02), look: new THREE.Vector3(LEN * .5, -.3, 0) };
    return g;
  },

  /* ══ KUPPELGEWÄCHSHAUS ══ */
  dome(st, ctx, modId, g, slots) {
    const M = mats();
    const R = 4.2;
    // Boden
    const ft = floorTexture(); ft.repeat.set(6, 6);
    // Boden mit Luke in der Mitte — darunter liegt der Knoten
    const floor = new THREE.Mesh(new THREE.RingGeometry(HATCH_R, R, 48, 2),
      new THREE.MeshStandardMaterial({ map: ft, color: 0x8e959c, roughness: .8, metalness: .3, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6;
    floor.receiveShadow = true;
    g.add(floor);
    const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(HATCH_R + .05, .07, 10, 36), mats().metal);
    hatchRing.rotation.x = Math.PI / 2; hatchRing.position.y = -1.57;
    g.add(hatchRing);
    ctx.dims = { outward: new THREE.Vector3(0, 1, 0), inDist: 1.6, outDist: R };
    ctx.walk = [[sphR([0, -1.6, 0], R - .55), boxR([-BIG, -1.6 + .5, -BIG], [BIG, BIG, BIG])]];
    ctx.profile = { fov: 72, earth: 1.1 };
    // Kuppelstreben
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: .3, metalness: .9 });
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const ph = (k / 12) * Math.PI / 2;
        pts.push(new THREE.Vector3(Math.cos(a) * Math.cos(ph) * R, -1.6 + Math.sin(ph) * R, Math.sin(a) * Math.cos(ph) * R));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .05, 6), frameMat));
    }
    for (let k = 1; k < 4; k++) {
      const ph = (k / 4) * Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.cos(ph) * R, .04, 6, 48), frameMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -1.6 + Math.sin(ph) * R;
      g.add(ring);
    }
    // Glas
    const glass = new THREE.Mesh(new THREE.SphereGeometry(R * .995, 48, 28, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({
        color: 0xdfefff, roughness: .02, metalness: 0, transparent: true, opacity: .085,
        side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: .02, depthWrite: false,
      }));
    glass.position.y = -1.6;
    g.add(glass);
    ctx.window = { mesh: glass, dir: new THREE.Vector3(0, -1, 0.15).normalize() };

    // Beete im Ring
    ctx.anchors = [];
    const rings = slots.length > 12 ? 2 : 1;
    for (let i = 0; i < slots.length; i++) {
      const ringIdx = i % rings;
      const perRing = Math.ceil(slots.length / rings);
      const idx = Math.floor(i / rings);
      const a = idx * TAU / perRing + ringIdx * .2;
      const rad = 1.5 + ringIdx * 1.35;
      const t = tray(.6, false);
      t.position.set(Math.cos(a) * rad, -1.56, Math.sin(a) * rad);
      t.rotation.y = -a;
      t.traverse(o => { if (o.isMesh) { o.userData.slotId = slots[i].id; o.userData.pickable = true; } });
      g.add(t);
      ctx.anchors.push({ slot: slots[i], obj: t.userData.anchor, tray: t });
    }

    g.add(new THREE.HemisphereLight(0x9fc8ff, 0x3a3a30, .85));
    g.add(new THREE.AmbientLight(0x5a6878, .45));
    ctx.camera = { pos: new THREE.Vector3(.4, .1, 2.6), look: new THREE.Vector3(-1.4, -1.0, -.6) };
    return g;
  },

  /* ══ LABOR ══ */
  lab(st, ctx, modId, ports = {}) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 6.4, RAD = 2.3;
    g.add(shell(LEN, RAD, M, { color: 0xf4f4f2, ends: { neg: 'port', pos: ports.far ? 'port' : 'closed' } }));
    dressModule(g, { len: LEN, rad: RAD, zones: ['ceiling', 'upper', 'ends'], bags: 2, seed: 41,
      neg: { to: ports.nearName, laptop: 1 }, pos: ports.far ? { to: ports.farName } : { extinguisher: true } });
    ctx.dims = { outward: new THREE.Vector3(1, 0, 0), inDist: LEN / 2, outDist: LEN / 2 };
    ctx.walk = [
      [cylR('x', [0, 0, 0], RAD - .45, LEN / 2 - .3), boxR([-BIG, -RAD * .72 + .5, -.8], [BIG, BIG, .8])],
      [cylR('x', [0, 0, 0], RAD - .45, LEN / 2 - .3), boxR([-BIG, -.3, -BIG], [BIG, BIG, BIG])],
    ];

    const benchMat = new THREE.MeshStandardMaterial({ color: 0xd4d8db, roughness: .35, metalness: .4 });
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(LEN * .82, .09, .72), benchMat);
      b.position.set(0, -.72, side * 1.3);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      const under = new THREE.Mesh(new THREE.BoxGeometry(LEN * .78, .74, .62), M.hullDark);
      under.position.set(0, -1.14, side * 1.3);
      g.add(under);
      for (let i = 0; i < 4; i++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(LEN * .18, .16, .02), M.metal);
        d.position.set((i - 1.5) * LEN * .2, -1.0, side * 1.3 - .32);
        g.add(d);
      }
    }
    // Mikroskop
    const mic = new THREE.Group();
    mic.add(new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, .06, 20), M.hullDark));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.06, .34, .1), M.metal);
    arm.position.set(-.07, .19, 0); mic.add(arm);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .22, 14), M.hullDark);
    tube.position.set(.02, .3, 0); tube.rotation.z = -.25; mic.add(tube);
    const stage2 = new THREE.Mesh(new THREE.BoxGeometry(.16, .015, .12), M.metal);
    stage2.position.set(.03, .12, 0); mic.add(stage2);
    mic.position.set(-1.6, -.63, -1.3);
    g.add(mic);
    // Probenständer
    for (let i = 0; i < 8; i++) {
      const tubeM = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .1, 10),
        new THREE.MeshPhysicalMaterial({ color: [0x7fd98a, 0xffd36a, 0x8ac6ff, 0xff8a9a][i % 4], transmission: .6, roughness: .1, transparent: true, opacity: .8 }));
      tubeM.position.set(-.55 + (i % 4) * .08, -.62, -1.3 + Math.floor(i / 4) * .1);
      g.add(tubeM);
    }
    const rack = new THREE.Mesh(new THREE.BoxGeometry(.38, .05, .22), M.metal);
    rack.position.set(-.43, -.665, -1.25);
    g.add(rack);
    // Zentrifuge
    const cent = new THREE.Mesh(new THREE.CylinderGeometry(.19, .21, .18, 24), M.hull);
    cent.position.set(.9, -.59, -1.3);
    g.add(cent);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .02, 24),
      new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, transmission: .7, roughness: .1, transparent: true, opacity: .6 }));
    lid.position.set(.9, -.49, -1.3);
    g.add(lid);
    // Keimschrank
    const inc = new THREE.Mesh(new THREE.BoxGeometry(.9, 1.5, .55), M.hull);
    inc.position.set(2.1, -.4, 1.35);
    g.add(inc);
    const incGlass = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1.1),
      new THREE.MeshPhysicalMaterial({ color: 0x2a4a3a, transmission: .5, roughness: .1, transparent: true, opacity: .75, emissive: 0x2a7a4a, emissiveIntensity: .45 }));
    incGlass.position.set(2.1, -.35, 1.06);
    g.add(incGlass);
    const incLight = new THREE.PointLight(0x4fd98a, 1.8, 3, 2);
    incLight.position.set(2.1, -.35, .9);
    g.add(incLight);

    const s1 = screen(1.1, .62, .52); s1.position.set(-.4, -.05, 2.05); s1.rotation.y = Math.PI;
    const s2 = screen(.6, .38, .32); s2.position.set(.9, -.12, 2.05); s2.rotation.y = Math.PI;
    g.add(s1, s2);
    ctx.screens = [s1, s2];

    g.add(makeStrip(LEN * .8, 0, RAD * .8, 0, 0xf0f6ff, .8));
    g.add(new THREE.HemisphereLight(0xd0e0f8, 0x3d3a34, 1.35));
    g.add(new THREE.AmbientLight(0x76829a, .75));
    const labFill = new THREE.PointLight(0xe0ecff, 2.0, LEN * 1.4, 2);
    labFill.position.set(0, -.3, 0);
    g.add(labFill);
    ctx.camera = { pos: new THREE.Vector3(-LEN * .42, .3, .05), look: new THREE.Vector3(LEN * .5, -.6, .05) };
    return g;
  },

  /* ══ TECHNIK ══ */
  systems(st, ctx, modId, ports = {}) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 6.0, RAD = 2.4;
    g.add(shell(LEN, RAD, M, { color: 0xd4d8da, ends: { neg: 'port', pos: ports.far ? 'port' : 'closed' } }));
    dressModule(g, { len: LEN, rad: RAD, zones: ['ends'], seed: 51,
      neg: { to: ports.nearName, laptop: 1 }, pos: ports.far ? { to: ports.farName } : { extinguisher: true } });
    ctx.dims = { outward: new THREE.Vector3(1, 0, 0), inDist: LEN / 2, outDist: LEN / 2 };
    ctx.walk = [
      [cylR('x', [0, 0, 0], RAD - .45, LEN / 2 - .3), boxR([-BIG, -RAD * .72 + .5, -.9], [BIG, BIG, .8])],
      [cylR('x', [0, 0, 0], RAD - .45, LEN / 2 - .3), boxR([-BIG, .35, -1.3], [BIG, BIG, 1.3])],
    ];

    // Wassertanks
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: .35, metalness: .5 });
    ctx.tanks = [];
    for (let i = 0; i < 3; i++) {
      const tk = new THREE.Mesh(new THREE.CapsuleGeometry(.42, .9, 8, 20), tankMat);
      tk.position.set(-1.6 + i * .95, -.72, -1.5);
      tk.castShadow = true;
      g.add(tk);
      const lvl = new THREE.Mesh(new THREE.CylinderGeometry(.43, .43, .9, 20),
        new THREE.MeshPhysicalMaterial({ color: 0x4fb8e8, transmission: .5, roughness: .12, transparent: true, opacity: .55, emissive: 0x1a5f88, emissiveIntensity: .3 }));
      lvl.position.copy(tk.position);
      g.add(lvl);
      ctx.tanks.push(lvl);
      const band = new THREE.Mesh(new THREE.TorusGeometry(.44, .03, 6, 24), M.metal);
      band.rotation.x = Math.PI / 2; band.position.copy(tk.position);
      g.add(band);
    }
    // Akkubank
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(.4, .28, .5), M.hullDark);
      c.position.set(-1.4 + (i % 3) * .46, -1.15 + Math.floor(i / 3) * .34, 1.5);
      g.add(c);
      const led = new THREE.Mesh(new THREE.CircleGeometry(.025, 10), new THREE.MeshBasicMaterial({ color: 0x5fd98a }));
      led.position.set(c.position.x, c.position.y, 1.26);
      g.add(led);
    }
    // Rohre
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x7a8894, roughness: .35, metalness: .85 });
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, LEN * .9, 10), pipeMat);
      p.rotation.z = Math.PI / 2;
      const a = 1.0 + i * .35;
      p.position.set(0, Math.sin(a) * RAD * .82, Math.cos(a) * RAD * .82);
      g.add(p);
    }
    // Pumpen
    for (const x of [-1.2, 1.2]) {
      const pu = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .3, 18), M.metal);
      pu.rotation.z = Math.PI / 2; pu.position.set(x, .9, -1.4);
      g.add(pu);
    }
    // Konsole
    const s1 = screen(1.3, .66, .5); s1.position.set(1.5, -.1, 1.72); s1.rotation.y = Math.PI;
    g.add(s1);
    ctx.screens = [s1];
    const con = new THREE.Mesh(new THREE.BoxGeometry(1.5, .85, .28), M.hullDark);
    con.position.set(1.5, -.15, 1.88);
    g.add(con);

    g.add(makeStrip(LEN * .8, 0, RAD * .8, 0, 0xcfe0f0, .6));
    g.add(new THREE.HemisphereLight(0xa8c0dc, 0x3a362e, 1.25));
    g.add(new THREE.AmbientLight(0x707c8c, .7));
    const sysFill = new THREE.PointLight(0xcfe0f4, 2.0, LEN * 1.4, 2);
    sysFill.position.set(0, -.3, 0);
    g.add(sysFill);
    ctx.camera = { pos: new THREE.Vector3(-LEN * .4, .3, .3), look: new THREE.Vector3(LEN * .5, -.6, -.1) };
    return g;
  },

  /* ══ FRACHTSCHLEUSE ══ */
  cargo(st, ctx, modId, ports = {}) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 5.6, RAD = 2.2;
    g.add(shell(LEN, RAD, M, { color: 0xe0e2e2, axis: 'z', ends: { neg: 'open', pos: 'port' } }));
    dressModule(g, { len: LEN, rad: RAD, axis: 'z', zones: ['ceiling', 'upper', 'ends'], bags: 6, seed: 61,
      pos: { to: ports.nearName, laptop: 1 } });
    /* Stirnwand mit Bullauge: durch die Luke sieht man hinaus ins All */
    const PORT_Y = -.5, PORT_R = .3;
    const endShape = new THREE.Shape(); endShape.absarc(0, 0, RAD, 0, TAU, false);
    const endHole = new THREE.Path(); endHole.absarc(0, PORT_Y, PORT_R, 0, TAU, true); endShape.holes.push(endHole);
    const endTex = panelTexture().clone(); endTex.needsUpdate = true; endTex.repeat.set(.45, .45);
    const endWall = new THREE.Mesh(new THREE.ShapeGeometry(endShape, 40),
      new THREE.MeshStandardMaterial({ map: endTex, color: 0xeceae4, roughness: .72, metalness: .1, side: THREE.DoubleSide }));
    endWall.position.z = -LEN / 2;
    g.add(endWall);
    const outer = new THREE.Mesh(new THREE.ShapeGeometry(endShape, 40), M.hull);
    outer.position.z = -LEN / 2 - .1; outer.rotation.y = Math.PI; outer.scale.x = -1;
    g.add(outer);
    ctx.dims = { outward: new THREE.Vector3(0, 0, -1), inDist: LEN / 2, outDist: LEN / 2 };
    ctx.walk = [[cylR('z', [0, 0, 0], RAD - .45, LEN / 2 - .3), boxR([-.85, -RAD * .72 + .5, -BIG], [.85, BIG, BIG])]];
    ctx.profile = { earth: .35 };

    // Luke mit Fenster zum All
    const hatch = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.95, .14, 12, 40), M.metal);
    hatch.add(ring);
    const doorShape = new THREE.Shape(); doorShape.absarc(0, 0, .92, 0, TAU, false);
    const doorHole = new THREE.Path(); doorHole.absarc(0, 0, PORT_R, 0, TAU, true); doorShape.holes.push(doorHole);
    const door = new THREE.Mesh(new THREE.ExtrudeGeometry(doorShape, { depth: .12, bevelEnabled: false, curveSegments: 28 }), M.hullDark);
    door.position.z = -.06;
    hatch.add(door);
    const portRim = new THREE.Mesh(new THREE.TorusGeometry(PORT_R + .02, .035, 8, 28), M.metal);
    portRim.position.z = .07;
    hatch.add(portRim);
    const port = new THREE.Mesh(new THREE.CircleGeometry(PORT_R, 28), new THREE.MeshBasicMaterial({
      color: 0x9fc4e8, transparent: true, opacity: .04, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    port.position.z = -.04;
    hatch.add(port);
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(.1, .16, .1), M.metal);
      const a = i * TAU / 8;
      b.position.set(Math.cos(a) * .95, Math.sin(a) * .95, -.1);
      hatch.add(b);
    }
    hatch.position.set(0, PORT_Y, -LEN / 2 + .1);
    g.add(hatch);
    ctx.hatchPort = port;
    ctx.window = { mesh: port, dir: new THREE.Vector3(0, -0.5, -1).normalize(), small: true };

    // Kisten an den Seitenwänden, damit der Gang frei bleibt
    const r = rng(1234);
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const sz = .34 + r() * .24;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * .8, sz),
        new THREE.MeshStandardMaterial({ color: [0xc8c2b4, 0x9aaab8, 0xb8b0a0][i % 3], roughness: .85 }));
      crate.position.set(side * (1.28 + r() * .22), -1.42 + (k % 2) * sz * .82, -1.0 + Math.floor(k / 2) * 1.1);
      crate.rotation.y = (r() - .5) * .5;
      crate.castShadow = crate.receiveShadow = true;
      g.add(crate);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(sz * 1.02, .04, sz * 1.02),
        new THREE.MeshStandardMaterial({ color: 0xd8a83a, roughness: .7 }));
      tape.position.copy(crate.position); tape.position.y += sz * .2;
      tape.rotation.y = crate.rotation.y;
      g.add(tape);
    }
    // Ladungsnetz an der Seitenwand
    const net = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2, 10, 5),
      new THREE.MeshBasicMaterial({ color: 0x5f7488, wireframe: true, transparent: true, opacity: .45 }));
    net.position.set(-1.72, -.55, .2);
    net.rotation.y = Math.PI / 2;
    g.add(net);

    const s1 = screen(.8, .5, .12); s1.position.set(1.62, -.25, .6); s1.rotation.y = -Math.PI / 2;
    g.add(s1);
    ctx.screens = [s1];

    const cgStrip = makeStrip(LEN * .75, 0, RAD * .8, 0, 0xffe0b0, .6);
    cgStrip.rotation.y = Math.PI / 2;
    g.add(cgStrip);
    g.add(new THREE.HemisphereLight(0xb8c4d0, 0x3a342c, 1.15));
    g.add(new THREE.AmbientLight(0x757d8c, .65));
    const cgFill = new THREE.PointLight(0xffe4bc, 1.8, LEN * 1.3, 2);
    cgFill.position.set(0, -.4, .4);
    g.add(cgFill);
    ctx.camera = { pos: new THREE.Vector3(.3, .3, 2.1), look: new THREE.Vector3(-.15, -.5, -2.7) };
    return g;
  },
};

function makeStrip(len, x, y, z, color, intensity) {
  const s = lightStrip(len, color, intensity);
  s.position.set(x, y, z);
  return s;
}

/* ───────────────────────── Knoten und Durchstiege ───────────────────────── */

const NODE_H = 2.0;         // halbe Kantenlänge des Knotens
const GAP = 1.0;            // Länge eines Durchstiegs
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/* Ketten vom Knoten aus. Die Reihenfolge ist die Reihenfolge der Montage. */
const CHAINS = [
  { key: '+x', dir: new THREE.Vector3(1, 0, 0), ids: ['grow_a', 'lab', 'vertical'] },
  { key: '-x', dir: new THREE.Vector3(-1, 0, 0), ids: ['systems', 'cargo'] },
  { key: '+z', dir: new THREE.Vector3(0, 0, 1), ids: ['lounge'] },
  { key: '-z', dir: new THREE.Vector3(0, 0, -1), ids: ['hydro', 'mycology'] },
  { key: '-y', dir: new THREE.Vector3(0, -1, 0), ids: ['cupola'] },
  { key: '+y', dir: new THREE.Vector3(0, 1, 0), ids: ['dome'] },
];

/** Dreht die Auswärtsachse eines Raums auf die Kettenrichtung. Waagerechte
 *  Räume nur um die Hochachse, damit der Boden unten bleibt. */
function orientation(outward, dir) {
  if (Math.abs(dir.y) > .5 && Math.abs(outward.y) < .5) return new THREE.Quaternion().setFromUnitVectors(outward, dir);
  const a = Math.atan2(outward.x, outward.z), b = Math.atan2(dir.x, dir.z);
  return new THREE.Quaternion().setFromAxisAngle(UP, b - a);
}

function buildRoom(id, st, ctx, ports) {
  const def = MOD_BY_ID[id];
  if (id === 'lounge') return ROOMS.lounge(st, ctx, id, ports);
  if (id === 'cupola') return ROOMS.cupola(st, ctx, id, ports);
  if (id === 'lab') return ROOMS.lab(st, ctx, id, ports);
  if (id === 'systems') return ROOMS.systems(st, ctx, id, ports);
  if (id === 'cargo') return ROOMS.cargo(st, ctx, id, ports);
  if (def && (def.slots || st.modules[id]?.slots)) return ROOMS.grow(st, ctx, id, ports);
  return ROOMS.lab(st, ctx, id, ports);
}

/** Kurzer Verbindungstunnel entlang +Y. */
function tunnel(len, M) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(HATCH_R + .02, HATCH_R + .02, len + .12, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xb4bbc2, roughness: .5, metalness: .5, side: THREE.BackSide }));
  g.add(tube);
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(HATCH_R + .12, HATCH_R + .12, len, 24, 1, true), M.hullDark);
  g.add(skin);
  for (const y of [-len / 2 + .12, 0, len / 2 - .12]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(HATCH_R - .01, .045, 8, 32), M.metal);
    r.rotation.x = Math.PI / 2; r.position.y = y;
    g.add(r);
  }
  // Handlauf längs durch den Durchstieg
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, len * .8, 8), M.metal);
  rail.position.set(HATCH_R - .12, 0, 0);
  g.add(rail);
  return g;
}

/** Der Knoten: ein Würfel mit bis zu sechs Luken, wie Unity auf der ISS. */
function buildNode(ports, M, names = {}) {
  const g = new THREE.Group();
  const S = NODE_H;
  const tex = panelTexture();
  tex.repeat.set(.5, .5);
  const wallMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: .7, metalness: .08, side: THREE.DoubleSide });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5e7aa0, roughness: .5, metalness: .35 });
  const faces = [
    ['+x', [S, 0, 0], [0, -Math.PI / 2, 0]], ['-x', [-S, 0, 0], [0, Math.PI / 2, 0]],
    ['+z', [0, 0, S], [0, Math.PI, 0]], ['-z', [0, 0, -S], [0, 0, 0]],
    ['+y', [0, S, 0], [Math.PI / 2, 0, 0]], ['-y', [0, -S, 0], [-Math.PI / 2, 0, 0]],
  ];
  for (const [key, pos, rot] of faces) {
    const shape = roundedRectShape(2 * S, 2 * S, .05);
    const open = ports.has(key);
    if (open) { const h = new THREE.Path(); h.absarc(0, 0, HATCH_R, 0, TAU, true); shape.holes.push(h); }
    const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), wallMat);
    wall.position.fromArray(pos); wall.rotation.fromArray(rot);
    g.add(wall);
    const inward = new THREE.Vector3().fromArray(pos).normalize().multiplyScalar(-1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(HATCH_R + .05, .07, 10, 40), M.metal);
    ring.position.fromArray(pos).addScaledVector(inward, .04); ring.rotation.fromArray(rot);
    g.add(ring);
    if (!open) {
      // geschlossene Luke: hier kann später ein Modul andocken
      const door = new THREE.Mesh(new THREE.CircleGeometry(HATCH_R, 32), doorMat);
      door.position.fromArray(pos).addScaledVector(inward, .02); door.rotation.fromArray(rot);
      g.add(door);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(.9, .07, .07), M.metal);
      bar.position.copy(door.position).addScaledVector(inward, .05); bar.rotation.fromArray(rot);
      g.add(bar);
    }
    /* Ausstattung je Wand in Wandkoordinaten: x quer, y hoch, +z in den Raum */
    const fg = new THREE.Group();
    fg.position.fromArray(pos); fg.rotation.fromArray(rot);
    g.add(fg);
    if (open && names[key]) {
      const sg = sign(names[key]);
      sg.position.set(0, HATCH_R + .34, .03);
      fg.add(sg);
    }
    if (key[1] !== 'y') {
      const bag = stowageBag(.5, .36, .26, key === '-x');
      bag.position.set(-1.3, -1.28, .01); bag.rotation.z = .06;
      fg.add(bag);
      const v = vent(.42, .24); v.position.set(1.3, 1.35, .02);
      fg.add(v);
      if (key === '+x' || key === '-z') {
        const lp = laptop(key === '+x' ? 0 : 1);
        lp.position.set(1.32, -.15, .01);
        fg.add(lp);
      } else {
        const b2 = stowageBag(.36, .5, .24, true);
        b2.position.set(1.3, -1.15, .01);
        fg.add(b2);
      }
    }
    // Handläufe beiderseits jeder Luke
    for (const sgn of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .9, 8), M.metal);
      const local = new THREE.Vector3(sgn * (HATCH_R + .35), 0, .09);
      h.position.copy(local.applyEuler(new THREE.Euler(...rot))).add(new THREE.Vector3().fromArray(pos));
      h.rotation.fromArray(rot);
      h.rotateX(Math.PI / 2); h.rotateX(-Math.PI / 2);
      g.add(h);
    }
  }
  // Kanten
  for (const ax of ['x', 'y', 'z']) for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 2 * S, 10), M.metal);
    if (ax === 'x') { e.rotation.z = Math.PI / 2; e.position.set(0, a * (S - .06), b * (S - .06)); }
    else if (ax === 'y') { e.position.set(a * (S - .06), 0, b * (S - .06)); }
    else { e.rotation.x = Math.PI / 2; e.position.set(a * (S - .06), b * (S - .06), 0); }
    g.add(e);
  }
  // vier Leuchtbänder unter der Decke
  for (const [x, z, ry] of [[0, S - .25, 0], [0, -S + .25, 0], [S - .25, 0, Math.PI / 2], [-S + .25, 0, Math.PI / 2]]) {
    const l = lightStrip(2.4, 0xe4ecff, .45);
    l.position.set(x, S - .12, z); l.rotation.y = ry;
    g.add(l);
  }
  return g;
}

/* ───────────────────────── Zusammenfassen ─────────────────────────
   Jede Spante, jeder Handlauf, jeder Pfosten war ein eigenes Objekt — über
   die ganze Station tausend Zeichenaufrufe je Bild, und das kostet in WebGL
   vor allem Prozessorzeit. Was sich nie bewegt, wird je Raum und Material zu
   einem einzigen Netz verschmolzen. Tabletts (anklickbar), Pflanzen,
   Bildschirme und Lampen bleiben eigenständig. */
function mergeStatic(holder) {
  holder.updateMatrixWorld(true);
  const inv = holder.matrixWorld.clone().invert();
  const groups = new Map();
  const keep = o => {
    for (let p = o; p && p !== holder; p = p.parent) {
      const u = p.userData;
      if (u.slotId || u.draw || u.lamp || u.anchor || u.disc || u.dynamic) return true;
    }
    return false;
  };
  holder.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.transparent || o.material.wireframe) return;
    if (keep(o) || !o.geometry.attributes.position) return;
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = [];
    for (const m of list) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      g.morphAttributes = {};
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.name = 'merged';
    holder.add(mesh);
    for (const m of list) { m.parent.remove(m); m.geometry.dispose(); }
  }
}

/* ───────────────────────── Abstandsfeld ─────────────────────────
   Begehbar ist die Vereinigung aller Bereiche; jeder Bereich ist der Schnitt
   einfacher Körper. Negativ = innen. Nach jedem Schritt wird das Auge entlang
   des Gradienten zurück ins Innere geschoben. */
const _v = new THREE.Vector3();
function sdPart(p, part) {
  if (part.type === 'cyl') {
    const c = part.c;
    const x = p.x - c[0], y = p.y - c[1], z = p.z - c[2];
    const [a, r1, r2] = part.axis === 'x' ? [x, y, z] : part.axis === 'y' ? [y, x, z] : [z, x, y];
    const dr = Math.hypot(r1, r2) - part.r, dh = Math.abs(a) - part.h;
    return Math.min(Math.max(dr, dh), 0) + Math.hypot(Math.max(dr, 0), Math.max(dh, 0));
  }
  if (part.type === 'box') {
    const cx = (part.min[0] + part.max[0]) / 2, cy = (part.min[1] + part.max[1]) / 2, cz = (part.min[2] + part.max[2]) / 2;
    const qx = Math.abs(p.x - cx) - (part.max[0] - part.min[0]) / 2;
    const qy = Math.abs(p.y - cy) - (part.max[1] - part.min[1]) / 2;
    const qz = Math.abs(p.z - cz) - (part.max[2] - part.min[2]) / 2;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  }
  const c = part.c;
  return Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2]) - part.r;
}
function sdRegion(p, reg) {
  _v.copy(p).applyMatrix4(reg.inv);
  let d = -Infinity;
  for (const part of reg.parts) d = Math.max(d, sdPart(_v, part));
  return d;
}

/* ───────────────────────── Controller ───────────────────────── */

const POOL = 10;             // gleichzeitig aktive Punktlichter
const SPEED = 2.1;           // m/s beim Schweben
const EYE = new THREE.Vector3();

const WARM_WHITE = new THREE.Color(0xf2ece4);
const WARM_GREY = new THREE.Color(0x8a8680);
const NODE_PROFILE = { hemiSky: new THREE.Color(0xc4d4e8), hemiGround: new THREE.Color(0x3a3630), hemiI: 1.05, ambColor: new THREE.Color(0x6a7688), ambI: .6, earth: 0, fov: 70 };

export class Interior {
  constructor(sky) {
    this.sky = sky;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.04, 300);
    this.camera.rotation.order = 'YXZ';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    /* Umgebungsspiegelung: ohne sie haben Metallteile nichts zu spiegeln
       und erscheinen schwarz. Ein weicher, heller Raum reicht dafür. */
    if (sky?.renderer) {
      const pmrem = new THREE.PMREMGenerator(sky.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = .38;
      pmrem.dispose();
    }

    /* Licht, das der ganzen Station gehört */
    this.hemi = new THREE.HemisphereLight(0xb4cdf0, 0x33302a, 1.0);
    this.amb = new THREE.AmbientLight(0x5f6b7d, .5);
    this.earthLight = new THREE.DirectionalLight(0xbcd6f5, 0);        // Erdschein von unten
    this.sun = new THREE.DirectionalLight(0xfff4e6, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = .5; sc.far = 48;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.hemi, this.amb, this.earthLight, this.earthLight.target, this.sun, this.sun.target);
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 5, 2);
      l.userData = { src: null, fade: 0 };
      this.pool.push(l);
      this.scene.add(l);
    }

    this.raycaster = new THREE.Raycaster();
    this.plants = new Map();
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.active = false;
    this.room = 'node';
    this.sig = null;
    this.ctx = {};
    this._fov = 70;
    this._screenT = 0;
    this._clearBuild();
  }

  _clearBuild() {
    this.anchors = []; this.screens = []; this.regions = []; this.sources = []; this.tunnels = [];
    this.spawns = {}; this.profiles = { node: NODE_PROFILE }; this.spinners = []; this.dynamic = []; this.floaters = [];
    for (const l of this.pool || []) { l.userData.src = null; l.userData.fade = 0; l.intensity = 0; }
  }

  /** Was sich ändern muss, damit die Station neu gebaut wird. */
  static signature(st) {
    const mods = Object.entries(st.modules).filter(([, m]) => m.built).map(([id]) => id + ':' + st.slots.filter(s => s.mod === id).length);
    return mods.sort().join(',') + '|' + [...st.comfort].sort().join(',');
  }

  /** Baut die Station nur, wenn sich am Aufbau etwas geändert hat. */
  ensure(st) {
    const sig = Interior.signature(st);
    if (sig !== this.sig) this.build(st);
  }

  build(st) {
    while (this.root.children.length) {
      const c = this.root.children.pop();
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.plants.clear();
    this._clearBuild();
    const M = mats();
    const built = id => !!st.modules[id]?.built;
    const nodePorts = new Set();

    for (const ch of CHAINS) {
      const ids = ch.ids.filter(built);
      if (!ids.length) continue;
      nodePorts.add(ch.key);
      let cursor = NODE_H + GAP;
      this._addTunnel(ch.dir, NODE_H, cursor, M);
      ids.forEach((id, i) => {
        const ctx = { anchors: [], screens: [] };
        const short = k => MOD_BY_ID[k]?.short || 'Knoten';
        const ports = { far: i < ids.length - 1, nearName: i ? short(ids[i - 1]) : 'Knoten', farName: ids[i + 1] ? short(ids[i + 1]) : null };
        const g = buildRoom(id, st, ctx, ports);
        const d = ctx.dims;
        const holder = new THREE.Group();
        holder.name = 'room:' + id;
        holder.quaternion.copy(orientation(d.outward, ch.dir));
        holder.position.copy(ch.dir).multiplyScalar(cursor + d.inDist);
        holder.add(g);
        this.root.add(holder);
        holder.updateMatrixWorld(true);
        this._collect(id, holder, ctx);
        mergeStatic(holder);
        cursor += d.inDist + d.outDist + GAP;
        if (ports.far) this._addTunnel(ch.dir, cursor - GAP, cursor, M);
      });
    }

    const nodeNames = {};
    for (const ch of CHAINS) { const first = ch.ids.find(built); if (first) nodeNames[ch.key] = MOD_BY_ID[first]?.short; }
    const node = buildNode(nodePorts, M, nodeNames);
    node.name = 'room:node';
    this.root.add(node);
    node.updateMatrixWorld(true);
    const NB = NODE_H - .32;
    this._collect('node', node, {
      walk: [[boxR([-NB, -NB, -NB], [NB, NB, NB])]],
      camera: { pos: new THREE.Vector3(-1.2, .5, 1.2), look: new THREE.Vector3(3, -.3, -2) },
    });
    mergeStatic(node);

    /* Alles wirft und empfängt Schatten — nur Glas nicht, sonst fiele kein
       Sonnenlicht durch die Fenster */
    this.root.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = !o.material.transparent && !o.material.wireframe;
    });
    this.syncPlants(st, true);
    this.sig = Interior.signature(st);
  }

  _addTunnel(dir, from, to, M) {
    const len = to - from;
    const t = tunnel(len, M);
    t.position.copy(dir).multiplyScalar((from + to) / 2);
    t.quaternion.setFromUnitVectors(UP, dir);
    this.root.add(t);
    t.updateMatrixWorld(true);
    mergeStatic(t);
    this.regions.push({ id: null, inv: t.matrixWorld.clone().invert(), parts: [cylR('y', [0, 0, 0], HATCH_R - .3, len / 2 + .75)] });
    this.tunnels.push({ center: t.position.clone(), dir: dir.clone(), half: len / 2 });
  }

  /* Wer auf eine Luke zuschwebt, wird sanft auf ihre Achse gezogen — sonst
     bleibt man schräg am Rand hängen und rutscht an der Wand entlang. */
  _hatchAssist(dt) {
    for (const tu of this.tunnels) {
      const rel = _g.copy(this.pos).sub(tu.center);
      const a = rel.dot(tu.dir);
      if (Math.abs(a) > tu.half + 1.3) continue;
      const lat = rel.addScaledVector(tu.dir, -a);            // seitlicher Versatz zur Achse
      const ld = lat.length();
      if (ld > 1.35 || ld < 1e-4) continue;
      const toward = -Math.sign(a) * this.vel.dot(tu.dir);   // Geschwindigkeit in den Tunnel hinein
      const inside = Math.abs(a) < tu.half + .2;
      if (!inside && toward < .15) continue;
      const k = Math.min(1, Math.max(toward, inside ? .4 : 0)) * 5.0 * dt;
      this.pos.addScaledVector(lat, -Math.min(k, .5) * (ld > .08 ? 1 : 0));
    }
  }

  /** Übernimmt Pflanzplätze, Bildschirme, Lichter und Laufbereiche eines Raums. */
  _collect(id, holder, ctx) {
    const inv = holder.matrixWorld.clone().invert();
    for (const parts of ctx.walk || []) this.regions.push({ id, inv, parts });
    for (const a of ctx.anchors || []) {
      // auch die Gruppe markieren — sonst trifft ein Klick aufs Blatt ins Leere
      a.tray.userData.slotId = a.slot.id;
      a.obj.userData.slotId = a.slot.id;
      this.anchors.push({ ...a, room: id });
    }
    for (const s of ctx.screens || []) this.screens.push({ mesh: s, pos: s.getWorldPosition(new THREE.Vector3()) });
    if (ctx.record) this.spinners.push(ctx.record);
    for (const f of ctx.floaters || []) this.floaters.push({ obj: f, base: f.position.clone(), q: f.quaternion.clone(), seed: this.floaters.length * 1.7 });
    if (ctx.winFill) this.dynamic.push({ light: ctx.winFill, kind: 'window' });
    if (ctx.camera) {
      const pos = holder.localToWorld(ctx.camera.pos.clone());
      const look = holder.localToWorld(ctx.camera.look.clone());
      this.spawns[id] = { pos, look };
    }
    /* Raumlicht herauslösen: Punktlichter kommen in den gemeinsamen Pool,
       Grundlicht wird zum Profil, zwischen dem beim Durchqueren überblendet wird. */
    const profile = { ...NODE_PROFILE, hemiSky: NODE_PROFILE.hemiSky.clone(), hemiGround: NODE_PROFILE.hemiGround.clone(), ambColor: NODE_PROFILE.ambColor.clone(), earth: 0, ...(ctx.profile || {}) };
    let hemiSeen = false, ambSeen = false;
    const drop = [];
    holder.traverse(o => {
      if (!o.isLight) return;
      if (o.isPointLight) {
        this.sources.push({ light: o, pos: o.getWorldPosition(new THREE.Vector3()), score: 0 });
      } else if (o.isHemisphereLight && !hemiSeen) {
        hemiSeen = true; profile.hemiSky = o.color.clone(); profile.hemiGround = o.groundColor.clone(); profile.hemiI = o.intensity;
      } else if (o.isAmbientLight && !ambSeen) {
        ambSeen = true; profile.ambColor = o.color.clone(); profile.ambI = o.intensity;
      } else if (o.isDirectionalLight) {
        profile.earth = Math.max(profile.earth, o.intensity);
      }
      drop.push(o);
    });
    for (const o of drop) { o.parent.remove(o); if (o.target) o.target.parent?.remove(o.target); }
    /* Die Räume waren auf eine Sonne ohne Schatten abgestimmt, die überall
       warm hineinschien. Ohne sie kippt das Grundlicht ins Blaue — also
       neutraler mischen. */
    profile.hemiSky.lerp(WARM_WHITE, .5);
    profile.ambColor.lerp(WARM_GREY, .45);
    if (id !== 'node' || !this.profiles.node.custom) this.profiles[id] = profile;
  }

  /* ── Bewegung ── */
  attachControls(dom, { onInteract } = {}) {
    if (this._controls) return;
    this._controls = true;
    this.onInteract = onInteract;
    const pointers = new Map();
    let pinch = 0, lastTap = 0;
    dom.addEventListener('pointerdown', e => {
      if (!this.active) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      if (e.pointerType === 'touch') {
        const now = performance.now();
        if (now - lastTap < 320 && pointers.size === 1) this.glideTo(e.clientX, e.clientY);
        lastTap = now;
      }
    });
    dom.addEventListener('pointermove', e => {
      if (!this.active || !pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) {
        const k = e.pointerType === 'touch' ? 0.0048 : 0.0036;
        this.yaw -= dx * k;
        this.pitch = clamp(this.pitch - dy * k, -1.45, 1.45);
        this.glide = null;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.vel.addScaledVector(this.forward(new THREE.Vector3()), (d - pinch) * 0.02);
        pinch = d;
      }
    });
    const up = e => { pointers.delete(e.pointerId); };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('pointerleave', up);
    dom.addEventListener('dblclick', e => { if (this.active) this.glideTo(e.clientX, e.clientY); });
    dom.addEventListener('wheel', e => {
      if (!this.active) return;
      e.preventDefault();
      this.vel.addScaledVector(this.forward(new THREE.Vector3()), -e.deltaY * 0.0035);
      this.glide = null;
    }, { passive: false });
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyQ']);
    window.addEventListener('keydown', e => {
      if (!this.active || e.target.matches?.('input,textarea,select') || e.metaKey || e.ctrlKey) return;
      if (MOVE.has(e.code)) { this.keys.add(e.code); this.glide = null; e.preventDefault(); }
      else if (e.code === 'KeyE') this.onInteract?.();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  forward(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Doppelklick: dorthin schweben, wo man hinzeigt. */
  glideTo(cx, cy) {
    const nx = (cx / innerWidth) * 2 - 1, ny = -(cy / innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    this.raycaster.far = 40;
    const hit = this.raycaster.intersectObjects(this.root.children, true).find(h => !h.object.material?.transparent);
    if (!hit) return;
    const dir = hit.point.clone().sub(this.camera.position);
    const len = dir.length();
    this.glide = this.camera.position.clone().addScaledVector(dir.normalize(), Math.max(0, len - .9));
  }

  /** Springt an den Aussichtspunkt eines Raums. */
  teleport(id) {
    const sp = this.spawns[id] || this.spawns.node;
    if (!sp) return;
    this.pos.copy(sp.pos);
    this.vel.set(0, 0, 0);
    this.glide = null;
    const d = sp.look.clone().sub(sp.pos).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.collide(this.pos);
    this.room = id;
    const pr = this.profiles[id] || NODE_PROFILE;
    this._snapLight = true;
    this._snapShadow = true;
    this._fov = pr.fov || 70;
  }

  /** Abstand zur nächsten Wand, negativ = innen. */
  sdf(p) {
    let d = Infinity;
    for (const r of this.regions) d = Math.min(d, sdRegion(p, r));
    return d;
  }

  collide(p) {
    for (let it = 0; it < 3; it++) {
      const d = this.sdf(p);
      if (d <= 0) return;
      const e = .004;
      const g = new THREE.Vector3(
        this.sdf(_g.set(p.x + e, p.y, p.z)) - this.sdf(_g.set(p.x - e, p.y, p.z)),
        this.sdf(_g.set(p.x, p.y + e, p.z)) - this.sdf(_g.set(p.x, p.y - e, p.z)),
        this.sdf(_g.set(p.x, p.y, p.z + e)) - this.sdf(_g.set(p.x, p.y, p.z - e)),
      );
      if (g.lengthSq() < 1e-12) return;
      g.normalize();
      p.addScaledVector(g, -(d + .002));
      const vn = this.vel.dot(g);
      if (vn > 0) this.vel.addScaledVector(g, -vn);
    }
  }

  /** In welchem Raum steht das Auge? */
  whichRoom(p) {
    let best = null, bd = Infinity;
    for (const r of this.regions) {
      if (!r.id) continue;
      const d = sdRegion(p, r);
      if (d < bd) { bd = d; best = r.id; }
    }
    return bd < .25 ? best : this.room;
  }

  /** Pflanzenmodelle anlegen/erneuern. */
  syncPlants(st, force = false) {
    for (const a of this.anchors) {
      const s = st.slots.find(x => x.id === a.slot.id) || a.slot;
      a.slot = s;
      const key = s.id;
      const p = s.plant ? PLANT_BY_ID[s.plant] : null;
      const stageIdx = p ? stageAt(p, s.prog).i : -1;
      const bucket = Math.floor(s.prog * 14);
      const sig = `${s.plant}|${stageIdx}|${bucket}|${s.dead ? 1 : 0}|${Math.round(s.health * 4)}`;
      const cur = this.plants.get(key);
      // Lampe je nach Einstellung
      if (a.tray?.userData.lamp) {
        const lamp = st.lamps[s.mod];
        const on = lamp ? lamp.on !== false : true;
        const inten = on ? clamp((lamp?.ppfd ?? 250) / 260, .2, 2.6) : 0;
        a.tray.userData.lamp.material.emissiveIntensity = inten * 1.5;
        if (a.tray.userData.lampLight) a.tray.userData.lampLight.intensity = inten * 1.2;
      }
      if (!force && cur && cur.sig === sig) continue;
      if (cur) { a.obj.remove(cur.mesh); cur.mesh.traverse(o => o.geometry?.dispose()); }
      if (!p) { this.plants.delete(key); continue; }
      const mesh = buildPlant(p, s.prog, s.dead ? 0.05 : s.health, s.id, stageIdx);
      mergeStatic(mesh);                         // Blätter je Material zu einem Netz
      mesh.scale.setScalar(a.tray ? 0.62 : 1);
      mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      a.obj.add(mesh);
      this.plants.set(key, { sig, mesh, slot: s });
    }
  }

  /** Raycast auf Anbauplätze — nur was vorne liegt, nicht durch Wände. */
  pick(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    this.raycaster.far = 12;
    const hits = this.raycaster.intersectObjects(this.root.children, true);
    const h = hits.find(x => !x.object.material?.transparent);
    let o = h?.object;
    while (o) {
      if (o.userData?.slotId) return { slotId: o.userData.slotId };
      o = o.parent;
    }
    return null;
  }

  /**
   * @param {THREE.Vector3} sunDir Sonnenrichtung im Stationssystem
   * @returns {string} Raum, in dem man gerade schwebt
   */
  update(dt, t, st, sol, sunDir, earthDir = DOWN) {
    /* Schweben: Tasten beschleunigen, Dämpfung bremst sanft wieder ab */
    const k = this.keys;
    const f = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(f, (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0))
      .addScaledVector(right, (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0))
      .addScaledVector(UP, (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC') || k.has('KeyQ') ? 1 : 0));
    const moving = wish.lengthSq() > 0;
    if (moving) this.vel.addScaledVector(wish.normalize(), SPEED * 5.5 * dt);
    if (this.glide) {
      const to = this.glide.clone().sub(this.pos);
      const dist = to.length();
      if (dist < .08) this.glide = null;
      else this.vel.lerp(to.normalize().multiplyScalar(Math.min(SPEED * 1.2, dist * 2.2)), 1 - Math.exp(-6 * dt));
    }
    this.vel.multiplyScalar(Math.exp(-(moving || this.glide ? 2.6 : 3.4) * dt));
    if (this.vel.length() > SPEED * 1.3) this.vel.setLength(SPEED * 1.3);
    this.pos.addScaledVector(this.vel, dt);
    this._hatchAssist(dt);
    this.collide(this.pos);

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.position.y += Math.sin(t * .55) * .012;            // ganz leichtes Treiben
    cam.rotation.set(this.pitch, this.yaw, Math.sin(t * .19) * .004);
    const room = this.whichRoom(this.pos);
    this.room = room;

    /* Grundlicht und Blickwinkel des Raums überblenden */
    const pr = this.profiles[room] || NODE_PROFILE;
    const a = this._snapLight ? 1 : 1 - Math.exp(-3 * dt);
    this._snapLight = false;
    this.hemi.color.lerp(pr.hemiSky, a); this.hemi.groundColor.lerp(pr.hemiGround, a);
    this.hemi.intensity += (pr.hemiI - this.hemi.intensity) * a;
    this.amb.color.lerp(pr.ambColor, a);
    this.amb.intensity += (pr.ambI - this.amb.intensity) * a;
    this._fov += ((pr.fov || 70) - this._fov) * (1 - Math.exp(-2 * dt));
    if (Math.abs(cam.fov - this._fov) > .01) { cam.fov = this._fov; cam.updateProjectionMatrix(); }

    /* Sonnenlicht durch die Fenster, mit Schatten. Die Schattenkamera folgt
       dem Auge und rastet auf ihr Texelraster ein, sonst flimmern die Kanten. */
    const lit = sol?.sun ?? 1;
    const sd = sunDir || UP;
    /* Ohne Schattenkarte (niedrige Qualitätsstufen) schiene die Sonne durch
       jede Wand — dann bleibt sie draußen, und nur das Fensterlicht zählt. */
    const shadows = !!this.sky?.renderer?.shadowMap.enabled;
    this.sun.intensity = shadows ? 3.4 * lit : 0;
    /* Die Sonne wandert 0,06° je Sekunde — die Schattenkarte muss nicht in
       jedem Bild neu entstehen. Die Karte gilt im Weltraum, deshalb stimmen
       die Schatten auch dann, wenn ihr Ausschnitt ein paar Bilder hinterherläuft. */
    this.sun.shadow.autoUpdate = false;
    this._shadowT = (this._shadowT || 0) + dt;
    if (lit > 0.01 && (this._shadowT > 0.05 || this._snapShadow)) { this.sun.shadow.needsUpdate = true; this._shadowT = 0; this._snapShadow = false; }
    const texel = 18 / 2048;
    const lz = sd.clone().normalize();
    const lx = new THREE.Vector3().crossVectors(Math.abs(lz.y) > .95 ? new THREE.Vector3(1, 0, 0) : UP, lz).normalize();
    const ly = new THREE.Vector3().crossVectors(lz, lx);
    const px = Math.round(this.pos.dot(lx) / texel) * texel, py = Math.round(this.pos.dot(ly) / texel) * texel, pz = this.pos.dot(lz);
    const center = lx.multiplyScalar(px).addScaledVector(ly, py).addScaledVector(lz, pz);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(sd, 22);
    this.sun.color.setHSL(0.09, 0.28 * (1 - lit) + 0.06, 0.62 + 0.1 * lit);
    /* Die Erde ist tagsüber ein Scheinwerfer von unten — dort, wo man sie sieht */
    this.earthLight.intensity = pr.earth * (0.12 + 0.88 * lit);
    this.earthLight.target.position.copy(this.pos);
    this.earthLight.position.copy(this.pos).addScaledVector(earthDir, 8);
    for (const dl of this.dynamic) if (dl.kind === 'window') dl.light.intensity = 0.5 + 2.6 * lit;

    this._updatePool(dt);

    /* Bildschirme in der Nähe, zwölfmal je Sekunde */
    this._screenT += dt;
    if (this._screenT > 1 / 12) {
      this._screenT = 0;
      for (const s of this.screens) if (s.pos.distanceToSquared(this.pos) < 110) s.mesh.userData.draw?.(t, []);
    }
    for (const r of this.spinners) r.rotation.y = t * 3.3;
    /* Was nicht festgemacht ist, treibt langsam an seiner Leine */
    for (const f of this.floaters) {
      f.obj.position.copy(f.base).add(_g.set(Math.sin(t * .23 + f.seed) * .03, Math.sin(t * .17 + f.seed * 2) * .04, Math.cos(t * .19 + f.seed) * .03));
      f.obj.quaternion.copy(f.q);
      f.obj.rotateX(Math.sin(t * .13 + f.seed) * .08); f.obj.rotateY(Math.sin(t * .11) * .12);
    }

    // Pflanzen wiegen sich leicht
    let i = 0;
    for (const { mesh } of this.plants.values()) {
      mesh.rotation.z = Math.sin(t * 0.55 + i) * 0.012;
      mesh.rotation.x = Math.cos(t * 0.42 + i * 1.7) * 0.009;
      i++;
    }
    return room;
  }

  /* Die nächstgelegenen, hellsten Lampen bekommen die Lichter aus dem Pool.
     Wer herausfällt, blendet erst aus, bevor sein Platz neu vergeben wird —
     so springt beim Durchqueren kein Licht. Die Zahl der Lichter bleibt fest,
     dadurch muss kein Shader neu übersetzt werden. */
  _updatePool(dt) {
    const p = this.pos;
    for (const s of this.sources) {
      const d2 = s.pos.distanceToSquared(p);
      const reach = (s.light.distance || 10) + 6;
      s.score = d2 > reach * reach || s.light.intensity <= 0 ? 0 : s.light.intensity / (0.8 + d2);
    }
    const want = this.sources.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, POOL);
    const wanted = new Set(want);
    const fadeStep = dt * 4;
    for (const l of this.pool) {
      const u = l.userData;
      if (u.src && !wanted.has(u.src)) u.fade = Math.max(0, u.fade - fadeStep);
      else if (u.src) u.fade = Math.min(1, u.fade + fadeStep);
      if (u.src && u.fade <= 0 && !wanted.has(u.src)) u.src = null;
    }
    const taken = new Set(this.pool.map(l => l.userData.src).filter(Boolean));
    for (const s of want) {
      if (taken.has(s)) continue;
      const free = this.pool.find(l => !l.userData.src);
      if (!free) break;
      free.userData.src = s; free.userData.fade = this._snapLight ? 1 : 0;
      taken.add(s);
    }
    for (const l of this.pool) {
      const s = l.userData.src;
      if (!s) { l.intensity = 0; continue; }
      l.position.copy(s.pos);
      l.color.copy(s.light.color);
      l.distance = s.light.distance;
      l.decay = s.light.decay;
      l.intensity = s.light.intensity * l.userData.fade;
    }
  }
}
const _g = new THREE.Vector3();
