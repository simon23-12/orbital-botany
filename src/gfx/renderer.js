/*  Gemeinsamer Renderer, Post-Processing und Qualitätsstufen. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Leichter Film-Look: Vignette, Korn, ganz sanfte chromatische Aberration. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uVignette: { value: 1.0 }, uGrain: { value: 0.035 }, uAberration: { value: 0.0016 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      vec2 off = c * r2 * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float vig = smoothstep(0.98, 0.25, r2 * 1.9);
      col *= mix(1.0, vig, uVignette);
      float g = hash(vUv * 900.0 + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* Das Pixelverhältnis ist der mit Abstand teuerste Regler: Die Erde füllt oft
 * das ganze Bild, und jeder Schritt nach oben kostet quadratisch Füllrate.
 * Deshalb bleibt selbst „Ultra" unter dem vollen Retina-Wert. */
export const QUALITY = {
  low:    { pixelRatio: 1.0,  bloom: false, shadows: false, grade: false, aniso: 2,  segs: 48 },
  medium: { pixelRatio: 1.2,  bloom: true,  shadows: false, grade: true,  aniso: 4,  segs: 96 },
  high:   { pixelRatio: 1.4,  bloom: true,  shadows: true,  grade: true,  aniso: 8,  segs: 160 },
  ultra:  { pixelRatio: 1.7,  bloom: true,  shadows: true,  grade: true,  aniso: 16, segs: 224 },
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const composer = this.composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    composer.setSize(w, h);
    if (opts.sky) {
      const sp = new RenderPass(opts.sky.scene, opts.sky.camera);
      sp.clear = true;
      composer.addPass(sp);
    }
    const mp = new RenderPass(scene, camera);
    if (opts.sky) { mp.clear = false; mp.clearDepth = true; }
    composer.addPass(mp);
    if (this.q.bloom && opts.bloom !== false) {
      // Bloom ist ohnehin ein Weichzeichner — halbe Auflösung spart viel und
      // fällt im Ergebnis nicht auf
      const b = new UnrealBloomPass(new THREE.Vector2(w * 0.5, h * 0.5),
        opts.bloomStrength ?? 0.62, opts.bloomRadius ?? 0.55, opts.bloomThreshold ?? 0.72);
      composer.addPass(b);
      this.bloom = b;
    } else this.bloom = null;
    composer.addPass(new OutputPass());
    if (this.q.grade && opts.grade !== false) {
      const g = new ShaderPass(GradeShader);
      g.uniforms.uVignette.value = opts.vignette ?? 1.0;
      g.uniforms.uGrain.value = opts.grain ?? 0.03;
      g.uniforms.uAberration.value = opts.aberration ?? 0.0016;
      composer.addPass(g);
      this.grade = g;
    } else this.grade = null;
    this.resize();
  }

  setBloom(on) { if (this.bloom) this.bloom.enabled = on; }

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
    if (this.grade) this.grade.uniforms.uTime.value += dt;
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
