"""Lounge-Ausstattung für Orbital Botany — wird in Blender ausgeführt.

    blender --background --python tools/lounge_blender.py

Mit dem Python-Modul aus PyPI (pip install bpy) geht es ohne Blender-Programm:

    python -c "ROOT='.'; exec(open('tools/lounge_blender.py').read())"

Baut Couch, Pflanzenregal mit Zimmerpflanzen, Feuerlöscher und den Bodenbelag
der Lounge. Die Umgebungsverdeckung wird mit Cycles in die Eckfarben gebacken,
damit Falten, Fugen und Kontaktstellen auch ohne teure Schatten im Spiel Tiefe
haben.

Ausgabe: assets/props/index.json + props.bin.gz (Format siehe pack()).
Koordinaten beim Bauen wie im Spiel: y oben, z zum Betrachter, Meter.

MODE = 'export' (Vorgabe) oder 'preview' (rendert OUT je Requisit als PNG).
"""
import bpy, math, json, struct, os, gzip, zlib, runpy
from mathutils import Vector, Matrix, noise

ROOT = globals().get('ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODE = globals().get('MODE', 'export')
TAU = math.tau

# Die Pflanzenbausteine (Blattflächen, Stängel, Umrisse) kommen aus dem Pflanzengenerator.
P = runpy.run_path(os.path.join(ROOT, 'tools', 'plants_blender.py'), init_globals={'MODE': 'lib', 'ROOT': ROOT})
leaf, tube_g, lcol, outline, Geo = P['leaf'], P['tube'], P['lcol'], P['outline'], P['Geo']
basis, tilt, arc, path_pts, azv = P['basis'], P['tilt'], P['arc'], P['path_pts'], P['azv']
sh_round, sh_linear, sh_lance, sh_spatula = P['sh_round'], P['sh_linear'], P['sh_lance'], P['sh_spatula']
S_MED, S_LOW, S_MIN = P['S_MED'], P['S_LOW'], P['S_MIN']

def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def sm(a, b, x):
    t = clamp((x - a) / (b - a)) if b != a else (1.0 if x >= a else 0.0)
    return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def _s2l(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _l2s(c): c = clamp(c); return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
def H(h): return Vector((_s2l(((h >> 16) & 255) / 255), _s2l(((h >> 8) & 255) / 255), _s2l((h & 255) / 255)))
def mix(a, b, t): return a.lerp(b, clamp(t))
def rnd(key, a=0.0, b=1.0): return a + (b - a) * zlib.crc32(key.encode()) / 4294967296.0
def nz(p, f=1.0, s=0.0): return noise.noise(Vector((p.x * f + s, p.y * f + s * .7, p.z * f - s * .3)))

UP = Vector((0, 1, 0))

# ───────────────────────── Netzbausteine ─────────────────────────

class Block:
    """Ein zusammenhängendes Stück Oberfläche. Glatte Blöcke werden verschweißt
    und bekommen gemittelte Normalen, harte behalten Flächennormalen."""
    def __init__(self):
        self.V, self.F = [], []
        self.W = None                       # optionales Gewicht je Ecke (z. B. Nahtlage)
    def quad_grid(self, rows, closed=False):
        n = len(rows[0]); b = len(self.V)
        for r in rows: self.V.extend(r)
        span = n if closed else n - 1
        for i in range(len(rows) - 1):
            for j in range(span):
                j2 = (j + 1) % n
                self.F.append((b + i * n + j, b + i * n + j2, b + (i + 1) * n + j2, b + (i + 1) * n + j))
        return self
    def fan(self, center, ring, flip=False):
        b = len(self.V); self.V.append(center); self.V.extend(ring)
        n = len(ring)
        for j in range(n):
            f = (b, b + 1 + j, b + 1 + (j + 1) % n)
            self.F.append(f[::-1] if flip else f)
        return self
    def xf(self, M):
        self.V = [M @ v for v in self.V]; return self
    def deform(self, fn):
        self.V = [fn(v) for v in self.V]; return self
    def bounds(self):
        xs = [v.x for v in self.V]; ys = [v.y for v in self.V]; zs = [v.z for v in self.V]
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

def T(x=0, y=0, z=0): return Matrix.Translation(Vector((x, y, z)))
def RX(a): return Matrix.Rotation(a, 4, 'X')
def RY(a): return Matrix.Rotation(a, 4, 'Y')
def RZ(a): return Matrix.Rotation(a, 4, 'Z')
def SC(x, y, z): return Matrix.Diagonal(Vector((x, y, z, 1)))

def _band(h, r, seg, inner_n):
    """Stützstellen einer Achse: dicht in der Rundung, locker in der Fläche."""
    inner = h - r
    out = []
    for k in range(seg + 1):
        a = (math.pi / 2) * (1 - k / seg)
        out.append(-(inner + r * math.sin(a)))
    for k in range(1, inner_n):
        out.append(-inner + 2 * inner * k / inner_n)
    for k in range(seg + 1):
        a = (math.pi / 2) * k / seg
        out.append(inner + r * math.sin(a))
    return out

def softbox(w, h, d, r, seg=3, dens=(6, 3, 6), welt=None, welt_h=.004):
    """Quader mit gerundeten Kanten, mittig um den Ursprung. welt = Achse, um
    deren Stirnflächen eine Naht (Keder) läuft; ihr Gewicht landet in Block.W."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)
    ax = [_band(w / 2, r, seg, dens[0]), _band(h / 2, r, seg, dens[1]), _band(d / 2, r, seg, dens[2])]
    inner = Vector((w / 2 - r, h / 2 - r, d / 2 - r))
    b = Block()
    W = []
    def proj(v):
        c = Vector((clamp(v.x, -inner.x, inner.x), clamp(v.y, -inner.y, inner.y), clamp(v.z, -inner.z, inner.z)))
        dv = v - c
        if dv.length < 1e-9:
            W.append(0.0); return c
        dn = dv.normalized()
        wt = 0.0
        if welt is not None:
            a = abs(dn[welt]); side = math.sqrt(max(0, 1 - a * a))
            wt = math.exp(-((a - .7071) / .16) ** 2) if side > .3 else 0.0
        W.append(wt)
        return c + dn * (r + welt_h * wt)
    # sechs Seiten; Reihenfolge so, dass die Normalen nach außen zeigen
    for axis in range(3):
        for sgn in (-1, 1):
            u_ax, v_ax = [(1, 2), (2, 0), (0, 1)][axis]
            if sgn < 0: u_ax, v_ax = v_ax, u_ax
            rows = []
            for vv in ax[v_ax]:
                row = []
                for uu in ax[u_ax]:
                    p = [0.0, 0.0, 0.0]
                    p[axis] = sgn * [w, h, d][axis] / 2; p[u_ax] = uu; p[v_ax] = vv
                    row.append(proj(Vector(p)))
                rows.append(row)
            b.quad_grid(rows)
    b.W = W
    return b

def lathe(prof, sides=24, a0=0.0, a1=TAU, cap_bottom=False, cap_top=False):
    """Drehkörper um +Y; prof = [(r, y)] von unten nach oben."""
    closed = abs(a1 - a0 - TAU) < 1e-6
    n = sides if closed else sides + 1
    rows = []
    for r, y in prof:
        rows.append([Vector((r * math.sin(a0 + (a1 - a0) * k / sides), y, r * math.cos(a0 + (a1 - a0) * k / sides))) for k in range(n)])
    b = Block().quad_grid(rows, closed=closed)
    if cap_bottom: b.fan(Vector((0, prof[0][1], 0)), rows[0], flip=True)
    if cap_top: b.fan(Vector((0, prof[-1][1], 0)), rows[-1])
    return b

def tube(pts, radii, sides=8, caps=True):
    n = len(pts)
    if not hasattr(radii, '__len__'): radii = [radii] * n
    Tn = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    a = Vector((1, 0, 0)) if abs(Tn[0].x) < .9 else Vector((0, 0, 1))
    N = (a - Tn[0] * a.dot(Tn[0])).normalized()
    rows = []
    for i in range(n):
        N = (N - Tn[i] * N.dot(Tn[i])).normalized()
        B = Tn[i].cross(N)
        rows.append([pts[i] + (N * math.cos(k * TAU / sides) + B * math.sin(k * TAU / sides)) * radii[i] for k in range(sides)])
    b = Block().quad_grid(rows, closed=True)
    if caps:
        b.fan(pts[0], rows[0], flip=True)
        b.fan(pts[-1], rows[-1])
    return b

def flatbox(w, h, d):
    """Harte Kiste, jede Seite eigene Ecken."""
    b = Block()
    x, y, z = w / 2, h / 2, d / 2
    c = [Vector(v) for v in ((-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (3, 7, 6, 2), (0, 1, 5, 4)):
        base = len(b.V); b.V.extend(c[i] for i in f); b.F.append((base, base + 1, base + 2, base + 3))
    return b

def disc_grid(r, rings, sides, color_fn=None):
    """Kreisscheibe in der XY-Ebene, zeigt nach +Z (für Zifferblätter)."""
    b = Block()
    rows = []
    for i in range(1, rings + 1):
        rr = r * i / rings
        rows.append([Vector((rr * math.sin(k * TAU / sides), rr * math.cos(k * TAU / sides), 0)) for k in range(sides)])
    b.fan(Vector((0, 0, 0)), rows[0], flip=True)
    base = len(b.V)
    for row in rows[1:]: b.V.extend(row)
    off0 = 1
    for i in range(len(rows) - 1):
        a0 = off0 if i == 0 else base + (i - 1) * sides
        a1 = base + i * sides
        for k in range(sides):
            k2 = (k + 1) % sides
            b.F.append((a0 + k, a1 + k, a1 + k2, a0 + k2))
    return b

# ───────────────────────── Requisit ─────────────────────────

class Prop:
    """Sammelt Blöcke je Material mit Farben und Normalen."""
    def __init__(self, name, ao=.85, ao_dist=.25, occluders=()):
        self.name, self.ao, self.ao_dist, self.occluders = name, ao, ao_dist, occluders
        self.parts = {}                     # mat → list of (V, N, C, F, ao_weight)

    def add(self, mat, blk, col, smooth=True, ao=1.0):
        """col: Vector oder fn(p, n) → Vector (linear)."""
        V, F = blk.V, blk.F
        Wt = blk.W or [0.0] * len(V)
        if smooth:
            # verschweißen
            key = {}; remap = []; Vw = []; Ww = []
            for v, wt in zip(V, Wt):
                k = (round(v.x * 2e5), round(v.y * 2e5), round(v.z * 2e5))
                if k not in key: key[k] = len(Vw); Vw.append(v); Ww.append(wt)
                remap.append(key[k])
            Fw = []
            for f in F:
                g = tuple(remap[i] for i in f)
                if len(set(g)) >= 3: Fw.append(g)
            N = [Vector((0, 0, 0)) for _ in Vw]
            for f in Fw:
                for t in range(1, len(f) - 1):
                    a, b, c = Vw[f[0]], Vw[f[t]], Vw[f[t + 1]]
                    n = (b - a).cross(c - a)
                    for i in (f[0], f[t], f[t + 1]): N[i] += n
            N = [n.normalized() if n.length > 1e-12 else Vector((0, 1, 0)) for n in N]
            V, F, Wt = Vw, Fw, Ww
        else:
            Vf, Nf, Ff, Wf = [], [], [], []
            for f in F:
                a, b, c = V[f[0]], V[f[1]], V[f[2]]
                n = (b - a).cross(c - a)
                if len(f) > 3: n += (c - a).cross(V[f[3]] - a)
                if n.length < 1e-14: continue
                n.normalize()
                base = len(Vf)
                Vf.extend(V[i] for i in f); Nf.extend([n] * len(f)); Wf.extend(Wt[i] for i in f)
                Ff.append(tuple(range(base, base + len(f))))
            V, N, F, Wt = Vf, Nf, Ff, Wf
        takes_w = callable(col) and 'w' in col.__code__.co_varnames[:col.__code__.co_argcount]
        C = [(col(v, n, w) if takes_w else col(v, n)) if callable(col) else col for v, n, w in zip(V, N, Wt)]
        self.parts.setdefault(mat, []).append([V, N, C, F, ao])

    def add_geo(self, g, M=Matrix.Identity(4)):
        """Übernimmt einen Pflanzen-Geo (Blätter zweiseitig, Stängel rund)."""
        for m, (V, C, F) in g.p.items():
            if not F: continue
            b = Block(); b.V = [M @ v for v in V]; b.F = list(F)
            self._add_indexed('leaf' if m in ('leaf', 'petal') else 'stem', b, list(C))

    def _add_indexed(self, mat, blk, cols):
        V, F = blk.V, blk.F
        N = [Vector((0, 0, 0)) for _ in V]
        for f in F:
            for t in range(1, len(f) - 1):
                a, b, c = V[f[0]], V[f[t]], V[f[t + 1]]
                n = (b - a).cross(c - a)
                for i in (f[0], f[t], f[t + 1]): N[i] += n
        N = [n.normalized() if n.length > 1e-14 else Vector((0, 1, 0)) for n in N]
        self.parts.setdefault(mat, []).append([list(V), N, list(cols), list(F), 1.0])

    def verts(self): return sum(len(b[0]) for L in self.parts.values() for b in L)

# ───────────────────────── Couch ─────────────────────────
# Vorn ist −Z, die Lehne liegt bei +Z (wie bisher im Spiel). Boden bei y = 0.

FAB_BODY, FAB_CUSH, FAB_PIPE = H(0x3d5775), H(0x46627f), H(0x2a3c52)

def fabric(base, amt=.07, f=18.0, seed=0.0, welt=.45):
    def c(p, n, w=0.0):
        k = 1 + amt * nz(p, f, seed) + amt * .5 * nz(p, f * 3.1, seed + 4)
        return base * k * (1 - welt * w)
    return c

def puff(hx, hz, amt, top=True, axis='y', edge=.0):
    """Wölbt die Ober- (bzw. Unter-)seite eines Kissens nach außen."""
    def fn(v):
        u = clamp(1 - (v.x / hx) ** 2); w = clamp(1 - ((v.z if axis == 'y' else v.y) / hz) ** 2)
        k = (u * w) ** .8
        if axis == 'y':
            if (v.y > 0) == top or edge: v = v + Vector((0, (1 if v.y > 0 else -1) * amt * k, 0))
        else:
            v = v + Vector((0, 0, (1 if v.z > 0 else -1) * amt * k))
        return v
    return fn

def build_couch():
    pr = Prop('couch', ao=.9, ao_dist=.22, occluders=('floor',))
    W = 2.64
    # Füße: gebürstetes Metall, leicht konisch
    for sx in (-1, 1):
        for sz in (-1, 1):
            b = lathe([(.022, 0), (.026, .01), (.03, .1), (.034, .104)], 16, cap_bottom=True, cap_top=True).xf(T(sx * 1.12, 0, sz * .33))
            pr.add('metal', b, H(0x9aa0a6), ao=.4)
    # Sockel
    base = softbox(2.52, .14, .84, .035, 3, (10, 2, 4)).xf(T(0, .17, .02))
    pr.add('fabric', base, fabric(FAB_BODY * .8, .05, 20, 1))
    # Armlehnen: oben gewölbt, außen leicht ausgestellt, Keder um die Stirnseiten
    for s in (-1, 1):
        a = softbox(.24, .54, .96, .085, 5, (3, 6, 8), welt=0)
        a.deform(puff(.12, .48, .018))
        a.deform(lambda v, s=s: v + Vector((s * .012 * sm(-.2, .27, v.y), 0, 0)))
        a.xf(T(s * 1.2, .37, .02))
        pr.add('fabric', a, fabric(FAB_BODY, .06, 18, 2 + s))
    # Rückenteil
    back = softbox(2.16, .5, .2, .06, 3, (12, 4, 2)).xf(T(0, .5, .38))
    pr.add('fabric', back, fabric(FAB_BODY * .95, .05, 20, 5))
    # Sitzkissen mit Keder oben und unten, in der Mitte durchgesessen
    cw = 2.16 / 3
    for i in range(3):
        x = (i - 1) * cw
        c = softbox(cw - .012, .17, .76, .07, 5, (8, 3, 8), welt=1, welt_h=.005)
        seed = i * 3.7
        def seat(v, seed=seed):
            u = clamp(1 - (v.x / (cw / 2)) ** 2); w = clamp(1 - (v.z / .38) ** 2)
            k = (u * w) ** .7
            if v.y > 0:
                v = v + Vector((0, .028 * k - .012 * k * sm(-.1, .25, -v.z) * sm(-.1, .1, v.x) + .004 * noise.noise(Vector((v.x * 9 + seed, v.z * 9, 0))), 0))
            # vorn etwas voller
            v = v + Vector((0, 0, -.012 * sm(.0, .38, -v.z) * sm(-.08, .08, v.y)))
            return v
        c.deform(seat).xf(T(x, .325, -.05))
        pr.add('fabric', c, fabric(FAB_CUSH, .07, 18, seed))
    # Rückenkissen, nach hinten gekippt, mit Knöpfen
    for i in range(3):
        x = (i - 1) * cw
        c = softbox(cw - .014, .52, .2, .085, 5, (8, 8, 3), welt=2, welt_h=.005)
        c.deform(puff(cw / 2, .26, .03, axis='z'))
        def tuft(v):
            for bx, by in ((-.14, .08), (.14, .08), (0, -.06)):
                d2 = (v.x - bx) ** 2 + (v.y - by) ** 2
                if v.z < 0: v = v + Vector((0, 0, .018 * math.exp(-d2 / .0012)))
            return v
        c.deform(tuft)
        M = T(x, .68, .2) @ RX(-.2)
        c.xf(M)
        pr.add('fabric', c, fabric(FAB_CUSH * 1.02, .07, 18, 10 + i))
        for bx, by in ((-.14, .08), (.14, .08), (0, -.06)):
            k = lathe([(.0001, -.002), (.011, .0), (.012, .004), (.0001, .008)], 12).xf(M @ T(bx, by, -.118) @ RX(-math.pi / 2))
            pr.add('fabric', k, FAB_PIPE * .9, ao=.5)
    # Zierkissen, an die Lehne gelehnt: quadratisch, mit Keder und gekniffenen Ecken
    for s, colr, ang in ((-1, H(0x9a5238), .12), (1, H(0xae8a3c), -.1)):
        c = softbox(.44, .44, .12, .04, 4, (8, 8, 2), welt=2, welt_h=.004)
        c.deform(puff(.22, .22, .04, axis='z'))
        c.deform(lambda v: Vector((v.x * (1 - .04 * (v.y / .22) ** 2), v.y * (1 - .04 * (v.x / .22) ** 2), v.z * (1 - .5 * ((v.x / .22) ** 2 * (v.y / .22) ** 2)))))
        c.xf(T(s * .78, .62, .1) @ RY(s * .3) @ RX(-.3) @ RZ(ang))
        pr.add('fabric', c, fabric(colr, .08, 26, 20 + s, welt=.3))
    # Haltegurte über den Armlehnen — in Schwerelosigkeit bleibt sonst nichts liegen
    for s in (-1, 1):
        pts = []
        for k in range(15):
            a = math.pi * k / 14
            pts.append(Vector((s * 1.2 + s * .006 - math.cos(a) * .142, .37 + math.sin(a) * .302, .18)))
        pts[0].y = pts[-1].y = .12
        strap = Block()
        rows = [[p + Vector((0, 0, -.025)), p + Vector((0, 0, .025))] for p in pts]
        for r in rows:
            r[0] = r[0] + (r[0] - Vector((s * 1.2, .37, r[0].z))).normalized() * .004
            r[1] = r[1] + (r[1] - Vector((s * 1.2, .37, r[1].z))).normalized() * .004
        strap.quad_grid(rows)
        pr.add('rubber', strap, H(0x3b3d40), smooth=True, ao=.5)
        buckle = softbox(.05, .012, .06, .004, 2, (2, 1, 2)).xf(T(s * 1.206, .676, .18))
        pr.add('metal', buckle, H(0x8a9096), ao=.3)
    return pr

# ───────────────────────── Pflanzenregal ─────────────────────────
# Regal lokal: x entlang der Wand, z zum Raum, y oben; Brettoberkante unten bei y = 0.

def wood(p, n):
    g = math.sin((p.z * 140 + 5 * nz(p, 6, 1)) + p.y * 30) * .5 + .5
    k = .92 + .1 * g * g + .05 * nz(p, 30, 2)
    return H(0xa47c52) * k

def pot_terracotta(pr, x, y):
    prof = [(.0, 0), (.064, 0), (.066, .004), (.082, .11), (.098, .112), (.1, .118), (.1, .14), (.096, .142), (.088, .142), (.084, .136), (.074, .02)]
    b = lathe(prof, 28).xf(T(x, y + .012, 0))
    pr.add('clay', b, lambda p, n: H(0xa9583a) * (1 + .08 * nz(p, 25, x) + .04 * nz(p, 80)))
    sauc = lathe([(.0, 0), (.072, 0), (.076, .003), (.09, .012), (.088, .014), (.074, .006), (0, .006)], 28).xf(T(x, y, 0))
    pr.add('clay', sauc, H(0x9a4f35))
    return y + .012 + .122

def pot_ceramic(pr, x, y):
    prof = [(.0, 0), (.07, 0), (.082, .006), (.088, .02), (.088, .128), (.086, .134), (.08, .134), (.078, .128), (.078, .02)]
    b = lathe(prof, 32).xf(T(x, y + .002, 0))
    pr.add('ceramic', b, lambda p, n: H(0xe6e2d8) if p.y > y + .03 else H(0xc9b8a0))
    return y + .002 + .118

def pot_concrete(pr, x, y):
    prof = [(.0, 0), (.06, 0), (.064, .004), (.09, .126), (.09, .132), (.082, .132), (.056, .012)]
    b = lathe(prof, 6).xf(T(x, y + .002, 0) @ RY(.26))   # sechseckig
    pr.add('ceramic', b, lambda p, n: H(0x8c8c88) * (1 + .06 * nz(p, 40, 3)), smooth=False)
    return y + .002 + .118

def soil(pr, x, y, r, seed):
    b = disc_grid(r, 4, 24).xf(T(x, y, 0) @ RX(-math.pi / 2))
    b.deform(lambda v: v + Vector((0, .004 * nz(v, 60, seed), 0)))
    pr.add('soil', b, lambda p, n: H(0x2e2219) * (1 + .3 * nz(p, 90, seed)))
    # Blähtonkugeln obenauf
    for k in range(14):
        a = rnd(f'pa{seed}{k}', 0, TAU); rr = r * math.sqrt(rnd(f'pr{seed}{k}', .05, .9))
        s = rnd(f'ps{seed}{k}', .006, .01)
        pb = lathe([(0, -s), (s * .7, -s * .7), (s, 0), (s * .7, s * .7), (0, s)], 8).xf(T(x + rr * math.cos(a), y + s * .4, rr * math.sin(a)))
        pr.add('clay', pb, H(0x8a4a2c) * rnd(f'pc{seed}{k}', .8, 1.1))

# ── Zimmerpflanzen (Pflanzenkoordinaten: y oben, Boden bei 0) ──

def plant_pothos(R, hang=.4):
    """Efeutute: herzförmige, gelb panaschierte Blätter an hängenden Ranken."""
    g = Geo()
    stemc = lambda t: mix(H(0x6a9a40), H(0x88aa50), t)
    def pcol(t, s, seed=[0]):
        base = mix(H(0x2f6a2a), H(0x3c7a30), t)
        v = noise.noise(Vector((s * 3 + seed[0], t * 4, seed[0] * .3)))
        base = mix(base, H(0xd6cf6a), sm(.25, .55, v) * .85)
        return mix(base, H(0x9ac070), (1 - sm(0, .06, abs(s))) * .5)
    heart = lambda t: (math.sin(math.pi * (.12 + .88 * t) ** .75) ** .7) * (1 - .25 * sm(.85, 1, t))
    for v in range(7):
        az = R(f'az{v}', -1.2, 1.2) + (0 if v < 5 else math.pi)
        down = v < 5
        L = R(f'L{v}', .25, hang + .2) if down else R(f'L{v}', .1, .16)
        n = 26
        pts = []
        P0 = Vector((math.sin(az) * .02, .01, math.cos(az) * .02))
        P = P0.copy()
        for i in range(n + 1):
            t = i / n
            pts.append(P.copy())
            # erst über den Rand, dann hängend nach unten
            out = azv(az) * (.018 if t < .3 else .006)
            upv = UP * (.012 * (1 - t / .25) if t < .25 else (-.03 if down else .004))
            P = P + out + upv + Vector((R(f'w{v}{i}', -.004, .004), 0, R(f'q{v}{i}', -.004, .004)))
            if down and P.y < -hang - .1: P.y = -hang - .1
        tube_g(g, pts, [.0022] * len(pts), stemc, sides=4)
        for i in range(2, n + 1, 2):
            t = i / n
            p = pts[i]
            side = 1 if (i // 2) % 2 else -1
            a = az + side * 1.2
            d, z = tilt(a, .9 if not down else 1.3)
            d = (d + UP * .5 + azv(az) * .4).normalized()
            s = (.07 - .03 * t) * R(f's{v}{i}', .8, 1.15)
            pr = arc(p, a, 1.0, -.4, .015, 2)
            tube_g(g, path_pts(pr), [.0012] * 3, stemc, sides=3)
            base, dd, zz = pr[-1]
            M = basis(base, (dd + UP * .6 + azv(az) * .5).normalized(), zz + UP * .6)
            leaf(g, M, s, s * .42, heart, lambda tt, ss, k=v * 31 + i: pcol(tt, ss, [k]), nl=8, S=S_MED,
                 cup=-.35, bend=.35, fold=.08, seed=v + i, notch=.02)
    return g

def plant_snake(R):
    """Bogenhanf: steife, aufrechte Schwertblätter mit Querbändern und gelbem Rand."""
    g = Geo()
    for i in range(9):
        az = i * 2.4 + R(f'a{i}', -.3, .3)
        r0 = R(f'r{i}', .005, .03)
        base = Vector((math.sin(az) * r0, 0, math.cos(az) * r0))
        L = R(f'L{i}', .22, .38) * (1 - .35 * (i > 5))
        W = R(f'W{i}', .026, .036)
        th = R(f't{i}', .05, .22) + (i > 5) * .2
        d, z = tilt(az, th)
        seed = i * 1.7
        def col(t, s, seed=seed):
            band = .5 + .5 * math.sin(t * 46 + 3 * noise.noise(Vector((s * 2 + seed, t * 6, seed))))
            c = mix(H(0x23452a), H(0x5c7e4a), band ** 3 * .8)
            return mix(c, H(0xcdb84e), sm(.78, .95, abs(s)))
        leaf(g, basis(base, d, z, R(f'ro{i}', -.6, .6)), L, W, lambda t: math.sin(math.pi * (.08 + .92 * t) ** .9) ** .35 * (1 - .8 * sm(.85, 1, t)) + .15 * (1 - t),
             col, nl=14, S=S_MED, fold=.35, cup=-.4, twist=R(f'tw{i}', -.7, .7), bend=.08, seed=seed)
    return g

def plant_spider(R):
    """Grünlilie: überhängende, weiß gestreifte Blätter, dazu zwei Ausläufer mit Kindeln."""
    g = Geo()
    col = lambda t, s: mix(mix(H(0x3a7d34), H(0x5a9a44), t), H(0xeef0d8), (1 - sm(.18, .32, abs(s))) * (1 - .3 * t))
    def rosette(center, n, scale, key):
        for i in range(n):
            az = i * 2.39996 + R(f'{key}a{i}', -.2, .2)
            L = R(f'{key}L{i}', .16, .3) * scale
            th = R(f'{key}t{i}', .25, .8)
            d, z = tilt(az, th)
            leaf(g, basis(center, d, z), L, .011 * scale ** .5, sh_linear, col, nl=12, S=S_LOW,
                 bend=R(f'{key}b{i}', 1.1, 2.2), fold=.25, twist=R(f'{key}tw{i}', -.4, .4), seed=i)
    rosette(Vector((0, .005, 0)), 26, 1.0, 'm')
    for k in range(2):
        az = R(f'sa{k}', 0, TAU)
        pts = []
        for i in range(12):
            t = i / 11
            pts.append(Vector((math.sin(az) * .3 * t, .08 * math.sin(math.pi * t * .7) - .25 * t * t, math.cos(az) * .3 * t)))
        tube_g(g, pts, [.0015] * len(pts), lambda t: H(0xc8d8a0), sides=4)
        rosette(pts[-1], 7, .35, f'k{k}')
    return g

def plant_pilea(R):
    """Ufopflanze: runde, schildförmige Blätter auf langen Stielen."""
    g = Geo()
    stemc = lambda t: mix(H(0x5e8a3a), H(0x7aa048), t)
    trunk = [Vector((0, 0, 0)), Vector((.003, .05, .002)), Vector((.004, .1, 0))]
    tube_g(g, trunk, [.006, .005, .004], stemc, sides=6)
    col = lcol(H(0x3f8a2c), H(0x4f9a36), rib=H(0x7fb860), rib_w=.04)
    for i in range(16):
        az = i * 2.39996
        h = .03 + .07 * (i / 16)
        base = Vector((0, h, 0))
        L = R(f'p{i}', .07, .13) * (1 - .3 * i / 16)
        th = lerp(1.35, .5, i / 16)
        pa = arc(base, az, th, -.3, L, 4)
        tube_g(g, path_pts(pa), [.0014] * 5, stemc, sides=3)
        tip, d, z = pa[-1]
        D = R(f'd{i}', .075, .1) * (1 - .25 * i / 16)
        # schildförmig: der Stiel sitzt nahe der Blattmitte
        flat = (azv(az) * .95 + UP * lerp(.1, .45, i / 16)).normalized()
        nrm = (UP - flat * flat.dot(UP)).normalized()
        M = basis(tip - flat * D * .42, flat, nrm)
        leaf(g, M, D, D * .5, lambda t: math.sin(math.pi * t) ** .5, col, nl=10, S=S_MED, cup=.25, seed=i)
    return g

def plant_echeveria(R):
    """Echeverie: dichte, bläulich bereifte Rosette mit rosa Spitzen."""
    g = Geo()
    col = lambda t, s: mix(mix(H(0x7ea39a), H(0x9ab8ae), t), H(0xd08a90), sm(.78, 1, t) * .8)
    for i in range(34):
        az = i * 2.39996
        k = i / 34
        L = lerp(.085, .035, k ** .8)
        th = lerp(1.3, .3, k)
        base = Vector((0, .01 + k * .02, 0))
        d, z = tilt(az, th)
        leaf(g, basis(base, d, z), L, L * .42, lambda t: sh_spatula(t) * (1 - .6 * sm(.9, 1, t)) + .1, col,
             nl=8, S=S_MED, cup=.7, fold=.15, bend=-.2, seed=i)
    return g

def plant_fern(R):
    """Schwertfarn: überhängende Wedel mit wechselständigen Fiedern."""
    g = Geo()
    lc = lcol(H(0x3f7d2e), H(0x62a044))
    stemc = lambda t: H(0x5a7a36)
    for i in range(13):
        az = i * 2.39996 + R(f'a{i}', -.2, .2)
        L = R(f'L{i}', .2, .32)
        th = R(f't{i}', .2, .6)
        A = arc(Vector((0, .01, 0)), az, th, R(f'b{i}', 1.0, 1.6), L, 14)
        tube_g(g, path_pts(A), [.0016 * (1 - .6 * j / 14) + .0005 for j in range(15)], stemc, sides=3)
        for j in range(2, 15):
            P0, d, z = A[j]
            t = j / 14
            s = .038 * math.sin(math.pi * clamp(t * 1.1)) ** .6 + .006
            side = azv(az + math.pi / 2)
            for sg in (-1, 1):
                dd = (side * sg * .9 + d * .45).normalized()
                leaf(g, basis(P0, dd, z), s, s * .22, lambda tt: math.sin(math.pi * tt ** .8) ** .8, lc, nl=5, S=S_LOW, cup=-.2, bend=.2, seed=i * 20 + j)
    return g

# Lage im Raum (für die Wandhalterungen): Mitte der Lounge-Röhre bei x = 0, y = 0.
SHELF_AT = (-2.62, -.62)            # (x, y) des unteren Bretts in Raumkoordinaten
SHELF_GAP = .46
LOUNGE_R = 2.85

def wall_z(y):
    """Lage der Modulwand in Regalkoordinaten (z), abhängig von der Höhe."""
    yw = y + SHELF_AT[1]
    return -(math.sqrt(LOUNGE_R ** 2 - yw * yw) + SHELF_AT[0])

def build_shelf():
    pr = Prop('shelf', ao=.85, ao_dist=.2)
    L = 1.5
    plants = [
        # (Topf, Pflanze, x, Ebene)
        (pot_ceramic, lambda: plant_pothos(P['Rand']('pothos'), .42), -.45, 1),
        (pot_concrete, lambda: plant_snake(P['Rand']('snake')), 0.0, 1),
        (pot_terracotta, lambda: plant_spider(P['Rand']('spider')), .47, 1),
        (pot_terracotta, lambda: plant_pilea(P['Rand']('pilea')), -.46, 0),
        (pot_concrete, lambda: plant_echeveria(P['Rand']('eche')), 0.0, 0),
        (pot_ceramic, lambda: plant_fern(P['Rand']('fern')), .46, 0),
    ]
    for lv in (0, 1):
        y = lv * SHELF_GAP
        board = softbox(L, .036, .3, .008, 2, (14, 1, 4)).xf(T(0, y - .018, 0))
        pr.add('wood', board, wood)
        # Halterungen bis an die gekrümmte Modulwand
        for x in (-.58, .58):
            yt, yb = y - .036, y - .25
            zt, zb = wall_z(yt), wall_z(yb)
            plate = softbox(.03, .24, .01, .004, 2, (1, 3, 1))
            tilt_a = math.atan2(zt - zb, yt - yb)
            plate.xf(T(x, (yt + yb) / 2, (zt + zb) / 2 + .005) @ RX(-tilt_a))
            pr.add('metal', plate, H(0x3a3e44), ao=.5)
            arm = Vector((x, y - .043, zt)), Vector((x, y - .043, .1))
            pr.add('metal', softbox(.03, .014, arm[1].z - arm[0].z, .004, 2, (1, 1, 4)).xf(T(x, y - .043, (arm[0].z + arm[1].z) / 2)), H(0x3a3e44), ao=.5)
            pr.add('metal', tube([Vector((x, yb + .02, zb + .01)), Vector((x, y - .05, .07))], .006, 8), H(0x3a3e44), ao=.5)
        # Vordere Haltestange
        for x in (-.72, .72):
            pr.add('metal', tube([Vector((x, y, .135)), Vector((x, y + .06, .135))], .005, 8), H(0xa0a6ac), ao=.4)
        pr.add('metal', tube([Vector((-.73, y + .06, .135)), Vector((.73, y + .06, .135))], .0065, 10), H(0xa0a6ac), ao=.4)
    for pot, mk, x, lv in plants:
        y = lv * SHELF_GAP
        top = pot(pr, x, y)
        r_in = .08 if pot is pot_terracotta else .074
        soil(pr, x, top - .018, r_in, x * 10 + lv)
        g = mk()
        pr.add_geo(g, T(x, top - .018, 0))
    # Gummiseile vor den Töpfen — hält alles in Schwerelosigkeit an seinem Platz
    for lv in (0, 1):
        y = lv * SHELF_GAP + .075
        pts = []
        for i in range(61):
            x = -.72 + 1.44 * i / 60
            z = .05
            for _, _, px, plv in plants:
                if plv != lv: continue
                dx = x - px
                if abs(dx) < .1: z = max(z, math.sqrt(max(0, .1 ** 2 - dx * dx)) + .002)
            pts.append(Vector((x, y - .004 * math.sin(math.pi * i / 60), z)))
        pr.add('rubber', tube(pts, .0045, 6), H(0xc85a1e), ao=.5)
        for x in (-.72, .72):
            hook = tube([Vector((x, y, .05)), Vector((x, y, .135)), Vector((x, y + .01, .14))], .003, 6)
            pr.add('metal', hook, H(0x9aa0a6), ao=.3)
    return pr

# ───────────────────────── Wolldecke über der Armlehne ─────────────────────────
# Mit Blenders Stoffsimulation über die linke Armlehne der Couch geworfen:
# Ein Teil liegt auf dem Sitzkissen, der Rest hängt außen herab. Koordinaten
# wie die Couch (vorn −Z), damit die Decke im Spiel einfach in die Couch-Gruppe kommt.

def plaid(u, v):
    """Karierte Wolldecke: Terrakotta mit dunklen Bahnen und hellen Fäden."""
    base = H(0xa8503a)
    def band(t, n):
        f = (t * n) % 1.0
        return sm(.0, .06, f) * sm(.26, .2, f), sm(.42, .45, f) * sm(.5, .47, f)
    d1, l1 = band(u, 7); d2, l2 = band(v, 4)
    c = base * (1 - .32 * d1) * (1 - .32 * d2)
    c = mix(c, H(0xe8d8bc), max(l1, l2) * .75)
    # Saum an den kurzen Enden
    c = mix(c, H(0x5a2a1e), sm(.03, .0, min(u, 1 - u)) * .8)
    return c

def build_blanket():
    pr = Prop('blanket', ao=.85, ao_dist=.12, occluders=('floor',))
    sc = bpy.context.scene
    c = coll('LB_cloth')
    couch = build_couch()
    obs = to_blender(couch, c)
    for _, _, o in obs:
        o.modifiers.new('Collision', 'COLLISION')
        o.collision.thickness_outer = .006
        o.collision.cloth_friction = 12
    fl = occluder('floor', c)
    fl.modifiers.new('Collision', 'COLLISION')
    # Decke: 1,15 m × 0,62 m, quer über der Armlehne, leicht schräg
    nu, nv = 92, 50
    L, Wd = 1.15, .62
    V, F, UV = [], [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            x = -1.0 + (u - .5) * L
            z = -.1 + (v - .5) * Wd + .08 * (u - .5)
            y = .82 + .03 * math.sin(u * 7 + v * 3)
            V.append(Vector((x, y, z))); UV.append((u, v))
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            F.append((a, a + 1, a + nu + 2, a + nu + 1))
    me = bpy.data.meshes.new('LB_blanket')
    me.from_pydata([g2b(v) for v in V], [], F)
    ob = bpy.data.objects.new('LB_blanket', me)
    c.objects.link(ob)
    cl = ob.modifiers.new('Cloth', 'CLOTH')
    st = cl.settings
    st.quality = 10
    st.mass = .4
    st.tension_stiffness = st.compression_stiffness = 20
    st.shear_stiffness = 8
    st.bending_stiffness = .8
    st.air_damping = 2
    cs = cl.collision_settings
    cs.distance_min = .005
    cs.use_self_collision = True
    cs.self_distance_min = .004
    cl.point_cache.frame_start, cl.point_cache.frame_end = 1, 90
    for f in range(1, 91):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    em = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    P = [Vector((v.co.x, v.co.z, -v.co.y)) for v in em.vertices]
    bpy.data.meshes.remove(em)
    sc.frame_set(1)
    coll('LB_cloth')
    # Dicke: Ober- und Unterseite plus Rand, damit die hängende Seite von beiden Seiten sichtbar ist
    N = [Vector((0, 0, 0)) for _ in P]
    for f in F:
        a, b, d = P[f[0]], P[f[1]], P[f[3]]
        n = (b - a).cross(d - a)
        for i in f: N[i] += n
    N = [n.normalized() if n.length > 1e-12 else Vector((0, 1, 0)) for n in N]
    if sum(n.y for n in N) < 0: N = [-n for n in N]; F = [f[::-1] for f in F]
    t = .007
    cols = [plaid(u, v) for u, v in UV]
    top = Block(); top.V = [p + n * t / 2 for p, n in zip(P, N)]; top.F = list(F)
    bot = Block(); bot.V = [p - n * t / 2 for p, n in zip(P, N)]; bot.F = [f[::-1] for f in F]
    pr._add_indexed('fabric', top, cols)
    pr._add_indexed('fabric', bot, [c0 * .92 for c0 in cols])
    rim = Block()
    ring = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
    idx = [j * (nu + 1) + i for i, j in ring]
    rim.V = [top.V[k] for k in idx] + [bot.V[k] for k in idx]
    m = len(idx)
    rim.F = [(k, (k + 1) % m, m + (k + 1) % m, m + k) for k in range(m)]
    pr._add_indexed('fabric', rim, [cols[k] * .8 for k in idx] * 2)
    return pr

# ───────────────────────── Laborbank ─────────────────────────
# Ursprung: Mitte der Bank auf Bodenhöhe, Vorderseite +Z (zum Gang).
# Dunkle Phenolharzplatte, vorn eine Aluleiste mit Sitzschienenlöchern als Rand
# gegen Wegtreiben, hinten eine Aufkantung mit Steckdosen. Darunter Schubladen-
# und Türschränke mit Edelstahlgriffen über einem zurückgesetzten Sockel.

def build_labbench(L=5.24, seed='lb'):
    pr = Prop('labbench', ao=.85, ao_dist=.16, occluders=('floor',))
    D, top = .72, .94
    slate = lambda p, n: H(0x3a3e44) * (1 + .04 * nz(p, 5, 3) + .02 * nz(p, 40, 1))
    # Arbeitsplatte mit gerundeter Vorderkante
    pr.add('plastic', softbox(L, .036, D, .008, 3, (60, 1, 8)).xf(T(0, top - .018, 0)), slate)
    # Aluleiste vorn: Profil mit Lochreihe im Zollraster
    pr.add('metal', softbox(L - .02, .02, .028, .004, 2, (60, 1, 1)).xf(T(0, top + .01, D / 2 - .016)), H(0xa9adb2))
    hole = lambda x: lathe([(1e-4, 0), (.0042, 0)], 10, cap_top=False).xf(T(x, top + .0202, D / 2 - .016))
    x = -L / 2 + .03
    while x < L / 2 - .03:
        pr.add('rubber', hole(x), H(0x101114), smooth=False, ao=0)
        x += .0254
    # Aufkantung hinten mit Steckdosen
    pr.add('paint', softbox(L, .13, .03, .006, 2, (60, 3, 1)).xf(T(0, top + .065, -D / 2 + .015)), H(0xd5d8db))
    x = -L / 2 + .5
    while x < L / 2 - .3:
        plate = softbox(.12, .07, .012, .004, 2, (2, 2, 1)).xf(T(x, top + .06, -D / 2 + .036))
        pr.add('plastic', plate, H(0xeeeeea), ao=.6)
        for sx in (-.028, .028):
            sk = lathe([(.017, 0), (.017, .004), (.012, .004), (.012, -.002)], 16).xf(T(x + sx, top + .06, -D / 2 + .043) @ RX(math.pi / 2))
            pr.add('rubber', sk, H(0x2a2c30), ao=.5)
        led = softbox(.006, .006, .004, .0015, 1, (1, 1, 1)).xf(T(x + .05, top + .085, -D / 2 + .043))
        pr.add('glow', led, H(0x3adf7a), ao=0)
        x += .9
    # Korpus und Sockel
    h = top - .036 - .1
    pr.add('paint', softbox(L - .03, h, D - .12, .006, 2, (40, 4, 4)).xf(T(0, .1 + h / 2, -.05)), H(0xa7aeb5), ao=1)
    pr.add('rubber', softbox(L - .1, .1, D - .26, .004, 1, (20, 1, 2)).xf(T(0, .05, -.1)), H(0x26282b))
    # Fronten: Module von gut 0,7 m, abwechselnd Schubladen und Türen
    n = max(1, round((L - .03) / .74))
    mw = (L - .03) / n
    fz = D / 2 - .11 + .011
    R = lambda k, a=0.0, b=1.0: rnd(f'{seed}{k}', a, b)
    white = lambda p, n: H(0xe2e5e8) * (1 + .015 * nz(p, 8, 2))
    def handle(cx, cy, length, vertical=False):
        if vertical:
            pts = [Vector((cx, cy - length / 2, fz + .028)), Vector((cx, cy + length / 2, fz + .028))]
            feet = [Vector((cx, cy - length / 2 + .01, fz)), Vector((cx, cy + length / 2 - .01, fz))]
        else:
            pts = [Vector((cx - length / 2, cy, fz + .028)), Vector((cx + length / 2, cy, fz + .028))]
            feet = [Vector((cx - length / 2 + .01, cy, fz)), Vector((cx + length / 2 - .01, cy, fz))]
        pr.add('metal', tube(pts, .0055, 10), H(0xb8bcc0), ao=.5)
        for f0 in feet:
            pr.add('metal', tube([f0, f0 + Vector((0, 0, .03))], .005, 8), H(0xa0a4a8), ao=.5)
    for i in range(n):
        x0 = -L / 2 + .015 + i * mw
        cx = x0 + mw / 2
        if i % 2 == 0:
            ys = [.1, .3, .52, top - .036]
            for j in range(3):
                y0, y1 = ys[j] + .004, ys[j + 1] - .004
                pr.add('paint', softbox(mw - .008, y1 - y0, .022, .005, 2, (6, 3, 1)).xf(T(cx, (y0 + y1) / 2, fz)), white)
                handle(cx, y1 - .045, .22)
                # Etikettenhalter
                pr.add('metal', softbox(.08, .025, .004, .001, 1, (1, 1, 1)).xf(T(cx, y1 - .085, fz + .013)), H(0x9aa0a6), ao=.5)
                pr.add('plastic', softbox(.07, .016, .002, .0005, 1, (1, 1, 1)).xf(T(cx, y1 - .085, fz + .0155)), H(0xf4f2ea), ao=.4)
        else:
            y0, y1 = .104, top - .04
            for s in (-1, 1):
                dx = cx + s * mw / 4
                pr.add('paint', softbox(mw / 2 - .008, y1 - y0, .022, .005, 2, (3, 6, 1)).xf(T(dx, (y0 + y1) / 2, fz)), white)
                handle(cx + s * .04, y1 - .16, .18, vertical=True)
            # Lüftungsschlitze in der unteren Türhälfte (Kühlschrankmodul)
            if R(f'v{i}') < .5:
                for k in range(6):
                    pr.add('rubber', softbox(mw * .6, .008, .004, .002, 1, (2, 1, 1)).xf(T(cx, .16 + k * .02, fz + .012)), H(0x3a3d42), ao=.4)
    return pr

# ───────────────────────── Feuerlöscher ─────────────────────────
# Rückseite bei z = 0 (Wand), steht entlang +Y, Flasche mittig bei y = 0.

def build_extinguisher():
    pr = Prop('extinguisher', ao=.8, ao_dist=.08, occluders=('wall',))
    zc = .085
    red = lambda p, n: H(0xa8141a) * (1 + .03 * nz(p, 30))
    prof = [(0, -.245), (.038, -.243), (.058, -.236), (.066, -.225), (.068, -.212), (.068, .15), (.066, .168), (.058, .186),
            (.044, .199), (.028, .206), (.022, .212), (.022, .236)]
    pr.add('paint', lathe(prof, 40).xf(T(0, 0, zc)), red)
    # Gummifuß
    pr.add('rubber', lathe([(.06, -.25), (.07, -.247), (.0705, -.228), (.0685, -.224)], 40).xf(T(0, 0, zc)), H(0x1c1c1e))
    # Etikett: weißes Feld mit Kopfband, Brandklassen-Symbolen und Textzeilen
    a0, a1 = -1.15, 1.15
    rows = []
    NU, NV = 64, 48
    y0, y1 = -.13, .08
    for j in range(NV + 1):
        yy = y0 + (y1 - y0) * j / NV
        rows.append([Vector((.0688 * math.sin(a0 + (a1 - a0) * i / NU), yy, zc + .0688 * math.cos(a0 + (a1 - a0) * i / NU))) for i in range(NU + 1)])
    lab = Block().quad_grid(rows)
    def lab_col(p, n):
        u = (math.atan2(p.x, p.z - zc) - a0) / (a1 - a0); v = (p.y - y0) / (y1 - y0)
        if v > .82: return H(0x8a1015) if (.86 < v < .95 and .14 < u < .86) else H(0xf2efe6)
        if v > .74: return H(0x1a1a1a)
        if .5 < v < .68:
            k = int(u * 5)
            if .06 < (u * 5) % 1 < .86 and 0 < k < 4:
                return [H(0x2f7d3a), H(0x2c5fa8), H(0xd2a020)][k - 1]
        if v < .44 and (int(v * 40) % 3 == 0) and .12 < u < .88 - .3 * ((int(v * 40) * 7) % 3) / 3: return H(0x3a3a3a)
        return H(0xf2efe6)
    pr.add('plastic', lab, lab_col)
    # Ventilkopf
    pr.add('metal', lathe([(.024, .23), (.026, .236), (.026, .262), (.02, .27)], 20).xf(T(0, 0, zc)), H(0x9ea3a8), ao=.5)
    pr.add('metal', softbox(.056, .036, .046, .008, 2, (2, 1, 2)).xf(T(0, .285, zc)), H(0xb0b4b8), ao=.5)
    # Tragegriff und Hebel
    grip = softbox(.026, .012, .14, .005, 2, (1, 1, 6)).xf(T(0, .3, zc + .04) @ RX(-.08))
    pr.add('plastic', grip, H(0x1d1e20))
    lever = softbox(.026, .01, .12, .005, 2, (1, 1, 6)).xf(T(0, .318, zc + .035) @ RX(.1))
    pr.add('plastic', lever, H(0x1d1e20))
    # Manometer nach vorn
    gz = zc + .048
    pr.add('metal', lathe([(.0, 0), (.019, 0), (.02, .004), (.02, .012), (.017, .013)], 20, cap_top=False).xf(T(0, .283, gz) @ RX(math.pi / 2)), H(0xc0c4c8), ao=.4)
    def dial(p, n):
        q = p - Vector((0, .283, 0)); r = math.hypot(q.x, q.y); a = math.atan2(q.x, q.y)
        if r < .004: return H(0x202020)
        if abs(a - .5) < .12 and r < .014: return H(0xc0181a)       # Zeiger
        if .011 < r < .0155 and -1.2 < a < 1.2: return H(0x2f9a3a) if -.4 < a < .8 else H(0xc0181a)
        return H(0xf4f2ea)
    face = disc_grid(.0165, 5, 32).xf(T(0, .283, gz + .0125))
    pr.add('plastic', face, dial)
    # Sicherungsstift mit Ring und Plombe
    pr.add('metal', tube([Vector((-.035, .29, zc + .01)), Vector((.034, .29, zc + .01))], .0022, 6), H(0xc8ccd0), ao=.3)
    ring = [Vector((-.035 - .012 - .012 * math.cos(a), .29 - .012 * math.sin(a) * .3, zc + .01 + .012 * math.sin(a))) for a in [k / 16 * TAU for k in range(17)]]
    pr.add('plastic', tube(ring, .0022, 6, caps=False), H(0xe0b020), ao=.3)
    # Schlauch zur Düse, seitlich an der Flasche eingeclipst
    hose = [Vector((-.026, .27, zc)), Vector((-.05, .255, zc + .01)), Vector((-.072, .2, zc + .02)), Vector((-.078, .1, zc + .03)),
            Vector((-.077, -.02, zc + .035)), Vector((-.076, -.1, zc + .03))]
    pts = []
    for i in range(len(hose) - 1):
        for k in range(6): pts.append(hose[i].lerp(hose[i + 1], k / 6))
    pts.append(hose[-1])
    pr.add('rubber', tube(pts, .0075, 10), H(0x1a1a1c), ao=.6)
    pr.add('plastic', lathe([(.0078, 0), (.011, .01), (.011, .03), (.007, .05), (.004, .055)], 12, cap_top=True).xf(T(-.076, -.1, zc + .03) @ RX(math.pi)), H(0x1d1e20))
    pr.add('plastic', softbox(.02, .03, .03, .004, 2, (1, 2, 2)).xf(T(-.068, -.02, zc + .03)), H(0x2a2b2e))
    # Wandhalterung mit zwei Spannbändern
    pr.add('metal', softbox(.1, .46, .008, .003, 2, (3, 8, 1)).xf(T(0, -.01, .004)), H(0x6e747a), ao=.7)
    for yb in (-.13, .11):
        band = lathe([(.0705, -.012), (.072, -.011), (.072, .011), (.0705, .012)], 32, a0=-2.2, a1=2.2).xf(T(0, yb, zc))
        pr.add('metal', band, H(0x50565c), ao=.6)
        for s in (-1, 1):
            arm = softbox(.012, .024, .06, .003, 2, (1, 1, 2)).xf(T(s * .058, yb, .03))
            pr.add('metal', arm, H(0x50565c), ao=.6)
        latch = softbox(.034, .022, .014, .004, 2, (2, 1, 1)).xf(T(0, yb, zc + .076))
        pr.add('metal', latch, H(0x2a2d30), ao=.5)
    return pr

# ───────────────────────── Bodenbelag der Lounge ─────────────────────────
# Oberkante bei y = 0. Fläche x ±2,02, z ±3,8. Fugen zeigen den dunklen Rost darunter.

def build_floor():
    pr = Prop('floor', ao=0)
    W, Lz = 4.04, 7.6
    nx, nz_ = 7, 13
    pw, pl = W / nx, Lz / nz_
    # Rost
    grid = Block(); grid.V = [Vector((-W / 2, -.028, -Lz / 2)), Vector((W / 2, -.028, -Lz / 2)), Vector((W / 2, -.028, Lz / 2)), Vector((-W / 2, -.028, Lz / 2))]
    grid.F = [(0, 3, 2, 1)]
    pr.add('metal', grid, H(0x1e2226), smooth=False)
    vents = {(1, 9), (5, 9)}
    for i in range(nx):
        for j in range(nz_):
            cx = -W / 2 + (i + .5) * pw
            cz = -Lz / 2 + (j + .5) * pl
            k = rnd(f'fl{i}{j}', .94, 1.05)
            if (i, j) in vents:
                # Gitterrahmen etwas tiefer, darin schräg gestellte Lamellen
                fr = softbox(pw - .014, .03, pl - .014, .006, 2, (2, 1, 2)).xf(T(cx, -.015 - .006, cz))
                pr.add('metal', fr, H(0x6c7278), ao=0)
                for s in range(14):
                    sl = flatbox(pw - .08, .004, .014).xf(T(cx, -.004, cz - pl / 2 + .06 + s * (pl - .12) / 13) @ RX(.5))
                    pr.add('metal', sl, H(0x3c4046), smooth=False)
                continue
            pan = softbox(pw - .012, .03, pl - .012, .005, 2, (2, 1, 2)).xf(T(cx, -.015, cz))
            base = (H(0x5c5f63) if i in (0, nx - 1) else H(0x8a837a)) * k
            pr.add('floor', pan, lambda p, n, base=base: base * (1 + .035 * nz(p, 3.3, 7) + .02 * nz(p, 14, 2)))
            # Senkkopfschrauben
            for sx in (-1, 1):
                for sz in (-1, 1):
                    sc = lathe([(.0001, .0012), (.006, .0006), (.0068, 0)], 10).xf(T(cx + sx * (pw / 2 - .035), 0, cz + sz * (pl / 2 - .035)))
                    pr.add('metal', sc, H(0x5a5e62), ao=0)
    # Seitliche Sockelleisten mit eingelassenem Leitlicht
    for s in (-1, 1):
        rail = softbox(.05, .03, Lz, .006, 2, (1, 1, 40)).xf(T(s * (W / 2 - .025), .005, 0))
        pr.add('metal', rail, H(0x8a9096), ao=0)
        led = flatbox(.012, .002, Lz - .1).xf(T(s * (W / 2 - .025), .0205, 0))
        pr.add('glow', led, H(0xffe2b8), smooth=False, ao=0)
    return pr

# ───────────────────────── Stoffkatze „Laika" ─────────────────────────
# Ein Plüschtier, das aufrecht auf der Fensterbank sitzt. Ursprung: Mitte der
# Standfläche, Blick nach +Z (in den Raum). Etwa 27 cm hoch.

def metaballs(elems, res=.0045, threshold=.6):
    """Weicher Körper aus Metabällen, in Blender zu einem Netz ausgewertet.
    elems: [(Mittelpunkt, Halbachsen)] in Spielkoordinaten; die Halbachsen sind
    die sichtbaren Radien eines einzeln stehenden Elements."""
    mb = bpy.data.metaballs.new('OB_cat')
    mb.resolution = mb.render_resolution = res
    mb.threshold = threshold
    ob = bpy.data.objects.new('OB_cat', mb)
    bpy.context.scene.collection.objects.link(ob)
    k = 1 / math.sqrt(1 - (threshold / 2) ** (1 / 3))     # Feld s·(1−d²/r²)³ mit s = 2
    for c, r in elems:
        e = mb.elements.new(type='ELLIPSOID')
        e.co = g2b(c)
        e.stiffness = 2.0
        R = max(r) * k
        e.radius = R
        e.size_x, e.size_y, e.size_z = r[0] * k / R, r[2] * k / R, r[1] * k / R
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    V = [Vector((v.co.x, v.co.z, -v.co.y)) for v in me.vertices]
    F = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob); bpy.data.metaballs.remove(mb); bpy.data.meshes.remove(me)
    b = Block(); b.V, b.F = V, F
    return b

def build_cat():
    pr = Prop('cat', ao=.85, ao_dist=.06, occluders=('floor',))
    Hc = Vector((0, .19, .008))                          # Kopfmitte
    tilt_h = .12                                         # Kopf leicht schief gelegt
    def hv(x, y, z):
        c, s = math.cos(tilt_h), math.sin(tilt_h)
        return Hc + Vector((x * c - y * s, x * s + y * c, z))
    tail = []
    tpts = [(0, .022, -.066), (.045, .017, -.066), (.078, .015, -.03), (.084, .015, .02), (.068, .016, .066), (.036, .018, .088)]
    for i in range(len(tpts) - 1):
        a, b = Vector(tpts[i]), Vector(tpts[i + 1])
        for j in range(4):
            tail.append((a.lerp(b, j / 4), (i + j / 4) / (len(tpts) - 1)))
    elems = [
        (Vector((0, .06, 0)), (.072, .066, .062)),           # Bauch, sitzt breit auf
        (Vector((0, .112, .004)), (.054, .05, .046)),        # Brust
        (Vector((0, .145, .006)), (.044, .03, .04)),         # Hals
        (Hc, (.072, .06, .06)),                              # großer Plüschkopf
        (hv(0, -.026, .052), (.03, .02, .02)),               # Schnauze
    ]
    for s in (-1, 1):
        elems += [
            (hv(s * .036, -.018, .03), (.038, .032, .034)),                       # Backe
            (Vector((s * .056, .042, -.006)), (.036, .04, .052)),                 # Oberschenkel
            (Vector((s * .052, .013, .052)), (.021, .013, .03)),                  # Hinterpfote
            (Vector((s * .026, .085, .04)), (.021, .025, .021)),                  # Vorderbein oben
            (Vector((s * .027, .045, .052)), (.019, .03, .019)),                  # Vorderbein
            (Vector((s * .028, .015, .062)), (.022, .015, .024)),                 # Vorderpfote
        ]
    for p, t in tail:
        r = lerp(.017, .014, t)
        elems.append((p, (r, r, r)))
    body = metaballs(elems)
    # flache Standfläche: ein Plüschtier ist unten mit Granulat beschwert
    body.deform(lambda v: Vector((v.x, .004 + (v.y - .004) * .2 if v.y < .004 else v.y, v.z)))
    # Nähte: Mittelnaht über Gesicht und Bauch, Halsnaht, Naht um die Seiten
    def seam_d(v):
        d1 = abs(v.x) if v.z > 0 and (v.y > .15 or v.y < .13) else 9
        d2 = abs(v.y - .15) if True else 9
        d3 = abs(v.z + .004) if v.y < .14 and abs(v.x) > .03 else 9
        return min(d1, d2, d3)
    nrm = {}
    def press(v):
        d = seam_d(v)
        k = math.exp(-(d / .0022) ** 2)
        c = Vector((0, v.y, 0)) if v.y < .15 else Hc
        return v - (v - c).normalized() * .0018 * k
    body.deform(press)

    def surface(local, inset=.0005):
        d = (local - Hc).normalized()
        cand = [v for v in body.V if (v - Hc).length > 1e-6 and (v - Hc).normalized().dot(d) > .985]
        far = max(cand, key=lambda v: (v - Hc).dot(d))
        return Hc + d * ((far - Hc).dot(d) - inset), d

    gray, gray2, dark = H(0x7c7064), H(0x8a7e70), H(0x40372e)
    cream, pink = H(0xf2e8d6), H(0xe8b4b0)
    def tail_s(p):
        best, bs = 9, 0
        for q, t in tail:
            d = (q - p).length
            if d < best: best, bs = d, t
        return best, bs
    def coat(p, n):
        c = mix(gray, gray2, .5 + .5 * nz(p, 90, 3))
        dt, ts = tail_s(p)
        rel = p - Hc
        if dt < .022 and p.y < .04 and (p.z < -.04 or abs(p.x) > .06):
            # aufgedruckte Ringe am Schwanz, helle Spitze
            c = mix(c, dark, sm(.3, .7, math.sin(ts * TAU * 4)) * .7)
            c = mix(c, cream, sm(.85, .95, ts))
        elif rel.length < .085 and p.y > .15:
            # Stirnstreifen, nur oben und hinten
            c = mix(c, dark, sm(.2, .6, math.sin(rel.x * TAU / .02 + 1.57)) * sm(.03, .05, rel.y) * .7)
        elif p.y > .02:
            c = mix(c, dark, sm(.2, .7, math.sin(p.y * TAU / .028 + p.x * 20)) * sm(.03, -.03, p.z) * .7)
        # helle Brust und Bauch, Schnauze, Pfoten
        front = sm(.0, .5, n.z) * sm(.045, .025, abs(p.x)) * (p.y < .14) * (p.y > .02)
        muz = 0.0
        r2 = p - hv(0, -.026, .052)
        if r2.length < .036 and r2.y < .01: muz = sm(.036, .026, r2.length)
        paw = sm(.024, .012, p.y) * (p.z > .04)
        c = mix(c, cream, clamp(max(front * .9, muz, paw)))
        # Nähte etwas dunkler
        c = c * (1 - .25 * math.exp(-(seam_d(p) / .0016) ** 2))
        return c
    pr.add('fur', body, coat)

    # Ohren: dicke Stoffdreiecke, innen rosa
    for s in (-1, 1):
        e = lathe([(.03, 0), (.025, .016), (.016, .032), (.007, .042), (1e-4, .045)], 12, cap_bottom=True)
        e.deform(lambda v: Vector((v.x, v.y, v.z * (.5 if v.z > 0 else .32))))
        e.deform(lambda v: v - Vector((0, 0, .009 * (1 - v.y / .048) * (abs(v.x) < .019) * (v.z > 0))))
        M = T(*hv(s * .04, .038, -.004)) @ RZ(-s * .3 + tilt_h) @ RX(.12)
        e.xf(M)
        fwd = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
        c0 = M @ Vector((0, .02, 0))
        pr.add('fur', e, lambda p, nn, fwd=fwd, c0=c0: mix(gray * .95, pink, sm(.3, .7, nn.dot(fwd)) * sm(.016, .008, abs((p - c0).cross(fwd).length - 0) * .6)))
    # Sicherheitsaugen: bernsteinfarben mit Schlitz, oben von einem Stofflid
    # abgeschnitten — daher der ernste Blick
    for s in (-1, 1):
        r = .0118
        eye = lathe([(r, 0), (r * .75, .0024), (r * .4, .0036), (1e-4, .004)], 18, cap_bottom=True)
        eye.deform(lambda v: Vector((v.x, v.y, min(v.z, r * .28))))
        loc, d = surface(hv(s * .027, .004, .06), .0016)
        d = (d + Vector((0, 0, 1.5))).normalized()
        M = basis(loc, d, UP) @ RY(-s * .12)
        eye.xf(M)
        Mi = M.inverted()
        def ecol(p, nn, Mi=Mi):
            q = Mi @ p
            rr = math.hypot(q.x, q.z) / r
            if abs(q.x) < .0019 * max(0, 1 - (q.z / r) ** 2) ** .5 and rr < .92: return H(0x0a0806)
            return mix(mix(H(0xf0b028), H(0xc88010), rr), H(0x5a3410), sm(.88, 1, rr))
        pr.add('eye', eye, ecol, ao=.2)
        # Lid: ein Stoffwulst über dem Auge, leicht nach innen abfallend
        lid = [M @ Vector((x * r * 1.1, .002, r * (.32 - .1 * s * x / 1.0) + .0012)) for x in (-1, -.5, 0, .5, 1)]
        pr.add('fur', tube(lid, [.0018, .0026, .003, .0026, .0018], 6, caps=True), gray * .9)
    # gestickte Nase und Mund
    npos, nd = surface(hv(0, -.016, .07), .0004)
    tri = Block()
    side = Vector((1, 0, 0)); up = nd.cross(side).normalized()
    pts = [npos + side * .0075 + up * .003, npos - side * .0075 + up * .003, npos - up * .006]
    tri.V = [p + nd * .0012 for p in pts] + [npos + nd * .0022]
    tri.F = [(0, 1, 3), (1, 2, 3), (2, 0, 3)]
    pr.add('fabric', tri, pink * .8, smooth=True)
    m0 = npos - up * .006
    mouth = [m0, m0 - up * .006]
    for s in (-1, 1):
        mouth_s = [m0 - up * .006, m0 - up * .008 + side * s * .006, m0 - up * .006 + side * s * .011]
        pr.add('fabric', tube([surface(q, -.0006)[0] for q in mouth_s], .0007, 4, caps=True), H(0x4a3a34))
    pr.add('fabric', tube([surface(q, -.0006)[0] for q in mouth], .0007, 4, caps=True), H(0x4a3a34))
    # Schnurrhaare: Nylonfäden
    for s in (-1, 1):
        for k in range(3):
            a0 = surface(hv(s * .02, -.026 - .004 * k, .06), .0)[0]
            dirv = Vector((s, .12 - .1 * k, .35)).normalized()
            pr.add('plastic', tube([a0 + dirv * .06 * t + Vector((0, -.008 * t * t, 0)) for t in (0, .5, 1)],
                                   [.0005, .0004, .00025], 3, caps=False), H(0xeeeae2), ao=0)
    # rotes Halsband mit runder Marke
    yc = .142
    near = [v for v in body.V if abs(v.y - yc) < .005]
    ring = []
    for k in range(33):
        a = k * TAU / 32
        dirv = Vector((math.sin(a), 0, math.cos(a)))
        rad = max((Vector((v.x, 0, v.z - .006)).dot(dirv) for v in near
                   if Vector((v.x, 0, v.z - .006)).normalized().dot(dirv) > .97), default=.05)
        ring.append(Vector((0, yc - .003 * math.cos(a), .006)) + dirv * (rad + .0025))
    pr.add('fabric', tube(ring, .0045, 8, caps=False), H(0xb01e22))
    tag = lathe([(1e-4, -.0012), (.009, -.0012), (.0095, 0), (.009, .0012), (1e-4, .0012)], 16, cap_bottom=True, cap_top=True)
    tp = ring[0] + Vector((0, -.011, .004))
    pr.add('metal', tag.xf(T(tp.x, tp.y, tp.z) @ RX(math.pi / 2 - .2)), H(0xd8b048), ao=.3)
    pr.add('metal', tube([ring[0], tp + Vector((0, .008, 0))], .0012, 5, caps=False), H(0xb89038), ao=.3)
    return pr

# ───────────────────────── Blender: Backen und Vorschau ─────────────────────────

def g2b(v): return (v.x, -v.z, v.y)

def to_blender(pr, coll):
    obs = []
    for mat, blocks in pr.parts.items():
        for bi, (V, N, C, F, aw) in enumerate(blocks):
            me = bpy.data.meshes.new(f'{pr.name}_{mat}_{bi}')
            me.from_pydata([g2b(v) for v in V], [], F)
            me.validate(clean_customdata=False)
            at = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
            flat = []
            for c in C: flat.extend((c.x, c.y, c.z, 1.0))
            at.data.foreach_set('color', flat)
            ob = bpy.data.objects.new(me.name, me)
            coll.objects.link(ob)
            obs.append((mat, bi, ob))
    return obs

def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    for o in list(c.objects):
        me = o.data; bpy.data.objects.remove(o)
        if me and me.users == 0: bpy.data.meshes.remove(me)
    return c

def occluder(kind, c):
    if kind == 'floor':
        bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    else:
        bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.active_object
    for cc in o.users_collection: cc.objects.unlink(o)
    c.objects.link(o)
    return o

def bake_ao(pr):
    """Backt die Umgebungsverdeckung je Ecke und multipliziert sie in die Farbe."""
    if not pr.ao: return
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 96
    w = sc.world or bpy.data.worlds.new('W'); sc.world = w
    w.light_settings.distance = pr.ao_dist
    c = coll('LB_bake')
    obs = to_blender(pr, c)
    occ = [occluder(k, c) for k in pr.occluders]
    for o in bpy.data.objects: o.select_set(False)
    for _, _, ob in obs:
        a = ob.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        ob.data.color_attributes.active_color = a
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0][2]
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type='AO')
    for mat, bi, ob in obs:
        blk = pr.parts[mat][bi]
        n = len(blk[0])
        ao = [0.0] * (n * 4)
        ob.data.color_attributes['AO'].data.foreach_get('color', ao)
        s = pr.ao * blk[4]
        blk[2] = [c * lerp(1, clamp(ao[i * 4]) ** .8, s) for i, c in enumerate(blk[2])]
    coll('LB_bake')                      # räumt Netze und Abdecker wieder ab

MAT_LOOK = {
    'fabric': dict(r=.9), 'metal': dict(r=.35, m=.9), 'paint': dict(r=.3, cc=.6), 'plastic': dict(r=.45),
    'rubber': dict(r=.8), 'ceramic': dict(r=.35), 'clay': dict(r=.85), 'wood': dict(r=.55), 'leaf': dict(r=.5),
    'stem': dict(r=.6), 'soil': dict(r=1), 'fur': dict(r=.85), 'eye': dict(r=.2), 'floor': dict(r=.6, m=.15), 'glow': dict(r=.5, e=3),
}

def _bmat(name):
    m = bpy.data.materials.get('LB_' + name)
    if m: return m
    m = bpy.data.materials.new('LB_' + name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF')
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'
    nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    L = MAT_LOOK[name]
    b.inputs['Roughness'].default_value = L.get('r', .5)
    b.inputs['Metallic'].default_value = L.get('m', 0)
    if 'cc' in L: b.inputs['Coat Weight'].default_value = L['cc']
    if 'e' in L:
        nt.links.new(at.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = L['e']
    return m

def preview(pr, path, view=(0, .5, -1), res=(1200, 800), target=None, dist=None):
    sc = bpy.context.scene
    c = coll('LB_preview')
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT') or o.name.startswith('Cube') or o.name.startswith('Plane'): bpy.data.objects.remove(o)
    obs = to_blender(pr, c)
    for mat, _, ob in obs:
        ob.data.materials.append(_bmat(mat))
        ob.data.shade_smooth()
    for k in pr.occluders or ('floor',):
        o = occluder(k, c)
        if not pr.occluders: o.location.z = -.06
        m = bpy.data.materials.new('occ'); m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.35, .35, .36, 1)
        o.data.materials.append(m)
    vs = [ob.matrix_world @ v.co for _, _, ob in obs for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    ctr = target or (lo + hi) / 2
    size = (hi - lo).length
    d = -Vector(g2b(Vector(view))).normalized()      # view: Richtung vom Ziel zur Kamera
    cam = bpy.data.objects.new('LB_cam', bpy.data.cameras.new('LB_cam'))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    cam.location = ctr - d * (dist or size * 1.35)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    for nm, rot, e in (('key', (math.radians(50), 0, math.radians(35)), 3.5), ('fill', (math.radians(70), 0, math.radians(-120)), 1.0)):
        L = bpy.data.objects.new('LB_' + nm, bpy.data.lights.new('LB_' + nm, 'SUN'))
        sc.collection.objects.link(L); L.data.energy = e; L.rotation_euler = rot
        L.data.angle = .2
    w = sc.world or bpy.data.worlds.new('W'); sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (.5, .55, .6, 1); bg.inputs['Strength'].default_value = .5
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
    try: sc.cycles.use_denoising = True
    except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

# ───────────────────────── Export ─────────────────────────
# Je Teilnetz: Positionen int16×3 (posScale je Requisit), Normalen int8×3,
# Farben uint8×3 (sRGB), aufgefüllt auf 4 Byte, UV int16×2 (1/256 m, dreiachsig
# projiziert), dann Indizes uint16 bzw. uint32.

UV_Q = 256

def triplanar(v, n):
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 0: return v.z, v.y
    if ax == 1: return v.x, v.z
    return v.x, v.y

def pack(pr, buf):
    ext = max(max(abs(c) for v in b[0] for c in v) for L in pr.parts.values() for b in L)
    q = math.floor(32767 / (ext * 1.001))
    subs = []
    for mat, blocks in pr.parts.items():
        V, N, C, I = [], [], [], []
        for (bv, bn, bc, bf, _) in blocks:
            o = len(V)
            V.extend(bv); N.extend(bn); C.extend(bc)
            for f in bf:
                for t in range(1, len(f) - 1): I.extend((f[0] + o, f[t] + o, f[t + 1] + o))
        nv = len(V)
        off = len(buf)
        buf += struct.pack(f'<{nv * 3}h', *[max(-32767, min(32767, round(c * q))) for v in V for c in v])
        buf += struct.pack(f'<{nv * 3}b', *[max(-127, min(127, round(c * 127))) for n in N for c in n])
        buf += bytes(round(_l2s(c[k]) * 255) for c in C for k in range(3))
        while len(buf) % 4: buf.append(0)
        uv = []
        for v, n in zip(V, N): uv.extend(triplanar(v, n))
        buf += struct.pack(f'<{nv * 2}h', *[max(-32767, min(32767, round(c * UV_Q))) for c in uv])
        wide = nv > 65535
        buf += struct.pack(f'<{len(I)}{"I" if wide else "H"}', *I)
        while len(buf) % 4: buf.append(0)
        subs.append({'mat': mat, 'off': off, 'nv': nv, 'ni': len(I), 'wide': wide})
    return {'posScale': 1 / q, 'uvScale': 1 / UV_Q, 'subs': subs}

BUILDERS = {'couch': build_couch, 'shelf': build_shelf, 'extinguisher': build_extinguisher, 'floor_lounge': build_floor,
            'cat': build_cat, 'blanket': build_blanket, 'labbench': build_labbench,
            'labbench_short': lambda: build_labbench(4.12, 'lbs')}

def export(ids=None):
    out = os.path.join(ROOT, 'assets', 'props')
    os.makedirs(out, exist_ok=True)
    buf = bytearray()
    index = {'version': 1, 'file': 'props.bin.gz', 'props': {}}
    stats = {}
    for pid in (ids or BUILDERS):
        pr = BUILDERS[pid]()
        bake_ao(pr)
        index['props'][pid] = pack(pr, buf)
        stats[pid] = pr.verts()
    with open(os.path.join(out, 'props.bin.gz'), 'wb') as f: f.write(gzip.compress(bytes(buf), 9, mtime=0))
    index['bytes'] = len(buf)
    with open(os.path.join(out, 'index.json'), 'w') as f: json.dump(index, f, separators=(',', ':'))
    stats['kb'] = len(buf) // 1024
    return stats

if MODE == 'export':
    result = export(globals().get('IDS'))
    print('props', result)
elif MODE == 'preview':
    pid = globals().get('PID', 'couch')
    pr = BUILDERS[pid]()
    if globals().get('AO', True): bake_ao(pr)
    preview(pr, globals().get('OUT', '/tmp/lb_preview.png'), globals().get('VIEW', (0.4, .45, -1)), globals().get('RES', (1200, 800)))
    result = {'verts': pr.verts()}
    print('preview', pid, result)
