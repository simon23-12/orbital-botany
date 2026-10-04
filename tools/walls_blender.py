"""Wandtexturen für Orbital Botany — in Blender modelliert und gebacken.

    blender --background --python tools/walls_blender.py

Gemalte Fugen und Umrisslinien lassen eine Wand wie bedrucktes Papier wirken:
Unter wechselndem Licht verändert sich nichts. Darum entstehen die Wände hier
als echte Geometrie — Rackfronten mit Sitzschienen, Schubladen, Schließen,
Lüftungsgittern, Nomex-Bezügen und Brandschutzports; Stirnwandpaneele mit
versenkten Schrauben; die gesteppte Polsterung der Lounge — und Cycles backt
daraus je Kachel vier Karten auf eine Ebene:

    <name>_albedo.jpg   Farbe (sRGB), mit etwas Hohlraumverschattung
    <name>_normal.jpg   Normalen im Tangentenraum (OpenGL, wie three.js)
    <name>_orm.jpg      R Umgebungsverdeckung, G Rauheit, B Metall

Die Kacheln sind nahtlos: Alles, was über den Rand reicht, wird auch auf der
Gegenseite gebaut. Ausgabe nach assets/walls/.

Koordinaten: Kachel in der XY-Ebene von (0, 0) bis (W, H), vorn ist +Z, Meter.
"""
import bpy, bmesh, math, os, zlib
import numpy as np
from mathutils import Vector, Matrix

ROOT = globals().get('ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODE = globals().get('MODE', 'export')
TAU = math.tau

def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def lerp(a, b, t): return a + (b - a) * t
def _s2l(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def H(h): return (_s2l(((h >> 16) & 255) / 255), _s2l(((h >> 8) & 255) / 255), _s2l((h & 255) / 255))

class Rand:
    def __init__(self, seed): self.seed, self.n = seed, 0
    def __call__(self, a=0.0, b=1.0):
        self.n += 1
        return a + (b - a) * zlib.crc32(f'{self.seed}:{self.n}'.encode()) / 4294967296.0
    def pick(self, seq): return seq[int(self(0, len(seq) - 1e-9))]

# ───────────────────────── Geometriesammler ─────────────────────────

class Kit:
    """Sammelt Geometrie je Material in je einem bmesh. Jedes Material hat
    Farbe, Rauheit und Metall; daraus werden die Karten gebacken."""
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.mats = {}                       # name → (color, rough, metal)
        self.bms = {}
        self.texts = []
        self.offsets = [(0, 0)]

    def mat(self, name, color, rough=.5, metal=0.0):
        if name not in self.mats: self.mats[name] = (color, rough, metal)
        return name

    def bm(self, mat):
        if mat not in self.bms: self.bms[mat] = bmesh.new()
        return self.bms[mat]

    def wrap(self, x0, y0, x1, y1):
        """Kopien für die Gegenseite, wenn ein Teil über den Kachelrand reicht."""
        out = [(0, 0)]
        for dx in (-self.W, 0, self.W):
            for dy in (-self.H, 0, self.H):
                if (dx, dy) == (0, 0): continue
                if x1 + dx > -.06 and x0 + dx < self.W + .06 and y1 + dy > -.06 and y0 + dy < self.H + .06:
                    out.append((dx, dy))
        return out

    def box(self, mat, x0, y0, x1, y1, z0, z1, bevel=0.0, seg=2):
        if x1 - x0 < 1e-5 or y1 - y0 < 1e-5 or z1 - z0 < 1e-6: return
        for dx, dy in self.wrap(x0, y0, x1, y1):
            bm = self.bm(mat)
            M = Matrix.Translation(((x0 + x1) / 2 + dx, (y0 + y1) / 2 + dy, (z0 + z1) / 2)) @ \
                Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1))
            r = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
            if bevel > 0:
                edges = list({e for v in r['verts'] for e in v.link_edges})
                b = min(bevel, (x1 - x0) * .45, (y1 - y0) * .45, (z1 - z0) * .45)
                bmesh.ops.bevel(bm, geom=edges, offset=b, segments=seg, profile=.5, affect='EDGES', clamp_overlap=True)

    def cyl(self, mat, cx, cy, r, z0, z1, seg=16, axis='z', length_dir=None):
        """Zylinder entlang z (Knöpfe, Schrauben) oder entlang x/y (Griffe)."""
        for dx, dy in self.wrap(cx - r, cy - r, cx + r, cy + r):
            bm = self.bm(mat)
            if axis == 'z':
                M = Matrix.Translation((cx + dx, cy + dy, (z0 + z1) / 2))
            elif axis == 'x':
                M = Matrix.Translation((cx + dx, cy + dy, (z0 + z1) / 2)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
            else:
                M = Matrix.Translation((cx + dx, cy + dy, (z0 + z1) / 2)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
            bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r,
                                  depth=z1 - z0, matrix=M)

    def rod(self, mat, x0, y0, x1, y1, z, r, seg=10):
        """Liegender Stab von (x0, y0) nach (x1, y1) auf Höhe z."""
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-5: return
        a = math.atan2(y1 - y0, x1 - x0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        for dx, dy in self.wrap(min(x0, x1) - r, min(y0, y1) - r, max(x0, x1) + r, max(y0, y1) + r):
            bm = self.bm(mat)
            M = Matrix.Translation((cx + dx, cy + dy, z)) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'Y')
            bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=L, matrix=M)

    def screw(self, x, y, z, r=.0045, mat='screw', slot=True):
        """Unverlierbare Schraube: flacher Kopf mit Schlitz."""
        self.cyl(mat, x, y, r, z - .001, z + .0016, seg=14)
        if slot:
            self.box('slot', x - r * .8, y - r * .14, x + r * .8, y + r * .14, z + .0012, z + .0019)

    def grid(self, mat, x0, y0, x1, y1, fz, nu, nv):
        """Höhenfeld z = fz(x, y) über einem Rechteck (für Polster)."""
        bm = self.bm(mat)
        vs = [[bm.verts.new((lerp(x0, x1, i / nu), lerp(y0, y1, j / nv), fz(lerp(x0, x1, i / nu), lerp(y0, y1, j / nv))))
               for i in range(nu + 1)] for j in range(nv + 1)]
        for j in range(nv):
            for i in range(nu):
                bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))

    def text(self, mat, s, x, y, size, z, align='LEFT'):
        self.texts.append((mat, s, x, y, size, z, align))

    def stripes(self, x0, y0, x1, y1, z, c1='warn_y', c2='warn_k', n=6):
        """Gelb-schwarzer Warnstreifen als Aufkleber."""
        self.box(c1, x0, y0, x1, y1, z, z + .0004)
        w = (x1 - x0) / (n * 2)
        for k in range(n):
            xa = x0 + (2 * k + .5) * w
            self.box(c2, xa, y0, xa + w, y1, z + .0004, z + .0006)

    # ── nach Blender ──
    def build(self, coll):
        obs = []
        for mat, bm in self.bms.items():
            me = bpy.data.meshes.new('W_' + mat)
            bm.to_mesh(me); bm.free()
            ob = bpy.data.objects.new('W_' + mat, me)
            ob.data.materials.append(bmat(mat, *self.mats[mat]))
            coll.objects.link(ob); obs.append(ob)
        dg = None
        for mat, s, x, y, size, z, align in self.texts:
            # Schrift als Netz: Backen von Ausgewähltem auf Aktives braucht Netze
            cu = bpy.data.curves.new('W_t', 'FONT')
            cu.body = s; cu.size = size; cu.extrude = .00015; cu.align_x = align
            tmp = bpy.data.objects.new('W_t', cu)
            coll.objects.link(tmp)
            tmp.location = (x, y, z)
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
            me.transform(tmp.matrix_world)
            bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
            ob = bpy.data.objects.new('W_t', me)
            ob.data.materials.append(bmat(mat, *self.mats[mat]))
            coll.objects.link(ob); obs.append(ob)
        self.bms = {}
        return obs

# ───────────────────────── Materialien ─────────────────────────

def bmat(name, color, rough, metal):
    m = bpy.data.materials.get('W_' + name)
    if m: return m
    m = bpy.data.materials.new('W_' + name)
    m.use_nodes = True
    m['wc'] = list(color); m['wr'] = rough; m['wm'] = metal
    set_channel(m, 'shade')
    return m

def set_channel(m, ch):
    """Baut den Knotenbaum: 'shade' = normales Material (für AO und Normalen),
    sonst eine Emission mit dem Kanalwert (Farbe, Rauheit, Metall)."""
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    c, r, mt = tuple(m['wc']), m['wr'], m['wm']
    if ch == 'shade':
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        b.inputs['Base Color'].default_value = (*c, 1)
        b.inputs['Roughness'].default_value = r
        b.inputs['Metallic'].default_value = mt
        nt.links.new(b.outputs[0], out.inputs['Surface'])
    else:
        e = nt.nodes.new('ShaderNodeEmission')
        v = {'albedo': c, 'rough': (r, r, r), 'metal': (mt, mt, mt)}[ch]
        e.inputs['Color'].default_value = (*v, 1)
        e.inputs['Strength'].default_value = 1.0
        nt.links.new(e.outputs[0], out.inputs['Surface'])

# ───────────────────────── Rackfront ─────────────────────────
# Eine Kachel = zwei Racks nebeneinander, 1,3 m × 1,6 m. Zwischen den Racks
# laufen Sitzschienen (seat tracks), an denen auf der ISS alles festgemacht wird.

LABELS = ['STOWAGE', 'ECLSS', 'EXPRESS', 'MELFI', 'ER-4', 'LAB1O3', 'HEDERA', 'WORF', 'MSG', 'GLACIER',
          'VEGGIE', 'APH-2', 'CDRA', 'OGS', 'TCS', 'AVIONICS', 'PCS', 'SSC-7', 'CREW', 'FIRE PORT']

def rack_tile():
    W, Hh = 1.3, 1.6
    k = Kit(W, Hh)
    R = Rand('rack')
    k.mat('void', H(0x16181c), .8)
    k.mat('frame', H(0x8a8e94), .45, .7)
    k.mat('track', H(0xa9adb2), .38, .85)
    k.mat('hole', H(0x0c0d0f), .7)
    k.mat('screw', H(0x9ca0a6), .32, .9)
    k.mat('slot', H(0x1a1b1e), .6)
    k.mat('handle', H(0x6c7076), .35, .85)
    k.mat('latch', H(0x2e3136), .4, .4)
    k.mat('label', H(0xf1efe8), .5)
    k.mat('ink', H(0x18191b), .45)
    k.mat('ink_r', H(0xb3261e), .45)
    k.mat('warn_y', H(0xe2b02a), .5)
    k.mat('warn_k', H(0x1c1c1c), .5)
    k.mat('velcro', H(0x3c3e42), .95)
    k.mat('velcro_w', H(0xd8d4c8), .95)
    k.mat('rubber', H(0x24262a), .8)
    k.mat('led_g', H(0x2ad86a), .3)
    k.mat('led_a', H(0xf0a020), .3)
    k.mat('conn', H(0x5a5e64), .35, .8)
    k.mat('conn_r', H(0xb02a22), .4)
    k.mat('conn_b', H(0x2a5aa8), .4)
    k.mat('stitch', H(0xa89c80), .9)
    paint = {
        'white': H(0xd6d4cc), 'white2': H(0xcbcac4), 'gray': H(0xa7abb0), 'blue': H(0x9eabb8),
        'dark': H(0x4d535b), 'beige': H(0xc5b898), 'beige2': H(0xb8ab8a),
    }
    for n, c in paint.items():
        k.mat('p_' + n, c, .62 if 'beige' not in n else .93)
    # Hintergrund (Rackinneres) und Rahmenleisten oben und unten
    k.box('void', -.05, -.05, W + .05, Hh + .05, -.05, -.04)
    for y in (0, Hh):
        k.box('frame', -.05, y - .012, W + .05, y + .012, -.04, -.004, bevel=.002)
    # Sitzschienen an den Rackkanten: Profil mit Nut und Lochreihe im Zollraster
    for x in (0, W / 2, W):
        k.box('track', x - .017, -.05, x + .017, Hh + .05, -.04, .004, bevel=.0025, seg=3)
        k.box('hole', x - .0035, -.05, x + .0035, Hh + .05, .0038, .0046)
        y = .0127
        while y < Hh:
            k.cyl('hole', x, y, .0058, .0039, .0047, seg=14)
            y += .0254
    # Racks: senkrecht gestapelte Einschübe
    for ci, (x0, x1) in enumerate(((.019, W / 2 - .019), (W / 2 + .019, W - .019))):
        y = .016
        while y < Hh - .03:
            kind = R.pick(['locker', 'locker', 'drawer', 'drawer', 'blank', 'vent', 'conn', 'nomex', 'nomex'])
            hgt = {'locker': R(.24, .32), 'drawer': R(.09, .15), 'blank': R(.12, .22), 'vent': R(.1, .16),
                   'conn': R(.09, .13), 'nomex': R(.3, .46)}[kind]
            hgt = min(hgt, Hh - .016 - y)
            if hgt < .07:
                kind, hgt = 'blank', Hh - .016 - y
            build_unit(k, R, kind, x0, y + .003, x1, y + hgt - .003, paint)
            y += hgt
    return k

def build_unit(k, R, kind, x0, y0, x1, y1, paint):
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if kind == 'nomex':
        # weicher Nomex-Bezug: gepolstert, Keder an der Kante, Klettlaschen, Sichtfenster für ein Etikett
        col = R.pick(['p_beige', 'p_beige', 'p_beige2'])
        k.box(col, x0, y0, x1, y1, -.03, .006, bevel=.016, seg=5)
        k.box(col, x0 + .03, y0 + .03, x1 - .03, y1 - .03, .0, .011, bevel=.012, seg=4)
        for i in range(int(w / .012)):
            xx = x0 + .02 + i * .012
            if xx > x1 - .02: break
            for yy in (y0 + .018, y1 - .018):
                k.box('stitch', xx, yy - .0007, xx + .006, yy + .0007, .0055, .0068)
        for xx in (x0 + w * .25, x1 - w * .25):
            k.box('velcro', xx - .03, y1 - .05, xx + .03, y1 - .004, .008, .0125, bevel=.002)
        k.box('label', cx - .07, cy - .03, cx + .07, cy + .03, .0105, .0125, bevel=.001)
        k.text('ink', R.pick(LABELS[:-1]), cx, cy - .008, .022, .0126, 'CENTER')
        k.text('ink', f'{int(R(100, 999))}-{int(R(10, 99))}', cx, cy - .024, .012, .0126, 'CENTER')
        return
    col = {'locker': R.pick(['p_white', 'p_white2', 'p_gray']), 'drawer': R.pick(['p_white', 'p_gray', 'p_blue']),
           'blank': R.pick(['p_white', 'p_white2', 'p_blue']), 'vent': 'p_gray', 'conn': R.pick(['p_dark', 'p_gray'])}[kind]
    k.box(col, x0, y0, x1, y1, -.03, 0, bevel=.0035, seg=3)
    # Schrauben in den Ecken
    for sx, sy in ((x0 + .014, y0 + .014), (x1 - .014, y0 + .014), (x0 + .014, y1 - .014), (x1 - .014, y1 - .014)):
        k.screw(sx, sy, 0)
    if kind == 'locker':
        # zurückgesetzte Tür mit zwei Hebelschließen und Etikett
        k.box(col, x0 + .03, y0 + .03, x1 - .03, y1 - .03, -.004, .0015, bevel=.003)
        for lx in (x0 + w * .22, x1 - w * .22):
            k.box('latch', lx - .032, y1 - .062, lx + .032, y1 - .038, .0015, .006, bevel=.003)
            k.box('handle', lx - .022, y1 - .055, lx + .022, y1 - .045, .006, .0095, bevel=.002)
        k.box('label', cx - .09, y0 + .05, cx + .09, y0 + .1, .0015, .0022)
        k.text('ink', R.pick(LABELS[:-1]), cx, y0 + .072, .02, .0023, 'CENTER')
        k.text('ink', f'P/N {int(R(1000, 9999))}', cx, y0 + .058, .01, .0023, 'CENTER')
        if R() < .45:
            # Brandschutzport: runde Öffnung mit Klappe, rotes Schild
            px, py = x1 - w * .2, cy
            k.cyl('rubber', px, py, .028, .0015, .0045, seg=28)
            k.cyl('void', px, py, .019, .0040, .0052, seg=24)
            k.box('ink_r', px - .045, py - .052, px + .045, py - .036, .0015, .0022)
            k.text('label', 'FIRE PORT', px, py - .0485, .011, .0023, 'CENTER')
    elif kind == 'drawer':
        # Schublade mit Bügelgriff
        k.box('handle', cx - .07, cy - .006, cx - .06, cy + .006, .0, .016, bevel=.003)
        k.box('handle', cx + .06, cy - .006, cx + .07, cy + .006, .0, .016, bevel=.003)
        k.rod('handle', cx - .066, cy, cx + .066, cy, .016, .0055)
        if h > .11:
            k.box('label', x0 + .03, y0 + .02, x0 + .13, y0 + .045, 0, .0008)
            k.text('ink', R.pick(LABELS[:-1]), x0 + .034, y0 + .028, .012, .0009)
        if R() < .3:
            k.stripes(x1 - .1, y0 + .02, x1 - .03, y0 + .032, 0)
    elif kind == 'vent':
        # Lüftungsgitter: Lamellen über dunkler Öffnung
        k.box('void', x0 + .04, y0 + .025, x1 - .04, y1 - .025, -.002, .0004)
        n = int((h - .05) / .011)
        for i in range(n):
            yy = y0 + .03 + i * .011
            k.box('frame', x0 + .04, yy, x1 - .04, yy + .005, .0004, .004, bevel=.0012)
        k.box('frame', x0 + .036, y0 + .022, x0 + .044, y1 - .022, 0, .005)
        k.box('frame', x1 - .044, y0 + .022, x1 - .036, y1 - .022, 0, .005)
    elif kind == 'conn':
        # Anschlussfeld: Rundstecker mit Farbringen, Kippschalter, Leuchtdioden
        n = int((w - .08) / .06)
        for i in range(n):
            px = x0 + .05 + i * .06
            ring = R.pick(['conn', 'conn_r', 'conn_b', 'conn'])
            k.cyl(ring, px, cy + .008, .017, 0, .004, seg=20)
            k.cyl('conn', px, cy + .008, .012, .004, .016, seg=18)
            k.cyl('void', px, cy + .008, .007, .015, .0168, seg=14)
            k.box('label', px - .018, y0 + .012, px + .018, y0 + .022, 0, .0006)
        for i in range(3):
            sx = x1 - .03 - i * .022
            k.box('latch', sx - .006, y1 - .04, sx + .006, y1 - .02, 0, .004, bevel=.0015)
            k.rod('handle', sx, y1 - .03, sx, y1 - .03 + .001, .009, .0022)
            k.cyl(R.pick(['led_g', 'led_a', 'led_g']), sx, y1 - .05, .0025, 0, .003, seg=10)
    elif kind == 'blank':
        for sx in (x0 + w / 3, x1 - w / 3):
            for sy in (y0 + .014, y1 - .014):
                k.screw(sx, sy, 0)
        if R() < .7:
            lw = min(.2, w * .5)
            k.box('label', cx - lw / 2, cy - .015, cx + lw / 2, cy + .015, 0, .0008)
            k.text('ink', R.pick(LABELS[:-1]), cx, cy - .006, .016, .0009, 'CENTER')
        if R() < .5:
            # Klettflächen für lose Ausrüstung
            for i in range(2):
                vx = x0 + w * (.2 + .45 * i)
                k.box(R.pick(['velcro', 'velcro', 'velcro_w']), vx, y0 + h * .2, vx + .045, y0 + h * .2 + .045, 0, .0025, bevel=.001)

# ───────────────────────── Wandpaneele ─────────────────────────
# Stirnwände und Knoten: große, verschraubte Platten mit Fugen,
# Wartungsklappen, Etiketten und einer Lüftung. Kachel 2,2 m × 2,2 m.

def panel_tile():
    W = Hh = 2.2
    k = Kit(W, Hh)
    R = Rand('panel')
    k.mat('void', H(0x2a2d32), .7)
    k.mat('screw', H(0x9ca0a6), .32, .9)
    k.mat('slot', H(0x1a1b1e), .6)
    k.mat('frame', H(0x8a8e94), .45, .7)
    k.mat('label', H(0xf1efe8), .5)
    k.mat('ink', H(0x18191b), .45)
    k.mat('ink_b', H(0x2a5aa8), .45)
    k.mat('warn_y', H(0xe2b02a), .5)
    k.mat('warn_k', H(0x1c1c1c), .5)
    k.mat('handle', H(0x6c7076), .35, .85)
    k.mat('velcro', H(0x3c3e42), .95)
    tones = [H(0xd3d2cc), H(0xcac9c3), H(0xd8d6ce), H(0xc2c5c8)]
    for i, c in enumerate(tones): k.mat(f'p{i}', c, .6)
    k.box('void', -.05, -.05, W + .05, Hh + .05, -.03, -.02)
    # unregelmäßiges Plattenraster
    cols = [0, .55, 1.1, 1.65, 2.2]
    for i in range(4):
        rows = [0]
        while rows[-1] < Hh - .01:
            rows.append(min(Hh, rows[-1] + R.pick([.55, .55, 1.1, .275])))
        for j in range(len(rows) - 1):
            x0, x1, y0, y1 = cols[i] + .003, cols[i + 1] - .003, rows[j] + .003, rows[j + 1] - .003
            col = f'p{int(R(0, 3.999))}'
            k.box(col, x0, y0, x1, y1, -.02, 0, bevel=.004, seg=3)
            # versenkte Schrauben entlang der Kanten
            for t in np.arange(.035, x1 - x0 - .02, .11):
                for yy in (y0 + .016, y1 - .016): k.screw(x0 + t, yy, -.0006, r=.004)
            for t in np.arange(.125, y1 - y0 - .1, .11):
                for xx in (x0 + .016, x1 - .016): k.screw(xx, y0 + t, -.0006, r=.004)
            u = R()
            if u < .18 and (y1 - y0) > .5:
                # Wartungsklappe mit Schnellverschlüssen
                hx0, hy0 = x0 + .09, y0 + .12
                hx1, hy1 = x1 - .09, min(y1 - .12, hy0 + .3)
                k.box('void', hx0 - .003, hy0 - .003, hx1 + .003, hy1 + .003, -.004, .0002)
                k.box(col, hx0, hy0, hx1, hy1, -.004, .0018, bevel=.003)
                for qx in (hx0 + .02, hx1 - .02):
                    k.cyl('handle', qx, (hy0 + hy1) / 2, .009, .0018, .004, seg=16)
                    k.box('slot', qx - .007, (hy0 + hy1) / 2 - .0012, qx + .007, (hy0 + hy1) / 2 + .0012, .0038, .0045)
                k.box('label', hx0 + .03, hy1 - .05, hx0 + .2, hy1 - .025, .0018, .0024)
                k.text('ink', R.pick(['ACCESS', 'IMV DUCT', 'BUS 2B', 'PDU', 'SMOKE DET']), hx0 + .035, hy1 - .043, .012, .0025)
            elif u < .3:
                k.box('label', x0 + .05, y1 - .1, x0 + .27, y1 - .06, 0, .0008)
                k.text('ink', R.pick(['NODE 4', 'HEDERA', 'DECK', 'OVHD', 'STBD', 'PORT', 'AFT']), x0 + .055, y1 - .088, .02, .0009)
                k.box('ink_b', x0 + .05, y1 - .112, x0 + .27, y1 - .104, 0, .0009)
            elif u < .38:
                k.stripes(x0 + .05, y0 + .05, x0 + .3, y0 + .07, 0, n=8)
            elif u < .48:
                vx = x0 + R(.1, .3)
                k.box('velcro', vx, y0 + .2, vx + .05, y0 + .25, 0, .0025, bevel=.001)
    # eine Lüftung
    vx0, vy0 = 1.2, 1.45
    k.box('void', vx0, vy0, vx0 + .34, vy0 + .2, -.004, .0004)
    for i in range(16):
        yy = vy0 + .008 + i * .012
        k.box('frame', vx0, yy, vx0 + .34, yy + .005, .0004, .004, bevel=.0012)
    return k

# ───────────────────────── Polsterung der Lounge ─────────────────────────
# Gesteppte Kissen, Knopfheftung an den Kreuzungen, Ziernaht in der Fuge.
# Kachel 1,5 m × 1,5 m mit 3 × 3 Kissen.

def padding_tile():
    W = Hh = 1.5
    k = Kit(W, Hh)
    k.mat('fabric', H(0xece4d6), .92)
    k.mat('button', H(0xb8ae9c), .6)
    k.mat('thread', H(0xb0a48c), .9)
    c = .5
    def fz(x, y):
        u, v = (x % c) / c, (y % c) / c
        s = (math.sin(math.pi * u) * math.sin(math.pi * v)) ** .45
        wr = .0012 * math.sin(x * 260 + math.sin(y * 31) * 2) * s      # leichte Falten im Bezug
        return .028 * s + wr
    k.grid('fabric', 0, 0, W, Hh, fz, 300, 300)
    for i in range(4):
        for j in range(4):
            x, y = i * c, j * c
            for dx, dy in ((0, 0),):
                k.cyl('button', x, y, .011, -.002, .006, seg=18)
                k.cyl('button', x, y, .008, .006, .0085, seg=16)
    # Ziernaht: Steppstiche entlang der Fugen
    for i in range(4):
        t = .02
        while t < Hh:
            for (x, y, along) in ((i * c, t, 'y'), (t, i * c, 'x')):
                if along == 'y':
                    k.box('thread', x - .0009, y, x + .0009, y + .009, .001, .0026)
                else:
                    k.box('thread', x, y - .0009, x + .009, y + .0009, .001, .0026)
            t += .016
    return k

TILES = {
    'rack':    (rack_tile, 1.3, 1.6, 2048, .045),
    'panel':   (panel_tile, 2.2, 2.2, 2048, .04),
    'padding': (padding_tile, 1.5, 1.5, 1024, .07),
}

# ───────────────────────── Backen ─────────────────────────

def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    for o in list(c.objects):
        d = o.data; bpy.data.objects.remove(o)
        if d is not None and d.users == 0:
            if isinstance(d, bpy.types.Mesh): bpy.data.meshes.remove(d)
            elif isinstance(d, bpy.types.Curve): bpy.data.curves.remove(d)
    return c

def target_plane(W, Hh, c):
    me = bpy.data.meshes.new('W_target')
    me.from_pydata([(0, 0, 0), (W, 0, 0), (W, Hh, 0), (0, Hh, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for li, (u, v) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))): uv.data[li].uv = (u, v)
    ob = bpy.data.objects.new('W_target', me)
    c.objects.link(ob)
    m = bpy.data.materials.new('W_targetmat'); m.use_nodes = True
    ob.data.materials.append(m)
    return ob, m

def bake_into(target, tmat, highs, kind, res, cage, ao_dist=.05, samples=64):
    img = bpy.data.images.new(f'W_{kind}', res, res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    nt = tmat.node_tree
    for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE']: nt.nodes.remove(n)
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img
    nt.nodes.active = tn
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples if kind == 'AO' else 1
    sc.world = sc.world or bpy.data.worlds.new('W')
    sc.world.light_settings.distance = ao_dist
    b = sc.render.bake
    b.use_selected_to_active = True
    b.cage_extrusion = cage
    b.max_ray_distance = cage * 2.5
    b.margin = 8
    b.normal_space = 'TANGENT'
    b.target = 'IMAGE_TEXTURES'
    for o in bpy.data.objects: o.select_set(False)
    for o in highs: o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.bake(type=kind)
    a = np.empty(res * res * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(res, res, 4)[:, :, :3].copy()

def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= .0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - .055)

def save_jpg(arr, path, srgb=False, quality=90):
    res = arr.shape[0]
    img = bpy.data.images.new('W_out', res, res, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    out = to_srgb(arr) if srgb else np.clip(arr, 0, 1)
    px = np.concatenate([out, np.ones((res, res, 1), dtype=np.float32)], axis=2).astype(np.float32)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = quality
    try: img.save(filepath=path, quality=quality)
    except TypeError: img.save()
    bpy.data.images.remove(img)

def noise2(res, scale, seed):
    """Glattes Rauschen für Anstrichunruhe und Schmutz (kachelbar)."""
    rng = np.random.default_rng(seed)
    n = max(2, int(scale))
    g = rng.random((n, n)).astype(np.float32)
    # bikubisch-ähnlich: zweimal linear hochrechnen und glätten, periodisch
    x = np.linspace(0, n, res, endpoint=False)
    i0 = np.floor(x).astype(int) % n; i1 = (i0 + 1) % n; f = x - np.floor(x); f = f * f * (3 - 2 * f)
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]

def bake_tile(name):
    fn, W, Hh, res, cage = TILES[name]
    # Die Startszene hat einen Würfel bei (0, 0, 0): er stünde mitten in der Kachel
    for o in list(bpy.data.objects):
        if not o.name.startswith('W_'): bpy.data.objects.remove(o)
    c = coll('W_bake')
    kit = fn()
    highs = kit.build(c)
    target, tmat = target_plane(W, Hh, c)
    mats = [m for m in (bpy.data.materials.get('W_' + m) for m in kit.mats) if m]
    for m in mats: set_channel(m, 'shade')
    nrm = bake_into(target, tmat, highs, 'NORMAL', res, cage)
    ao = bake_into(target, tmat, highs, 'AO', res, cage, ao_dist=.04)[:, :, 0]
    cav = bake_into(target, tmat, highs, 'AO', res, cage, ao_dist=.008, samples=32)[:, :, 0]
    chans = {}
    for ch in ('albedo', 'rough', 'metal'):
        for m in mats: set_channel(m, ch)
        chans[ch] = bake_into(target, tmat, highs, 'EMIT', res, cage)
    for m in mats: set_channel(m, 'shade')
    # Farbe: Anstrichunruhe, etwas Schmutz in Fugen und Ecken (Hohlraum-AO)
    alb = chans['albedo']
    n1 = noise2(res, 24, 1)[:, :, None]; n2 = noise2(res, 160, 2)[:, :, None]
    alb = alb * (1 + .06 * (n1 - .5) + .05 * (n2 - .5))
    alb = alb * (.55 + .45 * np.clip(cav, 0, 1))[:, :, None] * (.85 + .15 * np.clip(ao, 0, 1))[:, :, None]
    rough = np.clip(chans['rough'][:, :, 0] + .06 * (noise2(res, 60, 3) - .5), .05, 1)
    orm = np.stack([np.clip(ao, 0, 1), rough, chans['metal'][:, :, 0]], axis=2)
    out = os.path.join(ROOT, 'assets', 'walls')
    os.makedirs(out, exist_ok=True)
    save_jpg(alb, os.path.join(out, f'{name}_albedo.jpg'), srgb=True, quality=88)
    save_jpg(nrm, os.path.join(out, f'{name}_normal.jpg'), quality=92)
    save_jpg(orm, os.path.join(out, f'{name}_orm.jpg'), quality=88)
    stats = {'verts': sum(len(o.data.vertices) for o in highs)}
    coll('W_bake')
    return stats

if MODE == 'export':
    result = {n: bake_tile(n) for n in (globals().get('IDS') or TILES)}
    print('walls', result)
