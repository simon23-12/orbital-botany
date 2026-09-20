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
import { EARTH_ANGULAR } from '../core/orbit.js';

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
    /* ── Wolken: ITCZ am Äquator, Westwindzonen, Lücken in den Subtropen ── */
    float d = alat / 1.5708;
    float itcz = exp(-pow((d - 0.04) / 0.10, 2.0)) * 1.15;
    float storm = exp(-pow((d - 0.60) / 0.19, 2.0)) * 1.05;
    float polar = smoothstep(0.80, 1.0, d) * 0.55;
    float band = clamp(itcz + storm + polar + 0.20, 0.0, 1.6);
    vec3 w = p * 2.1 + 77.0;
    vec3 q = vec3(fbm(w * 2.0, 3, 2.1, 0.5), fbm(w * 2.0 + 3.1, 3, 2.1, 0.5), fbm(w * 2.0 + 7.3, 3, 2.1, 0.5));
    float c = fbm(w * 1.3 + q * 1.4, 6, 2.25, 0.55);
    float wisp = fbm(p * 12.0 + q * 2.0 + 41.0, 4, 2.4, 0.5);
    float a = smoothstep(0.16, 0.56, c * band + wisp * 0.20 * band);
    gl_FragColor = vec4(vec3(1.0), clamp(a, 0.0, 1.0));
  }
}`;

function renderToTexture(renderer, size, mode, seed) {
  const rt = new THREE.WebGLRenderTarget(size, size / 2, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, colorSpace: THREE.SRGBColorSpace, depthBuffer: false,
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

export function generateEarthTextures(renderer, size = 2048, seed = 3.7) {
  return {
    day: renderToTexture(renderer, size, 0, seed),
    night: renderToTexture(renderer, Math.min(size, 1024), 1, seed),
    clouds: renderToTexture(renderer, Math.min(size, 1536), 2, seed),
  };
}

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
uniform sampler2D tDay, tNight;
uniform vec3 uSun, uCam;
uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vPos; varying vec3 vObj;
${NOISE}

void main(){
  vec4 day = texture2D(tDay, vUv);
  vec3 albedo = day.rgb;
  float ocean = day.a;

  /* Aus 600 km Höhe blickt man auf wenige hundert Kilometer Boden — dafür ist
     jede Basistextur zu grob. Hochfrequentes Rauschen liefert die Feinstruktur:
     Flussläufe, Felder, Gebirgszüge, Wellenmuster auf dem Wasser. */
  float d1 = fbm(vObj * 260.0, 4, 2.55, 0.55);
  float d2 = fbm(vObj * 1500.0, 3, 2.4, 0.5);
  float land = 1.0 - ocean;
  albedo *= 1.0 + (d1 * 0.38 + d2 * 0.16) * land;
  albedo *= 1.0 + (d1 * 0.10 + d2 * 0.05) * ocean;
  albedo = max(albedo, vec3(0.0));

  vec3 N = normalize(vN);
  vec3 L = normalize(uSun);
  vec3 V = normalize(uCam - vPos);
  float ndl = dot(N, L);

  // weicher Terminator — die Atmosphäre streut Licht über die Tag-Nacht-Grenze
  float lambert = clamp(ndl, 0.0, 1.0);
  float soft = smoothstep(-0.18, 0.22, ndl);

  vec3 col = albedo * lambert * 1.25;
  col += albedo * soft * 0.10;

  // Spiegelung der Sonne auf dem Wasser
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 180.0) * ocean * soft;
  col += vec3(1.0, 0.95, 0.85) * spec * 1.1;
  // breiterer Glanzschleier auf dem Wasser
  col += vec3(0.35, 0.55, 0.85) * pow(clamp(dot(N, H), 0.0, 1.0), 20.0) * ocean * soft * 0.11;

  // Nachtseite: Städte
  float night = smoothstep(0.08, -0.22, ndl);
  float lights = texture2D(tNight, vUv).r;
  float flicker = 0.93 + 0.07 * sin(uTime * 0.7 + vUv.x * 320.0) * sin(uTime * 0.31 + vUv.y * 210.0);
  col += vec3(1.0, 0.72, 0.38) * lights * night * 0.16 * flicker;
  col += albedo * night * 0.012;

  // Rayleigh-Anteil: zur Silhouette hin bläulicher
  // Rayleigh-Streuung: zum Rand hin blauer und aufgehellt
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.8);
  col = mix(col, col * vec3(0.45, 0.72, 1.30) + vec3(0.008, 0.024, 0.058), rim * 0.66 * soft);

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
  float rim = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 3.1);
  float lit = smoothstep(-0.42, 0.38, dot(N, L));
  // Vorwärtsstreuung: am Sonnenrand heller und wärmer
  float fwd = pow(clamp(dot(V, -L), 0.0, 1.0), 6.0);
  vec3 blue = vec3(0.30, 0.58, 1.0);
  vec3 warm = vec3(1.0, 0.62, 0.34);
  vec3 c = mix(blue, warm, fwd * 0.7);
  float a = rim * lit * 0.48;
  gl_FragColor = vec4(c * (0.32 + fwd * 1.2), a);
}`;

const CLOUD_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tClouds;
uniform vec3 uSun, uCam;
uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
void main(){
  vec2 uv1 = vec2(vUv.x + uTime * 0.0016, vUv.y);
  vec2 uv2 = vec2(vUv.x * 1.37 - uTime * 0.0009, vUv.y * 1.37 + 0.21);
  float a = texture2D(tClouds, uv1).a;
  float b = texture2D(tClouds, uv2).a;
  float d = clamp(a * 0.70 + b * 0.42 - 0.22, 0.0, 1.0);
  if(d < 0.012) discard;
  vec3 N = normalize(vN);
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float soft = smoothstep(-0.16, 0.26, ndl);
  vec3 V = normalize(uCam - vPos);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
  vec3 c = mix(vec3(0.022, 0.030, 0.048), vec3(0.86, 0.88, 0.95), clamp(ndl, 0.0, 1.0));
  c = mix(c, vec3(0.98, 0.76, 0.56), rim * 0.45 * soft);
  gl_FragColor = vec4(c, d * (0.08 + soft * 0.88));
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
    uniforms: {},
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(0.135, 0.105, r);
        float glow = pow(smoothstep(1.0, 0.0, r), 2.6) * 0.55;
        float halo = pow(smoothstep(1.0, 0.0, r), 8.0) * 0.9;
        vec3 c = mix(vec3(1.0, 0.86, 0.66), vec3(1.0), disc);
        float a = clamp(disc + glow * 0.55 + halo, 0.0, 1.0);
        if(a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(distance * 0.17, distance * 0.17), mat);
  sprite.renderOrder = -5;
  g.add(sprite);
  g.userData = { sprite, distance };
  return g;
}

/* ───────────────────── Der komplette Himmel ───────────────────── */
export class Sky {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} segs Kugelsegmente je nach Qualitätsstufe
   */
  constructor(renderer, segs = 128, texSize = 2048) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 12000);
    this.tex = generateEarthTextures(renderer, texSize);

    /* Der Sichtwinkel der Erde aus 600 km Höhe beträgt 132°.
       Also: sin(halber Winkel) = R / D. */
    const R = 900;
    const D = R / Math.sin(EARTH_ANGULAR * 0.5 * Math.PI / 180);
    this.earthRadius = R; this.earthDistance = D;

    this.uniforms = {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    };

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        tDay: { value: this.tex.day }, tNight: { value: this.tex.night },
        uSun: this.uniforms.uSun, uCam: this.uniforms.uCam, uTime: this.uniforms.uTime,
      },
      vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R, segs, segs / 2), earthMat);

    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        tClouds: { value: this.tex.clouds },
        uSun: this.uniforms.uSun, uCam: this.uniforms.uCam, uTime: this.uniforms.uTime,
      },
      vertexShader: EARTH_VERT, fragmentShader: CLOUD_FRAG,
      transparent: true, depthWrite: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.007, Math.max(64, segs / 2), Math.max(32, segs / 4)), cloudMat);

    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { uSun: this.uniforms.uSun, uCam: this.uniforms.uCam },
      vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.055, 96, 48), atmoMat);

    this.earthGroup = new THREE.Group();
    this.earthGroup.add(this.earth, this.clouds, this.atmo);
    this.earthGroup.position.set(0, -D, 0);          // Erde unter der Station
    this.scene.add(this.earthGroup);

    this.stars = createStars(7000, 5200);
    this.scene.add(this.stars);

    this.sun = createSun(3600);
    this.scene.add(this.sun);

    this.sunDir = new THREE.Vector3(1, 0.2, 0.3).normalize();
    this.spin = 0;
  }

  /** Sonnenrichtung (Einheitsvektor) und Erdrotation setzen. */
  setSun(dir) {
    this.sunDir.copy(dir).normalize();
    this.uniforms.uSun.value.copy(this.sunDir).multiplyScalar(4000);
    const d = this.sun.userData.distance;
    this.sun.position.copy(this.sunDir).multiplyScalar(d);
    this.sun.lookAt(0, 0, 0);
  }

  update(dt, t) {
    this.uniforms.uTime.value = t;
    this.spin += dt * 0.0038;                    // Bodenspur unter der Station
    this.earth.rotation.y = this.spin;
    this.clouds.rotation.y = this.spin * 1.06 + 0.4;
    if (this.stars.userData.mat) {
      this.stars.userData.mat.uniforms.uTime.value = t;
      this.stars.userData.mat.uniforms.uScale.value = window.innerHeight;
    }
  }

  /** Kamera übernimmt nur die Drehung der Hauptkamera — der Himmel ist unendlich weit weg. */
  syncTo(camera) {
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.fov = camera.fov;
    this.camera.aspect = camera.aspect;
    this.camera.updateProjectionMatrix();
    this.uniforms.uCam.value.set(0, 0, 0);
  }

  /** Nur die Erde soll sich mitdrehen, wenn die Station ihre Lage ändert. */
  setAttitude(quat) { this.earthGroup.quaternion.copy(quat); }
}
