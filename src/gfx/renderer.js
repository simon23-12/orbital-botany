/*  Gemeinsamer Renderer, Post-Processing und Qualitätsstufen. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ───────────────────── Bloom ─────────────────────
   Absteigende Kette mit 13-Tap-Filter, aufsteigend mit Zeltfilter (Jimenez,
   „Next Generation Post Processing in Call of Duty", 2014). Der UnrealBloomPass
   schneidet seinen Gaußkern bei einer Standardabweichung ab — kleine, sehr
   helle Quellen wie die Sonne bekamen dadurch einen quadratischen Hof. */
const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee; uniform bool uFirst;
varying vec2 vUv;
vec3 tap(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
/* Karis-Mittel: dämpft einzelne überhelle Pixel, sonst flimmert der Hof */
float karis(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
vec3 prefilter(vec3 c){
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  return c * max(soft, br - uThreshold) / max(br, 1e-5);
}
void main(){
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0)), l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  vec3 o;
  if(uFirst){
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    o = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
      / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    o = prefilter(o);
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(o, 1.0);
}`;

const UP_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += (texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
     + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(s * (uWeight / 16.0), 1.0);
}`;

class SoftBloomPass extends Pass {
  constructor(strength = 0.6, radius = 0.6, threshold = 1.0, levels = 6) {
    super();
    this.strength = strength; this.radius = radius; this.threshold = threshold;
    this.levels = levels;
    this.needsSwap = false;
    this.mips = [];
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: threshold }, uKnee: { value: 0.35 }, uFirst: { value: true } },
      vertexShader: QUAD_VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
      vertexShader: QUAD_VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true,
    });
    this.quad = new FullScreenQuad(null);
  }

  setSize(w, h) {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = Math.max(1, Math.round(w / 2)), mh = Math.max(1, Math.round(h / 2));
    for (let i = 0; i < this.levels && mw >= 4 && mh >= 4; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, {
        type: THREE.HalfFloatType, depthBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      }));
      mw = Math.max(1, Math.round(mw / 2)); mh = Math.max(1, Math.round(mh / 2));
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.mips.length) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    const d = this.down.uniforms, u = this.up.uniforms;
    d.uThreshold.value = this.threshold;
    /* abwärts */
    let src = readBuffer.texture, sw = readBuffer.width, sh = readBuffer.height;
    this.quad.material = this.down;
    for (let i = 0; i < this.mips.length; i++) {
      d.tSrc.value = src; d.uTexel.value.set(1 / sw, 1 / sh); d.uFirst.value = i === 0;
      renderer.setRenderTarget(this.mips[i]);
      this.quad.render(renderer);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    /* aufwärts: jede Stufe addiert die gröbere darüber */
    this.quad.material = this.up;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i];
      u.tSrc.value = s.texture; u.uTexel.value.set(1 / s.width, 1 / s.height);
      u.uWeight.value = 0.35 + this.radius * 0.65;
      renderer.setRenderTarget(this.mips[i - 1]);
      this.quad.render(renderer);
    }
    /* auf das Bild legen */
    const top = this.mips[0];
    u.tSrc.value = top.texture; u.uTexel.value.set(1 / top.width, 1 / top.height);
    u.uWeight.value = this.strength * 0.5;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = auto;
  }

  dispose() { for (const m of this.mips) m.dispose(); this.down.dispose(); this.up.dispose(); this.quad.dispose(); }
}

/* ───────────────────── Abschluss ─────────────────────
   Tonwertabbildung, sRGB, Vignette, Korn und eine Spur chromatischer
   Aberration in einem einzigen Durchgang — vorher waren es zwei. */
const FINAL_FRAG = /* glsl */`
uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration, uExposure;
uniform int uCurve;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 RRTAndODTFit(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c){
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= uExposure / 0.6;
  return clamp(OUT * RRTAndODTFit(IN * c), 0.0, 1.0);
}
/* AgX (Sobotka): hält den Farbton auch in hellen Flächen — ACES kippt helles
   Blau ins Violette, Wolken und Dunst werden damit fliederfarben. */
vec3 agxCurve(vec3 x){
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c){
  const mat3 TO2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 FROM2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float MIN_EV = -12.47393, MAX_EV = 4.026069;
  c = INSET * (TO2020 * (c * uExposure));
  c = clamp((log2(max(c, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV), 0.0, 1.0);
  c = agxCurve(c);
  /* etwas mehr Kontrast und Farbe als die neutrale Grundkurve */
  c = pow(max(c, 0.0), vec3(1.12));
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.12);
  c = OUTSET * c;
  c = pow(max(c, 0.0), vec3(2.2));
  return clamp(FROM2020 * c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
void main(){
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 off = c * r2 * uAberration;
  vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
  col = uCurve == 1 ? agx(col) : toSRGB(aces(col));
  if(uCurve == 1) col = toSRGB(col);
  col *= mix(1.0, smoothstep(0.98, 0.25, r2 * 1.9), uVignette);
  col += (hash(vUv * 900.0 + fract(uTime) * 91.7) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

class FinalPass extends Pass {
  constructor({ vignette = 1, grain = 0.03, aberration = 0.0016, exposure = 1 } = {}) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: vignette },
        uGrain: { value: grain }, uAberration: { value: aberration }, uExposure: { value: exposure },
        uCurve: { value: 1 },
      },
      vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
    });
    this.uniforms = this.material.uniforms;
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

/**
 * Station bzw. Innenraum und Himmel in einem Durchgang, in dieser Reihenfolge:
 *   1. alles Undurchsichtige (Ebene 0) — schreibt die Tiefe
 *   2. der Himmel auf der fernen Ebene, mit Tiefentest: Die aufwendige Erde
 *      wird nur dort gerechnet, wo man tatsächlich hinaussieht
 *   3. alles Durchsichtige (Ebene 1) — Glas, Drahtgitter — über dem Himmel
 */
class StationPass extends Pass {
  constructor(scene, camera, sky) {
    super();
    this.scene = scene; this.camera = camera; this.sky = sky;
    this.needsSwap = false;
    this._frame = 0;
  }

  /* Ebenen zuordnen. Szenen ändern sich laufend (Pflanzen, Module), deshalb
     alle paar Bilder neu — das Durchlaufen kostet Bruchteile einer Millisekunde. */
  sortLayers() {
    this.scene.traverse(o => {
      if (o.isLight) { o.layers.enableAll(); return; }
      if (!o.material) return;
      const m = o.material;
      const transparent = Array.isArray(m) ? m.some(x => x.transparent) : m.transparent;
      o.layers.set(transparent ? 1 : 0);
    });
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this._frame++ % 12 === 0) this.sortLayers();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear(true, true, false);
    const mask = this.camera.layers.mask;
    renderer.shadowMap.needsUpdate = true;
    this.camera.layers.set(0);
    renderer.render(this.scene, this.camera);
    if (this.sky) renderer.render(this.sky.scene, this.sky.camera);
    this.camera.layers.set(1);
    renderer.render(this.scene, this.camera);
    this.camera.layers.mask = mask;
    renderer.autoClear = auto;
  }
}

/* Das Pixelverhältnis ist der mit Abstand teuerste Regler: Die Erde füllt oft
 * das ganze Bild, und jeder Schritt nach oben kostet quadratisch Füllrate.
 * Deshalb bleibt selbst „Ultra" unter dem vollen Retina-Wert. */
export const QUALITY = {
  low:    { pixelRatio: 1.0,  bloom: false, shadows: false, grade: false, msaa: 0, earth16k: false },
  medium: { pixelRatio: 1.2,  bloom: true,  shadows: false, grade: true,  msaa: 0, earth16k: false },
  high:   { pixelRatio: 1.4,  bloom: true,  shadows: true,  grade: true,  msaa: 4, earth16k: true },
  ultra:  { pixelRatio: 1.7,  bloom: true,  shadows: true,  grade: true,  msaa: 4, earth16k: true },
};

export function autoQuality() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth * dpr;
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 3 || cores <= 3 || w < 900) return 'low';
  // „Ultra" nur bei wirklich viel Leistung — ein Retina-Display allein genügt nicht
  if (mem >= 8 && cores >= 10 && w >= 3400) return 'ultra';
  if (mem >= 8 && cores >= 6) return 'high';
  return 'medium';
}

export class Stage {
  constructor(container, qualityName = 'auto') {
    this.container = container;
    this.qualityName = qualityName === 'auto' ? autoQuality() : qualityName;
    this.q = QUALITY[this.qualityName] || QUALITY.medium;

    const renderer = this.renderer = new THREE.WebGLRenderer({
      antialias: this.qualityName !== 'low', powerPreference: 'high-performance',
      stencil: false, depth: true, alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Tonwerte und sRGB übernimmt der FinalPass am Ende der Kette
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    // AgX legt mehr Spielraum in die Lichter als ACES — dafür eine Blende heller
    renderer.toneMappingExposure = 1.5;
    renderer.shadowMap.enabled = this.q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Schatten nur einmal je Bild — der StationPass zeichnet die Szene zweimal
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    this.clock = new THREE.Clock();
    this.scene = null; this.camera = null; this.composer = null;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  /** Szene & Kamera setzen und die Post-Kette neu aufbauen.
   *  opts.sky = {scene, camera} wird als eigener Durchgang davor gerendert —
   *  so bleibt die 600 km entfernte Erde von der Tiefengenauigkeit unberührt. */
  use(scene, camera, opts = {}) {
    this.scene = scene; this.camera = camera;
    const w = window.innerWidth, h = window.innerHeight;
    this.composer?.dispose?.();
    /* Mehrfachabtastung im Zwischenpuffer: Die Kanten von Station und
       Einrichtung sind sonst treppig. Auf Kachel-GPUs (Apple) kostet das wenig. */
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.msaa || 0 });
    const composer = this.composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    composer.setSize(w, h);
    composer.addPass(new StationPass(scene, camera, opts.sky || null));
    if (this.q.bloom && opts.bloom !== false) {
      const b = new SoftBloomPass(opts.bloomStrength ?? 0.62, opts.bloomRadius ?? 0.55, opts.bloomThreshold ?? 0.72);
      b.enabled = this.bloomOn !== false;
      composer.addPass(b);
      this.bloom = b;
    } else this.bloom = null;
    const grade = this.q.grade && opts.grade !== false;
    this.final = new FinalPass({
      vignette: grade ? opts.vignette ?? 1.0 : 0, grain: grade ? opts.grain ?? 0.03 : 0,
      aberration: grade ? opts.aberration ?? 0.0016 : 0, exposure: this.renderer.toneMappingExposure * (opts.exposure ?? 1),
    });
    composer.addPass(this.final);
    this.resize();
  }

  setBloom(on) { this.bloomOn = on; if (this.bloom) this.bloom.enabled = on; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    if (this.camera) {
      if (this.camera.isPerspectiveCamera) { this.camera.aspect = w / h; }
      this.camera.updateProjectionMatrix();
    }
  }

  render(dt) {
    if (!this.scene || !this.camera) return;
    if (this.final) this.final.uniforms.uTime.value += dt;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Alles freigeben, was an einem Objektbaum hängt. */
export function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      for (const k of Object.keys(mm)) {
        const v = mm[k];
        if (v && v.isTexture) v.dispose();
      }
      mm.dispose();
    }
  });
}
