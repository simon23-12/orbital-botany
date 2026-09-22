/*  Die Erde aus 600 km Höhe — physikalisch gerechnet.
 *
 *  Statt einer texturierten Kugel mit aufgemaltem Randleuchten wird die Erde
 *  pro Bildpunkt als Strahl durch die Atmosphäre verfolgt:
 *
 *  1. Atmosphäre nach Hillaire (2020): Rayleigh- und Mie-Streuung, Ozon-
 *     absorption. Transmission und Mehrfachstreuung liegen als kleine
 *     Tabellen vor, die beim Start einmal auf der Grafikkarte entstehen.
 *     Daraus ergeben sich der dünne blaue Saum, der Dunst zum Horizont, der
 *     rote Terminator und die untergehende Sonne ganz von selbst.
 *  2. Boden aus NASA-Daten (Blue Marble, 16K, passend zum Monat), Relief aus
 *     GEBCO-Höhen, Wasser mit Sonnenglanz nach GGX — die Rauheit schwankt mit
 *     dem Wind, so entstehen die Schlieren im Glanzfleck.
 *  3. Wolken als Schicht über dem Boden: Bedeckung aus der NASA-Wolkenkarte
 *     (1 km), zerfasert von 3D-Rauschen, mit Höhe (Parallaxe am Horizont),
 *     Selbstbeschattung und Schatten auf dem Boden.
 *  4. Nachtseite: Black Marble 2016, Streulicht der Städte in den Wolken und
 *     das grüne Nachthimmelsleuchten (Airglow) in 90 km Höhe.
 *
 *  Gerechnet wird in Kilometern im Bezugssystem der Himmelsszene; die Kamera
 *  sitzt im Ursprung, die Erdmitte liegt 6971 km entfernt.
 */
import * as THREE from 'three';

export const R_GROUND = 6371;
export const R_TOP = 6471;
const H_ATM = Math.sqrt(R_TOP * R_TOP - R_GROUND * R_GROUND);
const TRANS_W = 256, TRANS_H = 64, MS_SIZE = 32;

/* ───────────────────── Gemeinsames GLSL: Atmosphärenmodell ───────────────────── */
const ATMOSPHERE = /* glsl */`
#define PI 3.14159265359
const float RG = ${R_GROUND.toFixed(1)};
const float RT = ${R_TOP.toFixed(1)};
const float H_ATM = ${H_ATM.toFixed(4)};
/* Streukoeffizienten in 1/km auf Meereshöhe. Rayleigh nach Hillaire (2020);
   Aerosol deutlich kräftiger als dort — Hillaires Wert entspricht einer
   optischen Dicke von 0,005, im Mittel liegt die reale Erde bei 0,1. Erst mit
   diesem weißlichen Dunst sieht die Erde aus wie auf Fotos von der ISS. */
const vec3  RAY_S = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float RAY_H = 8.0;
const float MIE_S = 0.040;
const float MIE_E = 0.044;
const float MIE_H = 1.6;
const vec3  OZO_A = vec3(0.650e-3, 1.881e-3, 0.085e-3);

vec3 extinctionAt(float h, out vec3 rayS, out float mieS){
  float dr = exp(-h / RAY_H);
  float dm = exp(-h / MIE_H);
  float oz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  rayS = RAY_S * dr;
  mieS = MIE_S * dm;
  return rayS + vec3(MIE_E * dm) + OZO_A * oz;
}

/* Schnittpunkte Strahl–Kugel. Über den kürzesten Abstand zur Mitte gerechnet —
   die naive Formel verliert bei 7000 km Radius in float32 Kilometer an Genauigkeit. */
vec2 raySphere(vec3 o, vec3 d, float R){
  float b = dot(o, d);
  vec3 p = o - b * d;
  float lp = length(p);
  float disc = (R - lp) * (R + lp);
  if(disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

/* Parametrisierung der Transmissionstabelle nach Bruneton */
vec2 transUV(float r, float mu){
  float rho = sqrt(max((r - RG) * (r + RG), 0.0));
  float rs = r * sqrt(max(1.0 - mu * mu, 0.0));
  float d = max(0.0, -r * mu + sqrt(max((RT - rs) * (RT + rs), 0.0)));
  float dmin = RT - r, dmax = rho + H_ATM;
  float xmu = (d - dmin) / max(dmax - dmin, 1e-4);
  float xr = rho / H_ATM;
  return vec2(0.5 / ${TRANS_W}.0 + xmu * (1.0 - 1.0 / ${TRANS_W}.0),
              0.5 / ${TRANS_H}.0 + xr  * (1.0 - 1.0 / ${TRANS_H}.0));
}
`;

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* ───────────────────── Tabelle 1: Transmission ───────────────────── */
const TRANS_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${ATMOSPHERE}
void main(){
  float xmu = (vUv.x - 0.5 / ${TRANS_W}.0) / (1.0 - 1.0 / ${TRANS_W}.0);
  float xr  = (vUv.y - 0.5 / ${TRANS_H}.0) / (1.0 - 1.0 / ${TRANS_H}.0);
  float rho = H_ATM * clamp(xr, 0.0, 1.0);
  float r = sqrt(rho * rho + RG * RG);
  float dmin = RT - r, dmax = rho + H_ATM;
  float d = dmin + clamp(xmu, 0.0, 1.0) * (dmax - dmin);
  float mu = d <= 0.0 ? 1.0 : clamp((H_ATM * H_ATM - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 o = vec3(0.0, r, 0.0);
  vec3 dir = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  float tMax = max(raySphere(o, dir, RT).y, 0.0);
  const int N = 80;
  float dt = tMax / float(N);
  vec3 od = vec3(0.0);
  for(int i = 0; i < N; i++){
    float h = length(o + dir * ((float(i) + 0.5) * dt)) - RG;
    vec3 rs; float ms;
    od += extinctionAt(max(h, 0.0), rs, ms) * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}`;

/* ───────────────────── Tabelle 2: Mehrfachstreuung (Hillaire, Abschnitt 5.5) ─────────────────────
   Für jede Höhe und jeden Sonnenstand: Licht zweiter Ordnung aus allen
   Richtungen plus der Anteil, der erneut gestreut wird — als geometrische
   Reihe aufsummiert. Das hellt vor allem Dämmerung und Horizont realistisch auf. */
const MS_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tTrans;
${ATMOSPHERE}
vec3 trans(float r, float mu){ return texture2D(tTrans, transUV(r, mu)).rgb; }
void main(){
  float muS = vUv.x * 2.0 - 1.0;
  float r = RG + clamp(vUv.y, 0.0, 1.0) * (RT - RG - 0.01) + 0.005;
  vec3 o = vec3(0.0, r, 0.0);
  vec3 L = vec3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
  vec3 lum = vec3(0.0), fms = vec3(0.0);
  const int SQ = 8;
  const int STEPS = 20;
  const float ALBEDO = 0.3;
  for(int i = 0; i < SQ; i++) for(int j = 0; j < SQ; j++){
    float ct = 1.0 - 2.0 * (float(i) + 0.5) / float(SQ);
    float st = sqrt(max(1.0 - ct * ct, 0.0));
    float ph = 2.0 * PI * (float(j) + 0.5) / float(SQ);
    vec3 d = vec3(st * cos(ph), ct, st * sin(ph));
    vec2 tg = raySphere(o, d, RG);
    vec2 ta = raySphere(o, d, RT);
    bool ground = tg.x > 0.0;
    float tMax = ground ? tg.x : ta.y;
    float dt = tMax / float(STEPS);
    vec3 thr = vec3(1.0);
    for(int k = 0; k < STEPS; k++){
      vec3 p = o + d * ((float(k) + 0.5) * dt);
      float pr = length(p);
      vec3 rs; float ms;
      vec3 ext = extinctionAt(pr - RG, rs, ms);
      vec3 sca = rs + vec3(ms);
      float mu = dot(p, L) / pr;
      float muH = -sqrt(max(1.0 - (RG / pr) * (RG / pr), 0.0));
      vec3 ts = mu > muH ? trans(pr, mu) : vec3(0.0);
      vec3 stepT = exp(-ext * dt);
      vec3 S = sca * ts / (4.0 * PI);
      lum += thr * (S - S * stepT) / ext;
      fms += thr * (sca - sca * stepT) / ext;
      thr *= stepT;
    }
    if(ground){
      vec3 p = o + d * tMax;
      float mu = dot(normalize(p), L);
      lum += thr * trans(RG + 0.01, mu) * max(mu, 0.0) * ALBEDO / PI;
    }
  }
  float n = float(SQ * SQ);
  lum /= n; fms /= n;
  gl_FragColor = vec4(lum / (1.0 - fms), 1.0);
}`;

/* ───────────────────── Kachelbares 3D-Rauschen ─────────────────────
   Wolkendetail wird im Raum abgegriffen, nicht auf der Weltkarte — so gibt
   es weder Naht noch Streckung zu den Polen. Die 128³-Kachel entsteht als
   Streifen aus 128 Schichten auf der GPU und wird dann als 3D-Textur geladen. */
const NOISE_FRAG = /* glsl */`
precision highp float;
precision highp int;
varying vec2 vUv;
const int SIZE = 128;
uint pcg(uint v){
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
ivec3 wrapi(ivec3 p, int per){ return ((p % per) + per) % per; }
uint hash3(ivec3 p, uint seed){ return pcg(uint(p.x) ^ pcg(uint(p.y) ^ pcg(uint(p.z) ^ seed))); }
vec3 hashV(ivec3 p, uint seed){
  uint h = hash3(p, seed);
  return vec3(float(pcg(h) & 0xffffu), float(pcg(h + 1u) & 0xffffu), float(pcg(h + 2u) & 0xffffu)) / 65535.0;
}
float perlin(vec3 x, int per, uint seed){
  ivec3 i = ivec3(floor(x)); vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n[8];
  for(int k = 0; k < 8; k++){
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec3 g = normalize(hashV(wrapi(i + o, per), seed) * 2.0 - 1.0 + 1e-4);
    n[k] = dot(g, f - vec3(o));
  }
  return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
             mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
}
float worley(vec3 x, int per, uint seed){
  ivec3 i = ivec3(floor(x)); vec3 f = fract(x);
  float d = 9.0;
  for(int z = -1; z <= 1; z++) for(int y = -1; y <= 1; y++) for(int xx = -1; xx <= 1; xx++){
    ivec3 o = ivec3(xx, y, z);
    vec3 r = vec3(o) + hashV(wrapi(i + o, per), seed) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
float perlinFbm(vec3 p, int per, int oct, uint seed){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int k = 0; k < 6; k++){
    if(k >= oct) break;
    s += a * perlin(p, per, seed + uint(k) * 17u); n += a;
    p *= 2.0; per *= 2; a *= 0.5;
  }
  return s / n;
}
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  int z = px.y / SIZE;
  vec3 uvw = (vec3(float(px.x), float(px.y % SIZE), float(z)) + 0.5) / float(SIZE);
  /* R: Perlin-Worley — bauschige Grundform für Kumulusfelder */
  float pf = clamp(perlinFbm(uvw * 4.0, 4, 5, 11u) * 0.9 + 0.5, 0.0, 1.0);
  float w1 = 1.0 - worley(uvw * 4.0, 4, 3u);
  float w2 = 1.0 - worley(uvw * 8.0, 8, 5u);
  float w3 = 1.0 - worley(uvw * 16.0, 16, 7u);
  float wf = clamp(w1 * 0.625 + w2 * 0.25 + w3 * 0.125, 0.0, 1.0);
  float pw = clamp((pf - (wf - 1.0)) / (2.0 - wf) , 0.0, 1.0);
  pw = clamp((pw - 0.35) * 1.9, 0.0, 1.0);
  /* G: feinere Worley-Schichtung — frisst Ränder aus */
  float w4 = 1.0 - worley(uvw * 32.0, 32, 9u);
  float g = clamp(w2 * 0.5 + w3 * 0.3 + w4 * 0.2, 0.0, 1.0);
  /* B: weiches Perlin-Rauschen — Wind, Albedo, Dunst */
  float b = clamp(perlinFbm(uvw * 8.0, 8, 4, 23u) * 1.1 + 0.5, 0.0, 1.0);
  /* A: Zellen — Ortschaften auf der Nachtseite */
  float cells = 1.0 - worley(uvw * 24.0, 24, 13u);
  float a = smoothstep(0.35, 0.95, cells) * (0.55 + 0.45 * b);
  gl_FragColor = vec4(pw, g, b, a);
}`;

/* ───────────────────── Die Erde ───────────────────── */
const PLANET_VERT = /* glsl */`
varying vec2 vNdc;
void main(){
  vNdc = position.xy;
  /* z = w: liegt auf der fernen Ebene. Mit Tiefentest wird die Erde nur dort
     gerechnet, wo keine Wand und kein Modul davor steht. */
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const PLANET_FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
uniform sampler2D tTrans, tMS, tDay, tClouds, tNight, tTerrain;
uniform sampler3D tNoise;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform vec3 uCenter;
uniform mat3 uToLocal;
uniform vec3 uSun;
uniform float uSunE;
uniform float uCloudShift;
uniform vec3 uWind0, uWind1, uWind2, uWind3;
uniform vec2 uTerrainSize;
uniform float uRelief;
uniform float uCity;
uniform float uTime;
varying vec2 vNdc;
${ATMOSPHERE}

const float RC = RG + 3.0;             // Wolkenuntergrenze
const float MS_HALF = 0.5 / ${MS_SIZE}.0;

vec3 transmittance(float r, float mu){ return texture(tTrans, transUV(r, mu)).rgb; }
vec3 multiScatter(float r, float muS){
  vec2 uv = vec2(muS * 0.5 + 0.5, clamp((r - RG) / (RT - RG), 0.0, 1.0));
  return texture(tMS, MS_HALF + uv * (1.0 - 2.0 * MS_HALF)).rgb;
}
/* Liegt die Sonne von hier aus unter dem Horizont? Weich über den Sonnendurchmesser. */
float sunVisible(float r, float muS){
  float q = RG / r;
  float muH = -sqrt(max(1.0 - q * q, 0.0));
  return smoothstep(muH - 0.005, muH + 0.005, muS);
}
float miePhase(float mu){
  const float g = 0.8;
  float gg = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - gg) * (1.0 + mu * mu) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * g * mu, 1.5));
}
/* Diffuses Himmelslicht auf einer horizontalen Fläche, je W/m² Sonne */
vec3 skyIrradiance(float muS){
  float day = smoothstep(-0.14, 0.22, muS);
  return vec3(0.055, 0.090, 0.160) * day * (0.35 + 0.65 * clamp(muS, 0.0, 1.0)) + vec3(0.010, 0.012, 0.020) * day;
}

/* Äquirektangulare Koordinaten wie bei THREE.SphereGeometry */
vec2 dirToUv(vec3 d){
  return vec2(fract(atan(d.z, -d.x) * (0.5 / PI)), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI);
}
/* Ableitungen ohne Sprung an der Datumsgrenze */
void uvGrad(vec2 uv, out vec2 dx, out vec2 dy){
  vec2 b = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dxa = dFdx(uv), dya = dFdy(uv), dxb = dFdx(b), dyb = dFdy(b);
  dx = vec2(abs(dxa.x) < abs(dxb.x) ? dxa.x : dxb.x, dxa.y);
  dy = vec2(abs(dya.x) < abs(dyb.x) ? dya.x : dyb.x, dya.y);
}

/* ── Wolken ── */
float coverage(vec2 uv, vec2 dx, vec2 dy){
  vec2 c = vec2(fract(uv.x - uCloudShift), uv.y);
  float v = textureGrad(tClouds, c, dx, dy).r;
  return clamp(v * 1.22 - 0.04, 0.0, 1.0);
}
/* Die Karte liefert Bedeckung im Maßstab von Kilometern; das Rauschen frisst
   dünne Stellen und Ränder aus, dicke Bänke bleiben geschlossen. */
float density(float cov, vec3 pk, vec3 dpx, vec3 dpy){
  if(cov < 0.015) return 0.0;
  vec3 a = pk * (1.0 / 360.0) + uWind0;
  vec3 b = pk * (1.0 / 72.0) + uWind1;
  vec3 c = pk * (1.0 / 17.0) + uWind2;
  float n1 = textureGrad(tNoise, a, dpx / 360.0, dpy / 360.0).r;
  float n2 = textureGrad(tNoise, b, dpx / 72.0, dpy / 72.0).r;
  float n3 = textureGrad(tNoise, c, dpx / 17.0, dpy / 17.0).g;
  float n = n1 * 0.40 + n2 * 0.38 + n3 * 0.22;
  float thr = (1.0 - n) * 0.72;
  return clamp((cov - thr) / max(1.0 - thr, 0.05), 0.0, 1.0);
}

vec3 cityLight(vec2 uv, vec2 dx, vec2 dy, vec3 pk, vec3 dpx, vec3 dpy){
  float l = textureGrad(tNight, uv, dx, dy).r;
  if(l < 0.004) return vec3(0.0);
  l = l * l;
  /* Ballungsräume sind aus der Nähe nur Flecken — Zellrauschen löst sie in Orte auf */
  float cells = textureGrad(tNoise, pk * (1.0 / 11.0), dpx / 11.0, dpy / 11.0).a;
  l *= 0.30 + 1.7 * cells;
  vec3 sodium = vec3(1.0, 0.50, 0.16), led = vec3(1.0, 0.80, 0.56);
  return mix(sodium, led, smoothstep(0.10, 0.60, l)) * l;
}

/* ── Atmosphäre entlang eines Abschnitts. Die Stützstellen verdichten sich
   dort, wo der Strahl am tiefsten eintaucht — am Boden oder am Horizont. ── */
void march(vec3 O, vec3 V, float t0, float t1, int N, float phR, float phM, inout vec3 L, inout vec3 T){
  if(t1 <= t0) return;
  float tc = clamp(-dot(O, V), t0, t1);
  float sStar = (tc - t0) / (t1 - t0);
  float prev = t0;
  for(int i = 1; i <= 48; i++){
    if(i > N) break;
    float s = float(i) / float(N);
    float t;
    if(s < sStar){ float a = (sStar - s) / sStar; t = tc - (tc - t0) * a * a; }
    else { float a = (s - sStar) / max(1.0 - sStar, 1e-5); t = tc + (t1 - tc) * a * a; }
    float dt = t - prev;
    vec3 P = O + V * (0.5 * (t + prev));
    prev = t;
    if(dt <= 0.0) continue;
    float r = length(P);
    vec3 rs; float ms;
    vec3 ext = extinctionAt(r - RG, rs, ms);
    float muS = dot(P, uSun) / r;
    vec3 ts = transmittance(r, muS) * sunVisible(r, muS);
    vec3 psi = multiScatter(r, muS);
    vec3 S = (rs * (phR * ts + psi) + ms * (phM * ts + psi)) * uSunE;
    vec3 st = exp(-ext * dt);
    L += T * (S - S * st) / max(ext, vec3(1e-7));
    T *= st;
  }
}

float chord(vec3 O, vec3 V, float R, float tMax){
  vec2 t = raySphere(O, V, R);
  return max(0.0, min(t.y, tMax) - max(t.x, 0.0));
}
/* Nachthimmelsleuchten: grün (Sauerstoff, 557,7 nm) um 90 km, schwach rot
   darüber. Über die Weglänge durch die Schicht — am Rand ein feiner Strich. */
vec3 airglow(vec3 O, vec3 V, float tMax){
  float g = (chord(O, V, RG + 97.0, tMax) - chord(O, V, RG + 85.0, tMax))
          + (chord(O, V, RG + 94.0, tMax) - chord(O, V, RG + 88.5, tMax)) * 1.5;
  float r = chord(O, V, RG + 290.0, tMax) - chord(O, V, RG + 170.0, tMax);
  /* Tagsüber überstrahlt der helle Saum das Leuchten um das Tausendfache —
     sichtbar ist es nur dort, wo die Schicht selbst im Dunkeln liegt. */
  vec3 P = O + V * max(-dot(O, V), 0.0);
  float muS = dot(normalize(P), uSun);
  float night = 1.0 - smoothstep(-0.30, -0.05, muS);
  return (vec3(0.30, 1.0, 0.42) * g * 8.0e-6 + vec3(1.0, 0.18, 0.12) * r * 4.0e-7) * night;
}

void main(){
  vec4 vv = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 V = normalize(uCamRot * (vv.xyz / vv.w));
  vec3 O = -uCenter;

  /* Alles, was Ableitungen braucht, im einheitlichen Kontrollfluss vorab:
     Bodenpunkt, Wolkenpunkt und ihre Texturkoordinaten. Strahlen, die die
     Erde verfehlen, nehmen den nächstgelegenen Punkt — so bleiben die
     Ableitungen am Horizont stetig. */
  vec2 tg = raySphere(O, V, RG);
  vec2 tcs = raySphere(O, V, RC);
  vec2 ta = raySphere(O, V, RT);
  bool ground = tg.x > 0.0;
  float tClose = max(-dot(O, V), 0.0);
  vec3 closeDir = normalize(O + V * tClose);

  vec3 Pg = ground ? O + V * tg.x : closeDir * RG;
  vec3 Ng = normalize(Pg);
  vec3 NgL = uToLocal * Ng;
  vec3 pkG = NgL * RG;
  vec2 uvG = dirToUv(NgL);
  vec2 gdx, gdy; uvGrad(uvG, gdx, gdy);
  vec3 gpx = dFdx(pkG), gpy = dFdy(pkG);

  bool cloud = tcs.x > 0.0 && (!ground || tcs.x < tg.x);
  vec3 Pc = cloud ? O + V * tcs.x : closeDir * RC;
  vec3 NcL = uToLocal * normalize(Pc);
  vec3 pkC = NcL * RC;
  vec2 uvC = dirToUv(NcL);
  vec2 cdx, cdy; uvGrad(uvC, cdx, cdy);
  vec3 cpx = dFdx(pkC), cpy = dFdy(pkC);

  if(ta.y < 0.0){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float t0 = max(ta.x, 0.0);
  float tEnd = ground ? tg.x : ta.y;
  float mu = dot(V, uSun);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float phM = miePhase(mu);
  vec3 L = vec3(0.0), T = vec3(1.0);

  if(cloud){
    /* ── Wolkenschicht ── */
    float cov = coverage(uvC, cdx, cdy);
    float dens = density(cov, pkC, cpx, cpy);
    float tHit = tcs.x;
    /* Parallaxe: dichte Wolken reichen höher. Am Horizont schieben sie sich
       dadurch vor den Boden dahinter — das gibt der Schicht Volumen. */
    if(dens > 0.02){
      vec2 t2 = raySphere(O, V, RG + 1.5 + 9.0 * dens);
      if(t2.x > 0.0 && t2.x < tHit){
        tHit = t2.x;
        vec3 Nc2 = uToLocal * normalize(O + V * tHit);
        cov = coverage(dirToUv(Nc2), cdx, cdy);
        pkC = Nc2 * RC;
        dens = max(density(cov, pkC, cpx, cpy), dens * 0.6);
      }
    }
    march(O, V, t0, tHit, STEPS_A, phR, phM, L, T);
    if(dens > 0.002){
      vec3 Nw = normalize(O + V * tHit);
      float cosV = max(abs(dot(Nw, V)), 0.1);
      /* Zweistrom-Näherung: Reflexion R = τ / (τ + 7,7) bei optischer Dicke τ.
         Dünne Schleier bleiben durchscheinend, dichte Bänke (τ ≈ 40) decken,
         und schräg gesehen wächst der Weg durch die Schicht. */
      float tau = pow(dens, 1.35) * 42.0 / cosV;
      float alpha = tau / (tau + 7.7);
      /* Helligkeit schwankt mit der Mächtigkeit der Wolke: aus der Karte im
         Großen, aus dem Rauschen im Kleinen — sonst wirkt die Decke wie Farbe. */
      float fine = textureGrad(tNoise, pkC * (1.0 / 9.0) + uWind2 * 1.7, cpx / 9.0, cpy / 9.0).r;
      float body = (0.74 + 0.26 * smoothstep(0.25, 0.95, cov)) * (0.86 + 0.28 * fine);
      float muS = dot(Nw, uSun);
      vec3 col = vec3(0.0);
      if(muS > -0.2){
        vec3 ts = transmittance(RC + 2.0, muS) * sunVisible(RC + 2.0, muS);
        /* Selbstbeschattung: steht zur Sonne hin eine dichtere Wolke, liegt
           dieser Punkt in ihrem Schatten. Schräges Licht wirft lange Schatten. */
        vec3 sunL = uToLocal * uSun;
        vec3 tang = normalize(sunL - NcL * dot(sunL, NcL) + 1e-6);
        float off = min(2.8 * sqrt(max(1.0 - muS * muS, 0.0)) / max(muS, 0.08), 36.0);
        vec3 pkS = normalize(pkC + tang * off) * RC;
        float dS = density(coverage(dirToUv(normalize(pkS)), cdx, cdy), pkS, cpx, cpy);
        float self = exp(-max(dS - dens * 0.55, 0.0) * 2.6);
        float wrap = clamp((muS + 0.18) / 1.18, 0.0, 1.0);
        float powder = 0.62 + 0.38 * dens;
        /* dünne Ränder leuchten auf, wenn man gegen die Sonne blickt */
        float silver = 1.0 + (1.0 - dens) * 2.2 * pow(max(mu, 0.0), 12.0);
        /* Dichte Wolken streuen vielfach und wirken heller als eine matte
           Fläche gleicher Albedo. Über ihnen liegt weniger Luft als über dem
           Boden — das Himmelslicht fällt schwächer und weniger blau aus. */
        col = uSunE * ts * (wrap * self * powder * silver * body * 1.28 / PI);
        col += uSunE * skyIrradiance(muS) * vec3(0.85, 0.72, 0.62) * (0.9 / PI);
      }
      /* nachts: ein Hauch Mond-, Stern- und Airglow-Licht, damit die Wolken
         als graue Schemen zu erkennen bleiben */
      col += vec3(0.020, 0.024, 0.034) * (1.0 - smoothstep(-0.25, 0.05, muS));
      /* und Städte leuchten die Wolken von unten an */
      vec3 glow = textureGrad(tNight, uvC, cdx * 24.0, cdy * 24.0).r * vec3(1.0, 0.55, 0.22);
      col += glow * glow * uCity * 0.5 * (1.0 - smoothstep(-0.15, 0.02, muS));
      L += T * alpha * col;
      T *= 1.0 - alpha;
    }
    if(max(T.r, max(T.g, T.b)) > 0.004) march(O, V, tHit, tEnd, STEPS_B, phR, phM, L, T);
  } else {
    march(O, V, t0, tEnd, STEPS, phR, phM, L, T);
  }

  /* ── Boden ── */
  if(ground && max(T.r, max(T.g, T.b)) > 0.004){
    vec3 albedo = textureGrad(tDay, uvG, gdx, gdy).rgb;
    float tv = textureGrad(tTerrain, uvG, gdx, gdy).r * 255.0;
    float water = 1.0 - smoothstep(12.0, 28.0, tv);
    float muS = dot(Ng, uSun);
    vec3 col = vec3(0.0);

    if(muS > -0.2){
      /* Relief aus den GEBCO-Höhen. Der Abgriffabstand wächst mit dem
         Bildpunkt, damit Gebirge auch am Horizont noch Schatten werfen. */
      vec2 ts = 1.0 / uTerrainSize;
      vec2 off = max(ts, abs(gdx) + abs(gdy));
      float hE = textureGrad(tTerrain, uvG + vec2(off.x, 0.0), gdx, gdy).r;
      float hW = textureGrad(tTerrain, uvG - vec2(off.x, 0.0), gdx, gdy).r;
      float hN = textureGrad(tTerrain, uvG + vec2(0.0, off.y), gdx, gdy).r;
      float hS = textureGrad(tTerrain, uvG - vec2(0.0, off.y), gdx, gdy).r;
      float lat = asin(clamp(NgL.y, -1.0, 1.0));
      float kmU = 2.0 * PI * RG * max(cos(lat), 0.05) * off.x;
      float kmV = PI * RG * off.y;
      float dhu = (max(hE * 255.0 - 40.0, 0.0) - max(hW * 255.0 - 40.0, 0.0)) * 0.0296 / (2.0 * kmU);
      float dhv = (max(hN * 255.0 - 40.0, 0.0) - max(hS * 255.0 - 40.0, 0.0)) * 0.0296 / (2.0 * kmV);
      vec3 tu = normalize(cross(vec3(0.0, 1.0, 0.0), NgL) + vec3(1e-6, 0.0, 0.0));
      vec3 tvv = cross(NgL, tu);
      vec3 nL = normalize(NgL - (tu * dhu + tvv * dhv) * uRelief * (1.0 - water));
      vec3 nW = transpose(uToLocal) * nL;

      vec3 tsun = transmittance(RG + 0.02, muS) * sunVisible(RG + 0.02, muS);
      /* Wolkenschatten: vom Boden zur Sonne bis in die Wolkenschicht */
      float shade = 1.0;
      if(muS > -0.02){
        vec2 tt = raySphere(Pg, uSun, RC + 2.5);
        vec3 Q = Pg + uSun * max(tt.y, 0.0);
        vec3 QL = uToLocal * normalize(Q);
        float dq = density(coverage(dirToUv(QL), gdx, gdy), QL * RC, gpx, gpy);
        shade = 1.0 - 0.86 * smoothstep(0.0, 0.8, dq);
      }
      vec3 Es = uSunE * tsun * shade;
      vec3 Ek = uSunE * skyIrradiance(muS) * (0.55 + 0.45 * shade);
      /* Land: leichte Körnung unterhalb der Kartenauflösung */
      float grain = textureGrad(tNoise, pkG * (1.0 / 6.0), gpx / 6.0, gpy / 6.0).b;
      /* Die Blue-Marble-Farben kippen unter blauem Dunst leicht ins Rosa —
         ein Hauch Gelbgrün gleicht das aus */
      vec3 alb = albedo * mix(vec3(1.0), vec3(0.98, 1.04, 0.96) * (0.86 + 0.28 * grain), 1.0 - water);
      col = alb / PI * (Es * max(dot(nW, uSun), 0.0) + Ek);

      /* Wasser: Sonnenglanz nach GGX. Die Rauheit schwankt mit dem Wind —
         daraus entstehen die Schlieren und glatten Flecken im Glanz. */
      if(water > 0.01){
        vec3 Vv = -V;
        vec3 H = normalize(uSun + Vv);
        float nh = max(dot(Ng, H), 0.0);
        float nv = max(dot(Ng, Vv), 1e-3);
        float nl = max(muS, 0.0);
        float wind = textureGrad(tNoise, pkG * (1.0 / 240.0) + uWind3, gpx / 240.0, gpy / 240.0).b;
        float wind2 = textureGrad(tNoise, pkG * (1.0 / 45.0), gpx / 45.0, gpy / 45.0).b;
        float a = mix(0.07, 0.30, clamp(wind * 0.75 + wind2 * 0.45 - 0.1, 0.0, 1.0));
        float a2 = a * a;
        float dd = nh * nh * (a2 - 1.0) + 1.0;
        float D = a2 / (PI * dd * dd);
        float vis = 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2) + 1e-5);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, Vv), 0.0), 5.0);
        float Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        /* Meereis und Schlick glänzen nicht */
        float ice = smoothstep(0.06, 0.22, dot(albedo, vec3(0.333)));
        vec3 spec = Es * D * vis * F * nl;
        vec3 sky = uSunE * skyIrradiance(muS) * (1.0 + 2.5 * (1.0 - nv)) / PI;
        vec3 wcol = col * (1.0 - Fv) + spec + sky * Fv;
        col = mix(col, wcol, water * (1.0 - ice));
      }
    }
    /* Nachtseite: Städte, erst wenn es dunkel wird */
    float dark = 1.0 - smoothstep(-0.10, 0.03, muS);
    col += albedo * vec3(0.006, 0.007, 0.010) * (1.0 - smoothstep(-0.25, 0.05, muS));
    if(dark > 0.0) col += cityLight(uvG, gdx, gdy, pkG, gpx, gpy) * uCity * dark;
    L += T * col;
    T = vec3(0.0);
  }

  L += airglow(O, V, ground ? tg.x : 1e9);
  gl_FragColor = vec4(L, ground ? 0.0 : (T.r + T.g + T.b) * (1.0 / 3.0));
}`;

/* ───────────────────── Hilfen: Tabellen auf der GPU erzeugen ───────────────────── */
function renderQuad(renderer, target, material) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  material.dispose();
}

function lutTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, generateMipmaps: false,
  });
  return rt;
}

/** Transmissions- und Mehrfachstreutabelle. */
export function buildAtmosphere(renderer) {
  const trans = lutTarget(TRANS_W, TRANS_H);
  renderQuad(renderer, trans, new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT, fragmentShader: TRANS_FRAG, depthTest: false, depthWrite: false,
  }));
  const ms = lutTarget(MS_SIZE, MS_SIZE);
  renderQuad(renderer, ms, new THREE.ShaderMaterial({
    uniforms: { tTrans: { value: trans.texture } },
    vertexShader: FULLSCREEN_VERT, fragmentShader: MS_FRAG, depthTest: false, depthWrite: false,
  }));
  return { trans: trans.texture, ms: ms.texture, targets: [trans, ms] };
}

/** 128³ kachelbares Rauschen als 3D-Textur (RGBA8). */
export function buildNoise3D(renderer, size = 128) {
  const rt = new THREE.WebGLRenderTarget(size, size * size, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
  });
  renderQuad(renderer, rt, new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT, fragmentShader: NOISE_FRAG, depthTest: false, depthWrite: false,
  }));
  const data = new Uint8Array(size * size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size * size, data);
  rt.dispose();
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/* ───────────────────── Laden der Satellitendaten ───────────────────── */
/** Lädt ein Bild mit Fortschrittsanzeige und dekodiert es abseits des Hauptthreads. */
async function fetchBitmap(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let blob;
  if (res.body && total) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onBytes?.(got / total);
    }
    blob = new Blob(chunks);
  } else blob = await res.blob();
  return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function bitmapTexture(bmp, { srgb = false, gray = false, aniso = 8 } = {}) {
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (gray) t.format = THREE.RedFormat;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  // Nach dem Hochladen gehört das Bild der Grafikkarte — die Kopie im Speicher kann weg
  t.onUpdate = () => { bmp.close?.(); t.onUpdate = null; };
  t.needsUpdate = true;
  return t;
}

/** Monat → Dateikürzel der passenden Blue-Marble-Aufnahme. */
export const monthTag = (date = new Date()) => String(date.getMonth() + 1).padStart(2, '0');

/**
 * Lädt einen Satz Erdkarten.
 * @param {'8k'|'16k'} res   Auflösung von Tagseite und Wolken
 */
export async function loadEarthSet(res, { base = './assets/earth/', month = monthTag(), aniso = 8, onProgress, detailRes = '8k' } = {}) {
  const files = [
    ['day', `day_${month}_${res}.jpg`, { srgb: true }, res === '16k' ? 11 : 3.5],
    ['clouds', `clouds_${res}.jpg`, { gray: true }, res === '16k' ? 27 : 8],
    ['night', `night_${detailRes === '8k' ? '8k' : '4k'}.jpg`, { gray: true }, 1.4],
    ['terrain', `terrain_${detailRes === '8k' ? '8k' : '4k'}.png`, { gray: true }, 3.5],
  ];
  const weight = files.reduce((s, f) => s + f[3], 0);
  const prog = new Array(files.length).fill(0);
  const report = key => onProgress?.(prog.reduce((s, p, i) => s + p * files[i][3], 0) / weight, key);
  const out = {};
  // nacheinander: 16K-Bilder belegen dekodiert je ein halbes Gigabyte
  for (let i = 0; i < files.length; i++) {
    const [key, file, opts] = files[i];
    const bmp = await fetchBitmap(base + file, f => { prog[i] = f * 0.9; report(key); });
    out[key] = bitmapTexture(bmp, { ...opts, aniso });
    prog[i] = 1; report(key);
  }
  out.terrainSize = detailRes === '8k' ? [8192, 4096] : [4096, 2048];
  out.res = res;
  out.month = month;
  return out;
}

/* ───────────────────── Ersatzkarten, falls die Bilder fehlen ───────────────────── */
const FALLBACK_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uMode;   // 0 Tag, 1 Wolken, 2 Nacht, 3 Gelände
float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 6; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  float lon = (vUv.x * 2.0 - 1.0) * 3.14159265, lat = (vUv.y - 0.5) * 3.14159265;
  vec3 p = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float e = fbm(p * 2.2 + 3.7);
  float land = smoothstep(0.52, 0.56, e);
  float alat = abs(lat) / 1.5708;
  vec3 veg = mix(vec3(0.10, 0.16, 0.06), vec3(0.45, 0.38, 0.24), smoothstep(0.2, 0.35, alat) * (1.0 - smoothstep(0.35, 0.5, alat)));
  veg = mix(veg, vec3(0.85), smoothstep(0.82, 0.9, alat));
  vec3 day = mix(vec3(0.01, 0.02, 0.07), veg, land);
  float c = smoothstep(0.45, 0.75, fbm(p * 4.0 + 11.0));
  float lights = land * smoothstep(0.62, 0.8, fbm(p * 18.0 + 5.0)) * (1.0 - smoothstep(0.6, 0.8, alat));
  float terr = land * (40.0 + (e - 0.54) * 600.0) / 255.0;
  vec3 o = uMode == 0 ? day : vec3(uMode == 1 ? c : uMode == 2 ? lights : terr);
  gl_FragColor = vec4(o, 1.0);
}`;

export function generateFallbackSet(renderer, size = 2048) {
  const make = (mode, srgb) => {
    const rt = new THREE.WebGLRenderTarget(size, size / 2, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, depthBuffer: false,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.wrapS = THREE.RepeatWrapping;
    renderQuad(renderer, rt, new THREE.ShaderMaterial({
      uniforms: { uMode: { value: mode } },
      vertexShader: FULLSCREEN_VERT, fragmentShader: FALLBACK_FRAG, depthTest: false, depthWrite: false,
    }));
    return rt.texture;
  };
  return { day: make(0, true), clouds: make(1), night: make(2), terrain: make(3), terrainSize: [size, size / 2], res: 'procedural' };
}

/* ───────────────────── Das Erdmaterial ───────────────────── */
const STEPS = { low: [12, 8, 5], medium: [18, 12, 7], high: [24, 15, 9], ultra: [32, 20, 12] };

export function createPlanetMaterial(atmo, noise, tex, quality = 'high') {
  const [n, a, b] = STEPS[quality] || STEPS.high;
  return new THREE.ShaderMaterial({
    defines: { STEPS: n, STEPS_A: a, STEPS_B: b },
    uniforms: {
      tTrans: { value: atmo.trans }, tMS: { value: atmo.ms },
      tDay: { value: tex.day }, tClouds: { value: tex.clouds }, tNight: { value: tex.night }, tTerrain: { value: tex.terrain },
      tNoise: { value: noise },
      uInvProj: { value: new THREE.Matrix4() },
      uCamRot: { value: new THREE.Matrix3() },
      uCenter: { value: new THREE.Vector3(0, -6971, 0) },
      uToLocal: { value: new THREE.Matrix3() },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunE: { value: 3.4 },
      uCloudShift: { value: 0 },
      uWind0: { value: new THREE.Vector3() }, uWind1: { value: new THREE.Vector3() },
      uWind2: { value: new THREE.Vector3() }, uWind3: { value: new THREE.Vector3() },
      uTerrainSize: { value: new THREE.Vector2(...tex.terrainSize) },
      uRelief: { value: 3.2 },
      uCity: { value: 0.55 },
      uTime: { value: 0 },
    },
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    /* Ergebnis = Streulicht + Hintergrund × Transmission: Sterne verblassen
       hinter dem Saum, hinter dem Boden verschwinden sie ganz. */
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
}

/** Transmission der Atmosphäre entlang eines Sichtstrahls — für die Sonnenscheibe. */
export const SUN_TRANSMITTANCE = /* glsl */`
${ATMOSPHERE}
uniform sampler2D tTrans;
uniform vec3 uCenter;
vec3 viewTransmittance(vec3 V){
  vec3 O = -uCenter;
  if(raySphere(O, V, RG).x > 0.0) return vec3(0.0);
  vec2 ta = raySphere(O, V, RT);
  if(ta.y < 0.0) return vec3(1.0);
  vec3 P = O + V * max(ta.x, 0.0);
  float r = length(P);
  return texture(tTrans, transUV(r, dot(P, V) / r)).rgb;
}`;
