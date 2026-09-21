/*  Himmel: Sterne, Sonne und eine prozedurale Erde.
 *
 *  Die Erde bekommt keine Fototextur, sondern wird beim Start einmalig auf der
 *  Grafikkarte erzeugt: Kontinente aus verzerrtem Simplex-Rauschen, Klimazonen
 *  nach Breitengrad, Städte an den Küsten, Wolkenbänder an der innertropischen
 *  Konvergenzzone und in den Westwindzonen.
 *
 *  Der Himmel liegt in einer eigenen Szene mit eigener Kamera: Er ist 600 km
 *  entfernt, also verschiebt er sich nicht, wenn man um die Station herumfliegt.
 */
import * as THREE from 'three';
import { EARTH_ANGULAR, groundTrack, groundHeading } from '../core/orbit.js';

/* ───────────────────── GLSL: Simplex-Rauschen (Ashima/Gustavson) ───────────────────── */
const NOISE = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p, int oct, float lac, float gain){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i = 0; i < 8; i++){
    if(i >= oct) break;
    s += a * snoise(p); n += a; p *= lac; a *= gain;
  }
  return s / max(n, 1e-4);
}
float ridge(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i = 0; i < 6; i++){
    if(i >= oct) break;
    s += a * (1.0 - abs(snoise(p))); n += a; p *= 2.07; a *= 0.5;
  }
  return s / max(n, 1e-4);
}`;

/* ───────────────────── Erzeugung der Erdtexturen ───────────────────── */
const GEN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uMode;      // 0 = Tag+Ozeanmaske, 1 = Nachtlichter, 2 = Wolken
uniform float uSeed;
${NOISE}

/* Äquirektangular → Richtungsvektor (keine Polverzerrung, keine Naht) */
vec3 dirFromUv(vec2 uv){
  float lon = (uv.x * 2.0 - 1.0) * 3.14159265;
  float lat = (uv.y - 0.5) * 3.14159265;
  float cl = cos(lat);
  return vec3(cl * sin(lon), sin(lat), cl * cos(lon));
}

float landMask(vec3 p, out float elev, out float coast){
  vec3 w = p * 1.05 + uSeed;
  // Domänenverzerrung: erzeugt Landmassen mit gebogenen Küsten statt Klecksen
  vec3 q = vec3(fbm(w * 1.6, 4, 2.1, 0.5), fbm(w * 1.6 + 5.2, 4, 2.1, 0.5), fbm(w * 1.6 + 9.7, 4, 2.1, 0.5));
  float base = fbm(w + q * 0.85, 6, 2.05, 0.52);
  // Landanteil ~30 %
  float m = smoothstep(0.02, 0.14, base);
  coast = 1.0 - smoothstep(0.0, 0.10, abs(base - 0.02));
  float mount = ridge(p * 4.2 + uSeed * 2.0, 5);
  elev = clamp(base * 1.4 + mount * 0.55 * smoothstep(0.05, 0.4, base), 0.0, 1.6);
  return m;
}

void main(){
  vec3 p = dirFromUv(vUv);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float alat = abs(lat);
  float elev, coast;
  float land = landMask(p, elev, coast);

  if(uMode == 0){
    /* ── Ozean ── */
    float deep = smoothstep(0.0, 0.35, 0.16 - elev);
    vec3 oceanDeep  = vec3(0.005, 0.018, 0.055);   // Albedo offener Ozean ≈ 4 %
    vec3 oceanShelf = vec3(0.020, 0.082, 0.132);
    vec3 ocean = mix(oceanShelf, oceanDeep, deep);
    ocean += snoise(p * 26.0) * 0.003;

    /* ── Klimazonen nach Breitengrad ── */
    vec3 tropic = vec3(0.030, 0.072, 0.020);       // Regenwald ≈ 9 %
    vec3 temper = vec3(0.062, 0.098, 0.034);
    vec3 desert = vec3(0.300, 0.228, 0.120);       // Sand ≈ 30 %
    vec3 taiga  = vec3(0.026, 0.048, 0.028);
    vec3 tundra = vec3(0.130, 0.128, 0.098);

    float d = alat / 1.5708;
    float aridBand = exp(-pow((d - 0.27) / 0.095, 2.0));   // Subtropische Hochdruckgürtel
    float arid = clamp(aridBand * (0.35 + 0.85 * fbm(p * 3.1 + 31.0, 4, 2.0, 0.5)), 0.0, 1.0);
    // Kontinentalität: weiter im Landesinneren trockener
    arid = clamp(arid + smoothstep(0.45, 0.98, land) * 0.10 * (1.0 - coast), 0.0, 1.0);

    vec3 g = mix(tropic, temper, smoothstep(0.10, 0.42, d));
    g = mix(g, taiga, smoothstep(0.42, 0.68, d));
    g = mix(g, tundra, smoothstep(0.66, 0.84, d));
    g = mix(g, desert, arid * 0.72);
    g *= 0.86 + 0.28 * fbm(p * 9.0 + 4.0, 4, 2.2, 0.5);
    // Gebirge: kahl und hell
    float rock = smoothstep(0.92, 1.35, elev);
    g = mix(g, vec3(0.115, 0.102, 0.090), rock * 0.75);
    // Schneegrenze
    float snow = smoothstep(0.865, 0.965, d) + smoothstep(1.24, 1.55, elev);
    snow = clamp(snow * (0.7 + 0.5 * fbm(p * 7.0 + 11.0, 3, 2.0, 0.5)), 0.0, 1.0);
    g = mix(g, vec3(0.60, 0.65, 0.72), snow);       // Schnee ≈ 70 %

    /* Meereis */
    float ice = smoothstep(0.905, 0.985, d) * (0.6 + 0.6 * fbm(p * 5.0 + 17.0, 3, 2.0, 0.5));
    vec3 col = mix(ocean, g, smoothstep(0.35, 0.62, land));
    col = mix(col, vec3(0.52, 0.58, 0.66), clamp(ice * (1.0 - land), 0.0, 1.0));
    float oceanMask = (1.0 - smoothstep(0.35, 0.62, land)) * (1.0 - clamp(ice, 0.0, 1.0));
    gl_FragColor = vec4(col, oceanMask);

  } else if(uMode == 1){
    /* ── Nachtlichter: Land, tiefe Lagen, küstennah, mit Ballungsräumen ── */
    float l = smoothstep(0.42, 0.62, land);
    float hab = exp(-pow((alat - 0.72) / 0.55, 2.0));          // Bevölkerungsschwerpunkt mittlere Breiten
    float coastal = 0.35 + 0.65 * coast;
    float cl = fbm(p * 22.0 + 60.0, 5, 2.2, 0.52);
    float cities = smoothstep(0.24, 0.62, cl) * l * hab * coastal;
    float cores = pow(smoothstep(0.45, 0.78, cl), 3.0) * l * hab;
    float lights = clamp(cities * 0.55 + cores * 1.5, 0.0, 1.8);
    lights *= 1.0 - smoothstep(0.98, 1.35, elev);               // nicht im Hochgebirge
    gl_FragColor = vec4(vec3(lights), 1.0);

  } else {
    /* ── Kombinationskarte im selben Format wie die NASA-Daten:
          R = Relief, G = Rauheit (Wasser glatt), B = Wolken ── */
    float d = alat / 1.5708;
    float itcz = exp(-pow((d - 0.04) / 0.10, 2.0)) * 1.15;
    float storm = exp(-pow((d - 0.60) / 0.19, 2.0)) * 1.05;
    float polar = smoothstep(0.80, 1.0, d) * 0.55;
    float band = clamp(itcz + storm + polar + 0.20, 0.0, 1.6);
    vec3 w = p * 2.1 + 77.0;
    vec3 q = vec3(fbm(w * 2.0, 3, 2.1, 0.5), fbm(w * 2.0 + 3.1, 3, 2.1, 0.5), fbm(w * 2.0 + 7.3, 3, 2.1, 0.5));
    float c = fbm(w * 1.3 + q * 1.4, 6, 2.25, 0.55);
    float wisp = fbm(p * 12.0 + q * 2.0 + 41.0, 4, 2.4, 0.5);
    float clouds = smoothstep(0.16, 0.56, c * band + wisp * 0.20 * band);
    float relief = clamp(elev * 0.62, 0.0, 1.0);
    float rough = mix(0.16, 0.92, smoothstep(0.35, 0.62, land));
    gl_FragColor = vec4(relief, rough, clouds, 1.0);
  }
}`;

function renderToTexture(renderer, size, mode, seed) {
  const rt = new THREE.WebGLRenderTarget(size, size / 2, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, depthBuffer: false,
    // Farbkarten in sRGB, Datenkarten linear
    colorSpace: mode === 2 ? THREE.NoColorSpace : THREE.SRGBColorSpace,
  });
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMode: { value: mode }, uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: GEN_FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose(); mat.dispose();
  return rt.texture;
}

/** Erzeugt die kachelbare Detailkarte einmalig auf der Grafikkarte. */
export function generateDetailTexture(renderer, size = 1024) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, depthBuffer: false, colorSpace: THREE.NoColorSpace,
  });
  rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: DETAIL_FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose(); mat.dispose();
  return rt.texture;
}

/** Notfallvariante, falls die Bilddaten nicht geladen werden können. */
export function generateEarthTextures(renderer, size = 2048, seed = 3.7) {
  return {
    day: renderToTexture(renderer, size, 0, seed),
    night: renderToTexture(renderer, Math.min(size, 1024), 1, seed),
    brc: renderToTexture(renderer, Math.min(size, 2048), 2, seed),
    daySize: [size, size / 2],
    procedural: true,
  };
}

/**
 * Lädt die Satellitenkarten der Erde.
 *   earth_day    — Blue-Marble-Mosaik der NASA
 *   earth_night  — Nachtlichter (VIIRS / Black Marble)
 *   earth_brc    — R Relief, G Rauheit, B Wolken
 */
export function loadEarthTextures(base = './assets/planet/', onProgress, hires = false) {
  const loader = new THREE.TextureLoader();
  const files = [
    ['day', hires ? 'earth_day_8192.jpg' : 'earth_day_4096.jpg', THREE.SRGBColorSpace],
    ['night', 'earth_night_4096.jpg', THREE.SRGBColorSpace],
    ['brc', 'earth_bump_roughness_clouds_4096.jpg', THREE.NoColorSpace],
  ];
  let done = 0;
  return Promise.all(files.map(([key, file, cs]) => new Promise((res, rej) => {
    loader.load(base + file, tex => {
      tex.colorSpace = cs;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      onProgress?.(++done / files.length, key);
      res([key, tex]);
    }, undefined, rej);
  }))).then(pairs => {
    const out = Object.fromEntries(pairs);
    out.daySize = hires ? [8192, 4096] : [4096, 2048];
    return out;
  });
}

/* Kachelbares Wert-Rauschen für die Detailkarte. Simplex ließe sich in 2D nicht
 * sauber kacheln; hier genügt Wert-Rauschen mit periodischem Gitter. */
const TILED = /* glsl */`
float hash21(vec2 p, float per){
  p = mod(p, vec2(per));
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p, float per){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i, per),              hash21(i + vec2(1.0, 0.0), per), f.x),
             mix(hash21(i + vec2(0.0, 1.0), per), hash21(i + vec2(1.0, 1.0), per), f.x), f.y);
}
float tfbm(vec2 p, float per, int oct){
  float a = 0.5, s = 0.0, n = 0.0, q = per;
  for(int i = 0; i < 8; i++){
    if(i >= oct) break;
    s += a * vnoise(p, q); n += a; p *= 2.0; q *= 2.0; a *= 0.5;
  }
  return s / n;
}
float tridge(vec2 p, float per, int oct){
  float a = 0.5, s = 0.0, n = 0.0, q = per;
  for(int i = 0; i < 6; i++){
    if(i >= oct) break;
    s += a * (1.0 - abs(vnoise(p, q) * 2.0 - 1.0)); n += a; p *= 2.0; q *= 2.0; a *= 0.5;
  }
  return s / n;
}`;

/* Detailkarte: R Gratmuster, G Körnung, B Wolkenstruktur, A Ortschaften.
 * Vier Rauschtypen in einem Bild — im Erdshader kosten sie dann zwei Abgriffe
 * statt knapp dreißig Rauschauswertungen je Bildpunkt. */
const DETAIL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${TILED}
void main(){
  const float P = 16.0;                       // Gitterperiode der Kachel
  vec2 p = vUv * P;
  vec2 warp = vec2(tfbm(p * 0.9, P * 0.9, 3), tfbm(p * 0.9 + 5.3, P * 0.9, 3)) - 0.5;
  float ridges = tridge(p + warp * 2.2, P, 5);
  float fine   = tfbm(p * 3.1, P * 3.0, 4);
  vec2 cwarp = vec2(tfbm(p * 0.6, P * 0.6, 3), tfbm(p * 0.6 + 2.7, P * 0.6, 3)) - 0.5;
  float cloud = tfbm(p * 1.4 + cwarp * 3.0, P, 4);
  float towns = tfbm(p * 5.0, P * 5.0, 3);
  gl_FragColor = vec4(ridges, fine, cloud, towns);
}`;

/* Kubische Vergrößerung (Catmull-Rom, 9 bilineare Abgriffe).
 * Aus 600 km ist jedes Texel rund sechsfach vergrößert — die eingebaute
 * bilineare Filterung macht daraus Milchglas, die kubische hält die Kanten. */
const BICUBIC = /* glsl */`
vec3 texCubic(sampler2D tex, vec2 uv, vec2 texSize){
  vec2 p = uv * texSize - 0.5;
  vec2 f = fract(p);
  vec2 t1 = floor(p) + 0.5;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 p0 = (t1 - 1.0) / texSize;
  vec2 p3 = (t1 + 2.0) / texSize;
  vec2 p12 = (t1 + o12) / texSize;
  vec3 c = vec3(0.0);
  c += texture2D(tex, vec2(p0.x,  p0.y )).rgb * (w0.x  * w0.y);
  c += texture2D(tex, vec2(p12.x, p0.y )).rgb * (w12.x * w0.y);
  c += texture2D(tex, vec2(p3.x,  p0.y )).rgb * (w3.x  * w0.y);
  c += texture2D(tex, vec2(p0.x,  p12.y)).rgb * (w0.x  * w12.y);
  c += texture2D(tex, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y);
  c += texture2D(tex, vec2(p3.x,  p12.y)).rgb * (w3.x  * w12.y);
  c += texture2D(tex, vec2(p0.x,  p3.y )).rgb * (w0.x  * w3.y);
  c += texture2D(tex, vec2(p12.x, p3.y )).rgb * (w12.x * w3.y);
  c += texture2D(tex, vec2(p3.x,  p3.y )).rgb * (w3.x  * w3.y);
  return max(c, vec3(0.0));
}`;

/* ───────────────────── Erdmaterial ───────────────────── */
const EARTH_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vPos; varying vec3 vObj;
void main(){
  vUv = uv;
  vObj = normalize(position);
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const EARTH_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDay, tNight, tBRC, tDetail;
uniform vec3 uSun, uCam;
uniform float uTime, uDrift, uBump, uDetail;
uniform vec2 uDaySize;
varying vec2 vUv; varying vec3 vN; varying vec3 vPos; varying vec3 vObj;
${BICUBIC}

const vec2 TEXEL = vec2(1.0 / 4096.0, 1.0 / 2048.0);
/* Wiederholung der Detailkarte: eine Kachel entspricht gut 200 km Boden */
const vec2 DREP = vec2(200.0, 100.0);

void main(){
  vec3 N = normalize(vN);
  vec3 L = normalize(uSun);
  vec3 V = normalize(uCam - vPos);

  /* Tangentenraum der Kugel — für Reliefschattierung und Wolkenschatten */
  vec3 up = abs(N.y) > 0.995 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);

  /* R = Relief, G = Rauheit, B = Wolken */
  vec3 brc = texture2D(tBRC, vUv).rgb;
  float rough = brc.g;
  float wet = 1.0 - smoothstep(0.34, 0.60, rough);
  float land = 1.0 - wet;

  /* Großrelief aus der Karte: Gebirge werfen im Streiflicht Schatten */
  float hx = texture2D(tBRC, vUv + vec2(TEXEL.x, 0.0)).r - texture2D(tBRC, vUv - vec2(TEXEL.x, 0.0)).r;
  float hy = texture2D(tBRC, vUv + vec2(0.0, TEXEL.y)).r - texture2D(tBRC, vUv - vec2(0.0, TEXEL.y)).r;
  vec3 Nb = normalize(N + (T * hx + B * hy) * uBump);

#ifdef CUBIC_DAY
  vec3 albedo = texCubic(tDay, vUv, uDaySize);
#else
  vec3 albedo = texture2D(tDay, vUv).rgb;
#endif

  /* Feinstruktur aus der vorberechneten Detailkarte. Aus 600 km blickt man auf
     wenige hundert Kilometer Boden; selbst 8192 Texel sind dann noch rund
     sechsfach vergrößert. Drei Abgriffe in verschiedenen Maßstäben ergänzen
     Gratmuster, Körnung, Wolkenfasern und Ortschaften. */
  vec2 duv = vUv * DREP;
  vec4 s1 = texture2D(tDetail, duv * 0.55);
  vec4 s2 = texture2D(tDetail, duv * 2.30);
  vec4 s3 = texture2D(tDetail, duv * 11.0);
  float ridges = (s1.r * 0.62 + s2.r * 0.38 - 0.5) * 2.0;
  float fine   = (s3.g - 0.5) * 2.0;
  float cloudD = (s1.b * 0.55 + s2.b * 0.45 - 0.5) * 2.0;

  float relief = (ridges * 0.46 + fine * 0.30) * land * uDetail;
  albedo *= 1.0 + relief * 0.44;
  /* Täler kühler und gesättigter, Grate heller — das gibt dem Muster Tiefe */
  albedo = mix(albedo, albedo * vec3(0.93, 0.98, 1.05), clamp(-relief, 0.0, 1.0) * 0.55);
  albedo *= 1.0 + fine * 0.05 * wet * uDetail;
  albedo = max(albedo, vec3(0.0));
  /* und in die Normale, sonst bliebe es ein flacher Aufdruck */
  Nb = normalize(Nb + (T * relief * 1.7 + B * (fine - relief) * 0.9) * land * 0.5);

  float ndl = dot(Nb, L);
  float lambert = clamp(ndl, 0.0, 1.0);
  /* Weicher Terminator: die Atmosphäre streut Licht über die Tag-Nacht-Grenze */
  float soft = smoothstep(-0.16, 0.20, dot(N, L));

  /* Wolken driften langsam gegen die Oberfläche */
  vec2 cuv = vec2(fract(vUv.x + uDrift), vUv.y);
  float clouds = texture2D(tBRC, cuv).b;
  float edge = smoothstep(0.02, 0.45, clouds) * (1.0 - smoothstep(0.80, 1.0, clouds));
  clouds = clamp(clouds + cloudD * 0.40 * edge * uDetail, 0.0, 1.0);

  /* Wolkenschatten: die Schicht liegt höher, der Schatten fällt versetzt */
  vec3 Lt = vec3(dot(L, T), dot(L, B), dot(L, N));
  vec2 off = -Lt.xy / max(abs(Lt.z), 0.30) * 0.0019;
  float shade = texture2D(tBRC, vec2(fract(cuv.x + off.x), clamp(cuv.y + off.y, 0.002, 0.998))).b;
  float shadow = 1.0 - smoothstep(0.18, 0.72, shade) * 0.52;

  vec3 col = albedo * lambert * shadow * 1.55;
  col += albedo * soft * 0.06;

  /* Sonnenglanz auf dem Wasser — enger und heller als auf Land */
  vec3 H = normalize(L + V);
  float nh = clamp(dot(Nb, H), 0.0, 1.0);
  col += vec3(1.0, 0.96, 0.88) * pow(nh, mix(40.0, 1100.0, wet)) * wet * soft * shadow * 2.2;
  col += vec3(0.35, 0.55, 0.85) * pow(nh, 18.0) * wet * soft * 0.10;

  /* Nachtseite: Städte, von Wolken verdeckt. Ballungsräume sind bei dieser
     Vergrößerung nur Flecken — die Detailkarte löst sie in Ortschaften auf. */
  float night = smoothstep(0.06, -0.20, ndl);
  float flicker = 0.94 + 0.06 * sin(uTime * 0.7 + vUv.x * 340.0) * sin(uTime * 0.29 + vUv.y * 220.0);
  vec3 lights = texture2D(tNight, vUv).rgb;
  lights *= mix(1.0, 0.62 + 0.86 * smoothstep(0.30, 0.72, s3.a), uDetail);
  col += lights * night * 0.85 * flicker * (1.0 - smoothstep(0.1, 0.7, clouds) * 0.75);
  col += albedo * night * 0.010;

  /* Wolken darüberlegen. Wolkenalbedo liegt bei rund 70 % — hell, nicht blendend. */
  float cl = smoothstep(0.12, 0.82, clouds);
  vec3 cloudCol = mix(vec3(0.020, 0.028, 0.045), vec3(1.04, 1.05, 1.10), lambert);
  /* Wolkentürme beschatten sich selbst — das gibt ihnen Volumen */
  cloudCol *= 1.0 + (cloudD * 0.26 + 0.18 * smoothstep(0.5, 1.0, clouds)) * uDetail;
  cloudCol = mix(cloudCol, vec3(1.35, 1.02, 0.74), pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4) * 0.35 * soft);
  col = mix(col, cloudCol, cl * 0.93);

  /* Rayleigh-Streuung: zur Silhouette hin blauer und aufgehellt */
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.8);
  col = mix(col, col * vec3(0.45, 0.72, 1.32) + vec3(0.010, 0.030, 0.072), rim * 0.68 * soft);

  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSun, uCam;
varying vec3 vN; varying vec3 vPos;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vPos);
  vec3 L = normalize(uSun);
  /* Die Schale wird von innen gesehen: der Rand ist die dickste Luftsäule */
  float rim = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 3.0);
  float lit = smoothstep(-0.38, 0.30, dot(N, L));
  /* Vorwärtsstreuung — beim Sonnenaufgang wird der Saum orange */
  float fwd = pow(clamp(dot(V, -L), 0.0, 1.0), 7.0);
  float graze = smoothstep(0.35, 0.0, abs(dot(N, L)));      // Terminatorband
  vec3 blue = vec3(0.26, 0.52, 1.0);
  vec3 warm = vec3(1.0, 0.45, 0.22);
  vec3 c = mix(blue, warm, clamp(fwd * 0.8 + graze * 0.55, 0.0, 1.0));
  float a = rim * lit * 0.55;
  gl_FragColor = vec4(c * (0.34 + fwd * 1.6 + graze * 0.5), a);
}`;

/* ───────────────────── Sterne ───────────────────── */
export function createStars(count = 7000, radius = 4200) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Richtung gleichverteilt, aber zur galaktischen Ebene hin verdichtet
    let v;
    do {
      v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    const galactic = Math.exp(-Math.pow((v.y * 0.75 + v.x * 0.35) * 2.6, 2));
    if (Math.random() > 0.30 + galactic * 0.70) { i--; continue; }
    pos[i * 3] = v.x * radius; pos[i * 3 + 1] = v.y * radius; pos[i * 3 + 2] = v.z * radius;
    // Farbe nach Spektraltyp
    const r = Math.random();
    const hue = r < 0.08 ? 0.60 : r < 0.20 ? 0.56 : r < 0.62 ? 0.12 : r < 0.86 ? 0.09 : 0.045;
    const sat = r < 0.20 ? 0.45 : r < 0.62 ? 0.06 : 0.32;
    c.setHSL(hue, sat, 0.72 + Math.random() * 0.28);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    const m = Math.pow(Math.random(), 3.1);
    siz[i] = 1.6 + m * 15.0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: window.innerHeight } },
    vertexShader: /* glsl */`
      attribute float aSize; varying vec3 vC; varying float vTw;
      uniform float uTime, uScale;
      void main(){
        vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vTw = 0.78 + 0.22 * sin(uTime * 1.7 + position.x * 0.07 + position.y * 0.031);
        gl_PointSize = aSize * (uScale / 900.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vTw;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        float core = smoothstep(1.0, 0.0, r);
        float glow = pow(smoothstep(1.0, 0.0, r), 3.5);
        float a = core * 0.55 + glow * 0.9;
        if(a < 0.008) discard;
        gl_FragColor = vec4(vC * vTw, a);
      }`,
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.mat = mat;
  return pts;
}

/* ───────────────────── Sonne ───────────────────── */
export function createSun(distance = 3600) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uFade;
      varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(0.116, 0.088, r);
        float bloom = pow(smoothstep(1.0, 0.0, r), 9.0) * 0.85;
        float halo = pow(smoothstep(1.0, 0.0, r), 2.4) * 0.22;
        vec3 c = mix(vec3(1.0, 0.88, 0.70), vec3(1.0), disc);
        float a = clamp(disc * 1.6 + bloom + halo, 0.0, 2.0) * uFade;
        if(a < 0.004) discard;
        gl_FragColor = vec4(c * (0.7 + disc * 2.2), a);
      }`,
    // Tiefentest bleibt an: Die Erde verdeckt die Sonne, so entsteht der
    // Sonnenaufgang über dem Horizont von selbst.
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(distance * 0.2, distance * 0.2), mat);
  sprite.renderOrder = 6;
  g.add(sprite);
  g.userData = { sprite, distance, mat };
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
  const theta = (90 - lat) * D2R;             // Kolatitude, 0 am Nordpol
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
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} tex  {day, night, brc} — geladen oder prozedural erzeugt
   * @param {number} segs Kugelsegmente je nach Qualitätsstufe
   */
  constructor(renderer, tex, segs = 128, opts = {}) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 14000);
    this.tex = tex;

    /* Aus 600 km Höhe misst die Erde 132° am Himmel: sin(halber Winkel) = R/D. */
    const R = 900;
    const D = R / Math.sin(EARTH_ANGULAR * 0.5 * Math.PI / 180);
    this.earthRadius = R; this.earthDistance = D;

    this.uniforms = {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uDrift: { value: 0 },
      uBump: { value: tex.procedural ? 9.0 : 14.0 },
      uDetail: { value: 1 },
      uDaySize: { value: new THREE.Vector2(...(tex.daySize || [4096, 2048])) },
    };
    this.detail = generateDetailTexture(renderer, opts.detailSize || 1024);

    const earthMat = new THREE.ShaderMaterial({
      defines: opts.cubic ? { CUBIC_DAY: '' } : {},
      uniforms: {
        tDay: { value: tex.day }, tNight: { value: tex.night }, tBRC: { value: tex.brc },
        tDetail: { value: this.detail },
        uSun: this.uniforms.uSun, uCam: this.uniforms.uCam, uTime: this.uniforms.uTime,
        uDrift: this.uniforms.uDrift, uBump: this.uniforms.uBump, uDetail: this.uniforms.uDetail,
        uDaySize: this.uniforms.uDaySize,
      },
      vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R, segs, segs / 2), earthMat);
    this.earth.renderOrder = 0;

    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { uSun: this.uniforms.uSun, uCam: this.uniforms.uCam },
      vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.042, 96, 48), atmoMat);
    this.atmo.renderOrder = 2;

    this.earthGroup = new THREE.Group();
    this.earthGroup.add(this.earth, this.atmo);
    this.earthGroup.position.set(0, -D, 0);
    this.scene.add(this.earthGroup);

    this.stars = createStars(7000, 5200);
    this.scene.add(this.stars);

    this.sun = createSun(3600);
    this.scene.add(this.sun);

    this.sunDir = new THREE.Vector3(1, 0.2, 0.3).normalize();
    this.spin = 0;
  }

  /**
   * Erzeugt den Himmel; nutzt die Satellitenkarten, notfalls prozedurale Daten.
   * @param {{hires?:boolean, cubic?:boolean}} opts
   */
  static async create(renderer, segs = 128, texSize = 2048, onProgress, opts = {}) {
    let tex;
    const maxTex = renderer.capabilities.maxTextureSize || 4096;
    const hires = !!opts.hires && maxTex >= 8192;
    try {
      tex = await loadEarthTextures('./assets/planet/', onProgress, hires);
      const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
      for (const t of Object.values(tex)) if (t?.isTexture) t.anisotropy = aniso;
    } catch (e) {
      console.warn('[sky] Satellitenkarten nicht verfügbar, erzeuge Ersatzdaten', e);
      tex = generateEarthTextures(renderer, texSize);
    }
    return new Sky(renderer, tex, segs, opts);
  }

  /** Sonnenrichtung (Einheitsvektor) setzen. */
  setSun(dir) {
    this.sunDir.copy(dir).normalize();
    this.uniforms.uSun.value.copy(this.sunDir).multiplyScalar(4000);
    const d = this.sun.userData.distance;
    this.sun.position.copy(this.sunDir).multiplyScalar(d);
    this.sun.lookAt(0, 0, 0);
  }

  /**
   * Richtet die Erde so aus, dass der Subsatellitenpunkt zur Station zeigt und
   * die Flugrichtung nach +X weist. Dadurch zieht unter der Station wirklich
   * die Geografie durch, die die Bodenspur ausrechnet.
   */
  setGroundTrack(t) {
    const { lat, lon } = groundTrack(t);
    const h = groundHeading(t) * Math.PI / 180;
    const p = geoToVec(lat, lon);
    const q = new THREE.Quaternion().setFromUnitVectors(p, UP);

    // Nordrichtung am Subsatellitenpunkt, nach der Drehung
    const north = northTangent(lat, lon).applyQuaternion(q);
    const east = new THREE.Vector3().crossVectors(north, UP).normalize();
    const dir = north.multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const ang = Math.atan2(dir.z, dir.x);
    const roll = new THREE.Quaternion().setFromAxisAngle(UP, -ang);

    this.earth.quaternion.copy(roll).multiply(q);
    this.atmo.quaternion.copy(this.earth.quaternion);
    this.track = { lat, lon, heading: h * 180 / Math.PI };
  }

  update(dt, t, now) {
    this.uniforms.uTime.value = t;
    this.uniforms.uDrift.value += dt * 0.00016;     // Wolken ziehen gegen die Oberfläche
    this.setGroundTrack(now ?? Date.now());
    if (this.stars.userData.mat) {
      this.stars.userData.mat.uniforms.uTime.value = t;
      this.stars.userData.mat.uniforms.uScale.value = window.innerHeight;
    }
  }

  /** Kamera übernimmt nur die Drehung — der Himmel ist Hunderte Kilometer weit weg. */
  syncTo(camera) {
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.fov = camera.fov;
    this.camera.aspect = camera.aspect;
    this.camera.updateProjectionMatrix();
    this.uniforms.uCam.value.set(0, 0, 0);
  }

  setAttitude(quat) { this.earthGroup.quaternion.copy(quat); }
}
