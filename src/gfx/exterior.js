/*  Außenansicht — gleichzeitig das Hauptmenü.
 *  Die Station treibt vor der Erde; Module lassen sich anklicken.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildStation, LAYOUT } from './station.js';
import { MOD_BY_ID } from '../data/modules.js';
import { clamp, TAU } from '../core/util.js';

export class Exterior {
  constructor(sky) {
    this.sky = sky;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.2, 900);
    this.camera.position.set(24, 9, 26);

    this.sun = new THREE.DirectionalLight(0xfff4e2, 3.4);
    this.sun.position.set(40, 20, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 140;
    this.scene.add(this.sun, this.sun.target);

    /* Erdschein von unten — Albedo der Erde erhellt die Schattenseite deutlich */
    this.earthLight = new THREE.HemisphereLight(0x5fa8e8, 0x101018, 0.9);
    this.scene.add(this.earthLight);
    this.fill = new THREE.DirectionalLight(0x6ab0ff, 0.55);
    this.fill.position.set(0, -20, 6);
    this.scene.add(this.fill);
    this.ambient = new THREE.AmbientLight(0x2a3a4a, 0.35);
    this.scene.add(this.ambient);

    this.stationGroup = new THREE.Group();
    this.scene.add(this.stationGroup);
    this.station = null;
    this.raycaster = new THREE.Raycaster();
    this.hovered = null;
    this.drift = 0;
  }

  attachControls(dom) {
    const c = this.controls = new OrbitControls(this.camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.055;
    c.rotateSpeed = 0.42;
    c.zoomSpeed = 0.75;
    c.enablePan = false;
    c.minDistance = 16;
    c.maxDistance = 78;
    c.autoRotate = true;
    c.autoRotateSpeed = 0.28;
    c.target.set(0, 0, 0);
    c.addEventListener('start', () => { c.autoRotate = false; clearTimeout(this._ar); });
    c.addEventListener('end', () => { clearTimeout(this._ar); this._ar = setTimeout(() => { c.autoRotate = true; }, 9000); });
    return c;
  }

  build(st) {
    if (this.station) {
      this.stationGroup.remove(this.station.group);
      this.station.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.station = buildStation(st);
    this.stationGroup.add(this.station.group);
    this.pickables = this.station.pickables;
  }

  /** Modul unter dem Zeiger. */
  pick(nx, ny) {
    if (!this.pickables) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.moduleId) o = o.parent;
    return o?.userData.moduleId ? { moduleId: o.userData.moduleId, point: hit.point } : null;
  }

  setHover(moduleId) {
    if (this.hovered === moduleId) return;
    this.hovered = moduleId;
    if (!this.station) return;
    for (const [id, g] of Object.entries(this.station.moduleGroups)) {
      const on = id === moduleId;
      g.traverse(o => {
        if (!o.isMesh || !o.material || o.material.wireframe) return;
        if (o.material.emissive) {
          o.material.emissiveIntensity = on ? 0.35 : (o.userData.baseEmissive ?? o.material.emissiveIntensity);
        }
      });
      g.scale.setScalar(on ? 1.012 : 1);
    }
  }

  /** Sonnenrichtung im Stationskoordinatensystem. */
  setSun(dir, intensity) {
    this.sun.position.copy(dir).multiplyScalar(60);
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = 3.6 * intensity;
    this.earthLight.intensity = 0.55 + 0.5 * intensity;
    this.fill.intensity = 0.3 + 0.35 * intensity;
    if (this.station) this.station._sunLocal = dir;
  }

  update(dt, t, st) {
    this.controls?.update();
    this.station?.update(t, st);
    // langsames Treiben der Station um alle drei Achsen
    this.drift += dt;
    this.stationGroup.rotation.set(
      Math.sin(this.drift * 0.043) * 0.028,
      Math.sin(this.drift * 0.031 + 1.2) * 0.05,
      Math.sin(this.drift * 0.037 + 2.4) * 0.022,
    );

    /* Frachtkapsel: nähert sich in der letzten Stunde vor dem Andocken */
    const cap = this.station?.capsule;
    if (cap) {
      const now = Date.now();
      const order = (st.orders || []).filter(o => !o.done).sort((a, b) => a.arrivesAt - b.arrivesAt)[0];
      if (order) {
        const left = order.arrivesAt - now;
        if (left < 55 * 60_000) {
          const f = clamp(left / (55 * 60_000), 0, 1);
          cap.visible = true;
          cap.position.set(-16 - f * 46, f * 11, f * 26);
          cap.lookAt(-14, 0, 0);
          cap.children.find(c => c.material?.color?.getHex?.() === 0x8fd8ff)?.scale?.setScalar?.(0.6 + Math.sin(t * 12) * 0.25);
        } else cap.visible = false;
      } else {
        const recent = (st.orders || []).find(o => o.done && now - o.arrivesAt < 6 * 3600_000);
        cap.visible = !!recent;
        if (recent) { cap.position.set(-16.6, 0, 0); cap.rotation.set(0, 0, 0); }
      }
    }
  }

  focusModule(id) {
    const cfg = LAYOUT[id];
    if (!cfg || !this.controls) return;
    const p = new THREE.Vector3().fromArray(cfg.pos);
    this.controls.target.lerp(p, 0.6);
  }
}
