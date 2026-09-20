/*  Prozedurale Pflanzenmodelle.
 *
 *  Jede Pflanze wird aus ihrem Archetyp, ihren Farben und dem Wachstumsfortschritt
 *  gebaut. Die Form ist über die Platz-ID deterministisch — dieselbe Pflanze sieht
 *  nach dem Neuladen genauso aus wie vorher.
 */
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, hash, clamp, clamp01, lerp, TAU } from '../core/util.js';

/* ── Blattgeometrie: eine gewölbte, zugespitzte Fläche ── */
function leafGeometry(len = 1, wid = 0.42, curl = 0.35, serration = 0) {
  const segs = 10, cols = 5;
  const pos = [], idx = [], uv = [], nrm = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Umriss: breit in der Mitte, spitz am Ende
    let w = Math.sin(Math.pow(t, 0.62) * Math.PI) * wid;
    if (serration > 0) w *= 1 + Math.sin(t * 22) * serration * 0.12;
    for (let j = 0; j <= cols; j++) {
      const s = (j / cols) * 2 - 1;
      const x = s * w;
      const y = t * len;
      // Mittelrippe tiefer, Ränder hochgebogen
      const z = curl * (s * s) * w * 1.6 - Math.sin(t * Math.PI) * curl * 0.28 * len;
      pos.push(x, y, z);
      uv.push(j / cols, t);
      nrm.push(0, 0, 1);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ── Blütenblatt ── */
function petalGeometry(len = 0.4, wid = 0.18) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(wid, len * 0.25, wid * 0.9, len * 0.8, 0, len);
  shape.bezierCurveTo(-wid * 0.9, len * 0.8, -wid, len * 0.25, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i);
    p.setZ(i, -Math.sin(y / len * 1.4) * len * 0.18 + x * x * 0.6);
  }
  g.computeVertexNormals();
  return g;
}

function stemGeo(h, r0, r1) { return new THREE.CylinderGeometry(r1, r0, h, 7, 1); }

const matCache = new Map();
function leafMat(color, rough = 0.62) {
  const k = 'l' + color + rough;
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: 0.02, side: THREE.DoubleSide,
      sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xc6ffd4),
      clearcoat: 0.18, clearcoatRoughness: 0.6,
    }));
  }
  return matCache.get(k);
}
function solidMat(color, rough = 0.45, emissive = 0) {
  const k = 's' + color + rough + emissive;
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: 0.05,
      emissive, emissiveIntensity: emissive ? 0.35 : 0,
    }));
  }
  return matCache.get(k);
}

function tint(hex, f) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, (f - 1) * 0.35);
  return c.getHex();
}

/* ── Archetypen ───────────────────────────────────────────────── */

function buildRosette(p, g, r, n, scale, stage) {
  const leaves = [];
  const count = Math.max(2, Math.round(4 + n * 11));
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const len = lerp(0.55, 1.0, Math.pow(1 - t, 0.5)) * (0.35 + n * 0.95);
    const geo = leafGeometry(len, len * lerp(0.38, 0.55, r()), 0.4, 0.5);
    const a = i * 2.399963 + r() * 0.3;                // Goldener Winkel
    const tilt = lerp(1.35, 0.35, t) + r() * 0.15;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, a, 0, 'YXZ'));
    m.compose(new THREE.Vector3(0, 0.02 + t * 0.06 * n, 0), q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    leaves.push(geo);
  }
  const merged = BGU.mergeGeometries(leaves, false);
  leaves.forEach(l => l.dispose());
  const mesh = new THREE.Mesh(merged, leafMat(p.color.leaf));
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

function buildHerb(p, g, r, n, scale, stage) {
  const h = 0.25 + n * 0.75;
  const stem = new THREE.Mesh(stemGeo(h, 0.022, 0.014), solidMat(tint(p.color.leaf, 0.75), 0.7));
  stem.position.y = h / 2;
  g.add(stem);
  const leaves = [];
  const pairs = Math.max(1, Math.round(1 + n * 5));
  for (let i = 0; i < pairs; i++) {
    const y = 0.08 + (i + 0.6) * h / (pairs + 0.4);
    const sc = lerp(0.42, 0.18, i / pairs) * (0.5 + n);
    for (let s = 0; s < 2; s++) {
      const geo = leafGeometry(sc * 1.5, sc * 0.75, 0.3, 0.2);
      const a = i * 1.57 + s * Math.PI;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9 - r() * 0.3, a, 0, 'YXZ'));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      leaves.push(geo);
    }
  }
  const merged = BGU.mergeGeometries(leaves, false);
  leaves.forEach(l => l.dispose());
  const mesh = new THREE.Mesh(merged, leafMat(p.color.leaf));
  mesh.castShadow = true;
  g.add(mesh);
}

function buildBushOrVine(p, g, r, n, scale, stage, fruiting) {
  const vine = p.archetype === 'vine';
  const h = (vine ? 0.5 : 0.3) + n * (vine ? 1.35 : 0.85);
  const branches = [];
  const nB = vine ? 1 : 3;
  for (let b = 0; b < nB; b++) {
    const bh = h * lerp(1, 0.68, b / Math.max(1, nB));
    const geo = stemGeo(bh, 0.032, 0.016);
    const a = b * TAU / nB + r();
    const lean = b === 0 ? 0 : 0.28;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean * Math.cos(a), 0, lean * Math.sin(a)));
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * 0.04 * b, bh / 2, Math.cos(a) * 0.04 * b), q, new THREE.Vector3(1, 1, 1)));
    branches.push(geo);
  }
  const stemMesh = new THREE.Mesh(BGU.mergeGeometries(branches, false), solidMat(tint(p.color.leaf, 0.7), 0.75));
  branches.forEach(b => b.dispose());
  g.add(stemMesh);

  const leaves = [];
  const count = Math.max(3, Math.round(4 + n * 16));
  for (let i = 0; i < count; i++) {
    const t = r();
    const y = 0.1 + t * h * 0.95;
    const sc = lerp(0.5, 0.26, t) * (0.45 + n * 0.85);
    const geo = leafGeometry(sc * 1.35, sc * 0.78, 0.32, 0.35);
    const a = i * 2.399963;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75 - r() * 0.5, a, r() * 0.4, 'YXZ'));
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * 0.05, y, Math.cos(a) * 0.05), q, new THREE.Vector3(1, 1, 1)));
    leaves.push(geo);
  }
  const mesh = new THREE.Mesh(BGU.mergeGeometries(leaves, false), leafMat(p.color.leaf));
  leaves.forEach(l => l.dispose());
  mesh.castShadow = true;
  g.add(mesh);

  /* Blüten / Früchte je nach Phase */
  if (stage >= 3) {
    const flowers = Math.round(2 + n * 4);
    for (let i = 0; i < flowers; i++) {
      const a = i * 2.399963 + 0.6;
      const y = h * lerp(0.45, 0.92, r());
      const rad = 0.1 + r() * 0.09;
      if (fruiting) {
        const fr = new THREE.Mesh(new THREE.SphereGeometry(rad * (0.5 + n * 0.8), 14, 10), solidMat(p.color.accent, 0.3));
        fr.scale.y = 0.92;
        fr.position.set(Math.sin(a) * (0.1 + rad), y, Math.cos(a) * (0.1 + rad));
        fr.castShadow = true;
        g.add(fr);
      } else {
        const fl = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const pet = new THREE.Mesh(petalGeometry(0.11, 0.05), leafMat(p.color.accent, 0.5));
          pet.rotation.set(-1.1, k * TAU / 5, 0, 'YXZ');
          fl.add(pet);
        }
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), solidMat(0xffe08a, 0.4));
        fl.add(c);
        fl.position.set(Math.sin(a) * 0.1, y, Math.cos(a) * 0.1);
        g.add(fl);
      }
    }
  }
}

function buildRoot(p, g, r, n, scale, stage) {
  buildRosette(p, g, r, Math.min(1, n * 1.15), scale, stage);
  if (stage >= 3) {
    const s = (0.1 + n * 0.22);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(s, 18, 14), solidMat(p.color.accent, 0.42));
    bulb.scale.set(1, p.id === 'moehre' ? 2.1 : 1.05, 1);
    bulb.position.y = -s * 0.35;
    g.add(bulb);
  }
}

function buildGrass(p, g, r, n, scale, stage) {
  const blades = [];
  const count = Math.round(10 + n * 26);
  const h = 0.25 + n * 1.05;
  for (let i = 0; i < count; i++) {
    const bh = h * (0.65 + r() * 0.45);
    const geo = leafGeometry(bh, 0.028 + r() * 0.012, 0.6, 0);
    const a = r() * TAU;
    const rad = r() * 0.16;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12 - r() * 0.3, a, 0, 'YXZ'));
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * rad, 0, Math.cos(a) * rad), q, new THREE.Vector3(1, 1, 1)));
    blades.push(geo);
  }
  const mesh = new THREE.Mesh(BGU.mergeGeometries(blades, false), leafMat(p.color.leaf, 0.7));
  blades.forEach(b => b.dispose());
  g.add(mesh);
  if (stage >= 3) {
    for (let i = 0; i < Math.round(3 + n * 6); i++) {
      const a = r() * TAU, rad = r() * 0.12;
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.16 * n, 4, 8), solidMat(p.color.accent, 0.6));
      ear.position.set(Math.sin(a) * rad, h * (0.85 + r() * 0.15), Math.cos(a) * rad);
      ear.rotation.z = (r() - 0.5) * 0.3;
      g.add(ear);
    }
  }
}

function buildFlower(p, g, r, n, scale, stage) {
  const h = 0.18 + n * 0.72;
  const stems = [];
  const nS = Math.max(1, Math.round(1 + n * 3));
  for (let b = 0; b < nS; b++) {
    const bh = h * (0.7 + r() * 0.4);
    const geo = stemGeo(bh, 0.02, 0.012);
    const a = b * TAU / nS + r();
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(Math.sin(a) * 0.05 * b, bh / 2, Math.cos(a) * 0.05 * b));
    stems.push(geo);
  }
  g.add(new THREE.Mesh(BGU.mergeGeometries(stems, false), solidMat(tint(p.color.leaf, 0.8), 0.7)));
  stems.forEach(s => s.dispose());

  const leaves = [];
  for (let i = 0; i < Math.round(3 + n * 7); i++) {
    const sc = 0.2 + n * 0.28;
    const geo = leafGeometry(sc * 1.5, sc * 0.5, 0.35, 0.6);
    const a = i * 2.399963;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1 - r() * 0.3, a, 0, 'YXZ'));
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.05 + r() * h * 0.4, 0), q, new THREE.Vector3(1, 1, 1)));
    leaves.push(geo);
  }
  const lm = new THREE.Mesh(BGU.mergeGeometries(leaves, false), leafMat(p.color.leaf));
  leaves.forEach(l => l.dispose());
  g.add(lm);

  if (stage >= 3) {
    const open = clamp01((n - 0.65) / 0.3);
    for (let b = 0; b < nS; b++) {
      const a = b * TAU / nS;
      const head = new THREE.Group();
      const petals = p.id === 'sonnenblume' ? 18 : p.id === 'orchidee' ? 5 : 12;
      const pl = p.id === 'sonnenblume' ? 0.22 : 0.13;
      for (let k = 0; k < petals; k++) {
        const pet = new THREE.Mesh(petalGeometry(pl * (0.4 + open * 0.75), pl * 0.34), leafMat(p.color.accent, 0.45));
        pet.rotation.set(-0.5 - open * 0.9, k * TAU / petals, 0, 'YXZ');
        head.add(pet);
      }
      const disc = new THREE.Mesh(new THREE.SphereGeometry(pl * 0.32, 14, 8),
        solidMat(p.id === 'sonnenblume' ? 0x4a3418 : 0xffdd88, 0.6));
      disc.scale.y = 0.45;
      head.add(disc);
      head.position.set(Math.sin(a) * 0.05 * b, h * (0.72 + r() * 0.3), Math.cos(a) * 0.05 * b);
      head.rotation.z = (r() - 0.5) * 0.4;
      g.add(head);
    }
  }
}

function buildFungus(p, g, r, n, scale, stage) {
  const count = Math.round(2 + n * 7);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, rad = r() * 0.22;
    const s = (0.4 + r() * 0.6) * n;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.1 + s * 0.16, 7),
      solidMat(0xe8e0cc, 0.85));
    stem.position.set(Math.sin(a) * rad, (0.1 + s * 0.16) / 2, Math.cos(a) * rad);
    stem.rotation.z = (r() - 0.5) * 0.5;
    g.add(stem);
    const capG = new THREE.SphereGeometry(0.07 + s * 0.11, 16, 10, 0, TAU, 0, Math.PI * 0.55);
    const cap = new THREE.Mesh(capG, solidMat(p.color.leaf, 0.8));
    cap.scale.set(1.25, 0.55, 1.25);
    cap.position.set(stem.position.x + (r() - 0.5) * 0.04, 0.1 + s * 0.17, stem.position.z);
    cap.rotation.z = (r() - 0.5) * 0.4;
    cap.castShadow = true;
    g.add(cap);
  }
}

function buildWoody(p, g, r, n, scale, stage) {
  const h = 0.4 + n * 1.5;
  const trunk = new THREE.Mesh(stemGeo(h, 0.07, 0.035), solidMat(0x6b4f35, 0.85));
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const parts = [];
  const nB = Math.round(3 + n * 5);
  for (let b = 0; b < nB; b++) {
    const a = b * 2.399963;
    const y = h * (0.35 + 0.6 * (b / nB));
    const bl = 0.16 + n * 0.3;
    const geo = stemGeo(bl, 0.028, 0.014);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9));
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * bl * 0.4, y, Math.cos(a) * bl * 0.4), q, new THREE.Vector3(1, 1, 1)));
    parts.push(geo);
  }
  g.add(new THREE.Mesh(BGU.mergeGeometries(parts, false), solidMat(0x6b4f35, 0.85)));
  parts.forEach(x => x.dispose());

  const leaves = [];
  for (let i = 0; i < Math.round(10 + n * 34); i++) {
    const a = i * 2.399963;
    const y = h * (0.4 + r() * 0.6);
    const rad = (0.1 + r() * 0.3) * (0.4 + n);
    const sc = 0.12 + n * 0.16;
    const geo = leafGeometry(sc * 1.4, sc * 0.72, 0.3, 0.2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4 - r() * 0.8, a, r() * 0.6, 'YXZ'));
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * rad, y, Math.cos(a) * rad), q, new THREE.Vector3(1, 1, 1)));
    leaves.push(geo);
  }
  const lm = new THREE.Mesh(BGU.mergeGeometries(leaves, false), leafMat(p.color.leaf));
  leaves.forEach(l => l.dispose());
  lm.castShadow = true;
  g.add(lm);

  if (stage >= 4) {
    for (let i = 0; i < Math.round(2 + n * 5); i++) {
      const a = r() * TAU, rad = (0.15 + r() * 0.25) * (0.4 + n);
      const fr = new THREE.Mesh(new THREE.SphereGeometry(0.05 + n * 0.05, 14, 10), solidMat(p.color.accent, 0.28));
      fr.position.set(Math.sin(a) * rad, h * (0.45 + r() * 0.5), Math.cos(a) * rad);
      fr.castShadow = true;
      g.add(fr);
    }
  }
}

/* ── Öffentliche Fabrik ───────────────────────────────────────── */

/**
 * @param {object} p       Pflanzendefinition
 * @param {number} prog    Fortschritt 0…1
 * @param {number} health  0…1
 * @param {string} seed    stabile Kennung (Slot-ID)
 * @param {number} stageIdx aktuelle Phase
 */
export function buildPlant(p, prog, health, seed = 'x', stageIdx = 0) {
  const g = new THREE.Group();
  const r = rng(hash(seed + p.id));
  const n = clamp01(Math.pow(prog, 0.72));
  if (prog < 0.04) {
    // Keimling
    const s = 0.02 + prog * 0.6;
    const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), solidMat(0xdcd3b8, 0.8));
    sprout.scale.set(1, 0.7, 1);
    g.add(sprout);
    if (prog > 0.015) {
      for (let k = 0; k < 2; k++) {
        const geo = leafGeometry(0.09, 0.05, 0.2, 0);
        const m = new THREE.Mesh(geo, leafMat(0x8fd07a));
        m.rotation.set(-1.25, k * Math.PI, 0, 'YXZ');
        m.position.y = 0.03;
        g.add(m);
      }
    }
    g.scale.setScalar(clamp(0.6 + prog * 8, 0.6, 1.4));
    return g;
  }

  switch (p.archetype) {
    case 'root': buildRoot(p, g, r, n, 1, stageIdx); break;
    case 'herb': buildHerb(p, g, r, n, 1, stageIdx); break;
    case 'vine':
    case 'bush': buildBushOrVine(p, g, r, n, 1, stageIdx, stageIdx >= 4); break;
    case 'grass': buildGrass(p, g, r, n, 1, stageIdx); break;
    case 'flower': buildFlower(p, g, r, n, 1, stageIdx); break;
    case 'fungus': buildFungus(p, g, r, n, 1, stageIdx); break;
    case 'woody': buildWoody(p, g, r, n, 1, stageIdx); break;
    default: buildRosette(p, g, r, n, 1, stageIdx);
  }

  /* Kranke oder vertrocknete Pflanzen hängen und verfärben sich */
  if (health < 0.96) {
    const droop = (1 - health) * 0.7;
    g.traverse(o => {
      if (!o.isMesh) return;
      o.rotation.x += droop * 0.4;
      if (o.material && o.material.color && o.material.userData?.leaf !== false) {
        o.material = o.material.clone();
        const c = o.material.color;
        c.lerp(new THREE.Color(0x8a7a3a), (1 - health) * 0.8);
      }
    });
    g.scale.y *= lerp(0.72, 1, health);
  }
  return g;
}

export function disposePlant(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
  });
}
