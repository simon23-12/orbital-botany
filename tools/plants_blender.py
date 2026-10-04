"""Pflanzenmodelle für Orbital Botany — wird in Blender ausgeführt.

    blender --background --python tools/plants_blender.py

oder über die Blender-Bridge (dann vorher ROOT und MODE setzen).

Jede Art wird aus ihrer echten Wuchsform gebaut: Keimblätter, Blattstellung,
Blattumriss, Blüten und Früchte folgen der Botanik der Sorte. Für jede Art
entstehen mehrere Wachstumsschritte (Schlüssel) in drei Varianten. Das Spiel
setzt daraus einen Bestand je Tablett zusammen und wählt pro Pflanze den
Schlüssel, der zum Fortschritt passt.

Ausgabe: assets/plants/index.json + je Art eine .bin.gz (Format siehe pack()).
Koordinaten beim Bauen: y oben, Meter, Boden bei y = 0.
"""
import bpy, bmesh, math, json, struct, os, zlib, gzip
from mathutils import Vector, Matrix, noise

ROOT = globals().get('ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODE = globals().get('MODE', 'export')
TAU = math.tau
UP = Vector((0, 1, 0))

# ───────────────────────── Hilfen ─────────────────────────

def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def sm(a, b, x):
    t = clamp((x - a) / (b - a)) if b != a else (1.0 if x >= a else 0.0)
    return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def ease(x): x = clamp(x); return 1 - (1 - x) ** 2
def grow(age, dur): return ease(age / dur) if age > 0 else 0.0

def _s2l(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _l2s(c): c = clamp(c); return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
def H(h): return Vector((_s2l(((h >> 16) & 255) / 255), _s2l(((h >> 8) & 255) / 255), _s2l((h & 255) / 255)))
def mix(a, b, t): return a.lerp(b, clamp(t))

class Rand:
    """Zufall je Schlüsselwort — stabil über alle Wachstumsschritte einer Variante."""
    def __init__(self, seed): self.seed = seed
    def __call__(self, key, a=0.0, b=1.0):
        h = zlib.crc32(f'{self.seed}:{key}'.encode()) / 4294967296.0
        return a + (b - a) * h
    def sgn(self, key): return 1 if self(key) < .5 else -1

def azv(az): return Vector((math.sin(az), 0, math.cos(az)))

def tilt(az, th):
    """Richtung und Flächennormale eines Organs, das um th aus der Senkrechten
    in Richtung az geneigt ist. th = 0: senkrecht, Oberseite nach innen."""
    a = azv(az)
    d = UP * math.cos(th) + a * math.sin(th)
    z = -a * math.cos(th) + UP * math.sin(th)
    return d, z

def basis(pos, d, up, roll=0.0):
    Y = d.normalized()
    Z = up - Y * up.dot(Y)
    if Z.length < 1e-6:
        Z = Vector((0, 0, 1)) - Y * Y.z
        if Z.length < 1e-6: Z = Vector((1, 0, 0)) - Y * Y.x
    Z.normalize()
    X = Y.cross(Z)
    if roll:
        c, s = math.cos(roll), math.sin(roll)
        X, Z = X * c + Z * s, Z * c - X * s
    return Matrix(((X.x, Y.x, Z.x, pos.x), (X.y, Y.y, Z.y, pos.y), (X.z, Y.z, Z.z, pos.z), (0, 0, 0, 1)))

def arc(base, az, th0, bend, L, n=6):
    """Gebogene Achse in der Ebene (oben, az). Liefert [(P, T, Z)]."""
    out, P = [], base.copy()
    for i in range(n + 1):
        t = i / n
        if i:
            thm = th0 + bend * (t - .5 / n)
            P = P + (UP * math.cos(thm) + azv(az) * math.sin(thm)) * (L / n)
        d, z = tilt(az, th0 + bend * t)
        out.append((P.copy(), d, z))
    return out

# ───────────────────────── Geometriesammler ─────────────────────────

MATS = ('leaf', 'stem', 'petal', 'fruit', 'root')

class Geo:
    def __init__(self): self.p = {}
    def part(self, m):
        if m not in self.p: self.p[m] = ([], [], [])
        return self.p[m]
    def grid(self, mat, rows, cols, closed=False):
        V, C, F = self.part(mat)
        n = len(rows[0]); b = len(V)
        for r in rows: V.extend(r)
        C.extend(cols)
        span = n if closed else n - 1
        for i in range(len(rows) - 1):
            for j in range(span):
                j2 = (j + 1) % n
                F.append((b + i * n + j, b + i * n + j2, b + (i + 1) * n + j2, b + (i + 1) * n + j))
    def fan(self, mat, center, ccol, ring, rcols):
        """Deckel: Mittelpunkt + Ring (gegen den Uhrzeigersinn von außen)."""
        V, C, F = self.part(mat)
        b = len(V); V.append(center); C.append(ccol)
        V.extend(ring); C.extend(rcols)
        n = len(ring)
        for j in range(n): F.append((b, b + 1 + (j + 1) % n, b + 1 + j))
    def shade(self, fn, mats=None):
        for m, (V, C, F) in self.p.items():
            if mats and m not in mats: continue
            for i, v in enumerate(V): C[i] = C[i] * fn(v)
    def verts(self): return sum(len(v[0]) for v in self.p.values())

# ───────────────────────── Organe ─────────────────────────

S_FINE = (-1, -.78, -.55, -.33, -.15, -.05, 0, .05, .15, .33, .55, .78, 1)
S_MED = (-1, -.66, -.34, -.08, 0, .08, .34, .66, 1)
S_LOW = (-1, -.5, 0, .5, 1)
S_MIN = (-1, 0, 1)

def leaf(g, M, L, W, shape, col, nl=10, S=S_MED, bend=0.0, bend0=0.0, fold=0.0, cup=0.0,
         ruffle=0.0, rfreq=5.0, rph=0.0, twist=0.0, pucker=0.0, pfreq=3.0, pleat=0.0, notch=0.0,
         mat='leaf', seed=0.0, cos_rows=True, sinus=0.0):
    """Blattfläche entlang +Y, Oberseite +Z. shape(t) = halbe Breite / W.
    Zeilen liegen an Basis und Spitze dichter, damit runde Enden rund bleiben.
    sinus > 0 zieht die Mitte des Blattgrunds nach vorn (herzförmiger Grund);
    der Stielansatz liegt dann bei y = sinus · L."""
    rows, cols = [], []
    ts = [(.5 - .5 * math.cos(math.pi * i / nl)) if cos_rows else i / nl for i in range(nl + 1)]
    m = Vector((0, 0, 0))
    for i, t in enumerate(ts):
        if i:
            tm = (t + ts[i - 1]) / 2
            ph = bend0 + bend * tm ** 1.2
            m = m + Vector((0, math.cos(ph), -math.sin(ph))) * (L * (t - ts[i - 1]))
        ph = bend0 + bend * t ** 1.2
        T = Vector((0, math.cos(ph), -math.sin(ph)))
        N = Vector((0, math.sin(ph), math.cos(ph)))
        sh = shape(t)
        w = W * sh
        row = []
        for s in S:
            x = s * w
            z = fold * abs(x) + cup * x * x / max(W, 1e-5)
            if ruffle:
                z += ruffle * W * abs(s) ** 2.5 * math.sin(rfreq * TAU * t + rph + s * 1.7) * min(1.0, 3 * sh)
            if pucker:
                z += pucker * W * noise.noise(Vector((s * pfreq * .5 + seed, t * pfreq, seed * 3.1))) * (1 - abs(s) ** 3) * sm(0, .15, t)
            if pleat:
                z += pleat * W * abs(s) * math.sin(TAU * (t * 7 + abs(s) * 1.6))
            y = 0.0
            if notch:
                y = -notch * L * (1 - abs(s)) ** 2 * sm(.55, 1, t)
            if sinus:
                y += sinus * L * (1 - abs(s)) ** 1.5 * (1 - sm(0, .5, t))
            if twist:
                a = twist * t; c, sn = math.cos(a), math.sin(a)
                x, z = x * c - z * sn, x * sn + z * c
            p = m + Vector((x, 0, 0)) + N * z + T * y
            row.append(M @ p)
            cols.append(col(t, s))
        rows.append(row)
    g.grid(mat, rows, cols)

def outline(wide=.55, base=0.0, sharp=.5, bexp=.9):
    """Allgemeiner Blattumriss: breiteste Stelle bei wide, Basisbreite base,
    Spitze von rund (sharp 0) bis zugespitzt (1)."""
    a = lerp(2.2, 1.15, sharp); b = lerp(.5, 1.15, sharp)
    def f(t):
        if t < wide:
            return base + (1 - base) * math.sin(math.pi / 2 * t / wide) ** bexp
        u = (t - wide) / (1 - wide)
        return max(0.0, 1 - u ** a) ** b
    return f

def tube(g, pts, radii, col, sides=6, mat='stem', flat=1.0, cap=False):
    n = len(pts)
    T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    a = Vector((1, 0, 0)) if abs(T[0].x) < .9 else Vector((0, 0, 1))
    N = (a - T[0] * a.dot(T[0])).normalized()
    rows, cols = [], []
    for i in range(n):
        N = (N - T[i] * N.dot(T[i])).normalized()
        B = T[i].cross(N)
        r = radii[i]
        rows.append([pts[i] + (N * math.cos(k * TAU / sides) * flat + B * math.sin(k * TAU / sides)) * r
                     for k in range(sides)])
        c = col(i / (n - 1))
        cols.extend([c] * sides)
    g.grid(mat, rows, cols, closed=True)
    if cap:
        g.fan(mat, pts[-1] + T[-1] * radii[-1] * .6, col(1.0), rows[-1], [col(1.0)] * sides)

def lathe(g, M, prof, col, sides=10, mat='fruit', deform=None):
    """Drehkörper; prof = [(r, y)] von unten nach oben. col(v, k)."""
    rows, cols = [], []
    n = len(prof)
    for i, (r, y) in enumerate(prof):
        row = []
        for k in range(sides):
            a = k * TAU / sides
            p = Vector((r * math.sin(a), y, r * math.cos(a)))
            if deform: p = deform(p, i / (n - 1), a)
            row.append(M @ p)
            cols.append(col(i / (n - 1), k))
        rows.append(row)
    g.grid(mat, rows, cols, closed=True)

def path_pts(P, n=None):
    return [p for p, _, _ in P]

# ── Umrisse ──
def sh_ellipse(t): return math.sin(math.pi * t) ** .75
def sh_ovate(t): return math.sin(math.pi * t ** .72) ** .8
def sh_obovate(t): return math.sin(math.pi * t ** 1.35) ** .7
def sh_lance(t): return math.sin(math.pi * t ** .8) ** 1.1
def sh_linear(t): return (math.sin(math.pi * t ** .9) ** .35) * (1 - .3 * t)
def sh_spatula(t): return math.sin(math.pi * t ** 1.7) ** .6
def sh_round(t): return math.sin(math.pi * t) ** .5
def sh_kidney(t): return (math.sin(math.pi * (.08 + .92 * t)) ** .45) * (1 - .2 * sm(.8, 1, t))
def acuminate(f, k=.55):
    return lambda t: f(t) * (1 - k * sm(.72, 1, t) * (1 - (1 - t) * 3))
def serrate(f, n, d):
    return lambda t: f(t) * (1 - d * ((t * n) % 1.0) * sm(.05, .2, t))
def lobed(f, n, d, t0=0.0, t1=1.0, p=1.4):
    def s(t):
        if t < t0 or t > t1: return f(t)
        u = (t - t0) / (t1 - t0)
        return f(t) * (1 - d * (0.5 - 0.5 * math.cos(TAU * n * u)) ** p * math.sin(math.pi * u) ** .3)
    return s

def lcol(base, tip=None, rib=None, edge=None, rib_w=.07, edge_w=.6, rib_fade=.55):
    def f(t, s):
        c = base if tip is None else mix(base, tip, t)
        if edge is not None: c = mix(c, edge, sm(1 - edge_w, 1.0, abs(s)) * .8)
        if rib is not None: c = mix(c, rib, (1 - sm(0, rib_w, abs(s))) * (1 - rib_fade * t))
        return c
    return f

def const(c): return lambda *a: c

# ── Keimling ──
def seed_on_soil(g, R, size, color, shape=(1, .7, .75)):
    M = Matrix.Translation(Vector((0, size * shape[1] * .45, 0))) @ Matrix.Rotation(R('sa', 0, TAU), 4, 'Y')
    prof = [(math.sin(math.pi * v) * size * shape[0] * .5 + 1e-5, (v - .5) * size * shape[1]) for v in (0, .2, .5, .8, 1)]
    lathe(g, M @ Matrix.Diagonal(Vector((1, 1, shape[2], 1))), prof, const(color), sides=6, mat='root')

def hypocotyl(g, R, u, L, r, col, lean=.12):
    """Keimstängel: erst als Haken aus dem Boden, dann aufgerichtet.
    Liefert Spitze, Richtung und Azimut für die Keimblätter."""
    hook = math.pi * (1 - sm(.25, .75, u)) * .95
    Ls = L * sm(.0, .6, u) * .7 + L * .3 * sm(.4, 1, u) + 1e-4
    az = R('haz', 0, TAU)
    P = Vector((0, -.004, 0)); pts = [P.copy()]; n = 7
    leanv = R('lean', -lean, lean)
    for i in range(1, n + 1):
        s = i / n
        ph = leanv * s + hook * sm(.45, 1, s)
        P = P + (UP * math.cos(ph) + azv(az) * math.sin(ph)) * (Ls / n)
        pts.append(P.copy())
    tube(g, pts, [r * (1.1 - .2 * i / n) for i in range(n + 1)], col, sides=5)
    ph = leanv + hook
    return pts[-1], ph, az

def cotyledons(g, R, tip, ph, az, open_, L, W, shape, col, petiole=0.0, nl=6, S=S_LOW, notch=0.0, cup=.25, spread=None):
    """Keimblattpaar an der Spitze des Keimstängels."""
    for j in (0, 1):
        a = az + math.pi / 2 + j * math.pi + R(f'ca{j}', -.15, .15)
        th = (spread if spread is not None else 1.2) * open_ + ph * (1 if j == 0 else -1) * .5 * (1 - open_)
        d, z = tilt(a, th)
        base = tip.copy()
        if petiole > 0:
            P = arc(tip, a, th * .7, th * .3, petiole, 3)
            tube(g, path_pts(P), [.0006] * 4, const(col(0, 0)), sides=3)
            base, d, z = P[-1]
        leaf(g, basis(base, d, z), L, W, shape, col, nl=nl, S=S, notch=notch, cup=cup, bend=.25 * open_, seed=j + 1)

# ───────────────────────── Arten ─────────────────────────
# Jede Funktion baut eine Einzelpflanze beim Fortschritt p (0…1).

def build_kresse(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0022, H(0x8a4a22)); return g
    u = clamp(p / .12)
    Lh = .01 + .038 * sm(.06, .75, p) * R('hl', .75, 1.2)
    stemc = lambda t: mix(H(0xf0f0e0), H(0xb5d68e), t)
    tip, ph, az = hypocotyl(g, R, u, Lh, .0009, stemc, lean=.18)
    op = sm(.55, 1, u) * (1 - .25 * sm(.5, 1, p))
    c = .005 + .009 * sm(.05, .45, p)
    cc = lcol(H(0x72c257), H(0x8ad06a), rib=H(0xbfe29a))
    # Kresse-Keimblätter sind tief dreilappig
    for j in (0, 1):
        a = az + math.pi / 2 + j * math.pi + R(f'ca{j}', -.2, .2)
        th = 1.25 * op + (1 - op) * .1
        P = arc(tip, a, th * .6, th * .4, .007 * sm(.4, 1, u) + .0005, 2)
        tube(g, path_pts(P), [.0005] * 3, stemc, sides=3)
        base, d, z = P[-1]
        for k, (off, ln) in enumerate(((-.75, .75), (0, 1.0), (.75, .75))):
            M = basis(base, d, z, 0) @ Matrix.Rotation(off * op + off * .2, 4, 'Z')
            leaf(g, M, c * ln, c * .5, outline(.55, 0, .2), cc, nl=4, S=S_LOW, cup=.4, bend=.3 * op)
    # Erste Laubblätter, fiederspaltig
    nleaf = 3
    for i in range(nleaf):
        age = p - (.36 + i * .14)
        if age <= 0: continue
        gl = grow(age, .35)
        a = az + i * 2.4
        d, z = tilt(a, .5 + .2 * i)
        leaf(g, basis(tip, d, z), .02 * gl * R(f'tl{i}', .8, 1.2), .0055 * gl,
             lobed(outline(.6, .05, .3), 2.5, .7, .15, .85), lcol(H(0x5aae4a), H(0x6cc05a)), nl=10, S=S_LOW, bend=.4, cup=.3, cos_rows=False)
    return g

def build_radieschen(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .003, H(0x7a4a30), (1, .9, .9)); return g
    u = clamp(p / .14)
    bulb = .002 + .0165 * sm(.5, .95, p) * R('bs', .8, 1.15)
    stemc = lambda t: mix(H(0xd9a0b0), H(0xa8c880), t)
    tip, ph, az = hypocotyl(g, R, u, .012 + .006 * sm(.1, .4, p), .0011 + bulb * .3, stemc)
    # Keimblätter: nierenförmig mit Kerbe, welken später
    fade = sm(.55, .8, p)
    if fade < 1:
        c = (.006 + .01 * sm(.08, .35, p)) * (1 - .4 * fade)
        cc = lcol(mix(H(0x6ab84e), H(0xc8b050), fade), rib=H(0xb8dc98))
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .6, sh_kidney, cc, petiole=.006 * sm(.5, 1, u), notch=.25, nl=5)
    # Rosette aus leierförmig gefiederten Laubblättern
    top = Vector((0, bulb * 1.45, 0))
    for i in range(9):
        age = p - (.15 + i * .07)
        if age <= 0: continue
        gl = grow(age, .32)
        a = az + i * 2.3999 + R(f'a{i}', -.2, .2)
        L = (.05 + .075 * sm(0, 4, i)) * gl * R(f'l{i}', .85, 1.15)
        th = lerp(.25, .85, sm(0, .5, age)) + R(f't{i}', -.1, .15)
        P = arc(top, a, th, .15, L * .35, 3)
        pc = lambda t: mix(H(0xb04868), H(0x88b870), sm(0, .6, t))
        tube(g, path_pts(P), [.0016 * (1 - .4 * t / 3) for t in range(4)], pc, sides=4)
        base, d, z = P[-1]
        shape = lambda t: max(.5 * lobed(lambda t: 1, 3, .92, p=.8)(t / .52) * sm(0, .12, t) if t < .52 else 0,
                              outline(.5, 0, .1)(clamp((t - .4) / .6)) if t > .4 else 0)
        leaf(g, basis(base, d, z), L * .65, L * .24, shape, lcol(H(0x4f9a3c), H(0x5aa846), rib=H(0xc8e0b0)),
             nl=22, S=S_MED, bend=.7 + .4 * sm(0, .4, age), fold=.15, pucker=.1, pfreq=4, seed=i, ruffle=.06, rfreq=3,
             cos_rows=False)
    # Rote Knolle (verdicktes Hypokotyl), zur Hälfte über dem Substrat
    if bulb > .003:
        prof = []
        for k in range(10):
            v = k / 9
            r = bulb * math.sin(math.pi * v) ** .8 * (1 - .25 * (1 - v) ** 3)
            prof.append((max(r, 1e-5), bulb * (v * 2.1 - .75)))
        col = lambda v, k: mix(mix(H(0xf4f0f0), H(0xd8244a), sm(.05, .35, v)), H(0xa01848), sm(.7, 1, v))
        lathe(g, Matrix.Identity(4), prof, col, sides=12, mat='root')
    return g

def build_salat(p, R):
    """Römersalat 'Outredgeous' — aufrechter, tiefroter Kopf."""
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .004, H(0x9a9080), (.5, 1, .4)); return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0xe8ecd0), H(0xb0d090), t)
    tip, ph, az = hypocotyl(g, R, u, .01, .0011, stemc)
    if p < .45:
        c = .006 + .007 * sm(.05, .3, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .42, sh_spatula, lcol(H(0x7ab85a), rib=H(0xc0dca0)), nl=5)
    red = H(0x3c0818); red2 = H(0x5a0e22); green = H(0x86a83e); heart = H(0xa8c860); rib = H(0xdde6b8)
    n = 24
    for i in range(n):
        age = p - (.10 + i * .037)
        if age <= 0: continue
        gl = grow(age, .38)
        # äußere Blätter: offen, innere: aufrecht, sie bilden das Herz
        L = (.03 + .2 * sm(0, 10, i)) * gl * R(f'l{i}', .88, 1.1)
        a = i * 2.3999 + R(f'a{i}', -.15, .15)
        open_ = sm(0, .55, age)
        th = lerp(.1, 1.0 - .75 * sm(5, 17, i), open_) + R(f't{i}', -.06, .06)
        expo = sm(.02, .4, age) * (1 - .6 * sm(10, 22, i))      # Licht → Anthocyan
        g0 = mix(green, heart, sm(10, 22, i))
        def col(t, s, expo=expo, g0=g0):
            red_amt = sm(.05, .45, t * .8 + .55 * abs(s)) * (.3 + .7 * expo)
            c = mix(g0, mix(red2, red, abs(s) * .7 + t * .3), red_amt)
            c = mix(c, rib, (1 - sm(0, .07, abs(s))) * (1 - .75 * t))
            return c
        base = Vector((0, .004 + i * .0006 * gl, 0))
        leaf(g, basis(base, *tilt(a, th)), L, L * .25, outline(.64, .1, .08), col, nl=16, S=S_FINE,
             bend=lerp(.05, .75, open_) * R(f'b{i}', .7, 1.2), cup=.75 - .35 * open_, ruffle=.05 + .04 * gl,
             rfreq=4.5, rph=R(f'r{i}', 0, TAU), pucker=.06, pfreq=3, seed=i * .7)
    return g

def build_rucola(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0018, H(0x8a6a3a), (1, .8, .8)); return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0xe0d8d8), H(0xa8c880), t)
    tip, ph, az = hypocotyl(g, R, u, .01, .001, stemc)
    fade = sm(.4, .65, p)
    if fade < 1:
        c = (.005 + .008 * sm(.05, .3, p))
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .6, sh_kidney,
                   lcol(mix(H(0x6ab04e), H(0xb0a850), fade), rib=H(0xb8dc98)), petiole=.005, notch=.3, nl=5)
    for i in range(14):
        age = p - (.13 + i * .055)
        if age <= 0: continue
        gl = grow(age, .3)
        L = (.045 + .09 * sm(0, 5, i)) * gl * R(f'l{i}', .85, 1.15)
        a = i * 2.3999 + R(f'a{i}', -.25, .25)
        th = lerp(.2, .75, sm(0, .45, age)) + R(f't{i}', -.1, .1)
        P = arc(Vector((0, .002, 0)), a, th, .1, L * .18, 2)
        tube(g, path_pts(P), [.0012] * 3, lambda t: mix(H(0x9a6a7a), H(0x88b070), t), sides=4)
        base, d, z = P[-1]
        nlob = 3 + (i > 3)
        shape = lambda t, n=nlob: max(lobed(lambda t: .62 * math.sin(math.pi * clamp(t / .8)) ** .5, n, .9, .02, .66, p=.7)(t),
                                     outline(.45, 0, .35)(clamp((t - .6) / .4)) * .8 if t > .6 else 0)
        leaf(g, basis(base, d, z), L * .82, L * .19, shape, lcol(H(0x3f8a35), H(0x509a40), rib=H(0xc0dca8)),
             nl=24, S=S_MED, bend=.55 + .35 * sm(0, .4, age), fold=.12, ruffle=.04, rfreq=4, seed=i, cos_rows=False)
    return g

def build_spinat(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0035, H(0x8a7a50), (1, .85, .9)); return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0xd8b8b8), H(0xa8c880), t)
    tip, ph, az = hypocotyl(g, R, u, .012, .0011, stemc)
    fade = sm(.35, .6, p)
    if fade < 1:
        c = (.01 + .014 * sm(.05, .3, p))
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u) * .8, c, c * .12, sh_linear,
                   lcol(mix(H(0x5a9a48), H(0xa8a050), fade)), nl=6, S=S_LOW, spread=1.0)
    dark = H(0x1f5a2c); mid = H(0x2c7038); rib = H(0x9cc488)
    for i in range(16):
        age = p - (.12 + i * .05)
        if age <= 0: continue
        gl = grow(age, .32)
        L = (.05 + .1 * sm(0, 6, i)) * gl * R(f'l{i}', .85, 1.12)
        a = i * 2.3999 + R(f'a{i}', -.2, .2)
        th = lerp(.3, .95, sm(0, .45, age)) + R(f't{i}', -.1, .1)
        P = arc(Vector((0, .003, 0)), a, th, .25, L * .4, 3)
        tube(g, path_pts(P), [.0022, .002, .0017, .0014], lambda t: mix(H(0xb06070), H(0x78a860), sm(0, .5, t)), sides=5)
        base, d, z = P[-1]
        shape = lambda t: min(1, .85 * math.sin(math.pi * t ** .62) ** .8 + .35 * math.exp(-((t - .1) / .09) ** 2))
        leaf(g, basis(base, d, z), L * .6, L * .3, shape, lcol(mid, dark, rib=rib, rib_w=.06),
             nl=11, S=S_FINE, bend=.35 + .35 * sm(0, .4, age), cup=.35, pucker=.28, pfreq=7, seed=i * 1.3, fold=.08)
    return g

def build_basilikum(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0018, H(0x1a1a1a), (1, .75, .8)); return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0xa8c890), H(0x78b060), t)
    tip, ph, az = hypocotyl(g, R, u, .014, .0012, stemc)
    fade = sm(.35, .6, p)
    if fade < 1:
        c = .005 + .007 * sm(.05, .3, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .75, sh_kidney,
                   lcol(mix(H(0x6ac050), H(0xb0b060), fade), rib=H(0xc0e0a0)), petiole=.004, nl=5, notch=.1)
    if p < .12: return g
    # Hauptspross mit kreuzgegenständigen Blattpaaren
    npairs = 7
    gy = tip.y
    lean = R('lean', -.06, .06)
    nodes = []
    for k in range(npairs):
        age = p - (.12 + k * .075)
        if age <= 0: break
        ik = .005 + .022 * sm(0, .25, age) * (1 - .35 * k / npairs)
        gy += ik
        nodes.append((k, age, Vector((math.sin(az) * lean * gy, gy, math.cos(az) * lean * gy))))
    pts = [Vector((0, 0, 0)), tip.copy()] + [n[2] for n in nodes]
    if len(pts) >= 3:
        tube(g, pts, [.0022 * (1 - .5 * i / len(pts)) + .0009 for i in range(len(pts))], stemc, sides=4)
    lc = lcol(H(0x3c8e36), H(0x4ea542), rib=H(0xa8d890), rib_w=.05)
    for k, age, P in nodes:
        gl = grow(age, .3)
        L = (.035 + .03 * sm(0, 3, k) - .015 * sm(4, 7, k)) * gl * R(f'l{k}', .9, 1.1)
        for s in (0, 1):
            a = az + k * math.pi / 2 + s * math.pi + R(f'a{k}{s}', -.15, .15)
            th = lerp(.35, .95, sm(0, .35, age))
            A = arc(P, a, th, .25, .012 * gl + .002, 2)
            tube(g, path_pts(A), [.0011] * 3, stemc, sides=3)
            base, d, z = A[-1]
            leaf(g, basis(base, d, z), L, L * .38, acuminate(outline(.4, 0, .45), .3), lc, nl=9, S=S_MED,
                 cup=-.75, bend=.35, pucker=.15, pfreq=3, seed=k * 2 + s, fold=-.05)
            # Achseltriebe an älteren Knoten
            if k <= 3 and p > .35:
                sa = p - .35 - k * .05
                if sa > 0:
                    sg = grow(sa, .35)
                    B = arc(P, a + .6, .6, -.25, .05 * sg + .005, 3)
                    tube(g, path_pts(B), [.0016, .0014, .0012, .001], stemc, sides=4)
                    bt, bd, bz = B[-1]
                    for q, (bq, _, _) in ((1, B[1]), (3, B[3])):
                        for s2 in (0, 1):
                            a2 = a + .6 + (q > 1) * math.pi / 2 + s2 * math.pi
                            Lq = (.038 if q == 1 else .026) * sg + .004
                            leaf(g, basis(bq, *tilt(a2, .85)), Lq, Lq * .38,
                                 acuminate(outline(.4, 0, .45), .3), lc, nl=8, S=S_MED, cup=-.7, bend=.35, pucker=.12, seed=k + s2 * 5 + q)
    # Triebspitze
    if nodes:
        P = nodes[-1][2]
        for s in (0, 1):
            a = az + len(nodes) * math.pi / 2 + s * math.pi
            leaf(g, basis(P, *tilt(a, .3)), .012, .005, sh_ovate, lc, nl=5, S=S_LOW, cup=-.3)
    return g

# ── Schmetterlingsblütler: Bohne ──

def trifoliate(g, R, base, az, th, Lp, Ll, key, lc, pc):
    P = arc(base, az, th, .35, Lp, 4)
    tube(g, path_pts(P), [.0018, .0016, .0014, .0013, .0012], pc, sides=4)
    end, d, z = P[-1]
    side = d.cross(z)
    # Endblättchen an eigenem Stielchen, zwei seitliche schräg nach außen
    E = end + d * Ll * .32
    tube(g, [end, E], [.001, .0009], pc, sides=3)
    shp = acuminate(outline(.38, 0, .5), .45)
    leaf(g, basis(E, d, z), Ll, Ll * .34, shp, lc, nl=8, S=S_LOW, bend=.55, fold=.14, seed=R(key))
    for sgn in (-1, 1):
        dd = (d * -.05 + side * sgn).normalized()
        e2 = end + dd * Ll * .06
        tube(g, [end, e2], [.0009, .0008], pc, sides=3)
        dl = (d * .35 + side * sgn).normalized()
        leaf(g, basis(e2, dl, z, sgn * .2), Ll * .88, Ll * .3, shp, lc, nl=8, S=S_LOW,
             bend=.5, fold=.12, seed=R(key) + sgn)

def bean_flower(g, R, P, d, key, col):
    """Kleine Schmetterlingsblüte: Fahne, zwei Flügel, Schiffchen."""
    z = Vector((0, 1, 0)) if abs(d.y) < .9 else Vector((1, 0, 0))
    M = basis(P, d, z)
    leaf(g, M @ Matrix.Rotation(-.9, 4, 'X'), .009, .006, sh_round, col, nl=4, S=S_LOW, cup=.8, mat='petal')
    for s in (-1, 1):
        leaf(g, M @ Matrix.Rotation(s * .5, 4, 'Z'), .008, .003, sh_ellipse, col, nl=3, S=S_LOW, cup=.8, mat='petal')
    lathe(g, M @ Matrix.Rotation(-math.pi / 2, 4, 'X'), [(.0015, -.001), (.002, .0), (.001, .005), (1e-5, .006)],
          const(H(0x7ab050)), sides=5, mat='stem')

def bean_pod(g, R, P, L, key, col):
    az = R(key + 'az', 0, TAU)
    pts = []; rad = []
    n = 9
    for i in range(n + 1):
        t = i / n
        ph = math.pi - .35 * t - .15 * math.sin(math.pi * t) * R(key + 'c', -1, 1)
        pts.append(P + (UP * math.cos(math.pi - .2) * t + azv(az) * .25 * math.sin(t * 2)) * L +
                   Vector((0, -.004 * math.sin(math.pi * t), 0)))
        bump = 1 + .05 * math.sin(t * 5 * TAU) * sm(.1, .4, L / .11)
        rad.append(.0043 * math.sin(math.pi * clamp(t * .92 + .04)) ** .35 * bump * (1 - .7 * sm(.9, 1, t)) * sm(0, .6, L / .03 + .2))
    tube(g, pts, rad, col, sides=6, mat='fruit', flat=.6)

def build_bohne(p, R):
    g = Geo()
    if p < .02:
        lathe(g, Matrix.Translation(Vector((0, .003, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'Z'),
              [(1e-5, -.006), (.003, -.004), (.0038, 0), (.003, .004), (1e-5, .006)], const(H(0xeee4d0)), sides=7, mat='root')
        return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0x98b878), H(0x6aa050), t)
    tip, ph, az = hypocotyl(g, R, u, .05 + .02 * sm(.1, .3, p), .0022, stemc, lean=.08)
    # fleischige Keimblätter (die Bohnenhälften), später welk
    fade = sm(.2, .45, p)
    if fade < 1:
        op = sm(.5, 1, u)
        for j in (0, 1):
            a = az + math.pi / 2 + j * math.pi
            d, z = tilt(a, 1.3 * op + .3 * (1 - op))
            M = basis(tip, d, z) @ Matrix.Translation(Vector((0, .005, 0)))
            s = 1 - .45 * fade
            prof = [(1e-5, -.006 * s), (.0035 * s, -.003 * s), (.004 * s, .0), (.0032 * s, .004 * s), (1e-5, .007 * s)]
            lathe(g, M @ Matrix.Diagonal(Vector((1, 1, .45, 1))), prof,
                  const(mix(H(0xd8d890), H(0xa89860), fade)), sides=7, mat='root')
    if p < .07: return g
    lc = lcol(H(0x3f8c38), H(0x4c9a40), rib=H(0x9cc488), rib_w=.05)
    # Primärblätter: einfaches, herzförmiges Paar
    ga = p - .07
    gp = grow(ga, .2)
    node = tip + Vector((0, .02 * gp, 0))
    tube(g, [tip, node], [.0022, .002], stemc, sides=5)
    for j in (0, 1):
        a = az + j * math.pi
        A = arc(node, a, .6 + .5 * sm(0, .2, ga), .3, .025 * gp + .003, 3)
        tube(g, path_pts(A), [.0012] * 4, stemc, sides=3)
        b, d, z = A[-1]
        leaf(g, basis(b, d, z), .065 * gp + .006, (.065 * gp + .006) * .42,
             acuminate(lambda t: math.sin(math.pi * (.12 + .88 * t) ** .75) ** .6, .5), lc, nl=10, S=S_MED,
             bend=.5, fold=.1, notch=-.05, seed=j)
    if p < .2: return g
    # Hauptachse im Zickzack, wechselständige Dreiblätter
    k_n = 7
    P = node.copy(); pts = [tip, node]
    tri = []
    for k in range(k_n):
        age = p - (.2 + k * .06)
        if age <= 0: break
        P = P + Vector((math.sin(az + k * math.pi) * .006, .022 * sm(0, .2, age) + .004, math.cos(az + k * math.pi) * .006))
        pts.append(P.copy())
        tri.append((k, age, P.copy()))
    tube(g, pts, [.0034 * (1 - .5 * i / len(pts)) + .001 for i in range(len(pts))], stemc, sides=5)
    for k, age, Pk in tri:
        gl = grow(age, .22)
        a = az + k * 2.4 + math.pi / 2
        trifoliate(g, R, Pk, a, lerp(.3, 1.0, sm(0, .3, age)), (.03 + .03 * sm(0, 3, k)) * gl + .004,
                   (.04 + .032 * sm(0, 3, k)) * gl + .004, f'tr{k}', lc, stemc)
    # Seitentriebe
    for b in range(2):
        age = p - (.36 + b * .08)
        if age <= 0: continue
        gl = grow(age, .3)
        a = az + b * math.pi + .8
        B = arc(pts[2 + b] if len(pts) > 2 + b else node, a, .7, -.35, .08 * gl + .01, 4)
        tube(g, path_pts(B), [.0024, .002, .0018, .0016, .0014], stemc, sides=4)
        for q in range(2):
            qa = age - q * .1
            if qa <= 0: continue
            Pq, dq, zq = B[2 + q * 2]
            trifoliate(g, R, Pq, a + q * 2.2 + 1, .9, .04 * grow(qa, .2) + .004, .058 * grow(qa, .2) + .004,
                       f'sb{b}{q}', lc, stemc)
    # Blüten in den Blattachseln, später Hülsen
    fl_on = p >= .5
    flowers = [(tri[k][2], k) for k in range(1, len(tri), 2)]
    for Pk, k in flowers:
        if not fl_on: break
        a = az + k * 2.4 - math.pi / 2
        A = arc(Pk, a, 1.0, .8, .02, 3)
        tube(g, path_pts(A), [.0009] * 4, stemc, sides=3)
        end, d, z = A[-1]
        for f in range(3):
            fp = end + azv(a + f * 2.1) * .004 + Vector((0, -.003 * f, 0))
            if p < .74:
                o = sm(.5, .56, p) * (1 - sm(.68, .74, p))
                if o > .05:
                    bean_flower(g, R, fp, (azv(a + f * 2.1) + UP * .3).normalized(), f'f{k}{f}',
                                const(mix(H(0xf6f0ff), H(0xd8c8f0), R(f'fc{k}{f}'))))
            if p >= .66 and f < 2 + (k > 2):
                L = .11 * sm(.66, .92, p) * R(f'pl{k}{f}', .85, 1.1)
                if L > .004:
                    bean_pod(g, R, fp, L, f'p{k}{f}', lambda t: mix(H(0x7ab84e), H(0x9ac86a), t * .5))
    return g

# ── Korbblütler: Tagetes und Zinnie ──

def pinnate(g, R, base, az, th, L, nlf, lf_L, lf_W, key, lc, pc, bend=.4, serr=6, up=None):
    P = arc(base, az, th, bend, L, max(4, nlf))
    tube(g, path_pts(P), [.0012 * (1 - .5 * i / len(P)) + .0004 for i in range(len(P))], pc, sides=3)
    for i in range(1, len(P)):
        Pi, d, z = P[i]
        side = d.cross(z)
        f = i / (len(P) - 1)
        for sgn in ((-1, 1) if i < len(P) - 1 else (0,)):
            dd = (d * (.55 + .3 * f) + side * sgn).normalized() if sgn else d
            l = lf_L * (1 - .45 * (1 - f) ** 2) * (1 - .3 * f * f)
            leaf(g, basis(Pi, dd, z), l, lf_W * l / lf_L, sh_lance, lc, nl=3, S=S_MIN,
                 bend=.3, fold=.18, seed=R(key) + i)

def composite_head(g, R, M, D, rings, col, disc_col, openness, key, disc_raise=.2, ray_w=.35, reflex=0.0,
                   ruffle=0.0, notch=0.0, star=None):
    """Blütenkorb: Strahlenblüten in Ringen, Scheibe in der Mitte. D = Durchmesser."""
    r = D / 2
    for ri, (n, lf, el) in enumerate(rings):
        for k in range(n):
            a = k * TAU / n + ri * .6 + R(f'{key}r{ri}{k}', -.08, .08)
            th = lerp(.15, el, openness) + reflex * (ri == 0) * openness
            d, z = tilt(a, th)
            L = r * lf * lerp(.45, 1, openness)
            base = Vector((math.sin(a), 0, math.cos(a))) * r * .12 * (1 - ri * .3)
            leaf(g, M @ basis(base + Vector((0, ri * r * .05, 0)), d, z), L, L * ray_w, sh_obovate, col,
                 nl=5, S=S_LOW, cup=.3, bend=.25 + .2 * openness, ruffle=ruffle, rfreq=2, notch=notch,
                 mat='petal', seed=ri * 10 + k)
    # Scheibe
    dr = r * .3
    prof = [(1e-5, -dr * .25), (dr * .9, -dr * .15), (dr, dr * .15), (dr * .75, dr * disc_raise * 2.4), (1e-5, dr * disc_raise * 3.1)]
    lathe(g, M, prof, disc_col, sides=12, mat='petal')
    if star:
        n, c = star
        for k in range(n):
            a = k * TAU / n
            d, z = tilt(a, 1.25)
            pos = Vector((math.sin(a) * dr * .95, dr * .25, math.cos(a) * dr * .95))
            leaf(g, M @ basis(pos, d, z), dr * .45, dr * .16, sh_lance, const(c), nl=2, S=S_MIN, mat='petal')

def bud(g, M, r, col, tipcol=None, tipamt=0.0):
    prof = [(1e-5, 0), (r * .6, r * .15), (r, r * .8), (r * .8, r * 1.5), (r * .3, r * 2.0), (1e-5, r * 2.15)]
    c = (lambda v, k: mix(col, tipcol, sm(.55, 1, v) * tipamt)) if tipcol is not None else const(col)
    lathe(g, M, prof, c, sides=8, mat='stem', deform=lambda q, v, a: q * (1 + .08 * math.cos(a * 7) * math.sin(math.pi * v)))

def build_tagetes(p, R):
    g = Geo()
    if p < .02:
        leaf(g, basis(Vector((0, .0008, 0)), Vector((1, .05, .2)).normalized(), UP), .008, .0006, sh_linear,
             const(H(0x1a1a1a)), nl=2, S=S_MIN, mat='root')
        return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0x8a4a48), H(0x5a8a40), sm(0, .7, t))
    tip, ph, az = hypocotyl(g, R, u, .015, .0012, stemc)
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .008 + .01 * sm(.05, .3, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .15, sh_linear, lcol(mix(H(0x5aa048), H(0xa8a050), fade)), nl=5)
    if p < .12: return g
    lc = lcol(H(0x255a2c), H(0x2f6a33), rib=H(0x6a9a5a), rib_w=.1)
    # buschig: mehrere Triebe aus der Basis
    nb = 6
    heads = []
    Hmax = .15 * R('h', .9, 1.1)
    for b in range(nb):
        age = p - (.12 + b * .06)
        if age <= 0: continue
        gl = grow(age, .5)
        a = az + b * 2.3999
        th = .05 if b == 0 else .7 + R(f'bt{b}', 0, .3)
        L = (Hmax if b == 0 else Hmax * R(f'bl{b}', .75, .95)) * gl + .01
        B = arc(Vector((0, 0, 0)) if b else tip * .5, a, th, -th * .75, L, 6)
        tube(g, path_pts(B), [.002 * (1 - .5 * i / 6) + .0007 for i in range(7)], stemc, sides=4)
        # gefiederte Blätter an den Knoten, gegenständig
        for n in range(1, 6):
            if n / 6 > gl * 1.1: break
            Pn, dn, zn = B[n]
            la = grow(age - n * .03, .25)
            if la <= 0: continue
            for s in (0, 1):
                aa = a + n * math.pi / 2 + s * math.pi
                pinnate(g, R, Pn, aa, 1.0 + R(f'lt{b}{n}', -.2, .2), .06 * la + .004, 4, .022 * la + .002, .0055 * la + .0005,
                        f'lf{b}{n}{s}', lc, stemc, bend=.45)
        heads.append((B[-1], age, b))
    # Knospen und gefüllte Blütenköpfe
    if p >= .64:
        for (Pt, dt, zt), age, b in heads:
            ped = .025
            end = Pt + dt * ped * sm(.64, .75, p)
            tube(g, [Pt, end], [.0016, .0018], stemc, sides=4)
            M = basis(end, dt, zt)
            op = sm(.84, .96, p)
            if op < .08:
                bud(g, M, .006 + .004 * sm(.64, .84, p), H(0x3f7a3a), H(0xff9020), sm(.74, .84, p))
            else:
                bud(g, M @ Matrix.Translation(Vector((0, -.004, 0))), .0075, H(0x3f7a3a))
                D = .05 * R(f'hd{b}', .85, 1.1)
                # Rotbraun am Grund, sattes Orange, goldener Rand — unter rosa LEDs
                # kippt reines Orange sonst ins Lachsfarbene
                c1 = H(0x8a1a04); c2 = H(0xff7400); c3 = H(0xffb400)
                col = lambda t, s: mix(mix(c1, c2, sm(.15, .6, t)), c3, sm(.75, 1, t) * .8)
                composite_head(g, R, M @ Matrix.Translation(Vector((0, .007, 0))), D,
                               [(11, 1.0, 1.35), (10, .8, .95), (8, .55, .5)], col,
                               const(H(0xe07a10)), op, f'h{b}', disc_raise=.35, ray_w=.45, ruffle=.15, notch=.08)
    return g

def build_zinnie(p, R):
    g = Geo()
    if p < .02:
        leaf(g, basis(Vector((0, .0008, 0)), Vector((1, .05, .1)).normalized(), UP), .009, .0025, sh_lance,
             const(H(0x6a5a40)), nl=2, S=S_MIN, mat='root')
        return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0x7a8a50), H(0x5a9048), t)
    tip, ph, az = hypocotyl(g, R, u, .016, .0015, stemc)
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .008 + .008 * sm(.05, .3, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .55, sh_spatula, lcol(mix(H(0x6ab050), H(0xb0a850), fade), rib=H(0xb0d898)), nl=5)
    if p < .12: return g
    lc = lcol(H(0x3a7a3e), H(0x4a8a48), rib=H(0x9cc488), rib_w=.06)
    Hmax = .34 * R('h', .9, 1.08)
    Hs = Hmax * grow(p - .12, .55) + .01
    pts = [Vector((0, 0, 0)), tip]
    nodes = 6
    lean = R('lean', -.05, .05)
    for k in range(1, nodes + 1):
        y = tip.y + (Hs - tip.y) * (k / nodes) ** .9
        pts.append(Vector((math.sin(az) * lean * y, y, math.cos(az) * lean * y)))
    tube(g, pts, [.0028 * (1 - .4 * i / len(pts)) + .001 for i in range(len(pts))], stemc, sides=5)
    tips = [(pts[-1], UP.copy(), azv(az), 0)]
    for k in range(1, nodes):
        age = p - (.12 + k * .06)
        if age <= 0: continue
        gl = grow(age, .25)
        L = (.085 - .03 * sm(2, 6, k)) * gl + .004
        for s in (0, 1):
            a = az + k * math.pi / 2 + s * math.pi
            leaf(g, basis(pts[k + 1], *tilt(a, lerp(.4, 1.05, sm(0, .3, age)))), L, L * .34, acuminate(outline(.35, .25, .5), .3), lc,
                 nl=9, S=S_MED, bend=.4, fold=.15, cup=.1, seed=k * 2 + s)
        # Seitentriebe aus den oberen Achseln tragen eigene Köpfe
        if k in (2, 3, 4) and p > .42:
            sa = p - .42 - (k - 2) * .04
            if sa > 0:
                sg = grow(sa, .3)
                a = az + k * math.pi / 2 + .7 + k
                B = arc(pts[k + 1], a, .6, -.4, (.14 - .02 * k) * sg + .01, 5)
                tube(g, path_pts(B), [.0024, .0022, .002, .0018, .0016, .0015], stemc, sides=4)
                for q in (2, 4):
                    for s in (0, 1):
                        aa = a + math.pi / 2 + s * math.pi
                        Lq = .04 * sg + .003
                        leaf(g, basis(B[q][0], *tilt(aa, .9)), Lq, Lq * .3, acuminate(sh_ovate, .3), lc, nl=7, S=S_LOW, bend=.4, fold=.15)
                tips.append((B[-1][0], B[-1][1], B[-1][2], k))
    if p >= .66:
        for i, (Pt, dt, zt, k) in enumerate(tips):
            ped = .03 * sm(.66, .8, p) + .002
            end = Pt + dt * ped
            tube(g, [Pt, end], [.0016, .002], stemc, sides=4)
            M = basis(end, dt, zt)
            op = sm(.84, .96, p)
            if op < .08:
                bud(g, M, .006 + .005 * sm(.66, .84, p), H(0x557a40), H(0xff5f8a), sm(.76, .84, p))
            else:
                D = .075 * R(f'hd{i}', .85, 1.05) * (1 if k == 0 else .82)
                pink = H(0xf8386a); deep = H(0xb8103e); light = H(0xff90b0)
                col = lambda t, s: mix(mix(deep, pink, sm(0, .4, t)), light, sm(.8, 1, t) * .5)
                disc = lambda v, k2: mix(H(0x6a2a18), H(0xb07030), sm(.7, 1, v))
                composite_head(g, R, M, D, [(14, 1.0, 1.45), (12, .82, 1.15), (10, .6, .8)], col, disc, op, f'z{i}',
                               disc_raise=.45, ray_w=.42, reflex=.15, notch=.06, star=(12, H(0xffd21a)))
    return g

# ── Rosengewächs: Monatserdbeere ──

def strawberry_leaf(g, R, base, az, th, L, key, lc, pc):
    P = arc(base, az, th, .55, L * .62, 5)
    tube(g, path_pts(P), [.0016 * (1 - .3 * i / 5) for i in range(6)], pc, sides=4)
    end, d, z = P[-1]
    side = d.cross(z)
    ll = L * .38
    for sgn, ang, sc in ((0, 0, 1.0), (-1, .95, .9), (1, .95, .9)):
        dd = (d * math.cos(ang) + side * sgn * math.sin(ang)).normalized() if sgn else d
        leaf(g, basis(end, dd, z), ll * sc, ll * sc * .36, serrate(sh_ovate, 7, .22), lc, nl=13, S=S_LOW,
             bend=.3, fold=.28, pleat=.12, seed=R(key) + sgn)

def strawberry_flower(g, R, M, op):
    for k in range(5):
        a = k * TAU / 5
        d, z = tilt(a, lerp(.3, 1.35, op))
        leaf(g, M @ basis(Vector((0, 0, 0)), d, z), .0075, .0042, sh_round,
             lambda t, s: mix(H(0xf8f6ea), H(0xfffffa), t), nl=4, S=S_LOW, cup=.5, mat='petal')
    for k in range(5):
        a = (k + .5) * TAU / 5
        leaf(g, M @ basis(Vector((0, -.001, 0)), *tilt(a, 1.7)), .005, .0017, sh_lance, const(H(0x5a9a40)), nl=3, S=S_MIN)
    lathe(g, M, [(1e-5, 0), (.0028, .0006), (.0025, .0022), (1e-5, .003)], const(H(0xf0d020)), sides=8, mat='petal')

def strawberry_fruit(g, R, M, s, ripe):
    """Scheinfrucht: aufgequollene Blütenachse, darauf die Nüsschen."""
    L = .018 * s; r = .0075 * s
    prof = [(1e-5, 0)] + [(r * math.sin(math.pi * (v * .55 + .02)) ** .9 * (1 - .2 * v), -L * v) for v in (.08, .2, .35, .5, .65, .8, .92)] + [(1e-5, -L)]
    base = mix(H(0xe8ecc8), H(0xb00818), ripe)
    def col(v, k):
        dot = ((k + (int(v * 8) % 2)) % 2 == 0) and .1 < v < .95
        return mix(base, H(0xe8c040), .45) if dot else base
    lathe(g, M, prof, col, sides=12, mat='fruit')
    for k in range(8):
        a = k * TAU / 8
        leaf(g, M @ basis(Vector((0, .0005, 0)), *tilt(a, 1.45)), .0065 * s + .002, .0022 * s + .0008, sh_lance,
             const(H(0x4a8a38)), nl=3, S=S_MIN, bend=-.4)

def build_erdbeere(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0012, H(0xc05a30)); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0xc07070), H(0x80b060), t)
    tip, ph, az = hypocotyl(g, R, u, .008, .0009, stemc)
    fade = sm(.25, .45, p)
    if fade < 1:
        c = .004 + .004 * sm(.05, .2, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .8, sh_round, lcol(mix(H(0x6ab050), H(0xb0a850), fade)), petiole=.004, nl=4)
    if p < .08: return g
    lc = lcol(H(0x3a8a3c), H(0x48983e), rib=H(0x90c080), rib_w=.07, edge=H(0x2e7030), edge_w=.3)
    pc = lambda t: mix(H(0xa05050), H(0x78a860), sm(0, .5, t))
    crown = Vector((0, .006, 0))
    lathe(g, Matrix.Identity(4), [(.006, -.004), (.0065, .002), (.004, .008), (1e-5, .01)], const(H(0x6a5a38)), sides=8, mat='root')
    for i in range(10):
        age = p - (.08 + i * .06)
        if age <= 0: continue
        gl = grow(age, .3)
        a = az + i * 2.3999 + R(f'a{i}', -.2, .2)
        L = (.07 + .095 * sm(0, 4, i)) * gl * R(f'l{i}', .85, 1.15) + .006
        strawberry_leaf(g, R, crown, a, lerp(.1, .75, sm(0, .45, age)) + R(f't{i}', -.1, .1), L, f'l{i}', lc, pc)
    # Blütenstände, danach Früchte
    if p >= .5:
        for s in range(3):
            a = az + s * 2.1 + 1
            sg = sm(.5, .6, p) + .1
            B = arc(crown, a, .35, .6 + .3 * sm(.68, .9, p), .12 * min(1, sg), 6)
            tube(g, path_pts(B), [.0011] * 7, pc, sides=3)
            end, d, z = B[-1]
            for f in range(2 + (s == 0)):
                fa = a + f * 2.2
                F = arc(end, fa, 1.2, .9 * sm(.68, .9, p), .02, 3)
                tube(g, path_pts(F), [.0007] * 4, pc, sides=3)
                fp, fd, fz = F[-1]
                M = basis(fp, fd, fz)
                bloom = sm(.5, .56, p) * (1 - sm(.66, .72, p))
                if p < .72 and bloom > .05:
                    strawberry_flower(g, R, M, bloom)
                if p >= .66:
                    fs = sm(.66, .92, p) * R(f'fs{s}{f}', .8, 1.1)
                    if fs > .08:
                        ripe = sm(.86, .98, p) * (1 if f < 2 else sm(.95, 1, p))
                        strawberry_fruit(g, R, M @ Matrix.Rotation(math.pi, 4, 'X'), fs, ripe)
    return g

# ── Nachtschattengewächse: Micro-Tom und Chili ──

def tomato_leaf(g, R, base, az, th, L, key, lc, pc):
    P = arc(base, az, th, .8, L, 8)
    tube(g, path_pts(P), [.0017 * (1 - .5 * i / 8) + .0005 for i in range(9)], pc, sides=4)
    for i in (2, 4, 6, 8):
        Pi, d, z = P[i]
        side = d.cross(z)
        f = i / 8
        for sgn in ((-1, 1) if i < 8 else (0,)):
            dd = (d * .5 + side * sgn).normalized() if sgn else d
            ll = L * (.26 + .12 * f) * (1 if sgn == 0 else .85)
            leaf(g, basis(Pi, dd, z), ll, ll * .38, serrate(acuminate(outline(.4, 0, .5), .4), 4, .15), lc, nl=8, S=S_LOW,
                 bend=.55, fold=.12, cup=-.25, pucker=.3, pfreq=6, seed=R(key) * 10 + i + sgn)
            if sgn and i < 8:   # kleine Zwischenfiedern
                Pm = P[i - 1][0]
                leaf(g, basis(Pm, (d * .3 + side * sgn).normalized(), z), ll * .3, ll * .12, sh_ovate, lc, nl=3, S=S_MIN, bend=.3)

def star_flower(g, R, M, n, L, W, col, cone_col, reflex, cone=True):
    for k in range(n):
        a = k * TAU / n
        leaf(g, M @ basis(Vector((0, 0, 0)), *tilt(a, reflex)), L, W, sh_lance, col, nl=4, S=S_LOW, cup=.3, bend=.4, mat='petal')
    for k in range(n):
        leaf(g, M @ basis(Vector((0, -.001, 0)), *tilt((k + .5) * TAU / n, 1.9)), L * .6, W * .5, sh_lance,
             const(H(0x4a8a38)), nl=2, S=S_MIN)
    if cone:
        lathe(g, M, [(.0018, 0), (.0015, .004), (1e-5, .007)], const(cone_col), sides=6, mat='petal')

def tomato_fruit(g, R, M, s, ripe, key):
    r = .011 * s
    prof = [(1e-5, -r * 1.7)] + [(r * math.sin(math.pi * v), -r * (1 - math.cos(math.pi * v)) * .85) for v in (.12, .28, .45, .6, .75, .9)] + [(1e-5, 0)]
    col = mix(mix(H(0x6aa040), H(0xe89030), sm(0, .6, ripe)), H(0xd82a1a), sm(.5, 1, ripe))
    shoulder = mix(H(0x4a8030), col, sm(0, .5, ripe) * .8 + .2)
    lathe(g, M, prof, lambda v, k: mix(col, shoulder, sm(.75, 1, v) * .6), sides=12, mat='fruit',
          deform=lambda q, v, a: q * (1 + .03 * math.cos(a * 5)))
    for k in range(5):
        a = k * TAU / 5 + R(key)
        leaf(g, M @ basis(Vector((0, -.0003, 0)), *tilt(a, 1.3)), .007 * s + .002, .0015, sh_lance, const(H(0x3f7a30)),
             nl=3, S=S_MIN, bend=-.6, twist=.5)

def build_microtom(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0025, H(0xd8c8a0), (1, .4, .9)); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0x8aa860), H(0x6a9848), t)
    tip, ph, az = hypocotyl(g, R, u, .025, .0016, stemc)
    fade = sm(.28, .5, p)
    if fade < 1:
        c = .012 + .008 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .16, sh_lance, lcol(mix(H(0x5aa048), H(0xb0a850), fade), rib=H(0xa0d090)), nl=6)
    if p < .1: return g
    lc = lcol(H(0x2a6a30), H(0x347a36), rib=H(0x7aa870), rib_w=.06)
    Hmax = .17 * R('h', .9, 1.1)
    nodes = 7
    pts = [Vector((0, 0, 0)), tip]
    lean = R('lean', -.12, .12)
    P = tip.copy()
    leaves = []
    for k in range(nodes):
        age = p - (.1 + k * .06)
        if age <= 0: break
        P = P + Vector((math.sin(az) * lean * .02 + R(f'x{k}', -.004, .004), (Hmax / nodes) * sm(0, .25, age) + .003,
                        math.cos(az) * lean * .02 + R(f'z{k}', -.004, .004)))
        pts.append(P.copy())
        leaves.append((k, age, P.copy()))
    tube(g, pts, [.003 * (1 - .5 * i / len(pts)) + .0012 for i in range(len(pts))], stemc, sides=6)
    for k, age, Pk in leaves:
        gl = grow(age, .25)
        tomato_leaf(g, R, Pk, az + k * 2.4, lerp(.3, 1.05, sm(0, .3, age)), (.045 + .07 * sm(0, 3, k) - .025 * sm(4, 7, k)) * gl + .006,
                    f'l{k}', lc, stemc)
    # Seitentriebe machen den Zwerg buschig
    tips = [(pts[-1], 0)]
    for b in range(3):
        age = p - (.26 + b * .06)
        if age <= 0 or len(pts) <= 2 + b: continue
        gl = grow(age, .3)
        a = az + b * 2.3 + 1.2
        B = arc(pts[2 + b], a, .9, -.55, .09 * gl + .01, 5)
        tube(g, path_pts(B), [.0032 * (1 - .4 * i / 5) for i in range(6)], stemc, sides=5)
        for q in (2, 4):
            if q / 5 > gl + .2: continue
            tomato_leaf(g, R, B[q][0], a + q * 1.3, .9, .06 * gl + .006, f'b{b}{q}', lc, stemc)
        tips.append((B[-1][0], b + 1))
    # Blütentrauben → Früchte
    if p >= .5:
        for Pt, i in tips:
            a = az + i * 2.2 + .5
            T = arc(Pt, a, .9, 1.2, .035, 5)
            tube(g, path_pts(T), [.001] * 6, stemc, sides=3)
            for f in range(4 - (i > 0)):
                Pf, df, zf = T[1 + f]
                F = arc(Pf, a + (f - 1.5) * .9, 1.8, .6, .012, 2)
                tube(g, path_pts(F), [.0007] * 3, stemc, sides=3)
                fp, fd, fz = F[-1]
                M = basis(fp, fd, fz)
                bloom = sm(.5, .55, p) * (1 - sm(.66, .72, p))
                if p < .72 and bloom > .05 and R(f'fl{i}{f}') < .9:
                    star_flower(g, R, M, 5, .009, .0022, lambda t, s: mix(H(0xf8d020), H(0xffe860), t), H(0xe8c010), 1.5 + .4 * bloom)
                if p >= .66:
                    fs = sm(.66, .9, p) * R(f'fs{i}{f}', .75, 1.1)
                    if fs > .08:
                        ripe = sm(.86, 1, p + R(f'rp{i}{f}', -.05, .03))
                        tomato_fruit(g, R, M @ Matrix.Rotation(math.pi, 4, 'X'), fs, ripe, f'{i}{f}')
    return g

def chili_pod(g, R, P, s, ripe, key):
    L = .085 * s + .004
    az = R(key + 'az', 0, TAU)
    curve = R(key + 'c', -.4, .4)
    pts, rad = [], []
    n = 10
    for i in range(n + 1):
        t = i / n
        ph = math.pi - .15 - curve * t * t
        pts.append(P + (UP * math.cos(ph) + azv(az) * math.sin(ph)) * L * t + azv(az + 1.5) * curve * .01 * t * t)
        rad.append((.0068 * s + .001) * (1 - t ** 1.6) ** .8 * sm(0, .12, t + .03) + .0003)
    col = lambda t: mix(mix(H(0x2f7a30), H(0x3a8a34), t), H(0xd01a12), clamp(ripe * 1.4 - (1 - t) * .4))
    tube(g, pts, rad, col, sides=8, mat='fruit', cap=False)
    # Kelch
    lathe(g, Matrix.Translation(P + Vector((0, .0015, 0))), [(1e-5, .002), (.004 * s + .0015, 0), (.0045 * s + .002, -.002), (.0048 * s + .002, -.003)],
          const(H(0x3a7a30)), sides=8, mat='stem')

def build_chili(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0035, H(0xe8d8a8), (1, .3, .85)); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0x7a9858), H(0x5a9048), t)
    tip, ph, az = hypocotyl(g, R, u, .03, .0016, stemc)
    fade = sm(.28, .5, p)
    if fade < 1:
        c = .012 + .01 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .2, sh_lance, lcol(mix(H(0x4a9a40), H(0xb0a850), fade), rib=H(0xa0d090)), nl=6)
    if p < .1: return g
    lc = lcol(H(0x2c7434), H(0x3a8a3c), rib=H(0x8ac080), rib_w=.05)
    # Einzelstamm bis zur ersten Gabel, dann dichotome Verzweigung
    fork_y = .13 * R('fy', .9, 1.1)
    gh = grow(p - .1, .45)
    top = Vector((R('lx', -.01, .01), tip.y + (fork_y - tip.y) * gh, R('lz', -.01, .01)))
    tube(g, [Vector((0, 0, 0)), tip, (tip + top) / 2, top], [.0055, .005, .0042, .0036], stemc, sides=6)
    for k in range(4):
        age = p - (.1 + k * .05)
        if age <= 0: continue
        Pk = tip.lerp(top, (k + 1) / 5)
        L = (.05 + .02 * sm(0, 2, k)) * grow(age, .25) + .005
        a = az + k * 2.4
        A = arc(Pk, a, lerp(.4, 1.1, sm(0, .3, age)), .2, L * .3, 2)
        tube(g, path_pts(A), [.001] * 3, stemc, sides=3)
        b, d, z = A[-1]
        leaf(g, basis(b, d, z), L, L * .3, acuminate(sh_ovate, .5), lc, nl=10, S=S_MED, bend=.35, fold=.1, ruffle=.05, rfreq=2, seed=k)
    forks = []
    if p > .3:
        def branch(P0, a, th, lvl, t0, key):
            age = p - t0
            if age <= 0: return
            gl = grow(age, .3)
            L = (.12 - .03 * lvl) * gl + .01
            B = arc(P0, a, th, -th * .4, L, 4)
            tube(g, path_pts(B), [(.0034 - lvl * .0007) * (1 - .3 * i / 4) for i in range(5)], stemc, sides=5)
            for q in (2, 3, 4):
                la = age - q * .02
                if la <= 0: continue
                Pq, dq, zq = B[q]
                Lq = (.07 - .01 * lvl) * grow(la, .22) + .005
                for s in ((-1, 1) if q == 4 else (1 if q % 2 else -1,)):
                    aa = a + s * 1.4 + R(f'{key}{q}{s}', -.3, .3)
                    leaf(g, basis(Pq, *tilt(aa, lerp(.5, 1.2, sm(0, .3, la)))), Lq, Lq * .3, acuminate(sh_ovate, .5), lc,
                         nl=8, S=S_LOW, bend=.35, fold=.1, ruffle=.05, rfreq=2, seed=R(key) + q)
            forks.append((B[-1][0], key, lvl))
            if lvl < 2:
                for s in (-1, 1):
                    branch(B[-1][0], a + s * .9 + R(key + str(s), -.3, .3), .35 + .2 * lvl, lvl + 1, t0 + .09, key + str(s))
        for s in (-1, 1):
            branch(top, az + s * 1.4, .45, 0, .3, 'b' + str(s))
    # Blüten an den Gabeln, dann hängende Schoten
    if p >= .5:
        for i, (Pf, key, lvl) in enumerate(forks):
            if R('fk' + key) > .85: continue
            a = R('fa' + key, 0, TAU)
            F = arc(Pf, a, .6, 1.8, .018, 3)
            tube(g, path_pts(F), [.0009] * 4, stemc, sides=3)
            fp, fd, fz = F[-1]
            bloom = sm(.5, .55, p) * (1 - sm(.66, .72, p))
            if p < .72 and bloom > .05:
                star_flower(g, R, basis(fp, fd, fz), 5, .009, .004, lambda t, s: mix(H(0xf4f4ec), H(0xffffff), t),
                            H(0x8a7ac0), .8 + .5 * bloom)
            if p >= .66:
                s = sm(.66, .92, p) * R('ps' + key, .8, 1.1)
                if s > .05:
                    chili_pod(g, R, fp, s, sm(.9, 1, p + R('pr' + key, -.04, .04)), key)
    return g

# ── Doldenblütler: Möhre ──

def carrot_leaf(g, R, base, az, th, L, key, lc, pc):
    P = arc(base, az, th, .5, L, 7)
    tube(g, path_pts(P), [.0014 * (1 - .6 * i / 7) + .0003 for i in range(8)], pc, sides=3)
    for i in range(2, 8):
        Pi, d, z = P[i]
        side = d.cross(z)
        f = (i - 2) / 5
        for sgn in ((-1, 1) if i < 7 else (0,)):
            dd = (d * .7 + side * sgn).normalized() if sgn else d
            ll = L * .3 * (1 - .55 * f)
            shape = lobed(lambda t: math.sin(math.pi * t ** .8) ** .6, 4, .95, .03, 1.0, p=.6)
            leaf(g, basis(Pi, dd, z, R(key + str(i)) - .5), ll, ll * .36, shape, lc, nl=10, S=S_MIN, bend=.35, twist=.4,
                 fold=.15, seed=R(key) + i, cos_rows=False)

def build_moehre(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .002, H(0x8a7a50), (1, .5, .6)); return g
    u = clamp(p / .14)
    stemc = lambda t: mix(H(0xe0d0b8), H(0xa0c080), t)
    tip, ph, az = hypocotyl(g, R, u, .01, .0009, stemc)
    fade = sm(.4, .65, p)
    if fade < 1:
        c = .012 + .008 * sm(.05, .3, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .07, sh_linear, lcol(mix(H(0x5a9a48), H(0xa8a050), fade)), nl=6, S=S_MIN, spread=.9)
    lc = lcol(H(0x3a8a38), H(0x4a9a40))
    pc = lambda t: mix(H(0x8aa068), H(0x5a9048), t)
    r = .0015 + .0105 * sm(.5, .95, p) * R('r', .85, 1.1)
    crown = Vector((0, r * .6 + .001, 0))
    for i in range(8):
        age = p - (.15 + i * .075)
        if age <= 0: continue
        gl = grow(age, .35)
        a = az + i * 2.3999 + R(f'a{i}', -.2, .2)
        L = (.05 + .13 * sm(0, 4, i)) * gl * R(f'l{i}', .85, 1.12) + .006
        carrot_leaf(g, R, crown, a, lerp(.1, .6, sm(0, .5, age)) + R(f't{i}', -.08, .12), L, f'l{i}', lc, pc)
    # Rübenschulter schaut aus dem Substrat
    if r > .002:
        prof = [(r * .55, -r * 2.2), (r * .85, -r * 1.2), (r, -r * .2), (r * .9, r * .4), (r * .45, r * .75), (1e-5, r * .85)]
        col = lambda v, k: mix(H(0xff7a14), H(0x7a8a30), sm(.65, 1, v) * .8)
        lathe(g, Matrix.Identity(4), prof, col, sides=10, mat='root')
    return g

# ── Gemeinsame Bausteine der späteren Arten ──

def stake(g, P, h, r=.0024, col=H(0xb89a68)):
    """Pflanzstab aus Bambus mit angedeuteten Knoten."""
    pts = [P + UP * (h * i / 6) for i in range(7)]
    tube(g, pts, [r * (1.12 if i % 3 == 0 and 0 < i < 6 else 1) for i in range(7)], const(col), sides=5, cap=True)

def palmate(g, M, L, lobes, shape, lc, seed=0.0, **kw):
    """Handförmiges Blatt aus Lappen, die vom Stielansatz ausstrahlen.
    lobes = [(Winkel in der Blattebene, Länge, Breite)]; der Mittellappen liegt oben."""
    order = sorted(lobes, key=lambda q: -abs(q[0]))
    for k, (ang, l, w) in enumerate(order):
        Mk = M @ Matrix.Translation(Vector((0, 0, .0004 * k))) @ Matrix.Rotation(ang, 4, 'Z')
        leaf(g, Mk, L * l, L * w, shape, lc, seed=seed + ang, **kw)

def tendril(g, P, d, L, col, turns=3.5, r=.0035):
    """Ranke: erst gestreckt, dann zur Spirale gewunden."""
    side = d.cross(UP)
    if side.length < 1e-4: side = Vector((1, 0, 0))
    side.normalize(); up2 = side.cross(d).normalized()
    pts, n = [], 16
    for i in range(n + 1):
        t = i / n
        c = sm(.35, 1, t)
        a = turns * TAU * c
        pts.append(P + d * L * (t - .55 * c * t) + (side * (math.cos(a) - 1) + up2 * math.sin(a)) * r * c)
    tube(g, pts, [.00065 * (1 - .5 * i / n) for i in range(n + 1)], col, sides=3)

def blob(g, M, r, col, sides=8, mat='root', sq=1.0, deform=None):
    """Kleines Ellipsoid (Knolle, Knospe, Beere)."""
    prof = [(max(r * math.sin(math.pi * v), 1e-5), -r * math.cos(math.pi * v) * sq) for v in (0, .15, .32, .5, .68, .85, 1)]
    lathe(g, M, prof, col if callable(col) else const(col), sides=sides, mat=mat, deform=deform)

def wheel_flower(g, R, M, n, L, W, col, eye, op, shape=sh_round, cup=.2, mat='petal', sepal=H(0x4a8a38)):
    """Radförmige Krone: n Zipfel, offen von op 0 (Knospe) bis 1."""
    for k in range(n):
        a = k * TAU / n
        leaf(g, M @ basis(Vector((0, 0, 0)), *tilt(a, lerp(.25, 1.4, op))), L, W, shape, col, nl=4, S=S_LOW,
             cup=cup, bend=.15, mat=mat, seed=k)
    for k in range(n):
        leaf(g, M @ basis(Vector((0, -.0008, 0)), *tilt((k + .5) * TAU / n, 1.7)), L * .45, W * .35, sh_lance,
             const(sepal), nl=2, S=S_MIN)
    if eye is not None:
        lathe(g, M, [(.0016, 0), (.0014, .0035), (1e-5, .0055)], const(eye), sides=5, mat='petal')

# ── Kürbisgewächs: Snackgurke ──

CUKE_LOBES = ((0, 1, .52), (-.8, .86, .48), (.8, .86, .48), (-1.6, .62, .44), (1.6, .62, .44), (-2.35, .34, .4), (2.35, .34, .4))

def cucumber_leaf(g, R, base, az, th, L, key, lc, pc):
    P = arc(base, az, th, .45, L * .85, 4)
    tube(g, path_pts(P), [.0021, .0019, .0017, .0016, .0015], pc, sides=4)
    end, d, z = P[-1]
    dl, zl = tilt(az + R(key + 'r', -.3, .3), 1.35 + R(key + 't', -.12, .12))
    shp = acuminate(outline(.42, .18, .7), .3)
    palmate(g, basis(end, dl, zl), L * .6, CUKE_LOBES, shp, lc, seed=R(key) * 7,
            nl=6, S=S_LOW, cup=.12, bend=.25, pucker=.14, pfreq=4, ruffle=.05, rfreq=2.5)

def cucumber_fruit(g, R, M, s, key):
    """Snackgurke: schlank, kaum bewarzt, dunkelgrün mit hellen Streifen zur Blütenseite."""
    L = .1 * s + .006; r = .0115 * s + .0016
    prof = [(1e-5, 0)] + [(r * math.sin(math.pi * clamp(v * .97 + .015)) ** .28 * (1 - .3 * sm(.85, 1, v)), -L * v)
                          for v in (.03, .1, .25, .45, .65, .85, .95, .99)] + [(1e-5, -L)]
    def col(v, k):
        stripe = sm(.4, 1, v) * (.5 + .5 * math.cos(k * TAU / 5))
        return mix(mix(H(0x1c4e1e), H(0x2a6a2a), v * .5), H(0x8ab860), stripe * .45)
    curve = R(key + 'c', -.4, .4)
    lathe(g, M, prof, col, sides=10, mat='fruit',
          deform=lambda q, v, a: Vector((q.x * (1 + .04 * math.sin(a * 5) * math.sin(v * 40)) + curve * .02 * v * v, q.y,
                                         q.z * (1 + .04 * math.sin(a * 5) * math.sin(v * 40)))))
    return M @ Vector((curve * .02, -L, 0))

def cucumber_flower(g, R, M, op, key):
    lc = lcol(H(0xe0a008), H(0xffd426), rib=H(0xc89008), rib_w=.12)
    for k in range(5):
        a = k * TAU / 5 + R(key, 0, 1)
        leaf(g, M @ basis(Vector((0, 0, 0)), *tilt(a, lerp(.3, 1.3, op))), .015, .0095, outline(.6, .35, .55), lc,
             nl=4, S=S_LOW, cup=.35, bend=.35, ruffle=.12, rfreq=1.5, mat='petal', seed=k)
    lathe(g, M, [(.0025, -.001), (.0022, .002), (1e-5, .004)], const(H(0xd8a010)), sides=6, mat='petal')

def build_gurke(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .009, H(0xeadcb4), (1, .22, .45)); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0xb8c890), H(0x6a9a48), t)
    tip, ph, az = hypocotyl(g, R, u, .035, .0022, stemc, lean=.1)
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .017 + .012 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .5, outline(.5, .25, .1),
                   lcol(mix(H(0x5aa048), H(0xb0a850), fade), rib=H(0xa8d090)), nl=6, S=S_MED, cup=.15)
    if p < .1: return g
    lc = lcol(H(0x2f7a32), H(0x3c8c3c), rib=H(0x8ab878), rib_w=.05)
    pc = lambda t: mix(H(0x7a9858), H(0x5a8e44), t)
    # Stab, an dem die Ranke hochklettert
    S0 = azv(az + math.pi) * .022
    stake(g, S0, .55)
    gy = tip.y
    pts = [Vector((0, 0, 0)), tip]
    nodes = []
    for k in range(10):
        age = p - (.1 + k * .042)
        if age <= 0: break
        gy += .046 * sm(0, .14, age) + .004
        w = sm(0, 2.5, k)
        P = Vector((0, gy, 0)).lerp(S0 + azv(az + k * 1.3) * .009 + UP * gy, w)
        P.y = gy
        pts.append(P); nodes.append((k, age, P))
    tube(g, pts, [.0034 * (1 - .45 * i / len(pts)) + .0012 for i in range(len(pts))], stemc, sides=6)
    fruit_on = []
    for k, age, P in nodes:
        gl = grow(age, .2)
        a = az + k * 2.5 + R(f'a{k}', -.3, .3)
        L = (.06 + .055 * sm(0, 3, k)) * gl * R(f'l{k}', .88, 1.1) + .008
        cucumber_leaf(g, R, P, a, lerp(.4, 1.0, sm(0, .25, age)), L, f'l{k}', lc, pc)
        if k >= 2 and age > .05:
            tendril(g, P, (azv(a + 2.4) * .8 + UP * .6).normalized(), .05 * grow(age - .05, .15) + .008, pc)
        if k >= 2 and R(f'f{k}') < .8:
            fruit_on.append((k, P, a + math.pi))
    # Seitentrieb aus dem dritten Knoten
    if p > .4 and len(nodes) > 3:
        sa = p - .4; sg = grow(sa, .3)
        a = az + 1.9
        B = arc(nodes[2][2], a, 1.0, -.4, .14 * sg + .01, 5)
        tube(g, path_pts(B), [.0024 * (1 - .4 * i / 5) for i in range(6)], stemc, sides=5)
        for q in (2, 4):
            if q / 5 > sg + .25: continue
            cucumber_leaf(g, R, B[q][0], a + q * 1.6, .8, .07 * sg + .01, f'b{q}', lc, pc)
        if p > .55: fruit_on.append((99, B[3][0], a))
    # Blüten (rein weiblich, parthenokarp) und die Früchte dahinter
    if p >= .5:
        for k, P, a in fruit_on:
            fs = sm(.56, .9, p + R(f'fo{k}', -.04, .04)) * R(f'fs{k}', .8, 1.08)
            F = arc(P, a, 1.4, .4, .012, 2)
            tube(g, path_pts(F), [.0012] * 3, pc, sides=4)
            fp, fd, fz = F[-1]
            M = basis(fp, UP, azv(a)) @ Matrix.Rotation(R(f'ft{k}', -.35, .35), 4, 'Z')
            tipP = cucumber_fruit(g, R, M, fs * .92 + .08, f'c{k}')
            bloom = sm(.5, .56, p) * (1 - sm(.66, .74, p))
            if bloom > .05:
                d = (tipP - fp).normalized()
                cucumber_flower(g, R, basis(tipP, -d, azv(a)), bloom, f'fl{k}')
    return g

# ── Nachtschattengewächse: Blockpaprika und Kartoffel ──

def pepper_fruit(g, R, M, s, ripe, key):
    """Blockpaprika: vier Kammern, breite Schultern, hängt am gebogenen Stiel."""
    h = .07 * s + .004; r = .033 * s + .002
    prof = [(1e-5, -h + .006 * s), (r * .45, -h - .001), (r * .8, -h * .95), (r * .96, -h * .78), (r, -h * .45),
            (r * .99, -h * .18), (r * .9, -h * .03), (r * .55, .001), (r * .22, -.003 * s), (1e-5, -.002 * s)]
    base = mix(H(0x23581f), H(0x2f6a26), .5)
    ripe_c = mix(H(0xc8a000), H(0xe0bc00), .6)       # unter den LEDs bleicht helles Gelb aus
    def col(v, k):
        c = mix(base, ripe_c, clamp(ripe * 1.3 - (1 - v) * .3))
        return mix(c, H(0x3a6a20), sm(.92, 1, v) * .6)
    lathe(g, M, prof, col, sides=16, mat='fruit',
          deform=lambda q, v, a: Vector((q.x * (1 + .12 * math.cos(4 * a + .4)), q.y + .005 * s * math.cos(4 * a + .4) * sm(.25, 0, v),
                                         q.z * (1 + .12 * math.cos(4 * a + .4)))))
    lathe(g, M, [(.0045 * s + .0015, .0005), (.0035 * s + .001, .003), (.0016, .006), (.0013, .014)],
          const(H(0x3a7a30)), sides=7, mat='stem')

def build_paprika(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .004, H(0xe8d8a8), (1, .3, .85)); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0x7a9858), H(0x4f8a40), t)
    tip, ph, az = hypocotyl(g, R, u, .032, .0018, stemc)
    fade = sm(.28, .5, p)
    if fade < 1:
        c = .014 + .01 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .24, sh_lance, lcol(mix(H(0x4a9a40), H(0xb0a850), fade), rib=H(0xa0d090)), nl=6)
    if p < .1: return g
    lc = lcol(H(0x2a6a32), H(0x357a3d), rib=H(0x80b878), rib_w=.05)
    fork_y = .15 * R('fy', .92, 1.08)
    gh = grow(p - .1, .45)
    top = Vector((R('lx', -.008, .008), tip.y + (fork_y - tip.y) * gh, R('lz', -.008, .008)))
    tube(g, [Vector((0, 0, 0)), tip, (tip + top) / 2, top], [.0068, .006, .0052, .0045], stemc, sides=7)
    for k in range(5):
        age = p - (.1 + k * .045)
        if age <= 0: continue
        Pk = tip.lerp(top, (k + 1) / 6)
        L = (.065 + .03 * sm(0, 2, k)) * grow(age, .25) + .006
        a = az + k * 2.4
        A = arc(Pk, a, lerp(.4, 1.1, sm(0, .3, age)), .2, L * .32, 2)
        tube(g, path_pts(A), [.0013] * 3, stemc, sides=3)
        b, d, z = A[-1]
        leaf(g, basis(b, d, z), L, L * .42, acuminate(sh_ovate, .45), lc, nl=10, S=S_MED, bend=.4, fold=.08, cup=-.15,
             ruffle=.04, rfreq=2, pucker=.06, seed=k)
    forks = []
    if p > .3:
        def branch(P0, a, th, lvl, t0, key):
            age = p - t0
            if age <= 0: return
            gl = grow(age, .3)
            L = (.13 - .035 * lvl) * gl + .01
            B = arc(P0, a, th, -th * .45, L, 4)
            tube(g, path_pts(B), [(.0042 - lvl * .0009) * (1 - .3 * i / 4) for i in range(5)], stemc, sides=5)
            for q in (2, 3, 4):
                la = age - q * .02
                if la <= 0: continue
                Pq, dq, zq = B[q]
                Lq = (.085 - .012 * lvl) * grow(la, .22) + .006
                for s in ((-1, 1) if q == 4 else (1 if q % 2 else -1,)):
                    aa = a + s * 1.4 + R(f'{key}{q}{s}', -.3, .3)
                    A = arc(Pq, aa, lerp(.5, 1.15, sm(0, .3, la)), .15, Lq * .3, 2)
                    tube(g, path_pts(A), [.0012] * 3, stemc, sides=3)
                    b, d, z = A[-1]
                    leaf(g, basis(b, d, z), Lq, Lq * .42, acuminate(sh_ovate, .45), lc,
                         nl=8, S=S_MED, bend=.4, fold=.08, cup=-.15, ruffle=.04, rfreq=2, seed=R(key) + q)
            forks.append((B[-1][0], key, lvl))
            if lvl < 1:
                for s in (-1, 1):
                    branch(B[-1][0], a + s * .9 + R(key + str(s), -.3, .3), .4, lvl + 1, t0 + .1, key + str(s))
        for s in (-1, 1):
            branch(top, az + s * 1.45, .5, 0, .3, 'b' + str(s))
    # Blüten in den Gabeln, dann schwere, hängende Früchte
    if p >= .5:
        for i, (Pf, key, lvl) in enumerate(forks):
            if R('fk' + key) > (.9 if lvl == 0 else .55): continue
            a = R('fa' + key, 0, TAU)
            F = arc(Pf, a, .7, 1.7, .02, 3)
            tube(g, path_pts(F), [.0014] * 4, stemc, sides=4)
            fp, fd, fz = F[-1]
            bloom = sm(.5, .55, p) * (1 - sm(.66, .72, p))
            if p < .72 and bloom > .05:
                star_flower(g, R, basis(fp, fd, fz), 6, .011, .0045, lambda t, s: mix(H(0xf2f2e8), H(0xffffff), t),
                            H(0xd8c860), .8 + .5 * bloom)
            if p >= .64:
                s = sm(.64, .9, p) * R('ps' + key, .85, 1.08)
                if s > .05:
                    pepper_fruit(g, R, Matrix.Translation(fp + Vector((0, -.004, 0))) @ Matrix.Rotation(R('pt' + key, -.25, .25), 4, 'Z'),
                                 s, sm(.88, 1, p + R('pr' + key, -.05, .03)), key)
    return g

def potato_tuber(g, M, r, green=0.0, key=0.0):
    """Knolle mit flachen Augen; grüne Stellen dort, wo Licht hinkommt."""
    skin = H(0xc89a5a); hi = H(0xdab27a)
    def col(v, k):
        c = mix(skin, hi, .5 + .5 * math.sin(k * 1.7 + v * 5 + key))
        return mix(c, H(0x8a9a40), green * sm(.5, 1, v))
    def deform(q, v, a):
        e = math.exp(-((math.sin(a * 2.5 + key) * .5 + .5 - .9) / .07) ** 2) * math.sin(math.pi * v) * .12
        return q * (1 - e) + Vector((0, 0, 0))
    prof = [(max(r * math.sin(math.pi * v) ** .85, 1e-5), -r * .78 * math.cos(math.pi * v)) for v in (0, .12, .28, .45, .6, .75, .88, 1)]
    lathe(g, M @ Matrix.Diagonal(Vector((1.25, 1, 1, 1))), prof, col, sides=10, mat='root', deform=deform)

def potato_leaf(g, R, base, az, th, L, key, lc, pc):
    """Unpaarig gefiedert, mit kleinen Zwischenfiedern."""
    P = arc(base, az, th, .7, L, 8)
    tube(g, path_pts(P), [.0016 * (1 - .5 * i / 8) + .0005 for i in range(9)], pc, sides=4)
    shp = acuminate(outline(.42, .12, .45), .25)
    for i in (2, 4, 6, 8):
        Pi, d, z = P[i]
        side = d.cross(z)
        f = i / 8
        for sgn in ((-1, 1) if i < 8 else (0,)):
            dd = (d * .45 + side * sgn).normalized() if sgn else d
            ll = L * (.24 + .1 * f) * (1.15 if sgn == 0 else 1)
            leaf(g, basis(Pi, dd, z), ll, ll * .55, shp, lc, nl=8, S=S_LOW, bend=.4, cup=-.2, pucker=.22, pfreq=5,
                 seed=R(key) * 10 + i + sgn)
        if 2 < i:
            Pm, dm, zm = P[i - 1]
            sm_ = dm.cross(zm)
            for sgn in (-1, 1):
                leaf(g, basis(Pm, (dm * .3 + sm_ * sgn).normalized(), zm), L * .07, L * .045, sh_ovate, lc, nl=3, S=S_MIN, bend=.2)

def build_kartoffel(p, R):
    g = Geo()
    sink = sm(.1, .5, p)
    # Pflanzknolle — erst obenauf, später angehäufelt
    if p < .5:
        potato_tuber(g, Matrix.Translation(Vector((0, .006 - .02 * sink, 0))) @ Matrix.Rotation(R('ta', 0, TAU), 4, 'Y'),
                     .016, 0, R('tk', 0, 6))
    if p < .02: return g
    u = clamp(p / .14)
    stemc = lambda t: mix(H(0x8a6a78), H(0x5a8a46), sm(0, .6, t))
    if p < .14:
        # Keimtrieb, violett, mit eingerolltem Blattschopf
        tip, ph, az = hypocotyl(g, R, u, .03, .0026, stemc, lean=.15)
        blob(g, Matrix.Translation(tip), .004 + .003 * u, H(0x5a8a40), sides=6, mat='leaf')
        return g
    az = R('haz', 0, TAU)
    senesce = sm(.86, 1, p)
    lc = lcol(mix(H(0x2f6a32), H(0xb0a040), senesce * .75), mix(H(0x3c7a3a), H(0xc8b050), senesce * .75),
              rib=mix(H(0x7aa868), H(0xc8b880), senesce), rib_w=.05)
    tops = []
    for b in range(3):
        age = p - (.12 + b * .05)
        if age <= 0: continue
        gl = grow(age, .4)
        a = az + b * 2.2
        th = (.12 if b == 0 else .4) + .35 * senesce
        Ls = (.3 - .06 * b) * gl * R(f'sl{b}', .9, 1.08) + .02
        B = arc(azv(a) * .006, a, th, .25 + .2 * senesce, Ls, 7)
        tube(g, path_pts(B), [.0042 * (1 - .45 * i / 7) + .001 for i in range(8)], stemc, sides=5)
        for n in range(1, 8):
            la = age - n * .035
            if la <= 0: continue
            Pn = B[n][0]
            ll = (.11 + .05 * sm(1, 4, n) - .04 * sm(5, 7, n)) * grow(la, .22) + .008
            potato_leaf(g, R, Pn, a + n * 2.4, lerp(.4, 1.0, sm(0, .25, la)) + .3 * senesce, ll, f'k{b}{n}', lc, stemc)
        tops.append((B[-1], b))
    # Trugdolden mit fliederfarbenen Radblüten
    if .5 <= p < .82:
        op = sm(.55, .62, p)
        fade = sm(.74, .82, p)
        for (Pt, dt, zt), b in tops:
            if b == 2: continue
            C = arc(Pt, az + b, .3, .5, .035, 3)
            tube(g, path_pts(C), [.0012] * 4, stemc, sides=3)
            end = C[-1][0]
            for f in range(5):
                fa = f * TAU / 5 + b
                fp = end + azv(fa) * .012 + UP * (.004 + .003 * (f % 2))
                tube(g, [end, fp], [.0007, .0006], stemc, sides=3)
                fd = (azv(fa) * .5 + UP).normalized()
                if op < .3 or f == 4:
                    blob(g, basis(fp, fd, azv(fa)) @ Matrix.Translation(Vector((0, .004, 0))), .003, H(0xb8a0c8), sides=5, mat='petal', sq=1.5)
                elif fade < .9:
                    wheel_flower(g, R, basis(fp, fd, azv(fa)), 5, .011 * (1 - .4 * fade), .008, lcol(H(0xc8b0e8), H(0xe8dcf8)),
                                 H(0xf0c818), op * (1 - fade), shape=outline(.6, .4, .45), cup=.1)
    # Knollen am Ende der Stolonen, die obersten schauen aus dem Substrat
    if p > .55:
        tg = sm(.55, .95, p)
        for t in range(4):
            a = az + t * 1.7 + R(f'ka{t}', -.3, .3)
            r = (.017 - .003 * t) * tg * R(f'kr{t}', .8, 1.1) + .002
            d = .035 + .015 * t
            potato_tuber(g, Matrix.Translation(azv(a) * d + UP * (-r * (.35 + .15 * t))) @ Matrix.Rotation(a, 4, 'Y'),
                         r, .35 * (t == 0) * sm(.8, 1, p), R(f'kk{t}', 0, 6))
    return g

# ── Korbblütler: Zwergsonnenblume ──

GOLDEN = math.pi * (3 - math.sqrt(5))

def floret(g, P, nrm, r, h, col, mat='petal'):
    """Einzelne Röhrenblüte als vierseitiges Pyramidchen."""
    V, C, F = g.part(mat)
    a = Vector((1, 0, 0)) if abs(nrm.x) < .9 else Vector((0, 0, 1))
    X = (a - nrm * a.dot(nrm)).normalized(); Y = nrm.cross(X)
    b = len(V)
    for k in range(4):
        an = k * TAU / 4
        V.append(P + (X * math.cos(an) + Y * math.sin(an)) * r); C.append(col)
    V.append(P + nrm * h); C.append(col)
    for k in range(4):
        F.append((b + k, b + (k + 1) % 4, b + 4))

def sunflower_head(g, R, M, D, op, key, bud_op=1.0):
    """Korb: Zungenblüten in zwei Kreisen (21 + 13), Röhrenblüten in Vogels
    Spirale mit dem Goldenen Winkel — die Fibonacci-Spiralen entstehen von selbst."""
    r = D / 2; dr = r * .56
    # Hüllblätter
    for ring, (n, L) in enumerate(((13, r * .55), (13, r * .42))):
        for k in range(n):
            a = (k + ring * .5) * TAU / n
            leaf(g, M @ basis(Vector((math.sin(a), 0, math.cos(a))) * dr * .92 + Vector((0, -dr * .2, 0)), *tilt(a, lerp(.15, 1.25, bud_op) + .5 * op + ring * .15)),
                 L * lerp(1.5, 1, bud_op), L * .38, acuminate(sh_ovate, .5), lcol(H(0x3a7a32), H(0x4a8a3a)), nl=4, S=S_LOW, cup=.3, bend=.3)
    if bud_op < .35:
        blob(g, M @ Matrix.Translation(Vector((0, -dr * .1, 0))), dr * 1.02, H(0x3f7a34), sides=12, mat='leaf', sq=.55)
        return
    # Zungenblüten
    if True:                       # Zungenblüten entfalten sich vor den Röhrenblüten
        yc = lambda t, s: mix(mix(H(0xe89800), H(0xffbe1a), sm(0, .35, t)), H(0xffd040), sm(.7, 1, t) * .6)
        for ring, (n, lf) in enumerate(((21, 1.0), (13, .85))):
            for k in range(n):
                a = (k + ring * .5) * TAU / n + R(f'{key}z{ring}{k}', -.05, .05)
                th = lerp(.2, 1.42 + .08 * ring, op)
                L = (r - dr) * 1.25 * lf * lerp(.5, 1, op)
                leaf(g, M @ basis(Vector((math.sin(a), 0, math.cos(a))) * dr * .95 + Vector((0, ring * .001, 0)), *tilt(a, th)),
                     L, L * .3, outline(.5, .35, .35), yc, nl=5, S=S_LOW, cup=.25, bend=.2, ruffle=.08, rfreq=1.5,
                     notch=.04, mat='petal', seed=ring * 30 + k)
    # Korbboden
    lathe(g, M, [(1e-5, -dr * .3), (dr * .9, -dr * .25), (dr, -dr * .05), (dr * .7, dr * .1), (1e-5, dr * .14)],
          const(H(0x3a2a10)), sides=16, mat='petal')
    # Röhrenblüten, von außen nach innen aufblühend
    n = 200
    for i in range(n):
        f = math.sqrt((i + .5) / n)
        a = i * GOLDEN
        rr = dr * .96 * f
        y = dr * .14 * (1 - f * f) + .0004
        P = M @ Vector((math.sin(a) * rr, y, math.cos(a) * rr))
        nrm = (M.to_3x3() @ Vector((math.sin(a) * f * .5, 1, math.cos(a) * f * .5))).normalized()
        bloom_f = f > 1 - .45 * op
        if bloom_f:
            c = mix(H(0x5a3008), H(0xc88a10), sm(.75, 1, f))
        else:
            c = mix(H(0x2a1a08), H(0x4a5a18), sm(.4, 0, f))
        rf = dr * 1.05 / math.sqrt(n)
        floret(g, P, nrm, rf, rf * (1.6 if bloom_f else .9), c)

def build_sonnenblume(p, R):
    g = Geo()
    if p < .02:
        leaf(g, basis(Vector((0, .0015, 0)), Vector((1, .05, .2)).normalized(), UP), .011, .0035, sh_ellipse,
             lambda t, s: mix(H(0x2a2420), H(0xb0b0a8), (abs(s) > .5) * .7), nl=3, S=S_LOW, mat='root', cup=.6)
        return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0x8a9a60), H(0x4a8a3a), t)
    tip, ph, az = hypocotyl(g, R, u, .04, .0026, stemc, lean=.08)
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .018 + .012 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .48, outline(.45, .3, .2),
                   lcol(mix(H(0x4a9a40), H(0xb0a850), fade), rib=H(0xa0d090)), nl=6, S=S_MED, cup=.1)
    if p < .12: return g
    lc = lcol(H(0x3a7a32), H(0x4c8c3f), rib=H(0x9cc488), rib_w=.05)
    Hmax = .38 * R('h', .92, 1.06)
    Hs = tip.y + (Hmax - tip.y) * sm(.12, .8, p) ** 1.25
    # Stängel neigt den Kopf zum Gang (lokal +z)
    nod = .55 * sm(.7, .9, p)
    pts = [Vector((0, 0, 0)), tip]
    n = 8
    lean = R('lean', -.03, .03)
    for k in range(1, n + 1):
        f = k / n
        y = tip.y + (Hs - tip.y) * f
        pts.append(Vector((lean * y, y, nod * .06 * sm(.6, 1, f))))
    tube(g, pts, [.0055 * (1 - .45 * i / len(pts)) + .0012 for i in range(len(pts))], stemc, sides=7, cap=True)
    shp = acuminate(serrate(lambda t: math.sin(math.pi * (.15 + .85 * t) ** .8) ** .6, 9, .1), .4)
    for k in range(1, n):
        age = p - (.12 + k * .055)
        if age <= 0: continue
        gl = grow(age, .25)
        L = (.075 + .02 * sm(0, 3, k) - .035 * sm(4, 7, k)) * gl + .006
        a = az + (k * math.pi / 2 if k < 3 else k * 2.4)
        A = arc(pts[k + 1], a, lerp(.5, 1.0, sm(0, .3, age)), .3, L * .55, 3)
        tube(g, path_pts(A), [.0016, .0015, .0014, .0013], stemc, sides=4)
        b, d, z = A[-1]
        leaf(g, basis(b, d, z) @ Matrix.Translation(Vector((0, -.18 * L, 0))), L, L * .5, shp, lc, nl=10, S=S_MED,
             bend=.45, cup=-.1, pucker=.18, pfreq=4, seed=k, sinus=.18)
    # junge Blätter am Scheitel, solange noch keine Knospe sitzt
    if p < .62:
        for s in range(3):
            L = .028 * (1 - sm(.5, .62, p)) + .004
            leaf(g, basis(pts[-1], *tilt(az + s * 2.1, .35 + .15 * s)), L, L * .45, sh_ovate, lc, nl=5, S=S_LOW, cup=.4, bend=.2)
    # Knospe, dann der Korb
    if p >= .55:
        top = pts[-1]
        face = (UP * math.cos(.15 + 1.05 * sm(.7, .95, p)) + Vector((0, 0, 1)) * math.sin(.15 + 1.05 * sm(.7, .95, p))).normalized()
        M = basis(top + face * .006, face, Vector((0, 1, 0)) if abs(face.y) < .95 else Vector((0, 0, -1)))
        D = (.03 + .085 * sm(.55, .9, p)) * R('hd', .9, 1.08)
        sunflower_head(g, R, M, D, sm(.84, .95, p), 'h', sm(.76, .86, p))
    return g

# ── Pilz: Austernseitling auf Strohsubstrat ──

def substrate_block(g, w, d, h, colfn, sides=72, n=5.0):
    """Block mit fast rechteckigem Grundriss (Superellipse) und gerundeten Kanten."""
    prof = ([(.9, 0), (.975, .006)] + [(1, lerp(.02, h - .018, i / 8)) for i in range(9)] +
            [(.985, h - .007), (.93, h - .001)] + [(lerp(.86, .04, i / 7), h + .002 + .001 * math.sin(math.pi * i / 7)) for i in range(8)] +
            [(1e-4, h + .002)])
    rows, cols = [], []
    for sc, y in prof:
        row = []
        for k in range(sides):
            a = k * TAU / sides
            sa, ca = math.sin(a), math.cos(a)
            x = math.copysign(abs(sa) ** (2 / n), sa) * w / 2 * sc
            z = math.copysign(abs(ca) ** (2 / n), ca) * d / 2 * sc
            P = Vector((x, y, z))
            # gestopftes Stroh: die Oberfläche beult sich unregelmäßig
            b = noise.noise(P * 38) * .5 + noise.noise(P * 90 + Vector((3, 1, 2))) * .25
            P = Vector((x * (1 + .035 * b * sc), y + .004 * b * (y > h * .9), z * (1 + .035 * b * sc)))
            row.append(P); cols.append(colfn(P))
        rows.append(row)
    g.grid('root', rows, cols, closed=True)

def oyster_cap(g, M, Lc, op, top, gill, key):
    """Muschelförmiger Hut, seitlich am Stiel. Lokal: +Y vom Stiel weg, +Z oben.
    Jung mit eingerolltem Rand, reif flach und gewellt; Lamellen laufen am Stiel herab."""
    nl, ns = 7, 10
    tr, br, tc, bc = [], [], [], []
    curl = 1 - op
    for i in range(nl + 1):
        t = i / nl
        w = Lc * .58 * math.sin(math.pi / 2 * t) ** .65 * (1 + .2 * t)
        rowt, rowb = [], []
        for j in range(ns + 1):
            s = j / ns * 2 - 1
            x = s * w
            y = Lc * t * (1 - .18 * s * s * t)
            z = Lc * (.16 * (1 - s * s) * math.sin(math.pi * min(t, 1) * .8) - .1 * (1 - sm(0, .35, t)))
            z -= Lc * .16 * curl * sm(.6, 1, t) ** 2
            z += Lc * .025 * op * math.sin(s * 3 + key * 3) * sm(.7, 1, t)
            th = Lc * (.07 * (1 - t) + .012)
            ridge = Lc * .025 * abs(math.sin(s * 9 + key)) * sm(.05, .2, t) * (1 - sm(.85, 1, t))
            rowt.append(M @ Vector((x, y, z)))
            rowb.append(M @ Vector((x, y, z - th - ridge)))
            tc.append(mix(top, mix(top, H(0xd8d0c0), .5), sm(.6, 1, t) * .6 + .3 * (1 - op) * 0))
            bc.append(mix(gill, H(0xf4eee0), sm(.3, 1, t) * .5))
        tr.append(rowt); br.append(rowb)
    V, C, F = g.part('petal')
    g.grid('petal', tr, tc)
    g.grid('petal', br, bc)

def build_austernpilz(p, R):
    g = Geo()
    W, Dp, Hb = .17, .25, .1
    myc = sm(.03, .6, p) * 1.12
    straw = H(0xb89a50); straw2 = H(0x8a6a30); white = H(0xf2f0e6)
    def bcol(P):
        n1 = noise.noise(Vector((P.x * 60, P.y * 160, P.z * 60)))
        n2 = noise.noise(Vector((P.x * 140 + 3, P.y * 30, P.z * 140)))
        c = mix(straw, straw2, .5 + .5 * n1)
        c = mix(c, H(0xd8c070), sm(.3, .7, n2) * .6)
        patch = noise.noise(Vector((P.x * 18 + 7, P.y * 18, P.z * 18))) * .5 + .5
        m = sm(-.08, .08, myc - patch * .9 - .05)
        return mix(c, mix(white, H(0xd4ccb6), .5 + .5 * n1), m * (.7 + .2 * sm(-.3, .5, n2)))
    substrate_block(g, W, Dp, Hb, bcol)
    if p < .55: return g
    # Fruchtstellen: oben, an der Gangseite (+z) und an einer Stirnseite
    sites = [(Vector((R('sx', -.03, .03), Hb + .002, R('sz', -.05, .04))), UP, 1.0),
             (Vector((R('fx', -.03, .03), Hb * .55, Dp / 2 + .001)), Vector((0, 0, 1)), .9),
             (Vector((W / 2 + .001, Hb * .5, R('ex', -.06, .06))), Vector((1, 0, 0)), .7)]
    prim = sm(.55, .68, p)
    fruit = sm(.72, .97, p)
    for si, (S, nrm, wgt) in enumerate(sites):
        if R(f'site{si}') > .85 and si == 2: continue
        side = nrm.cross(UP) if abs(nrm.y) < .9 else Vector((1, 0, 0))
        side.normalize()
        ncap = 11 + int(R(f'n{si}', 0, 6))
        for c in range(ncap):
            a = (c / ncap - .5) * 2.2 + R(f'a{si}{c}', -.2, .2)
            lay = R(f'l{si}{c}')
            # Richtung: vom Substrat weg, nach außen gefächert und leicht aufwärts
            out = (nrm * .8 + side * math.sin(a) * .9 + UP * (.35 + .4 * lay)).normalized()
            if abs(nrm.y) > .9:
                out = (azv(c * 2.4 + R(f'o{si}', 0, 6)) * .9 + UP * (.5 + .3 * lay)).normalized()
            base = S + side * math.sin(a) * .006 + UP * (lay - .5) * .01 * (abs(nrm.y) < .9)
            size = R(f's{si}{c}', .55, 1.0) * wgt
            if fruit <= .02:
                k = prim * size
                if k > .05:
                    blob(g, Matrix.Translation(base + out * .004 * k), .0035 * k + .0008,
                         mix(H(0x4a5060), H(0x8a8a90), R(f'pc{si}{c}')), sides=6, mat='petal')
                continue
            Lc = (.014 + .058 * fruit) * size + .004
            stem_l = .006 + .008 * size
            tip = base + out * stem_l
            tube(g, [base, (base + tip) / 2 + UP * .001, tip], [.0042 * size + .001, .0034 * size + .001, .0028 * size + .0008],
                 const(H(0xeeeae0)), sides=5)
            dH = (out + UP * .25).normalized()
            zH = (UP - dH * UP.dot(dH)).normalized()
            top = mix(mix(H(0x464a56), H(0x857e72), fruit), H(0xa09684), R(f'tc{si}{c}') * .35)
            oyster_cap(g, basis(tip - dH * .002, dH, zH), Lc, fruit, top, H(0xe6dece), R(f'k{si}{c}', 0, 6))
    return g

# ── Orchideen: Phalaenopsis ──

def phal_flower(g, R, M, op, key):
    """Lokal: Blüte schaut nach +Z, +Y ist oben. Drei Sepalen, zwei breite
    Petalen, dreilappige Lippe mit gelbem Schwiel, Säule in der Mitte."""
    s = .55 + .45 * op
    white = lcol(H(0xf4e4ee), H(0xfdf6fa), rib=H(0xe8b8d4), rib_w=.25, rib_fade=.2)
    def part(a, L, W, shape, col, cup=-.05, bend=-.1, z0=0.0):
        d = Vector((math.sin(a), math.cos(a), 0))
        nrm = Vector((0, 0, 1))
        leaf(g, M @ basis(Vector((0, 0, z0)), (d + nrm * lerp(1.2, .12, op)).normalized(), nrm), L * s, W * s, shape, col,
             nl=6, S=S_MED, cup=cup, bend=bend, mat='petal', seed=a)
    part(0, .03, .011, outline(.5, .15, .3), white)
    for sg in (-1, 1):
        part(sg * 2.45, .029, .011, outline(.5, .15, .3), white, z0=-.0004)
        part(sg * 1.3, .03, .022, outline(.55, .1, .05), white, cup=-.1, z0=.0006)
    lip = lambda t, s2: mix(mix(H(0xd84a90), H(0xffd030), sm(.3, 0, t) * .9), H(0xe03070), sm(.6, 1, t))
    part(math.pi, .019, .009, lambda t: (.6 + .4 * math.sin(math.pi * t * 2.2) ** 2) * math.sin(math.pi * t) ** .4, lip,
         cup=.6, bend=.4, z0=.002)
    lathe(g, M @ Matrix.Rotation(math.pi / 2, 4, 'X'), [(.0025, -.002), (.002, .004), (.0015, .008), (1e-5, .009)],
          const(H(0xf6eef0)), sides=6, mat='petal')

def build_orchidee(p, R):
    g = Geo()
    # Rindenstücke als Substrat
    for b in range(9):
        a = b * 2.4 + R('ba', 0, 1); rr = .012 + .03 * R(f'br{b}')
        sz = R(f'bs{b}', .006, .012)
        lathe(g, Matrix.Translation(azv(a) * rr + UP * .001) @ Matrix.Rotation(R(f'bt{b}', 0, 3), 4, 'Y') @ Matrix.Rotation(.2, 4, 'X'),
              [(1e-5, 0), (sz, .001), (sz * .9, .004), (1e-5, .005)], const(mix(H(0x5a3420), H(0x8a5a38), R(f'bc{b}'))),
              sides=4, mat='root')
    if p < .03:
        blob(g, Matrix.Translation(UP * .005), .004, H(0x6aa060), sides=6, mat='leaf'); return g
    az = R('az', 0, TAU) * 0 + R('az0', -.4, .4) + math.pi / 2
    lc = lcol(H(0x2a6440), H(0x3a7a4c), rib=H(0x4a8a5a), rib_w=.12, edge=H(0x245a38), edge_w=.3)
    # distiche, dicke Blätter, fast waagrecht
    nleaf = 0
    for i in range(6):
        age = p - (.03 + i * .11)
        if age <= 0: break
        nleaf += 1
        gl = grow(age, .35)
        a = az + (i % 2) * math.pi + R(f'a{i}', -.25, .25)
        L = (.05 + .1 * sm(0, 3, i)) * gl * R(f'l{i}', .9, 1.08) + .006
        th = lerp(.5, 1.35, sm(0, .3, age)) - .08 * i
        base = Vector((0, .004 + .003 * i, 0))
        leaf(g, basis(base, *tilt(a, th)), L, L * .4, outline(.62, .3, .2), lc, nl=9, S=S_MED, cup=.35, bend=.35, fold=.08, seed=i)
    # Luftwurzeln, silbrig mit grüner Spitze
    for r in range(5):
        age = p - (.12 + r * .12)
        if age <= 0: continue
        gl = grow(age, .4)
        a = az + R(f'ra{r}', 0, TAU)
        L = (.04 + .06 * R(f'rl{r}')) * gl + .004
        up = r % 3 == 2
        P = arc(Vector((0, .006, 0)), a, 1.3 if not up else .5, (.5 if not up else -.4) + R(f'rb{r}', -.3, .3), L, 6)
        pts = [q for q, _, _ in P]
        if not up:
            pts = [q if q.y > .003 else Vector((q.x, .003, q.z)) for q in pts]
        tube(g, pts, [.0028] * 6 + [.0022], lambda t: mix(H(0xb8c4b4), H(0x5a9a4a), sm(.75, 1, t)), sides=6, cap=True)
    # Blütenrispe: aus der Blattachsel, aufrecht, oben zum Gang (+z) gebogen
    if p >= .5:
        sg = sm(.5, .74, p)
        Ls = .33 * sg * R('sl', .9, 1.06) + .01
        n = 14
        pts = []
        start = Vector((math.sin(az) * .01, .012, math.cos(az) * .01))
        lean = Vector((R('sx', -1, 1) < 0 and -1 or 1, 0, .45)).normalized()
        for i in range(n + 1):
            t = i / n
            ang = .12 + 1.5 * sm(.4, 1, t) * sg
            if i == 0:
                pts.append(start); continue
            d = UP * math.cos(ang) + lean * math.sin(ang)
            pts.append(pts[-1] + d * (Ls / n))
        tube(g, pts, [.0019 * (1 - .4 * i / n) + .0006 for i in range(n + 1)], const(H(0x4a6a3a)), sides=5)
        nf = 7
        for f in range(nf):
            t = .5 + .5 * f / (nf - 1)
            i = min(n, int(t * n))
            P = pts[i]
            fo = sm(.74 + .025 * f, .8 + .025 * f, p) * (1 - sm(.97, 1, p) * 0)
            if p < .7 or t * sg < .5: continue
            side = 1 if f % 2 else -1
            pd = (Vector((0, -.5, .4)) + lean * .3 * side).normalized()
            fp = P + pd * .012
            tube(g, [P, fp], [.0008, .0007], const(H(0x6a8a50)), sides=3)
            if fo < .05:
                blob(g, basis(fp, Vector((0, 0, 1)), UP) @ Matrix.Translation(Vector((0, .004, 0))),
                     .0035 + .002 * sm(.68, .76, p), mix(H(0x8aa860), H(0xf0e0e8), sm(.7, .8, p)), sides=6, mat='petal', sq=1.2)
            else:
                M = Matrix.Translation(fp + Vector((0, -.006, .008))) @ Matrix.Rotation(side * .25 + lean.x * .3, 4, 'Y') @ Matrix.Rotation(-.15, 4, 'X')
                phal_flower(g, R, M, fo, f)
    return g

# ── Süßgras: Zwergweizen 'USU-Apogee' ──

def wheat_ear(g, R, M, L, ripe, key, emerge=1.0):
    """Ähre: Ährchen wechselständig zweizeilig an der Spindel, grannenlos."""
    green = H(0x7aa848); gold = H(0xd8b868)
    col = mix(green, gold, ripe)
    n = 13
    tube(g, [M @ Vector((0, 0, 0)), M @ Vector((0, L, 0))], [.0011, .0008], const(mix(H(0x6a9a40), H(0xc8a860), ripe)), sides=4)
    for i in range(n):
        t = i / (n - 1)
        if t > emerge: break
        sgn = 1 if i % 2 else -1
        sz = .0034 * (1 - .4 * abs(t - .4) ** 1.5)
        M2 = M @ Matrix.Translation(Vector((0, L * (.04 + .92 * t), 0))) @ Matrix.Rotation(sgn * .42, 4, 'Z') @ Matrix.Diagonal(Vector((1, 1, .6, 1)))
        lathe(g, M2, [(1e-5, -.001), (sz * .8, sz * .5), (sz, sz * 1.4), (sz * .6, sz * 2.3), (1e-5, sz * 2.9)],
              lambda v, k, c=col: mix(c, mix(c, H(0xf0e0b0), .4), sm(.6, 1, v)), sides=5, mat='stem')

def build_weizen(p, R):
    g = Geo()
    if p < .02:
        blob(g, Matrix.Translation(Vector((0, .0016, 0))) @ Matrix.Rotation(R('sa', 0, 3), 4, 'Y') @ Matrix.Rotation(math.pi / 2, 4, 'Z'),
             .0016, H(0xb8803a), sides=6, sq=2.0); return g
    az = R('az', 0, TAU)
    ripe = sm(.8, .97, p)
    senesce = sm(.75, 1, p)
    lg = H(0x4f8a3e); lt = H(0x6a9a48)
    lc = lambda t, s, k=0.0: mix(mix(lg, lt, t), H(0xc8b070), clamp(senesce * 1.2 - (1 - t) * .3 + k))
    # Keimscheide und erstes Blatt
    if p < .1:
        u = p / .1
        L = .01 + .05 * u
        tube(g, [Vector((0, 0, 0)), Vector((0, .006 + .006 * u, 0))], [.0012, .001], const(H(0xc8d8a0)), sides=4, cap=True)
        leaf(g, basis(Vector((0, .008, 0)), *tilt(az, .15 + .3 * u)), L, .0022, sh_linear, lambda t, s: lc(t, s), nl=6, S=S_MIN, bend=.5 * u, twist=.4)
        return g
    ntill = 1 + int(sm(.1, .3, p) * (2 + R('nt') * 1.6))
    Hmax = .37 * R('h', .9, 1.06)
    elong = sm(.32, .62, p)
    for k in range(ntill):
        a = az + k * 2.3
        lean = 0 if k == 0 else .08 + .06 * k
        Hc = (.02 + (Hmax - .02) * elong) * (1 - .08 * k)
        top_d = (UP * math.cos(lean) + azv(a) * math.sin(lean)).normalized()
        base = azv(a) * .003 * k
        culm = [base + top_d * Hc * i / 6 for i in range(7)]
        if elong > .02:
            tube(g, culm, [.0016 * (1 - .3 * i / 6) + .0006 for i in range(7)],
                 lambda t: mix(mix(H(0x6a9a48), H(0x8ab060), t), H(0xd8c078), ripe), sides=5)
        nl = 4
        for i in range(nl + 1):
            la = p - (.04 + k * .06 + i * .06)
            if la <= 0: continue
            gl = grow(la, .2)
            flag = i == nl
            if flag and elong < .5: continue
            y = (i / nl) * .75 if elong > 0 else 0
            Pn = base + top_d * Hc * y + UP * .004
            L = (.08 + .07 * sm(0, 3, i) - (.05 if flag else 0)) * gl + .006
            aa = a + i * math.pi + R(f'la{k}{i}', -.3, .3)
            dead = sm(.6, 1, senesce * 1.5 - i * .25)
            leaf(g, basis(Pn, *tilt(aa, lerp(.15, .6, sm(0, .4, la)) + .25 * dead)), L, .0045 if not flag else .0055,
                 sh_linear, lambda t, s, dd=dead: lc(t, s, dd * .6), nl=8, S=S_MIN,
                 bend=.9 + .6 * dead, twist=R(f'tw{k}{i}', -.8, .8), fold=.25, seed=k * 9 + i)
        # Ähre schiebt sich aus der Blattscheide
        if p > .55:
            emerge = sm(.58, .74, p)
            L = .055 * R(f'el{k}', .9, 1.08) * (1 - .1 * k)
            top = culm[-1]
            nodd = .25 * ripe
            de = (top_d + azv(a + .5) * nodd).normalized()
            M = basis(top - de * L * (1 - emerge), de, azv(a))
            wheat_ear(g, R, M, L, ripe, f'{k}', emerge)
    return g

# ── Hülsenfrüchtler: Mimose ──

def mimosa_leaf(g, R, base, az, th, L, key, lc, pc, closed=0.0):
    """Doppelt gefiedert: kurzer Stiel, vier fingerförmig gespreizte Fiedern
    mit je 12 Paaren winziger Blättchen."""
    P = arc(base, az, th, .25, L * .4, 3)
    tube(g, path_pts(P), [.0009, .0008, .0007, .0007], pc, sides=3)
    end, d, z = P[-1]
    side = d.cross(z).normalized()
    for q, ang in enumerate((-.6, -.2, .2, .6)):
        dq = (d * math.cos(ang) + side * math.sin(ang)).normalized()
        Lp = L * .62 * (1 if abs(ang) < .3 else .9)
        pts = [end + dq * Lp * i / 4 - z * .002 * (i / 4) ** 2 for i in range(5)]
        tube(g, pts, [.0005] * 5, pc, sides=3)
        sq = dq.cross(z).normalized()
        npair = 10
        for i in range(npair):
            t = (i + .6) / (npair + .4)
            Pi = end + dq * Lp * t - z * .002 * t * t
            ll = .0075 * (1 - .45 * abs(t - .45) ** 1.5) * (L / .06)
            for sg in (-1, 1):
                dl = (dq * .35 + sq * sg).normalized()
                up = (z * math.cos(closed * 1.4) - sq * sg * math.sin(closed * 1.4)).normalized()
                dl2 = (dl * math.cos(closed) + z * math.sin(closed)).normalized()
                leaf(g, basis(Pi, dl2, up), ll, ll * .32, sh_ellipse, lc, nl=2, S=S_MIN, cup=.1)

def pompom(g, R, P, r, key, op):
    """Kugeliges Köpfchen aus Staubfäden."""
    n = 60
    blob(g, Matrix.Translation(P), r * .3, H(0xd070a8), sides=6, mat='petal')
    for i in range(n):
        y = 1 - 2 * (i + .5) / n
        rr = math.sqrt(max(0, 1 - y * y)); a = i * GOLDEN
        d = Vector((math.cos(a) * rr, y, math.sin(a) * rr))
        L = r * (.4 + .6 * op) * R(f'{key}f{i}', .85, 1.1)
        tube(g, [P + d * r * .2, P + d * (r * .2 + L)], [.00045, .00035],
             lambda t: mix(H(0xd85aa8), H(0xffc0e8), t * .8 + .1), sides=3, mat='petal', cap=False)

def build_mimose(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .003, H(0x7a5a30), (1, .45, .8)); return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0x9a5a48), H(0x7a7a40), t)
    tip, ph, az = hypocotyl(g, R, u, .015, .0012, stemc)
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .007 + .004 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .55, sh_ellipse, lcol(mix(H(0x5aa048), H(0xb0a850), fade)), nl=4)
    if p < .12: return g
    lc = lcol(H(0x3a8a48), H(0x54945a), rib=H(0x7ab070), rib_w=.15)
    pc = lambda t: mix(H(0x8a4a3a), H(0x6a7a40), t)
    heads = []
    # Hauptspross aufrecht, zwei Seitentriebe niederliegend
    for b in range(3):
        age = p - (.12 + b * .1)
        if age <= 0: continue
        gl = grow(age, .45)
        a = az + b * 2.1
        th = .15 if b == 0 else .9
        L = (.26 if b == 0 else .2) * gl * R(f'bl{b}', .9, 1.08) + .01
        B = arc(tip * .7 if b == 0 else Vector((0, .006, 0)), a, th, (.3 if b == 0 else .4), L, 8)
        tube(g, path_pts(B), [.0016 * (1 - .4 * i / 8) + .0006 for i in range(9)], stemc, sides=4)
        # Stacheln
        for i in range(2, 8, 2):
            Pi, d, z = B[i]
            side = d.cross(z).normalized()
            tube(g, [Pi, Pi + side * .0025 - d * .001], [.0004, 1e-5], const(H(0xb07a60)), sides=3)
        for n in range(1, 8):
            la = age - n * .035
            if la <= 0: continue
            Pn, dn, zn = B[n]
            ll = (.05 + .02 * sm(1, 4, n) - .02 * sm(6, 8, n)) * grow(la, .2) + .006
            mimosa_leaf(g, R, Pn, a + n * 2.4 + R(f'm{b}{n}', -.3, .3), lerp(.6, 1.15, sm(0, .2, la)), ll, f'{b}{n}', lc, stemc)
            if 3 <= n <= 6 and n % 2 == b % 2:
                heads.append((Pn, a + n * 2.4 + 1.3, b * 10 + n))
    # Knospen, dann rosa Köpfchen an langen Stielen aus den Blattachseln
    if p >= .66:
        for Pn, a, key in heads:
            P = arc(Pn, a, .6, -.3, .03, 3)
            tube(g, path_pts(P), [.0006] * 4, stemc, sides=3)
            end = P[-1][0]
            op = sm(.84, .93, p + R(f'ho{key}', -.03, .03))
            r = .004 + .004 * sm(.66, .84, p)
            if op < .05:
                blob(g, Matrix.Translation(end + UP * r * .5), r * .7, mix(H(0x8aa060), H(0xd890c0), sm(.74, .84, p)), sides=7, mat='petal')
            else:
                pompom(g, R, end + UP * .006, .0085, f'h{key}', op)
    return g

# ── Sonnentaugewächs: Venusfliegenfalle ──

def flytrap(g, R, M, L, open_, key, lc_out):
    """Falle: zwei Hälften am Mittelnerv, innen rot, außen grün, Randzähne."""
    inner = lambda t, s: mix(mix(H(0xa81830), H(0xd03048), sm(.2, .8, abs(s))), H(0x6aa048), sm(.82, 1, abs(s)))
    outer = lambda t, s: mix(lc_out(t, s), H(0x8a6040), sm(.5, 1, abs(s)) * .25)
    shape = lambda t: math.sin(math.pi * t) ** .55
    for sg in (-1, 1):
        S = tuple(sg * v for v in (0, .2, .45, .7, .88, 1))
        if sg < 0: S = S[::-1]
        Mh = M @ Matrix.Rotation(-sg * lerp(1.45, .62, open_), 4, 'Y')
        leaf(g, Mh, L, L * .45, shape, inner, nl=7, S=S, cup=.55, bend=.1)
        leaf(g, Mh @ Matrix.Translation(Vector((0, 0, -.0009))), L, L * .45, shape, outer, nl=7, S=S, cup=.55, bend=.1)
        # Wimpern am Rand
        for i in range(1, 12):
            t = i / 12
            w = L * .45 * shape(t)
            x = sg * w; zc = .55 * w * w / (L * .45)
            P0 = Mh @ Vector((x, L * t, zc))
            dout = (Mh.to_3x3() @ Vector((sg * 1, 0, .9))).normalized()
            tube(g, [P0, P0 + dout * L * .3], [.00035, .0001], const(H(0x7aa850)), sides=3, mat='leaf')

def build_venus(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0013, H(0x1a1410), (1, .8, .8)); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0xd8e0c0), H(0x8ac070), t)
    tip, ph, az = hypocotyl(g, R, u, .004, .0006, stemc)
    fade = sm(.25, .45, p)
    if fade < 1:
        c = .004 + .002 * sm(.05, .2, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .5, sh_ellipse, lcol(mix(H(0x6ab050), H(0xb0a850), fade)), nl=3)
    if p < .06: return g
    lc = lcol(H(0x4e9a48), H(0x60a850), rib=H(0x8ac070), rib_w=.1)
    for i in range(9):
        age = p - (.06 + i * .07)
        if age <= 0: continue
        gl = grow(age, .3)
        a = az + i * 2.3999 + R(f'a{i}', -.2, .2)
        L = (.022 + .022 * sm(0, 4, i)) * gl * R(f'l{i}', .85, 1.12) + .004
        th = lerp(.4, 1.25, sm(0, .4, age)) + R(f't{i}', -.12, .12)
        # geflügelter Blattstiel
        M = basis(Vector((0, .001, 0)), *tilt(a, th))
        leaf(g, M, L, L * .15, lambda t: .2 + .8 * math.sin(math.pi / 2 * t) ** 1.6, lc, nl=6, S=S_LOW, cup=.3, bend=-.15)
        # Falle am Ende, etwas aufgerichtet
        trap_age = sm(.1, .3, age)
        if trap_age > .05:
            d = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
            end = M @ Vector((0, L, -.0005))
            dt, zt = tilt(a, th - .45)
            Lt = L * .5 * trap_age
            flytrap(g, R, basis(end, dt, zt), Lt, sm(.15, .4, age) * (1 - .8 * (R(f'cl{i}') < .15)), f'{i}', lc)
    # Blütenschaft hoch über den Fallen — die Bestäuber sollen nicht hineinfallen
    if p >= .66:
        sg = sm(.66, .84, p)
        Ls = .2 * sg * R('sl', .9, 1.06) + .01
        S = arc(Vector((0, .002, 0)), az + .5, .08, .1, Ls, 6)
        tube(g, path_pts(S), [.0014, .0013, .0012, .0011, .001, .0009, .0009], const(H(0x6a9a50)), sides=4)
        end = S[-1][0]
        for f in range(6):
            fa = f * TAU / 6 + R(f'fa{f}', 0, .5)
            fp = end + azv(fa) * .012 + UP * (.006 + .003 * (f % 3))
            tube(g, [end, fp], [.0005, .0005], const(H(0x6a9a50)), sides=3)
            fd = (azv(fa) * .7 + UP).normalized()
            op = sm(.84 + .02 * (f % 3), .9 + .02 * (f % 3), p)
            if op < .1:
                blob(g, basis(fp, fd, azv(fa)) @ Matrix.Translation(Vector((0, .003, 0))), .0025, H(0xd8e8c8), sides=5, mat='petal', sq=1.4)
            else:
                wheel_flower(g, R, basis(fp, fd, azv(fa)), 5, .009, .006, lcol(H(0xf4f8f0), H(0xffffff), rib=H(0x9ac088), rib_w=.12),
                             H(0xe8e0a0), op, shape=outline(.6, .25, .2), cup=.15)
    return g

# ── Kreuzblütler: Echter Wasabi ──

def sh_cordate(t): return math.sin(math.pi * (.2 + .8 * t)) ** .5 * (1 - .15 * sm(.75, 1, t))

def build_wasabi(p, R):
    g = Geo()
    if p < .02:
        seed_on_soil(g, R, .0026, H(0x5a4030), (1, .8, .8)); return g
    u = clamp(p / .12)
    stemc = lambda t: mix(H(0xd8d8c0), H(0x8ab878), t)
    tip, ph, az = hypocotyl(g, R, u, .012, .0011, stemc)
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .007 + .006 * sm(.05, .25, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .85, sh_kidney, lcol(mix(H(0x5aa050), H(0xb0a850), fade), rib=H(0xa8d090)),
                   petiole=.006, nl=5, notch=.12)
    if p < .1: return g
    lc = lcol(H(0x2f6e40), H(0x3f7a4e), rib=H(0x8ac080), rib_w=.04, edge=H(0x2a6038), edge_w=.25)
    # Rhizom: dick, knotig, mit Blattnarben, schiebt sich aus dem Substrat
    rh = sm(.25, 1, p)
    rl = .008 + .05 * rh * R('rl', .85, 1.1)
    rr = .004 + .011 * rh
    def rcol(v, k):
        scar = .5 + .5 * math.sin(v * 38 + k * .7)
        return mix(mix(H(0x6a8a50), H(0x9fd08a), v), H(0x5a6a40), sm(.75, 1, scar) * .5)
    lean = R('rlean', -.15, .15)
    lathe(g, Matrix.Translation(Vector((0, -.006, 0))) @ Matrix.Rotation(lean, 4, 'X'),
          [(rr * .7, 0), (rr, rl * .2), (rr * 1.05, rl * .5), (rr * .95, rl * .8), (rr * .8, rl * .95), (1e-5, rl)],
          rcol, sides=10, mat='root', deform=lambda q, v, a: q * (1 + .07 * math.sin(v * 30) * math.sin(math.pi * v)))
    crown = Vector((0, -.006 + rl * .95, 0))
    # lange Stiele, herz- bis nierenförmige Spreiten, die äußeren sinken mit dem Alter ab
    n = 12
    for i in range(n):
        age = p - (.1 + i * .06)
        if age <= 0: continue
        gl = grow(age, .3)
        old = sm(.25, .7, age)
        a = az + i * 2.3999 + R(f'a{i}', -.2, .2)
        Lp = (.07 + .09 * sm(0, 5, i)) * gl * R(f'l{i}', .85, 1.1) + .008
        th = lerp(.15, .9, old) + R(f't{i}', -.1, .1)
        P = arc(crown, a, th, .35 + .2 * old, Lp, 5)
        tube(g, path_pts(P), [.0022 * (1 - .4 * j / 5) + .0008 for j in range(6)],
             lambda t: mix(H(0x9ab880), H(0x6aa060), t), sides=4)
        end, d, z = P[-1]
        Lb = (.03 + .045 * sm(0, 5, i)) * gl + .006
        dl, zl = tilt(a, lerp(.9, 1.5, old))
        leaf(g, basis(end, dl, zl) @ Matrix.Translation(Vector((0, -.25 * Lb, 0))), Lb, Lb * .62,
             serrate(sh_cordate, 14, .05), lc, nl=10, S=S_FINE, sinus=.25, cup=.25, bend=.35, pucker=.08, pfreq=4,
             ruffle=.04, rfreq=3, seed=i)
    return g

# ── Schwertliliengewächs: Safran-Krokus ──

def build_safran(p, R):
    g = Geo()
    # Knolle mit Netzfaserhülle
    cr = .011 * R('cr', .9, 1.1)
    def ccol(v, k):
        return mix(H(0x8a6a48), H(0xb08a60), .5 + .5 * math.sin(k * 2.1 + v * 9))
    sink = sm(0, .2, p)
    lathe(g, Matrix.Translation(Vector((0, -cr * .9 * sink, 0))),
          [(1e-5, 0), (cr * .8, cr * .15), (cr, cr * .55), (cr * .8, cr * .95), (cr * .25, cr * 1.15), (1e-5, cr * 1.35)],
          ccol, sides=9, mat='root')
    if p < .03: return g
    top = Vector((0, cr * 1.2 * (1 - sink) + .002, 0))
    az = R('az', 0, TAU)
    # weiße Niederblätter als Scheide
    sh = sm(.03, .2, p)
    tube(g, [top - UP * .004, top + UP * .02 * sh], [.0032, .0026], const(H(0xe8e4d0)), sides=6, cap=True)
    # grasartige Blätter mit weißem Mittelstreif
    lc = lambda t, s: mix(mix(H(0x2f5f32), H(0x4f8250), t), H(0xd8e8cc), (1 - sm(.0, .16, abs(s))) * .75)
    for i in range(8):
        age = p - (.04 + i * .035)
        if age <= 0: continue
        gl = grow(age, .3)
        a = az + i * 2.3999 + R(f'a{i}', -.3, .3)
        L = (.14 + .1 * sm(0, 4, i)) * gl * R(f'l{i}', .85, 1.1) + .006
        leaf(g, basis(top, *tilt(a, .08 + .25 * sm(0, .5, age) + R(f't{i}', 0, .2))), L, .0024, sh_linear, lc,
             nl=8, S=(-1, -.5, -.15, 0, .15, .5, 1), bend=.6 + .5 * sm(.2, .8, age), fold=-.35, twist=R(f'w{i}', -.4, .4),
             seed=i)
    # Blüten: Knospe in der Scheide, dann Kelch aus sechs violetten Blütenhüllblättern,
    # drei rote Narbenäste hängen heraus, drei gelbe Staubbeutel
    if p >= .62:
        for f in range(1 + (R('nf') > .35) + (R('nf2') > .7)):
            fa = az + f * 2.3 + .7
            ft = .1 + .08 * f
            sg = sm(.62 + .03 * f, .8 + .03 * f, p)
            Lt = .07 * sg + .01
            base = top + azv(fa) * .002
            d = (UP + azv(fa) * ft).normalized()
            tube(g, [base, base + d * Lt * .5, base + d * Lt], [.0014, .0013, .0012], const(H(0xe8e0e8)), sides=5)
            P = base + d * Lt
            M = basis(P, d, azv(fa + 1.6))
            op = sm(.84 + .03 * f, .92 + .03 * f, p)
            vio = lambda t, s: mix(mix(H(0x6a3a9a), H(0x9a5fd0), sm(0, .5, t)), H(0xb88ae0), sm(.7, 1, t) * .5 + (1 - sm(0, .15, abs(s))) * -.0)
            veins = lambda t, s: mix(vio(t, s), H(0x5a2a8a), (1 - sm(0, .1, abs(s))) * .6)
            if op < .05:
                bud(g, M, .006 + .002 * sg, H(0x8a5ab8), H(0xb07ae0), .7)
                continue
            for k in range(6):
                a = k * TAU / 6 + (k % 2) * .0
                inner = k % 2
                leaf(g, M @ basis(Vector((0, 0, 0)), *tilt(a, lerp(.12, .55, op) - .08 * inner)), .036 * (1 - .06 * inner), .0105,
                     outline(.6, .25, .35), veins, nl=6, S=S_MED, cup=.55, bend=-.15 * op, mat='petal', seed=k)
            # Narbenäste (der Safran) und Staubbeutel
            for k in range(3):
                a = k * TAU / 3 + .3
                Sg = [M @ Vector((0, .004 + .02 * t, 0)) + (M.to_3x3() @ azv(a)) * .009 * t * t for t in (0, .35, .7, 1)]
                Sg.append(Sg[-1] + (M.to_3x3() @ (azv(a) * .6 - UP * .4)).normalized() * .012 * op)
                tube(g, Sg, [.0008, .0008, .001, .0013, .0016], const(H(0xd8280e)), sides=4, mat='petal', cap=True)
                a2 = a + math.pi / 3
                A0 = M @ Vector((0, .004, 0)); A1 = A0 + (M.to_3x3() @ (UP + azv(a2) * .35)).normalized() * .016
                tube(g, [A0, A1], [.0009, .0013], const(H(0xf0c818)), sides=4, mat='petal', cap=True)
    return g

# ── Orchideen: Vanille ──

def vanilla_flower(g, R, M, op):
    """Wachsartige, grünlich-cremefarbene Blüte mit eingerollter Trompetenlippe."""
    col = lcol(H(0xd8d088), H(0xf0e8b8))
    for k in range(5):
        a = k * TAU / 5 + .3
        leaf(g, M @ basis(Vector((0, 0, 0)), *tilt(a, lerp(.2, .75, op))), .03, .0065, outline(.5, .2, .4), col,
             nl=5, S=S_LOW, cup=.3, bend=.2, mat='petal', seed=k)
    lathe(g, M, [(.0015, 0), (.004, .006), (.0055, .016), (.0072, .022)], lambda v, k: mix(H(0xe8d890), H(0xf0b830), sm(.6, 1, v) * .5),
          sides=8, mat='petal')

def vanilla_pod(g, R, P, L, s, ripe, key):
    pts, rad = [], []
    n = 8
    az = R(key + 'az', 0, TAU)
    for i in range(n + 1):
        t = i / n
        pts.append(P + (UP * -1 + azv(az) * .15 * t) .normalized() * L * t + azv(az + 1.5) * .006 * math.sin(t * 3) * R(key + 'c', -1, 1))
        rad.append((.0042 * s + .0008) * math.sin(math.pi * clamp(t * .95 + .03)) ** .25 * (1 - .4 * sm(.85, 1, t)))
    col = lambda t: mix(H(0x3a7a2c), H(0xc8b030), clamp(ripe * (1.6 * t - .2)))
    tube(g, pts, rad, col, sides=6, mat='fruit', cap=True)

def build_vanille(p, R):
    g = Geo()
    az = R('az', 0, TAU)
    # Kokosstab, an dem die Kletterorchidee hochwächst
    pole = azv(az + math.pi) * .02
    def pcol(t):
        return mix(H(0x5a3a22), H(0x7a5232), .5)
    tube(g, [pole + UP * (.54 * i / 8) for i in range(9)], [.0125] * 9,
          lambda t: mix(H(0x5a3a22), H(0x7a5838), .5 + .5 * math.sin(t * 60)), sides=10, cap=True, mat='root')
    stemc = lambda t: mix(H(0x5a8a40), H(0x6a9a48), t)
    lc = lcol(H(0x2f6e3c), H(0x3d7e4a), rib=H(0x5a9a5a), rib_w=.06)
    # Steckling: ein Sprossstück mit zwei Knoten
    if p < .06:
        q0 = Vector((.015, .004, -.01)); q1 = Vector((-.02, .004, .015))
        tube(g, [q0, (q0 + q1) / 2, q1], [.0035] * 3, stemc, sides=6, cap=True)
        leaf(g, basis(q1, *tilt(az + 2, 1.2)), .05, .018, acuminate(outline(.5, .3, .3), .4), lc, nl=8, S=S_MED, cup=.3, bend=.2)
        if p > .02:
            tube(g, [q1, q1 + UP * .02 * sm(.02, .06, p)], [.003, .0026], stemc, sides=6, cap=True)
        return g
    # zickzackender Spross, windet sich um den Stab; je Knoten ein Blatt und eine Haftwurzel
    gy = .004
    pts = [Vector((-.02, .004, .015)), Vector((0, .006, 0))]
    nodes = []
    for k in range(12):
        age = p - (.06 + k * .036)
        if age <= 0: break
        gy += .042 * sm(0, .1, age) + .003
        ang = az + k * .9
        P = pole + azv(ang) * .016 * sm(0, 2, k) + Vector((0, gy, 0))
        if k == 0: P = P.lerp(pts[-1] + UP * gy, .5)
        pts.append(P); nodes.append((k, age, P, ang))
    # über dem Stab hängt die Triebspitze über
    if len(nodes) > 10:
        last = pts[-1]
        over = sm(.5, .7, p)
        for j in range(1, 4):
            pts.append(last + azv(az + 1) * .02 * j * over + UP * (.015 * j - .008 * j * j * over))
    tube(g, pts, [.0038 * (1 - .25 * i / len(pts)) for i in range(len(pts))], stemc, sides=6, cap=True)
    for k, age, P, ang in nodes:
        gl = grow(age, .2)
        a = ang + (math.pi * .5 if k % 2 else -math.pi * .5) + R(f'a{k}', -.3, .3)
        L = (.06 + .035 * sm(0, 3, k)) * gl * R(f'l{k}', .9, 1.08) + .006
        A = arc(P, a, .8, .2, .006, 2)
        tube(g, path_pts(A), [.0022] * 3, stemc, sides=4)
        b, d, z = A[-1]
        leaf(g, basis(b, *tilt(a, lerp(.7, 1.15, sm(0, .2, age)))), L, L * .32, acuminate(outline(.5, .35, .25), .5), lc,
             nl=9, S=S_MED, cup=.35, bend=.3, fold=.05, seed=k)
        # Haftwurzel zum Stab
        if k >= 1 and age > .03:
            to = (pole + UP * P.y - P)
            to.y = 0
            if to.length > 1e-4:
                dd = to.normalized()
                Wt = [P, P + dd * .007 - UP * .004, P + dd * .011 - UP * .012 + azv(ang + 1.6) * .006]
                tube(g, Wt, [.0013, .0012, .0011], lambda t: mix(H(0x7a9a60), H(0xc8c8b0), t), sides=4, cap=True)
    # Blütentrauben in den Blattachseln, danach die Schoten in Büscheln
    if p >= .5:
        for k, age, P, ang in nodes:
            if k < 4 or k % 3 != 1: continue
            a = ang + (math.pi * .5 if k % 2 else -math.pi * .5) + .8
            C = arc(P, a, 1.0, .5, .025, 3)
            tube(g, path_pts(C), [.0018] * 4, stemc, sides=4)
            end = C[-1][0]
            for f in range(4):
                fa = a + (f - 1.5) * .7
                fp = end + azv(fa) * .006 + UP * (-.003 * f)
                bloom = sm(.52 + .02 * f, .56 + .02 * f, p) * (1 - sm(.6 + .02 * f, .66 + .02 * f, p))
                if p < .68 and bloom > .05:
                    fd = (azv(fa) + UP * .3).normalized()
                    vanilla_flower(g, R, basis(fp, fd, UP if abs(fd.y) < .9 else azv(fa)), bloom)
                elif p < .58 and bloom <= .05:
                    blob(g, basis(fp, (azv(fa) + UP * .3).normalized(), UP) @ Matrix.Translation(Vector((0, .006, 0))), .0035,
                         H(0x8ab060), sides=6, mat='petal', sq=2)
                if p >= .64:
                    s = sm(.64, .88, p) * R(f'ps{k}{f}', .85, 1.08)
                    if s > .05:
                        vanilla_pod(g, R, fp, .12 * s + .008, s, sm(.9, 1, p), f'v{k}{f}')
    return g

# ── Rötegewächs: Arabica-Kaffee ──

def coffee_cluster(g, R, P, a, p, key, lc):
    """Achselständiges Büschel: weiße Sternblüten, dann Kirschen, die ungleich reifen."""
    n = 4 + int(R(key + 'n', 0, 3))
    for i in range(n):
        fa = a + (i - n / 2) * .7 + R(key + str(i), -.2, .2)
        dP = azv(fa) * .006 + UP * (R(key + 'y' + str(i), -.004, .004))
        fp = P + dP
        bloom = sm(.66, .7, p) * (1 - sm(.78, .82, p))
        if .62 <= p < .82 and i < 3:        # sparsam: die Hälfte der Knospen reicht fürs Bild
            fd = (azv(fa) + UP * .6).normalized()
            if bloom < .08:
                blob(g, basis(fp, fd, azv(fa)) @ Matrix.Translation(Vector((0, .004, 0))), .0022, H(0xe8f0e0), sides=5, mat='petal', sq=2.2)
            else:
                star_flower(g, R, basis(fp, fd, azv(fa)), 5, .014, .0038, lambda t, s: mix(H(0xf6f6f0), H(0xffffff), t),
                            H(0xf0f0e0), 1.0 + .5 * bloom)
        if p >= .78:
            fs = sm(.78, .9, p)
            ripe = sm(.86, 1, p + R(key + 'r' + str(i), -.12, .08))
            c = mix(mix(H(0x4a8a30), H(0xe8c040), sm(0, .45, ripe)), H(0xc4382c), sm(.4, 1, ripe))
            c = mix(c, H(0x7a1a18), sm(.85, 1, ripe) * .5)
            blob(g, basis(fp + dP * .4, (azv(fa) + UP * .2).normalized(), UP) @ Matrix.Translation(Vector((0, .005 * fs, 0))),
                 .0068 * fs + .0012, c, sides=8, mat='fruit', sq=1.15)

def build_kaffee(p, R):
    g = Geo()
    if p < .02:
        # Pergamentkaffee: flache Seite mit Längsfurche nach unten
        blob(g, Matrix.Translation(Vector((0, .003, 0))) @ Matrix.Rotation(R('sa', 0, 3), 4, 'Y') @ Matrix.Diagonal(Vector((1, .55, 1.4, 1))),
             .0045, H(0xd8c8a0), sides=8); return g
    u = clamp(p / .1)
    stemc = lambda t: mix(H(0x8aa060), H(0x5a8a40), t)
    lc = lcol(H(0x1e5a2e), H(0x2f6b3c), rib=H(0x5a9a5a), rib_w=.05)
    tip, ph, az = hypocotyl(g, R, u, .05, .0016, stemc, lean=.06)
    # „Soldat": die Samenschale sitzt noch auf den Keimblättern
    if p < .1:
        blob(g, Matrix.Translation(tip + UP * .003) @ Matrix.Rotation(ph, 4, 'X'), .0045, H(0xd8c8a0), sides=7, sq=1.3)
        return g
    # „Schmetterling": zwei runde, leicht gewellte Keimblätter
    fade = sm(.3, .5, p)
    if fade < 1:
        c = .016 + .008 * sm(.1, .2, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u) * .9 + .1, c, c * .85, sh_round,
                   lcol(mix(H(0x3a8a40), H(0xb0a850), fade), rib=H(0x8ac080)), petiole=.006, nl=6, S=S_MED, cup=.15)
    if p < .14: return g
    # orthotroper Haupttrieb, kreuzgegenständige Blattpaare, waagrechte Seitenäste (plagiotrop)
    Hmax = .48 * R('h', .92, 1.05)
    nn = 9
    pts = [Vector((0, 0, 0)), tip]
    nodes = []
    gy = tip.y
    for k in range(nn):
        age = p - (.14 + k * .055)
        if age <= 0: break
        gy += (Hmax - tip.y) / nn * sm(0, .2, age) + .002
        P = Vector((R(f'x{k}', -.003, .003), gy, R(f'z{k}', -.003, .003)))
        pts.append(P); nodes.append((k, age, P))
    tube(g, pts, [.0055 * (1 - .55 * i / len(pts)) + .0012 for i in range(len(pts))],
         lambda t: mix(H(0x8a7058), H(0x5a8a40), sm(.3, .8, t)), sides=6, cap=True)
    leafkw = dict(nl=10, S=S_MED, bend=.35, cup=-.1, ruffle=.08, rfreq=3.5, pucker=.05, fold=.12)
    shp = acuminate(outline(.48, .05, .45), .55)
    for k, age, P in nodes:
        gl = grow(age, .22)
        rot = az + k * math.pi / 2
        L = (.06 + .03 * sm(0, 3, k) - .02 * sm(6, 9, k)) * gl + .006
        for s in (0, 1):
            a = rot + s * math.pi
            A = arc(P, a, lerp(.5, 1.0, sm(0, .2, age)), .2, .006, 2)
            tube(g, path_pts(A), [.0011] * 3, stemc, sides=3)
            b, d, z = A[-1]
            leaf(g, basis(b, d, z), L, L * .38, shp, lc, seed=k * 2 + s, **leafkw)
            # Seitenäste ab dem dritten Knoten
            if 2 <= k <= 6 and age > .1:
                bg = grow(age - .1, .3)
                Lb = (.14 - .015 * k) * bg + .01
                B = arc(P, a + .25, 1.35, .15, Lb, 6)
                tube(g, path_pts(B), [.0024 * (1 - .4 * i / 6) + .0006 for i in range(7)],
                     lambda t: mix(H(0x7a6a50), H(0x5a8a40), t), sides=4, cap=True)
                for q in (2, 4, 6):
                    qa = age - .1 - q * .02
                    if qa <= 0: continue
                    Pq, dq, zq = B[q]
                    sq = dq.cross(UP).normalized()
                    lq = (.05 + .01 * (q < 6)) * grow(qa, .2) + .005
                    for sg in (-1, 1):
                        dl = (dq * .45 + sq * sg).normalized() + UP * .15
                        leaf(g, basis(Pq, dl.normalized(), UP), lq, lq * .38, shp, lc, seed=k * 10 + q + sg, **leafkw)
                    if q < 6:
                        coffee_cluster(g, R, Pq - UP * .002, a, p, f'c{k}{s}{q}', lc)
    return g

# ── Rosengewächs: Säulenapfel ──

def apple_fruit(g, R, M, s, ripe, key):
    r = .024 * s + .002
    prof = [(1e-5, r * .25), (r * .35, r * .05), (r * .75, r * .2), (r * .98, r * .7), (r, r * 1.05), (r * .9, r * 1.4),
            (r * .6, r * 1.62), (r * .25, r * 1.55), (1e-5, r * 1.42)]
    base = mix(H(0x8ab040), H(0xe0d060), ripe * .6)
    blush = mix(H(0x9a8a30), H(0xc8241e), ripe)
    side = R(key, 0, TAU)
    def col(v, k):
        a = k * TAU / 14
        face = .5 + .5 * math.cos(a - side)
        streak = .5 + .5 * math.sin(k * 3.1 + v * 4)
        return mix(base, blush, clamp(face * 1.3 * ripe + streak * .25 * ripe))
    lathe(g, M, prof, col, sides=14, mat='fruit', deform=lambda q, v, a: q * (1 + .03 * math.cos(5 * a)))
    tube(g, [M @ Vector((0, r * 1.45, 0)), M @ Vector((.002, r * 1.45 + .012, 0))], [.0009, .0008], const(H(0x6a5030)), sides=4)

def build_apfel(p, R):
    g = Geo()
    if p < .02:
        blob(g, Matrix.Translation(Vector((0, .002, 0))) @ Matrix.Rotation(R('sa', 0, 3), 4, 'Y') @ Matrix.Rotation(1.5, 4, 'Z'),
             .0022, H(0x4a2a14), sides=6, sq=1.8); return g
    u = clamp(p / .08)
    stemc = lambda t: mix(H(0xa07860), H(0x6a9a48), t)
    tip, ph, az = hypocotyl(g, R, u, .02, .0013, stemc)
    fade = sm(.15, .3, p)
    if fade < 1:
        c = .009 + .005 * sm(.04, .12, p)
        cotyledons(g, R, tip, ph, az, sm(.5, 1, u), c, c * .55, sh_ellipse, lcol(mix(H(0x4a9a40), H(0xb0a850), fade)), nl=5)
    if p < .06: return g
    lc = lcol(H(0x3a7a3a), H(0x4a8442), rib=H(0x9ac090), rib_w=.05)
    shp = acuminate(serrate(outline(.4, .1, .45), 10, .08), .35)
    bark = lambda t: mix(mix(H(0x6a5040), H(0x7a6050), .5), H(0x6a9a48), sm(.85, 1, t))
    # Ein senkrechter Stamm, der mit dem Alter verholzt
    Hmax = .54 * R('h', .94, 1.04)
    Ht = tip.y + (Hmax - tip.y) * sm(.06, .62, p) ** .9
    n = 14
    pts = [Vector((0, 0, 0))]
    for i in range(1, n + 1):
        y = Ht * i / n
        pts.append(Vector((math.sin(i * 1.3) * .0015, y, math.cos(i * 1.7) * .0015)))
    thick = .004 + .006 * sm(.2, .8, p)
    tube(g, pts, [thick * (1 - .6 * i / n) + .0012 for i in range(n + 1)], bark, sides=7, cap=True)
    # Fruchtspieße: kurze Kurztriebe rundum, je mit einer Blattrosette
    spurs = []
    for i in range(16):
        y = .06 + i * .028
        if y > Ht - .04: break
        age = p - (.2 + i * .022)
        if age <= 0: continue
        a = az + i * 2.3999
        Lsp = (.012 + .012 * R(f'sp{i}')) * sm(0, .15, age)
        P0 = Vector((0, y, 0))
        P1 = P0 + (azv(a) * .8 + UP * .5).normalized() * (Lsp + .004)
        tube(g, [P0, P1], [.0022, .0016], bark, sides=4, cap=True)
        spurs.append((i, age, P1, a))
        for l in range(4):
            la = age - l * .02
            if la <= 0: continue
            L = (.042 + .012 * R(f'll{i}{l}')) * grow(la, .18) + .005
            aa = a + (l - 1.5) * .9
            leaf(g, basis(P1, *tilt(aa, lerp(.5, 1.1, sm(0, .2, la)) + .1 * l)), L, L * .5, shp, lc,
                 nl=9, S=S_MED, bend=.4, cup=-.2, fold=.1, pucker=.05, seed=i * 4 + l)
    # Leittrieb mit jungen, wechselständigen Blättern
    for l in range(5):
        y = Ht - .01 - l * .012
        if y < tip.y: break
        a = az + l * 2.3999 + 1
        L = (.03 + .008 * l) * sm(.06, .2, p) + .006
        leaf(g, basis(Vector((0, y, 0)), *tilt(a, .45 + .12 * l)), L, L * .45, shp, lc, nl=7, S=S_LOW, bend=.3, cup=-.2, seed=50 + l)
    # Doldentrauben an den Spießen, danach ausgedünnte Früchte direkt am Stamm
    for i, age, P1, a in spurs:
        if i < 2 or i % 2: continue
        if .62 <= p < .82:
            for f in range(5):
                fa = a + f * TAU / 5
                fp = P1 + azv(fa) * .008 + UP * (.006 + .004 * (f == 0))
                tube(g, [P1, fp], [.0006, .0006], const(H(0x6a8a50)), sides=3)
                fd = (azv(fa) * .5 + UP).normalized()
                op = sm(.66 + .01 * f, .7 + .01 * f, p) * (1 - sm(.78, .82, p))
                if op < .08:
                    blob(g, basis(fp, fd, azv(fa)) @ Matrix.Translation(Vector((0, .003, 0))), .0028,
                         mix(H(0xd8406a), H(0xf0a0b8), sm(.6, .68, p)), sides=6, mat='petal', sq=1.3)
                else:
                    wheel_flower(g, R, basis(fp, fd, azv(fa)), 5, .012, .009,
                                 lambda t, s: mix(H(0xf8c8d8), H(0xfff6f8), sm(0, .7, t)), H(0xe8c040), op,
                                 shape=outline(.55, .2, .1), cup=.45)
        if p >= .78 and R(f'fr{i}') < .8:
            s = sm(.78, .95, p) * R(f'fs{i}', .85, 1.05)
            ripe = sm(.86, 1, p)
            d = (azv(a) * .9 + UP * .2).normalized()
            Mf = Matrix.Translation(P1 + d * (.02 * s + .002) - UP * (.026 * s)) @ Matrix.Rotation(R(f'ft{i}', -.3, .3), 4, 'Z')
            apple_fruit(g, R, Mf, s, ripe, f'a{i}')
    return g

# ───────────────────────── Katalog ─────────────────────────

STAGES = {
    'leafy':  [.12, .22, .46, .20],
    'root':   [.14, .20, .32, .24, .10],
    'fruit':  [.10, .16, .26, .16, .22, .10],
    'flower': [.12, .20, .34, .18, .16],
    'grain':  [.10, .24, .26, .20, .20],
    'fungus': [.55, .20, .15, .10],
    'woody':  [.08, .30, .28, .14, .20],
}
SPECIES = {
    # id: (Bauplan, Phasensatz, Varianten)
    'kresse':     (build_kresse, 'leafy', 3),
    'radieschen': (build_radieschen, 'root', 3),
    'salat':      (build_salat, 'leafy', 3),
    'rucola':     (build_rucola, 'leafy', 3),
    'spinat':     (build_spinat, 'leafy', 3),
    'basilikum':  (build_basilikum, 'leafy', 3),
    'bohne':      (build_bohne, 'fruit', 3),
    'tagetes':    (build_tagetes, 'flower', 3),
    'zinnie':     (build_zinnie, 'flower', 3),
    'erdbeere':   (build_erdbeere, 'fruit', 3),
    'microtom':   (build_microtom, 'fruit', 3),
    'chili':      (build_chili, 'fruit', 3),
    'moehre':     (build_moehre, 'root', 3),
    'gurke':      (build_gurke, 'fruit', 3),
    'paprika':    (build_paprika, 'fruit', 3),
    'kartoffel':  (build_kartoffel, 'root', 3),
    'sonnenblume': (build_sonnenblume, 'flower', 3),
    'austernpilz': (build_austernpilz, 'fungus', 3),
    'orchidee':   (build_orchidee, 'flower', 3),
    'weizen':     (build_weizen, 'grain', 3),
    'mimose':     (build_mimose, 'flower', 3),
    'venus':      (build_venus, 'flower', 3),
    'wasabi':     (build_wasabi, 'leafy', 3),
    'safran':     (build_safran, 'flower', 3),
    'vanille':    (build_vanille, 'fruit', 3),
    'kaffee':     (build_kaffee, 'woody', 3),
    'apfel':      (build_apfel, 'woody', 3),
}

def keys_for(stages):
    """Wachstumsschritte: Keimung fein, jeder Phasenbeginn, dazwischen höchstens
    0,12 Abstand. Zwischen zwei Schritten skaliert das Spiel stufenlos."""
    ks = {0.0, .035, .07, 1.0}
    acc = 0
    for f in STAGES[stages]:
        ks.add(round(acc, 4)); acc += f
    ks = sorted(ks)
    out = []
    for a, b in zip(ks, ks[1:]):
        n = max(1, math.ceil((b - a) / .12 - 1e-6))
        out.extend(round(a + (b - a) * i / n, 4) for i in range(n))
    return out + [1.0]

def ao(g):
    """Grobe Umgebungsverdeckung: tief im Bestand und nahe der Achse dunkler."""
    ys = [v.y for m in g.p.values() for v in m[0]] or [0]
    top = max(max(ys), .01)
    def f(v):
        r = math.hypot(v.x, v.z)
        k = clamp(v.y / top * .8 + r / (top * .9 + .02) * .5)
        return .5 + .5 * k
    g.shade(f)

def build(pid, p, variant):
    fn = SPECIES[pid][0]
    g = fn(p, Rand(f'{pid}{variant}'))
    ao(g)
    return g

# ───────────────────────── Blender-Objekte ─────────────────────────

def _material(name):
    m = bpy.data.materials.get('OB_' + name)
    if m: return m
    m = bpy.data.materials.new('OB_' + name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    rough = {'leaf': .55, 'stem': .6, 'petal': .5, 'fruit': .25, 'root': .7}[name]
    bsdf.inputs['Roughness'].default_value = rough
    if name in ('leaf', 'petal'):
        try:
            bsdf.inputs['Subsurface Weight'].default_value = .15
        except KeyError: pass
    return m

def to_objects(g, name, coll):
    obs = []
    for mat, (V, C, F) in g.p.items():
        if not F: continue
        me = bpy.data.meshes.new(f'{name}_{mat}')
        me.from_pydata([(v.x, -v.z, v.y) for v in V], [], F)
        at = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        flat = []
        for c in C: flat.extend((c.x, c.y, c.z, 1.0))
        at.data.foreach_set('color', flat)
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
        bm.to_mesh(me); bm.free()
        me.shade_smooth()
        me.materials.append(_material(mat))
        ob = bpy.data.objects.new(f'{name}_{mat}', me)
        coll.objects.link(ob)
        obs.append((mat, ob))
    return obs

def coll(name, clear=True):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    elif clear:
        for o in list(c.objects):
            me = o.data; bpy.data.objects.remove(o)
            if me and me.users == 0: bpy.data.meshes.remove(me)
    return c

# ───────────────────────── Export ─────────────────────────
# Je Teilnetz: Positionen int16×3 (1/16384 m), Normalen int8×3, Farben uint8×3 (sRGB),
# auf 4 Byte aufgefüllt, dann Indizes uint16 (oder uint32 ab 65536 Ecken).

POS_Q = 16384

def pack(obs, buf):
    subs = []
    for mat, ob in obs:
        me = ob.data
        me.calc_loop_triangles()
        nv = len(me.vertices)
        if not len(me.loop_triangles): continue
        co = [0.0] * (nv * 3); me.vertices.foreach_get('co', co)
        nr = [0.0] * (nv * 3); me.vertex_normals.foreach_get('vector', nr)
        cl = [0.0] * (nv * 4); me.color_attributes['Col'].data.foreach_get('color', cl)
        tri = [0] * (len(me.loop_triangles) * 3); me.loop_triangles.foreach_get('vertices', tri)
        off = len(buf)
        pos = []
        for i in range(nv):
            x, y, z = co[i * 3], co[i * 3 + 1], co[i * 3 + 2]
            pos.extend((x, z, -y))
        buf += struct.pack(f'<{nv * 3}h', *[max(-32767, min(32767, round(v * POS_Q))) for v in pos])
        nrm = []
        for i in range(nv):
            x, y, z = nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]
            nrm.extend((x, z, -y))
        buf += struct.pack(f'<{nv * 3}b', *[max(-127, min(127, round(v * 127))) for v in nrm])
        buf += bytes(round(_l2s(cl[i * 4 + k]) * 255) for i in range(nv) for k in range(3))
        while len(buf) % 4: buf.append(0)
        wide = nv > 65535
        buf += struct.pack(f'<{len(tri)}{"I" if wide else "H"}', *tri)
        while len(buf) % 4: buf.append(0)
        subs.append({'mat': mat, 'off': off, 'nv': nv, 'ni': len(tri), 'wide': wide})
    return subs

def export(ids=None):
    out = os.path.join(ROOT, 'assets', 'plants')
    os.makedirs(out, exist_ok=True)
    ip = os.path.join(out, 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {'version': 1, 'posScale': 1 / POS_Q, 'plants': {}}
    tmp = coll('OB_export')
    stats = {}
    for pid in (ids or SPECIES):
        fn, stages, nvar = SPECIES[pid]
        keys = keys_for(stages)
        buf = bytearray()
        models = []
        heights = []
        tv = 0
        for v in range(nvar):
            row = []; hs = []
            for k in keys:
                g = build(pid, k, v)
                V = [q for m in g.p.values() for q in m[0]]
                hs.append(round(max([q.y for q in V] + [.002]), 4))
                obs = to_objects(g, f'{pid}_{v}_{k}', tmp)
                subs = pack(obs, buf)
                tv += sum(s['nv'] for s in subs)
                row.append(subs)
                coll('OB_export')
            models.append(row)
            heights.append(hs)
        # vorkomprimiert: GitHub Pages packt unbekannte Binärtypen nicht selbst
        with open(os.path.join(out, pid + '.bin.gz'), 'wb') as f: f.write(gzip.compress(bytes(buf), 9, mtime=0))
        index['plants'][pid] = {'file': pid + '.bin.gz', 'keys': keys, 'variants': nvar, 'models': models, 'heights': heights, 'bytes': len(buf)}
        stats[pid] = {'kb': len(buf) // 1024, 'avgVerts': tv // (nvar * len(keys))}
    with open(ip, 'w') as f: json.dump(index, f, separators=(',', ':'))
    return stats

# ───────────────────────── Vorschau ─────────────────────────

def preview(pid, variant=0, ps=None, spacing=None, path=None):
    c = coll('OB_preview')
    fn, stages, _ = SPECIES[pid]
    ps = ps or [0, .06, .14, .3, .5, .6, .75, .92, 1.0]
    xs = 0.0
    maxh = .05
    placed = []
    for i, p in enumerate(ps):
        g = build(pid, p, variant)
        V = [v for m in g.p.values() for v in m[0]]
        w = (max(v.x for v in V) - min(v.x for v in V)) if V else .02
        maxh = max(maxh, max(v.y for v in V) if V else 0)
        obs = to_objects(g, f'pv_{pid}_{i}', c)
        placed.append((obs, w))
    total = sum(max(w, .03) for _, w in placed) + .02 * len(placed)
    x = -total / 2
    for obs, w in placed:
        w = max(w, .03)
        for _, ob in obs: ob.location.x = x + w / 2
        x += w + .02
    return {'width': total, 'height': maxh}

def setup_render(width, height, path, res=(1800, 700), elev=.35):
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT') or o.name == 'Cube': bpy.data.objects.remove(o)
    cam = bpy.data.objects.new('OB_cam', bpy.data.cameras.new('OB_cam'))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(width * 1.08, height * 1.25 * res[0] / res[1])
    d = 3
    cam.location = (0, -d * math.cos(elev), height * .45 + d * math.sin(elev))
    cam.rotation_euler = (math.pi / 2 - elev, 0, 0)
    sun = bpy.data.objects.new('OB_sun', bpy.data.lights.new('OB_sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = 4.0; sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
    fill = bpy.data.objects.new('OB_fill', bpy.data.lights.new('OB_fill', 'SUN'))
    sc.collection.objects.link(fill)
    fill.data.energy = 1.2; fill.rotation_euler = (math.radians(-60), math.radians(-30), 0)
    w = sc.world or bpy.data.worlds.new('W'); sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (.35, .4, .45, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = .6
    # Bodenplatte
    if not bpy.data.objects.get('OB_soil'):
        bpy.ops.mesh.primitive_plane_add(size=1)
        pl = bpy.context.active_object; pl.name = 'OB_soil'
        m = bpy.data.materials.new('OB_soilmat'); m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.045, .03, .022, 1)
        pl.data.materials.append(m)
    pl = bpy.data.objects['OB_soil']; pl.scale = (width * 1.3, 2, 1)
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

if MODE == 'export':
    result = {'stats': export(globals().get('IDS'))}
elif MODE == 'preview':
    pid = globals().get('PID', 'salat')
    info = preview(pid, globals().get('VARIANT', 0), globals().get('PS'))
    setup_render(info['width'], info['height'], globals().get('OUT', '/tmp/ob_preview.png'), globals().get('RES', (1800, 700)), globals().get('ELEV', .35))
    result = info
