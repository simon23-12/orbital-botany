/*  Himmel: Sterne, Milchstraße, Sonne und die Erde.
 *
 *  Die Erde selbst rechnet earth.js pro Bildpunkt. Hier liegt alles drumherum:
 *  die eigene Himmelsszene mit eigener Kamera (sie übernimmt nur die Drehung
 *  der Spielkamera — der Himmel ist Hunderte Kilometer weit weg), die
 *  Ausrichtung der Erde nach der echten Bodenspur und das Laden der Karten.
 *
 *  Alle Himmelsobjekte liegen auf der fernen Ebene (z = w) und werden mit
 *  Tiefentest gezeichnet, nachdem Station bzw. Innenraum schon im Bild sind:
 *  Hinter Wänden kostet die Erde dann nichts.
 */
import * as THREE from 'three';
import { EARTH_ANGULAR, groundTrack, groundHeading } from '../core/orbit.js';
import {
  R_GROUND, buildAtmosphere, buildNoise3D, createPlanetMaterial, loadEarthSet,
  generateFallbackSet, monthTag, SUN_TRANSMITTANCE,
} from './earth.js';

/* ───────────────────── Sterne ───────────────────── */
export function createStars(count = 9000, radius = 4200) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // gleichverteilt, zur galaktischen Ebene hin verdichtet
    do { v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); }
    while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    const gal = Math.exp(-Math.pow(v.dot(GALAXY_POLE) * 3.2, 2));
    if (Math.random() > 0.35 + gal * 0.65) { i--; continue; }
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    // Farbe nach Spektraltyp: wenige blaue, viele weiße, ein Teil gelb bis rot
    const r = Math.random();
    const hue = r < 0.10 ? 0.61 : r < 0.24 ? 0.57 : r < 0.66 ? 0.13 : r < 0.88 ? 0.10 : 0.05;
    const sat = r < 0.24 ? 0.40 : r < 0.66 ? 0.05 : 0.38;
    c.setHSL(hue, sat, 0.75);
    col.set([c.r, c.g, c.b], i * 3);
    // Helligkeitsverteilung wie bei echten Sternen: viele schwache, wenige helle
    mag[i] = Math.pow(Math.random(), 4.2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aMag; varying vec3 vC; varying float vB;
      uniform float uTime, uPx, uGain;
      void main(){
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        /* Kein Funkeln: über der Atmosphäre flackern Sterne nicht */
        vB = (0.10 + aMag * 3.2) * uGain;
        vC = color;
        gl_PointSize = (1.6 + aMag * 2.6) * uPx;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vB;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float a = exp(-r2 * 5.0);
        if(a < 0.01) discard;
        gl_FragColor = vec4(vC * vB * a, 1.0);
      }`,
    vertexColors: true, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 1;
  pts.userData.mat = mat;
  return pts;
}

/* Lage der Milchstraße: grob wie am echten Himmel, aber fest im Stationssystem */
const GALAXY_POLE = new THREE.Vector3(0.35, 0.75, -0.56).normalize();

/** Milchstraße als schwacher Schleier mit Staubbändern — nur nachts zu sehen. */
function createMilkyWay(noise) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tNoise: { value: noise }, uPole: { value: GALAXY_POLE }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      precision highp sampler3D;
      uniform sampler3D tNoise; uniform vec3 uPole; uniform float uGain;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float b = dot(d, uPole);
        float band = exp(-b * b * 38.0) + 0.35 * exp(-b * b * 7.0);
        vec4 n1 = texture(tNoise, d * 1.3);
        vec4 n2 = texture(tNoise, d * 4.1 + 0.37);
        float clouds = smoothstep(0.25, 0.85, n1.b * 0.6 + n2.r * 0.4);
        float dust = smoothstep(0.45, 0.75, n2.b) * exp(-b * b * 90.0);
        float I = band * (0.35 + 0.9 * clouds) * (1.0 - 0.75 * dust);
        vec3 c = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.86, 0.66), clouds * 0.6);
        gl_FragColor = vec4(c * I * 0.012 * uGain, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = 0;
  m.userData.mat = mat;
  return m;
}

/* ───────────────────── Sonne ─────────────────────
   Echte Größe (0,53°), dazu ein schwacher Hof. Die Scheibe rechnet für jeden
   ihrer Bildpunkte die Transmission der Atmosphäre: Beim Aufgang taucht sie
   rot und gestaucht hinter dem Saum auf, und die Erde verdeckt sie Zeile für Zeile. */
function createSun(atmo, distance = 3600) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tTrans: { value: atmo.trans }, uCenter: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 p = projectionMatrix * viewMatrix * w;
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv; varying vec3 vWorld;
      ${SUN_TRANSMITTANCE}
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(0.047, 0.041, r);
        float limb = 1.0 - 0.45 * pow(clamp(r / 0.047, 0.0, 1.0), 2.0);   // Randverdunkelung
        float halo = pow(max(1.0 - r, 0.0), 12.0) * 0.9 + pow(max(1.0 - r, 0.0), 4.0) * 0.10;
        vec3 T = viewTransmittance(normalize(vWorld));
        /* Nicht heller als nötig: Der Bloom-Kern ist endlich, bei extremen
           Werten zeichnet er sonst die Kanten seines Rasters als Quadrat nach. */
        vec3 c = vec3(1.0, 0.97, 0.92) * disc * limb * 16.0 + vec3(1.0, 0.86, 0.66) * halo * 1.2;
        gl_FragColor = vec4(c * T, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(distance * 0.2, distance * 0.2), mat);
  sprite.frustumCulled = false;
  sprite.renderOrder = 10;
  const g = new THREE.Group();
  g.add(sprite);
  g.userData = { sprite, distance, mat };
  return g;
}

function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

/* ───────────────────── Geografie auf der Kugel ───────────────────── */
const UP = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;
/* Bei three.js beginnt die Kugel-UV bei phi = 0 an der Texturkante, die auf
 * einer Weltkarte dem 180. Längengrad entspricht — Greenwich liegt in der Mitte. */
const LON_OFFSET = Math.PI;

/** Einheitsvektor im Modellraum der Kugel für geografische Koordinaten. */
function geoToVec(lat, lon) {
  const theta = (90 - lat) * D2R;
  const phi = lon * D2R + LON_OFFSET;
  const st = Math.sin(theta);
  return new THREE.Vector3(-Math.cos(phi) * st, Math.cos(theta), Math.sin(phi) * st);
}
/** Tangente Richtung Nordpol am Punkt (lat, lon). */
function northTangent(lat, lon) {
  const theta = (90 - lat) * D2R;
  const phi = lon * D2R + LON_OFFSET;
  const ct = Math.cos(theta), st = Math.sin(theta);
  return new THREE.Vector3(Math.cos(phi) * ct, st, -Math.sin(phi) * ct).normalize();
}

/* ───────────────────── Der komplette Himmel ───────────────────── */
export class Sky {
  constructor(renderer, tex, { quality = 'high', aniso = 8 } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.aniso = aniso;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 14000);

    /* Maßstab der Himmelsszene: Erdradius = 900 Einheiten. Aus 600 km Höhe
       misst die Erde 132° am Himmel: sin(halber Winkel) = R/D. */
    const R = 900;
    this.earthRadius = R;
    this.earthDistance = R / Math.sin(EARTH_ANGULAR * 0.5 * D2R);
    this.kmPerUnit = R_GROUND / R;

    this.atmo = buildAtmosphere(renderer);
    this.noise = buildNoise3D(renderer);
    this.tex = tex;
    this.material = createPlanetMaterial(this.atmo, this.noise, tex, quality);
    this.uniforms = this.material.uniforms;

    this.planet = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.planet.frustumCulled = false;
    this.planet.renderOrder = 5;
    this.scene.add(this.planet);

    // Lage und Drehung der Erde; gezeichnet wird sie vom Vollbild-Shader
    this.earthGroup = new THREE.Group();
    this.earth = new THREE.Object3D();
    this.earthGroup.add(this.earth);
    this.earthGroup.position.set(0, -this.earthDistance, 0);
    this.scene.add(this.earthGroup);

    this.milky = createMilkyWay(this.noise);
    this.scene.add(this.milky);
    this.stars = createStars(9000, 4200);
    this.scene.add(this.stars);
    this.sun = createSun(this.atmo, 3600);
    this.scene.add(this.sun);

    this.sunDir = new THREE.Vector3(1, 0.2, 0.3).normalize();
    this._m3 = new THREE.Matrix3();
    this._monthCheck = 0;
  }

  /**
   * Lädt die Karten in Grundauflösung (8K) und baut den Himmel. Auf starken
   * Rechnern folgt danach upgrade() mit 16K im Hintergrund.
   */
  static async create(renderer, { quality = 'high', onProgress } = {}) {
    const aniso = Math.min(quality === 'low' ? 4 : 16, renderer.capabilities.getMaxAnisotropy());
    let tex;
    try {
      tex = await loadEarthSet('8k', { aniso, onProgress, detailRes: quality === 'low' ? '4k' : '8k' });
    } catch (e) {
      console.warn('[sky] Satellitenkarten nicht verfügbar, erzeuge Ersatzdaten', e);
      tex = generateFallbackSet(renderer);
    }
    return new Sky(renderer, tex, { quality, aniso });
  }

  /** 16K-Tagseite und -Wolken nachladen und nahtlos einsetzen. */
  async upgrade(onProgress) {
    if (this.tex.res !== '8k' || this._upgrading) return;
    if ((this.renderer.capabilities.maxTextureSize || 0) < 16384) return;
    this._upgrading = true;
    try {
      const hi = await loadEarthSet('16k', { aniso: this.aniso, onProgress, month: this.tex.month });
      this._swap(hi);
    } catch (e) {
      console.warn('[sky] 16K-Karten nicht geladen, bleibe bei 8K', e);
    }
    this._upgrading = false;
  }

  _swap(set) {
    const u = this.uniforms;
    for (const [key, uni] of [['day', 'tDay'], ['clouds', 'tClouds'], ['night', 'tNight'], ['terrain', 'tTerrain']]) {
      const old = this.tex[key];
      if (set[key] && old !== set[key]) { u[uni].value = set[key]; old?.dispose?.(); }
    }
    u.uTerrainSize.value.set(...set.terrainSize);
    this.tex = set;
  }

  /** Neuer Monat → passende Blue-Marble-Aufnahme nachladen. */
  async _checkMonth() {
    const m = monthTag();
    if (!this.tex.month || this.tex.month === m || this._upgrading) return;
    this._upgrading = true;
    try {
      const set = await loadEarthSet(this.tex.res, { aniso: this.aniso, month: m });
      this._swap(set);
    } catch (e) { console.warn('[sky] Monatskarte nicht geladen', e); }
    this._upgrading = false;
  }

  /** Sonnenrichtung (Einheitsvektor) setzen. */
  setSun(dir) {
    this.sunDir.copy(dir).normalize();
    this.uniforms.uSun.value.copy(this.sunDir);
    const d = this.sun.userData.distance;
    this.sun.position.copy(this.sunDir).multiplyScalar(d);
    this.sun.lookAt(0, 0, 0);
  }

  /** Sterne gehen unter, wenn die Tagseite im Bild ist — das Auge passt sich an. */
  setDaylight(f) {
    const g = 1 - 0.85 * f;
    this.stars.userData.mat.uniforms.uGain.value = g;
    this.milky.userData.mat.uniforms.uGain.value = Math.max(0, 1 - 1.2 * f);
  }

  /**
   * Richtet die Erde so aus, dass der Subsatellitenpunkt zur Station zeigt und
   * die Flugrichtung nach +X weist. Dadurch zieht unter der Station wirklich
   * die Geografie durch, die die Bodenspur ausrechnet.
   */
  setGroundTrack(t) {
    const { lat, lon } = groundTrack(t);
    const h = groundHeading(t) * D2R;
    const p = geoToVec(lat, lon);
    const q = new THREE.Quaternion().setFromUnitVectors(p, UP);
    const north = northTangent(lat, lon).applyQuaternion(q);
    const east = new THREE.Vector3().crossVectors(north, UP).normalize();
    const dir = north.multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const ang = Math.atan2(dir.z, dir.x);
    const roll = new THREE.Quaternion().setFromAxisAngle(UP, -ang);
    this.earth.quaternion.copy(roll).multiply(q);
    this.track = { lat, lon, heading: h / D2R };
  }

  update(dt, t, now = Date.now()) {
    const u = this.uniforms;
    u.uTime.value = t;
    this.setGroundTrack(now);
    /* Wolken ziehen mit rund 55 km/h nach Osten — jeden Tag liegen sie
       woanders. Die Rauschfelder wandern langsam mit und verändern ihre Form. */
    const days = now / 86_400_000;
    u.uCloudShift.value = (days * 12 / 360) % 1;
    const s = (now / 1000) % 1e6;
    u.uWind0.value.set((s * 2.1e-5) % 1, (s * 0.4e-5) % 1, (s * 1.3e-5) % 1);
    u.uWind1.value.set((s * 6.0e-5) % 1, (s * 1.1e-5) % 1, (s * 3.9e-5) % 1);
    u.uWind2.value.set((s * 1.9e-4) % 1, (s * 0.5e-4) % 1, (s * 1.2e-4) % 1);
    u.uWind3.value.set((s * 0.9e-5) % 1, 0, (s * 0.6e-5) % 1);
    this.stars.userData.mat.uniforms.uPx.value = this.renderer.getPixelRatio();
    this._monthCheck += dt;
    if (this._monthCheck > 60) { this._monthCheck = 0; this._checkMonth(); }
  }

  /** Kamera übernimmt nur die Drehung — der Himmel ist Hunderte Kilometer weit weg. */
  syncTo(camera) {
    const cam = this.camera;
    cam.quaternion.copy(camera.quaternion);
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.earthGroup.updateMatrixWorld(true);
    const u = this.uniforms;
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    u.uCenter.value.setFromMatrixPosition(this.earthGroup.matrixWorld).multiplyScalar(this.kmPerUnit);
    this.sun.userData.mat.uniforms.uCenter.value.copy(u.uCenter.value);
    u.uToLocal.value.setFromMatrix4(this.earth.matrixWorld).transpose();
  }
}
