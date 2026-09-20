/*  Modell der Station Hedera. Maßstab 1 Einheit = 1 Meter.
 *  Die Module werden aus dem Spielstand aufgebaut: was gebaut ist, steht da,
 *  was noch fehlt, erscheint als Drahtgitter-Platzhalter.
 */
import * as THREE from 'three';
import { mats } from './materials.js';
import { MOD_BY_ID } from '../data/modules.js';

/* Position, Ausrichtung und Größe jedes Moduls am Gerüst.
 * −Y zeigt zur Erde, +Y zum Zenit. */
export const LAYOUT = {
  cargo:    { pos: [-11.5, 0, 0], len: 4.2, rad: 1.5, axis: 'x', color: 0xcfd3d6 },
  systems:  { pos: [-5.6, 0, 0], len: 5.6, rad: 1.85, axis: 'x', color: 0xe6e8e4 },
  lounge:   { pos: [0, 0, 5.4], len: 5.0, rad: 2.15, axis: 'z', color: 0xf2f3ef, window: true },
  grow_a:   { pos: [5.6, 0, 0], len: 5.6, rad: 1.85, axis: 'x', color: 0xeef0ea },
  lab:      { pos: [11.4, 0, 0], len: 5.0, rad: 1.7, axis: 'x', color: 0xe4e8ea },
  hydro:    { pos: [0, 0, -5.6], len: 5.4, rad: 1.9, axis: 'z', color: 0xdfeaf0 },
  mycology: { pos: [-5.6, -3.4, 0], len: 3.4, rad: 1.4, axis: 'x', color: 0x9aa0a6 },
  vertical: { pos: [16.8, 0, 0], len: 7.4, rad: 2.5, axis: 'x', color: 0xeaece8 },
  dome:     { pos: [0, 4.6, 0], len: 3.0, rad: 2.6, axis: 'y', color: 0xdfe8ee, dome: true },
};

function cylinderFor(len, rad, axis) {
  const g = new THREE.CylinderGeometry(rad, rad, len, 28, 1, false);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

function ribs(len, rad, axis, M) {
  const grp = new THREE.Group();
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + i * len / n;
    const g = new THREE.TorusGeometry(rad * 1.015, 0.055, 8, 30);
    const m = new THREE.Mesh(g, M.metal);
    if (axis === 'x') { m.rotation.y = Math.PI / 2; m.position.x = t; }
    else if (axis === 'z') { m.position.z = t; }
    else { m.rotation.x = Math.PI / 2; m.position.y = t; }
    grp.add(m);
  }
  return grp;
}

function handrails(len, rad, axis, M) {
  const grp = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3 + 0.4;
    const g = new THREE.CylinderGeometry(0.035, 0.035, len * 0.86, 6);
    const m = new THREE.Mesh(g, M.metal);
    const off = rad * 1.12;
    if (axis === 'x') { m.rotation.z = Math.PI / 2; m.position.set(0, Math.cos(a) * off, Math.sin(a) * off); }
    else if (axis === 'z') { m.rotation.x = Math.PI / 2; m.position.set(Math.cos(a) * off, Math.sin(a) * off, 0); }
    else { m.position.set(Math.cos(a) * off, 0, Math.sin(a) * off); }
    grp.add(m);
  }
  return grp;
}

/** Ein Modul als Gruppe. */
function buildModule(id, cfg, M, built) {
  const g = new THREE.Group();
  g.name = 'mod:' + id;
  g.userData.moduleId = id;

  if (!built) {
    const wire = new THREE.Mesh(
      cfg.dome ? new THREE.SphereGeometry(cfg.rad, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
               : cylinderFor(cfg.len, cfg.rad, cfg.axis),
      new THREE.MeshBasicMaterial({ color: 0x4fd6ff, wireframe: true, transparent: true, opacity: 0.16 })
    );
    wire.userData.pickable = true; wire.userData.moduleId = id;
    g.add(wire);
    g.position.fromArray(cfg.pos);
    g.userData.ghost = true;
    return g;
  }

  if (cfg.dome) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(cfg.rad * .82, cfg.rad * .95, 1.1, 28), M.hull);
    base.position.y = -0.4; g.add(base);
    const frame = new THREE.Mesh(new THREE.SphereGeometry(cfg.rad, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xbfc6cc, roughness: .3, metalness: .85, wireframe: true }));
    frame.position.y = 0.2; g.add(frame);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(cfg.rad * .99, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
    glass.position.y = 0.2; glass.userData.pickable = true; glass.userData.moduleId = id;
    g.add(glass);
    // Grünes Schimmern von innen
    const inner = new THREE.Mesh(new THREE.SphereGeometry(cfg.rad * .8, 20, 12),
      new THREE.MeshBasicMaterial({ color: 0x3bd98a, transparent: true, opacity: .22 }));
    inner.position.y = 0.1; g.add(inner);
    g.position.fromArray(cfg.pos);
    return g;
  }

  const body = new THREE.Mesh(cylinderFor(cfg.len, cfg.rad, cfg.axis), M.hull.clone());
  body.material.color = new THREE.Color(cfg.color);
  body.castShadow = body.receiveShadow = true;
  body.userData.pickable = true; body.userData.moduleId = id;
  g.add(body);

  // Endkappen
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(cfg.rad, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.hullDark);
    const off = cfg.len / 2;
    if (cfg.axis === 'x') { cap.rotation.z = -s * Math.PI / 2; cap.position.x = s * off; }
    else if (cfg.axis === 'z') { cap.rotation.x = s * Math.PI / 2; cap.position.z = s * off; }
    else { cap.rotation.x = s > 0 ? 0 : Math.PI; cap.position.y = s * off; }
    cap.scale.setScalar(0.92);
    cap.userData.pickable = true; cap.userData.moduleId = id;
    g.add(cap);
  }

  g.add(ribs(cfg.len, cfg.rad, cfg.axis, M));
  g.add(handrails(cfg.len, cfg.rad, cfg.axis, M));

  // Isolationsfolie auf Teilabschnitten
  const foil = new THREE.Mesh(cylinderFor(cfg.len * 0.3, cfg.rad * 1.03, cfg.axis), M.mli);
  if (cfg.axis === 'x') foil.position.x = cfg.len * 0.22;
  else if (cfg.axis === 'z') foil.position.z = cfg.len * 0.22;
  else foil.position.y = cfg.len * 0.22;
  g.add(foil);

  // Fenster
  if (cfg.window) {
    const wg = new THREE.CylinderGeometry(cfg.rad * 1.005, cfg.rad * 1.005, 2.6, 28, 1, true, -0.95, 1.9);
    wg.rotateX(Math.PI / 2);
    const win = new THREE.Mesh(wg, new THREE.MeshPhysicalMaterial({
      color: 0x0c1826, roughness: .05, metalness: .1, transmission: .35, transparent: true,
      opacity: .82, side: THREE.DoubleSide, clearcoat: 1, emissive: 0xffd9a0, emissiveIntensity: .22,
    }));
    win.rotation.y = Math.PI;
    win.position.z = -0.4;
    win.userData.pickable = true; win.userData.moduleId = id;
    g.add(win);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(cfg.rad * 1.02, .08, 8, 36), M.metal);
    rim.position.z = -0.4 - 1.3; rim.visible = false;
    g.add(rim);
  } else {
    // Bullaugen
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshStandardMaterial({
        color: 0x0a1420, emissive: 0xffc98a, emissiveIntensity: .5, roughness: .15, metalness: .2,
      }));
      const a = -0.6 + i * 0.6;
      const t = (i - 1) * cfg.len * 0.26;
      if (cfg.axis === 'x') { p.position.set(t, Math.cos(a) * cfg.rad * 1.01 * -1, Math.sin(a) * cfg.rad * 1.01); p.lookAt(p.position.clone().multiplyScalar(2)); }
      else if (cfg.axis === 'z') { p.position.set(Math.sin(a) * cfg.rad * 1.01, Math.cos(a) * cfg.rad * -1.01, t); p.lookAt(p.position.clone().multiplyScalar(2)); }
      else { p.position.set(Math.sin(a) * cfg.rad * 1.01, t, Math.cos(a) * cfg.rad * 1.01); p.lookAt(p.position.clone().multiplyScalar(2)); }
      g.add(p);
    }
  }

  g.position.fromArray(cfg.pos);
  return g;
}

/** Verbindungsknoten zwischen den Modulen. */
function node(M, r = 1.35) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), M.hull);
  core.castShadow = core.receiveShadow = true;
  g.add(core);
  for (const [ax, dir] of [['x', 1], ['x', -1], ['z', 1], ['z', -1], ['y', 1], ['y', -1]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(r * .62, r * .62, r * 1.5, 18), M.hullDark);
    if (ax === 'x') { col.rotation.z = Math.PI / 2; col.position.x = dir * r * .7; }
    else if (ax === 'z') { col.rotation.x = Math.PI / 2; col.position.z = dir * r * .7; }
    else col.position.y = dir * r * .7;
    g.add(col);
  }
  return g;
}

/** Solarflügel. */
function solarWing(M, span, chord, cells = 3) {
  const g = new THREE.Group();
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, span, 10), M.metal);
  boom.rotation.z = Math.PI / 2; boom.position.x = span / 2;
  g.add(boom);
  for (let i = 0; i < cells; i++) {
    const w = span / cells - 0.25;
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, .06, chord), M.solar);
    p.position.set(i * (span / cells) + w / 2 + .15, 0, 0);
    p.castShadow = true;
    g.add(p);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + .08, .1, chord + .08),
      new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: .4, metalness: .8 }));
    fr.position.copy(p.position); fr.position.y -= .05;
    g.add(fr);
  }
  return g;
}

/** Radiatorfläche. */
function radiator(M, w, h) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, .05, h), M.radiator);
    p.position.set(0, 0, i * (h + .18));
    g.add(p);
    for (let k = 0; k < 5; k++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, w * .95, 6), M.metal);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, .045, i * (h + .18) - h / 2 + (k + .5) * h / 5);
      g.add(pipe);
    }
  }
  return g;
}

/**
 * Baut die Station passend zum Spielstand.
 * @returns {{group:THREE.Group, pickables:THREE.Object3D[], lights:object, update:Function}}
 */
export function buildStation(st) {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'station';
  const pickables = [];

  /* Gerüst */
  const spine = new THREE.Group();
  const truss = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, 30, 12), M.metal);
  rail.rotation.z = Math.PI / 2;
  truss.add(rail);
  // Fachwerk
  for (let i = -14; i <= 14; i += 1.6) {
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.15, 5), M.metal);
      d.position.set(i, s * .38, 0);
      d.rotation.z = Math.PI / 2 + s * 0.62;
      truss.add(d);
    }
  }
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, 30, 8), M.metal);
    c.rotation.z = Math.PI / 2; c.position.y = s * .42;
    truss.add(c);
  }
  spine.add(truss);
  root.add(spine);

  /* Knoten */
  for (const x of [0, -5.6, 5.6, 11.4]) {
    const n = node(M, x === 0 ? 1.55 : 1.15);
    n.position.x = x;
    root.add(n);
  }

  /* Module */
  const moduleGroups = {};
  for (const [id, cfg] of Object.entries(LAYOUT)) {
    const built = !!st.modules[id]?.built;
    const building = !!st.modules[id]?.building;
    const def = MOD_BY_ID[id];
    if (!built && !building && def && st.level < def.level - 2) continue;   // noch zu weit weg
    const g = buildModule(id, cfg, M, built);
    if (building) {
      g.traverse(o => { if (o.material && !o.material.wireframe) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .45; } });
    }
    moduleGroups[id] = g;
    root.add(g);
    g.traverse(o => { if (o.userData.pickable) pickables.push(o); });
  }

  /* Solarflügel am Querträger */
  const wings = new THREE.Group();
  const nWings = st.research?.done?.includes('solar2') ? 2 : 1;
  const big = st.research?.done?.includes('solar3');
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < nWings; k++) {
      const w = solarWing(M, big ? 11 : 8.5, 3.4, big ? 4 : 3);
      w.position.set(0, 0, (side ? 1 : -1) * (2.6 + k * 4.2));
      w.rotation.y = side ? 0 : Math.PI;
      w.rotation.x = (side ? 1 : -1) * 0.02;
      wings.add(w);
    }
  }
  const cross = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 22, 10), M.metal);
  cross.rotation.x = Math.PI / 2;
  wings.add(cross);
  wings.position.x = -2.8;
  root.add(wings);

  /* Radiatoren */
  const rad = radiator(M, 5.2, 2.0);
  rad.position.set(-2.8, -2.6, -2.2);
  rad.rotation.x = 0.12;
  root.add(rad);
  const rad2 = rad.clone();
  rad2.position.set(-2.8, 2.6, -2.2);
  root.add(rad2);

  /* Andockadapter + Antenne */
  const dock = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.15, 1.1, 20), M.hullDark);
  dock.rotation.z = Math.PI / 2; dock.position.x = -14;
  root.add(dock);
  const target = new THREE.Mesh(new THREE.TorusGeometry(.62, .06, 8, 24), new THREE.MeshBasicMaterial({ color: 0x4fd6ff }));
  target.rotation.y = Math.PI / 2; target.position.x = -14.6;
  root.add(target);

  const dish = new THREE.Group();
  const d1 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: .5, metalness: .3, side: THREE.DoubleSide }));
  d1.rotation.x = Math.PI;
  dish.add(d1);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.1, 6), M.metal);
  arm.position.y = -.5; dish.add(arm);
  dish.position.set(9.4, 2.4, 1.4);
  dish.rotation.set(-0.5, 0.3, 0);
  root.add(dish);

  /* Positionsleuchten */
  const beacons = [];
  const mk = (x, y, z, color) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    const l = new THREE.PointLight(color, 1.6, 6);
    l.position.copy(m.position);
    root.add(m, l);
    beacons.push({ m, l, phase: Math.random() * 6.28 });
  };
  mk(-14.8, 0, 0, 0xff4444);
  mk(13.6, 1.6, 0, 0x44ff66);
  mk(0, 0, 8.4, 0xffffff);
  mk(0, -3.2, -7.8, 0xffaa33);

  /* Fenster-Glimmen der Lounge */
  const loungeGlow = new THREE.PointLight(0xffd6a0, 2.4, 14, 2);
  loungeGlow.position.set(0, 0, 7.4);
  root.add(loungeGlow);

  /* Frachtkapsel, wenn eine Lieferung unterwegs oder angedockt ist */
  const capsule = new THREE.Group();
  const cb = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 3.4, 22), M.mli);
  cb.rotation.z = Math.PI / 2; capsule.add(cb);
  const cn = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.3, 22), M.hull);
  cn.rotation.z = -Math.PI / 2; cn.position.x = 2.3; capsule.add(cn);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, .05, 1.1), M.solar);
    p.position.set(-.4, 0, s * 1.9); capsule.add(p);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.3, 1.2, 12),
    new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: .55 }));
  flame.rotation.z = Math.PI / 2; flame.position.x = -2.4;
  capsule.add(flame);
  capsule.visible = false;
  root.add(capsule);

  return {
    group: root, pickables, moduleGroups, capsule, beacons, wings, loungeGlow,
    update(t, st2) {
      for (const b of beacons) {
        const v = (Math.sin(t * 1.9 + b.phase) > .72) ? 1 : 0.06;
        b.m.material.color.setScalar(1);
        b.l.intensity = v * 2.4;
        b.m.scale.setScalar(.7 + v * .6);
      }
      // Solarflügel der Sonne nachführen
      if (this._sunLocal) {
        const a = Math.atan2(this._sunLocal.y, this._sunLocal.x);
        wings.rotation.x = -a;
      }
      target.rotation.z = t * 0.6;
    },
  };
}
