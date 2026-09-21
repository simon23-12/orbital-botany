/*  Innenräume der Station.
 *
 *  Jeder Raum ist eine eigene kleine Bühne mit fester Kamera und sanfter
 *  Mausparallaxe. Der Himmel wird als eigene Szene dahinter gerendert — durch
 *  die Fensteröffnungen sieht man die echte Erde und den echten Sonnenstand.
 */
import * as THREE from 'three';
import { mats, floorTexture, fabricTexture } from './materials.js';
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
function screen(w, h, hue = 0.55) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.max(64, Math.round(256 * h / w));
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.userData.draw = (t, lines) => {
    const W = c.width, H = c.height;
    ctx.fillStyle = '#060a12'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `hsla(${hue * 360},70%,60%,.14)`; ctx.lineWidth = 1;
    for (let i = 0; i < H; i += 6) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke(); }
    ctx.fillStyle = `hsl(${hue * 360},80%,68%)`;
    ctx.font = '11px monospace';
    (lines || []).forEach((ln, i) => ctx.fillText(ln, 8, 18 + i * 14));
    // laufende Kurve
    ctx.strokeStyle = `hsl(${hue * 360},90%,62%)`; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const y = H * 0.75 + Math.sin(x * 0.06 + t * 1.4) * 12 + Math.sin(x * 0.21 + t * 0.7) * 6;
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

function shell(len, rad, M, opts = {}) {
  const g = new THREE.Group();
  const axis = opts.axis || 'x';                 // Längsachse des Moduls
  const along = v => axis === 'x' ? new THREE.Vector3(v, 0, 0) : new THREE.Vector3(0, 0, v);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(rad, rad, len, 32, 1, true),
    new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xd8dcdf, roughness: .78, metalness: .12, side: THREE.BackSide,
    })
  );
  if (axis === 'x') wall.rotation.z = Math.PI / 2; else wall.rotation.x = Math.PI / 2;
  wall.receiveShadow = true;
  g.add(wall);

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
  // Endwände mit Durchstieg
  if (!opts.openEnds) for (const sgn of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(rad, 32),
      new THREE.MeshStandardMaterial({ color: 0xc3c9cd, roughness: .8, metalness: .15, side: THREE.DoubleSide }));
    cap.position.copy(along(sgn * len / 2));
    if (axis === 'x') cap.rotation.y = -sgn * Math.PI / 2;
    else if (sgn < 0) cap.rotation.y = Math.PI;
    g.add(cap);
    const hatch = new THREE.Mesh(new THREE.CircleGeometry(rad * .38, 24), M.hullDark);
    hatch.position.copy(along(sgn * (len / 2 - .01)));
    hatch.position.y = -rad * .18;
    hatch.rotation.copy(cap.rotation);
    g.add(hatch);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad * .4, .05, 8, 28), M.metal);
    ring.position.copy(hatch.position);
    ring.rotation.copy(cap.rotation);
    g.add(ring);
  }
  return g;
}

/* ───────────────────────── Die Räume ───────────────────────── */

const ROOMS = {

  /* ══ LOUNGE ══ */
  lounge(st, ctx) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 7.6, RAD = 2.85;
    g.add(shell(LEN, RAD, M, { color: 0xb9bcb8, openEnds: true, axis: 'z' }));

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
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.7, .34, 1.0), couchMat);
    seat.position.y = .42; seat.castShadow = seat.receiveShadow = true;
    couch.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, .78, .26), couchMat);
    back.position.set(0, .78, .44); back.rotation.x = -.14;
    back.castShadow = true;
    couch.add(back);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.24, .5, 1.0), couchMat);
      arm.position.set(s * 1.32, .55, 0); arm.castShadow = true;
      couch.add(arm);
    }
    for (let i = 0; i < 3; i++) {
      const cu = new THREE.Mesh(new THREE.BoxGeometry(.82, .16, .82), couchMat);
      cu.position.set((i - 1) * .88, .62, -.02); cu.rotation.x = -.05;
      couch.add(cu);
    }
    // Kissen
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(.42, .42, .14),
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

    ctx.camera = { pos: new THREE.Vector3(0.05, 0.72, 3.15), look: new THREE.Vector3(0.95, -0.48, -3.6), fov: 60 };
    ctx.sunDirLocal = new THREE.Vector3(0, .1, -1);
    return g;
  },

  /* ══ CUPOLA ══
   * Nachbau der ISS-Aussichtskuppel: sechs trapezförmige Seitenfenster um eine
   * runde Mittelscheibe. Es gibt bewusst keine Wandflächen zwischen den Rahmen —
   * dadurch ist der Blick nach draußen wirklich rundum frei.
   */
  cupola(st, ctx) {
    const M = mats();
    const g = new THREE.Group();

    /* Der weite Ring liegt bewusst HINTER dem Auge — wie wenn man den Kopf in
       die Kuppel steckt. So füllen die sechs Fenster jedes Seitenverhältnis bis
       hinaus zu Ultrawide, ohne dass man seitlich am Rahmen vorbeisieht. */
    const R1 = 1.95, Z1 = 0.78;        // weiter Ring, hinter dem Betrachter
    const R2 = 1.06, Z2 = -1.12;       // enger Ring, Fassung der Mittelscheibe
    // Matt und hell: die Rahmen nehmen das Erdlicht diffus auf, statt es zu spiegeln
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd8dee4, roughness: .58, metalness: .30 });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x353b44, roughness: .72, metalness: .35, side: THREE.DoubleSide });
    const paneMat = new THREE.MeshBasicMaterial({
      color: 0x8fb8e0, transparent: true, opacity: .028, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });

    const corner = (i, r, z) => {
      const a = i * TAU / 6 + Math.PI / 6;
      return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
    };

    /* Sechs Pfosten zwischen den Ringen, dazwischen je eine Scheibe */
    for (let i = 0; i < 6; i++) {
      const aTop = corner(i, R1, Z1), aBot = corner(i, R2, Z2);
      const mid = aTop.clone().lerp(aBot, .5);
      const len = aTop.distanceTo(aBot);
      const post = new THREE.Mesh(new THREE.BoxGeometry(.085, .085, len), frameMat);
      post.position.copy(mid);
      post.lookAt(aBot);
      g.add(post);

      /* Trapezscheibe zwischen zwei Pfosten */
      const bTop = corner(i + 1, R1, Z1), bBot = corner(i + 1, R2, Z2);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        aTop.x, aTop.y, aTop.z, bTop.x, bTop.y, bTop.z, bBot.x, bBot.y, bBot.z,
        aTop.x, aTop.y, aTop.z, bBot.x, bBot.y, bBot.z, aBot.x, aBot.y, aBot.z,
      ], 3));
      geo.computeVertexNormals();
      const pane = new THREE.Mesh(geo, paneMat);
      pane.renderOrder = 3;
      g.add(pane);

      /* Rahmenkante oben und unten */
      for (const [p1, p2, w] of [[aTop, bTop, .075], [aBot, bBot, .065]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, w, p1.distanceTo(p2)), frameMat);
        bar.position.copy(p1).lerp(p2, .5);
        bar.lookAt(p2);
        g.add(bar);
      }
    }

    /* Mittelscheibe — 80 cm, das größte Fenster, das je geflogen ist */
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R2 * .95, .042, 10, 44), frameMat);
    ring.position.z = Z2;
    g.add(ring);
    const centre = new THREE.Mesh(new THREE.CircleGeometry(R2 * .93, 44), paneMat);
    centre.position.z = Z2 + .01;
    centre.renderOrder = 3;
    g.add(centre);

    /* Kragen hinter dem Betrachter: Übergang zum Modul.
       Er beginnt bewusst erst hinter der Kamera — sonst schiebt er sich auf
       breiten Bildschirmen von den Seiten ins Bild und verdeckt die Aussicht. */
    const COLLAR_START = 0.84;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(R1 * 1.04, R1 * 1.04, 1.5, 6, 1, true), innerMat);
    collar.rotation.x = Math.PI / 2;
    collar.rotation.z = Math.PI / 6;
    collar.position.z = COLLAR_START + .75;
    g.add(collar);
    const back = new THREE.Mesh(new THREE.CircleGeometry(R1 * 1.04, 6), innerMat);
    back.position.z = COLLAR_START + 1.5;
    back.rotation.z = Math.PI / 6;
    g.add(back);
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(.56, .07, 8, 28), M.metal);
    hatch.position.z = COLLAR_START + 1.47;
    g.add(hatch);

    /* Handläufe: Bügel, die längs auf den Pfosten sitzen — wie an jedem
       ISS-Modul. Quer durchs Fenster würden sie nur die Aussicht zerschneiden. */
    const UPV = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 6; i += 2) {
      const aTop = corner(i, R1, Z1), aBot = corner(i, R2, Z2);
      const p1 = aTop.clone().lerp(aBot, .34);
      const p2 = aTop.clone().lerp(aBot, .66);
      const mid = p1.clone().lerp(p2, .5);
      const inward = mid.clone().setZ(0).normalize().multiplyScalar(-.075);
      const axis = p2.clone().sub(p1).normalize();
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, p1.distanceTo(p2), 8), frameMat);
      bar.position.copy(mid).add(inward);
      bar.quaternion.setFromUnitVectors(UPV, axis);
      g.add(bar);
      for (const p of [p1, p2]) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, .085, 6), frameMat);
        stud.position.copy(p).add(inward.clone().multiplyScalar(.5));
        stud.quaternion.setFromUnitVectors(UPV, inward.clone().normalize());
        g.add(stud);
      }
    }

    /* Arbeitsbildschirm an einem Rahmen, wie in der echten Cupola */
    const scr = screen(.40, .26, .5);
    const anchor = corner(1, R1, Z1).lerp(corner(1, R2, Z2), .42);
    scr.position.copy(anchor).addScaledVector(anchor.clone().setZ(0).normalize(), -.14);
    scr.lookAt(0, 0, 1.2);
    g.add(scr);
    ctx.screens = [scr];

    /* Gedimmtes Licht — wer hinaussehen will, macht die Lampen aus */
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      const led = new THREE.PointLight(0xd8e4f2, .34, 3.0, 2);
      led.position.set(Math.cos(a) * R1 * .8, Math.sin(a) * R1 * .8, Z1 + .3);
      g.add(led);
    }
    g.add(new THREE.AmbientLight(0x2a3442, .45));
    g.add(new THREE.HemisphereLight(0x6f92bb, 0x24282e, .35));
    /* Die Erde selbst ist die hellste Lichtquelle hier drin — ihr Albedo liegt
       bei rund 30 %, aus 600 km ist das ein Scheinwerfer von unten. */
    const earthGlow = new THREE.DirectionalLight(0xbcd6f5, 2.2);
    earthGlow.position.set(0, -4, -6);
    g.add(earthGlow, earthGlow.target);
    ctx.earthGlow = earthGlow;

    /* Blickrichtung: 33° neben dem Nadir — dann liegt der Erdhorizont im Bild */
    ctx.window = { mesh: centre, dir: new THREE.Vector3(0, -0.55, -0.84).normalize(), wide: true };
    ctx.camera = { pos: new THREE.Vector3(0, 0, .45), look: new THREE.Vector3(0, -.05, -4.0), fov: 84 };
    return g;
  },

  /* ══ GEWÄCHSRÄUME (grow_a, hydro, vertical, mycology, dome) ══ */
  grow(st, ctx, modId) {
    const M = mats();
    const def = MOD_BY_ID[modId];
    const g = new THREE.Group();
    const slots = st.slots.filter(s => s.mod === modId);
    const n = slots.length;

    if (def.sunlit) return ROOMS.dome(st, ctx, modId, g, slots);
    if (modId === 'vertical') return ROOMS.tower(st, ctx, modId, g, slots);

    const dark = !!def.dark;
    const LEN = clamp(4.5 + n * 0.5, 5, 11), RAD = 2.4;
    g.add(shell(LEN, RAD, M, { color: dark ? 0x4a4e52 : 0xdde3e6 }));

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
    /* Bedienkonsole */
    const con = screen(.72, .42, dark ? .78 : .42);
    con.position.set(-LEN / 2 + .35, -.3, 0);
    con.rotation.y = Math.PI / 2;
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

    ctx.camera = { pos: new THREE.Vector3(LEN * .44, .42, .02), look: new THREE.Vector3(-LEN * .5, -.58, 0), fov: 64 };
    return g;
  },

  /* ══ VERTIKALFARM ══ */
  tower(st, ctx, modId, g, slots) {
    const M = mats();
    const RAD = 3.1, LEN = 8.5;
    g.add(shell(LEN, RAD, M, { color: 0xc8d2d8 }));
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
    con.position.set(-LEN / 2 + .3, .4, 0);
    con.rotation.y = Math.PI / 2;
    g.add(con);
    ctx.screens = [con];
    g.add(makeStrip(LEN * .8, 0, RAD * .85, 0, 0xd8e4ff, .6));
    g.add(new THREE.HemisphereLight(0xb4cdf0, 0x33302a, 1.05));
    g.add(new THREE.AmbientLight(0x5f6b7d, .55));
    ctx.camera = { pos: new THREE.Vector3(LEN * .44, .45, .02), look: new THREE.Vector3(-LEN * .5, -.15, 0), fov: 68 };
    return g;
  },

  /* ══ KUPPELGEWÄCHSHAUS ══ */
  dome(st, ctx, modId, g, slots) {
    const M = mats();
    const R = 4.2;
    // Boden
    const ft = floorTexture(); ft.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48),
      new THREE.MeshStandardMaterial({ map: ft, color: 0x8e959c, roughness: .8, metalness: .3 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6;
    floor.receiveShadow = true;
    g.add(floor);
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
    // Sitzbank in der Mitte
    const bench = new THREE.Mesh(new THREE.CylinderGeometry(.55, .6, .42, 24),
      new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: .7 }));
    bench.position.y = -1.4;
    g.add(bench);

    g.add(new THREE.HemisphereLight(0x9fc8ff, 0x3a3a30, .85));
    g.add(new THREE.AmbientLight(0x5a6878, .45));
    ctx.camera = { pos: new THREE.Vector3(.5, .35, 3.15), look: new THREE.Vector3(-1.4, -.95, -.6), fov: 64 };
    ctx.sunDirLocal = new THREE.Vector3(0, 1, 0);
    return g;
  },

  /* ══ LABOR ══ */
  lab(st, ctx) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 6.4, RAD = 2.3;
    g.add(shell(LEN, RAD, M, { color: 0xe8ecef }));

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
    ctx.camera = { pos: new THREE.Vector3(-LEN * .44, .38, .05), look: new THREE.Vector3(LEN * .5, -.55, .05), fov: 64 };
    return g;
  },

  /* ══ TECHNIK ══ */
  systems(st, ctx) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 6.0, RAD = 2.4;
    g.add(shell(LEN, RAD, M, { color: 0xb4bcc2 }));

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
    ctx.camera = { pos: new THREE.Vector3(-LEN * .46, .34, .55), look: new THREE.Vector3(LEN * .5, -.52, -.1), fov: 64 };
    return g;
  },

  /* ══ FRACHTSCHLEUSE ══ */
  cargo(st, ctx) {
    const M = mats();
    const g = new THREE.Group();
    const LEN = 5.6, RAD = 2.2;
    g.add(shell(LEN, RAD, M, { color: 0xc6ccd0, axis: 'z' }));

    // Luke mit Fenster zum All
    const hatch = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.95, .14, 12, 40), M.metal);
    hatch.add(ring);
    const door = new THREE.Mesh(new THREE.CylinderGeometry(.92, .92, .12, 36), M.hullDark);
    door.rotation.x = Math.PI / 2;
    hatch.add(door);
    const port = new THREE.Mesh(new THREE.CircleGeometry(.3, 28), new THREE.MeshPhysicalMaterial({
      color: 0x0a1018, transmission: .0, transparent: true, opacity: .1, roughness: .02, clearcoat: 1, depthWrite: false,
    }));
    port.position.z = -.07;
    hatch.add(port);
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(.1, .16, .1), M.metal);
      const a = i * TAU / 8;
      b.position.set(Math.cos(a) * .95, Math.sin(a) * .95, -.1);
      hatch.add(b);
    }
    hatch.position.set(0, -.5, -LEN / 2 + .1);
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
    ctx.camera = { pos: new THREE.Vector3(.55, .42, 2.35), look: new THREE.Vector3(-.15, -.45, -2.7), fov: 62 };
    return g;
  },
};

function makeStrip(len, x, y, z, color, intensity) {
  const s = lightStrip(len, color, intensity);
  s.position.set(x, y, z);
  return s;
}

/* ───────────────────────── Controller ───────────────────────── */

export class Interior {
  constructor(sky) {
    this.sky = sky;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 0);
    this.sun.castShadow = false;
    this.scene.add(this.sun, this.sun.target);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.ctx = {};
    this.plants = new Map();
    this.roomId = null;
    this.baseCam = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
  }

  setRoom(id, st) {
    while (this.root.children.length) {
      const c = this.root.children.pop();
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.plants.clear();
    this.ctx = { anchors: [], screens: [] };
    this.roomId = id;

    let g;
    const def = MOD_BY_ID[id];
    if (id === 'lounge') g = ROOMS.lounge(st, this.ctx);
    else if (id === 'cupola') g = ROOMS.cupola(st, this.ctx);
    else if (id === 'lab') g = ROOMS.lab(st, this.ctx);
    else if (id === 'systems') g = ROOMS.systems(st, this.ctx);
    else if (id === 'cargo') g = ROOMS.cargo(st, this.ctx);
    else if (def && (def.slots || st.modules[id]?.slots)) g = ROOMS.grow(st, this.ctx, id);
    else g = ROOMS.lab(st, this.ctx);
    this.root.add(g);

    const c = this.ctx.camera;
    this.camera.fov = c.fov;
    this.camera.position.copy(c.pos);
    this.baseCam.copy(c.pos);
    this.lookAt.copy(c.look);
    this.camera.lookAt(c.look);
    this.camera.updateProjectionMatrix();
    this.syncPlants(st, true);
  }

  /** Pflanzenmodelle anlegen/erneuern. */
  syncPlants(st, force = false) {
    for (const a of this.ctx.anchors || []) {
      const s = st.slots.find(x => x.id === a.slot.id) || a.slot;
      a.slot = s;
      const key = s.id;
      const p = s.plant ? PLANT_BY_ID[s.plant] : null;
      const stageIdx = p ? stageAt(p, s.prog).i : -1;
      const bucket = Math.floor(s.prog * 14);
      const sig = `${s.plant}|${stageIdx}|${bucket}|${s.dead ? 1 : 0}|${Math.round(s.health * 4)}`;
      const cur = this.plants.get(key);
      if (!force && cur && cur.sig === sig) continue;
      if (cur) { a.obj.remove(cur.mesh); cur.mesh.traverse(o => o.geometry?.dispose()); }
      if (!p) { this.plants.delete(key); continue; }
      const mesh = buildPlant(p, s.prog, s.dead ? 0.05 : s.health, s.id, stageIdx);
      const scale = a.tray ? 0.62 : 1;
      mesh.scale.setScalar(scale);
      a.obj.add(mesh);
      this.plants.set(key, { sig, mesh, slot: s });
      // Lampe je nach Einstellung
      if (a.tray?.userData.lamp) {
        const lamp = st.lamps[s.mod];
        const on = lamp ? lamp.on !== false : true;
        const inten = on ? clamp((lamp?.ppfd ?? 250) / 260, .2, 2.6) : 0;
        a.tray.userData.lamp.material.emissiveIntensity = inten * 1.5;
        if (a.tray.userData.lampLight) a.tray.userData.lampLight.intensity = inten * 1.2;
      }
    }
  }

  setPointer(nx, ny) {
    this.pointer.set(nx, ny);
  }

  /** Raycast auf Anbauplätze. */
  pick(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.raycaster.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData?.slotId) return { slotId: o.userData.slotId };
        o = o.parent;
      }
    }
    return null;
  }

  update(dt, t, st, solarInfo) {
    // Sanfte Parallaxe
    this.parallax.lerp(this.pointer, 1 - Math.pow(0.001, dt));
    const px = this.parallax.x * 0.22, py = this.parallax.y * 0.14;
    // Seitliche Parallaxe quer zur Blickrichtung, nicht entlang einer Weltachse
    const fwd = this.lookAt.clone().sub(this.baseCam).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    this.camera.position.copy(this.baseCam)
      .addScaledVector(right, px)
      .addScaledVector(new THREE.Vector3(0, 1, 0), py + Math.sin(t * 0.32) * 0.014);
    this.camera.lookAt(this.lookAt);
    this.camera.rotateZ(Math.sin(t * 0.19) * 0.005);   // sanfte Rolle um die Blickachse

    // Sonnenlicht durch die Fenster
    const lit = solarInfo?.sun ?? 1;
    const dir = this.ctx.window?.dir;
    if (dir) {
      const swing = solarInfo ? (solarInfo.phase * TAU) : 0;
      const d = dir.clone();
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(swing) * 0.5);
      d.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.cos(swing) * 0.22);
      this.sun.position.copy(d.multiplyScalar(-12));
      this.sun.target.position.set(0, -0.6, 0);
      this.sun.intensity = lit * (this.ctx.window.small ? 1.0 : this.ctx.window.wide ? 2.2 : 3.4);
      this.sun.color.setHSL(0.09, 0.25 * (1 - lit * 0.5) + 0.05, 0.62);
    } else {
      this.sun.intensity = 0;
    }

    if (this.ctx.winFill) this.ctx.winFill.intensity = 0.5 + 2.6 * lit;
    if (this.ctx.earthGlow) this.ctx.earthGlow.intensity = 0.35 + 2.4 * lit;
    for (const s of this.ctx.screens || []) s.userData.draw?.(t, this.ctx.screenLines || []);
    if (this.ctx.record) this.ctx.record.rotation.y = t * 3.3;

    // Pflanzen wiegen sich leicht
    let i = 0;
    for (const { mesh } of this.plants.values()) {
      mesh.rotation.z = Math.sin(t * 0.55 + i) * 0.012;
      mesh.rotation.x = Math.cos(t * 0.42 + i * 1.7) * 0.009;
      i++;
    }
  }
}
