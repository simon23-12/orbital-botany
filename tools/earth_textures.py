"""Bereitet die NASA-Rohdaten für die Erde auf.

    python3 tools/earth_textures.py <ordner-mit-rohdaten>

Erwartet im Rohdatenordner (Quellen siehe assets/earth/HERKUNFT.md):
    world.2004MM.21600.jpg       Blue Marble Next Generation, 12 Monate
    cloud.W.png, cloud.E.png     Blue Marble Clouds, 2 × 21600², 1 km
    night2016.jpg                Black Marble 2016, Graustufen, 3 km
    elev.png, bath.png           GEBCO-Höhen und -Tiefen, 21600 × 10800

Schreibt nach assets/earth/:
    day_MM_16k.jpg / day_MM_8k.jpg     Tagseite je Monat
    clouds_16k.jpg / clouds_8k.jpg     Wolkendichte (Graustufen)
    night_8k.jpg / night_4k.jpg        Nachtlichter (Graustufen)
    terrain_8k.png / terrain_4k.png    Wasser = 0, Land = 40 + Höhe
"""
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'earth'
OUT.mkdir(parents=True, exist_ok=True)


def day(month):
    mm = f'{month:02d}'
    im = Image.open(SRC / f'world.2004{mm}.21600.jpg').convert('RGB')
    im.resize((16384, 8192), Image.LANCZOS).save(OUT / f'day_{mm}_16k.jpg', quality=86, optimize=True)
    im.resize((8192, 4096), Image.LANCZOS).save(OUT / f'day_{mm}_8k.jpg', quality=88, optimize=True)
    return mm


def clouds():
    w = Image.open(SRC / 'cloud.W.png')
    e = Image.open(SRC / 'cloud.E.png')
    full = Image.new('L', (43200, 21600))
    full.paste(w, (0, 0))
    full.paste(e, (21600, 0))
    del w, e
    full.resize((16384, 8192), Image.LANCZOS).save(OUT / 'clouds_16k.jpg', quality=90, optimize=True)
    full.resize((8192, 4096), Image.LANCZOS).save(OUT / 'clouds_8k.jpg', quality=90, optimize=True)
    return 'clouds'


def night():
    im = Image.open(SRC / 'night2016.jpg').convert('L')
    im.resize((8192, 4096), Image.LANCZOS).save(OUT / 'night_8k.jpg', quality=92, optimize=True)
    im.resize((4096, 2048), Image.LANCZOS).save(OUT / 'night_4k.jpg', quality=92, optimize=True)
    return 'night'


def erode(m):
    """3×3-Minimum ohne scipy."""
    p = np.pad(m, 1, mode='edge')
    out = m.copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out &= p[dy:dy + m.shape[0], dx:dx + m.shape[1]]
    return out


def dilate(m):
    p = np.pad(m, 1, mode='edge')
    out = m.copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out |= p[dy:dy + m.shape[0], dx:dx + m.shape[1]]
    return out


def terrain():
    elev = np.asarray(Image.open(SRC / 'elev.png'), dtype=np.uint8)
    # Meer laut GEBCO; Binnenseen und Küstenversatz aus der Tagkarte. Seen sind
    # dort fast schwarz (Michigan 2/2/4, Victoria 0/9/4), dunkler als jeder Wald.
    d = np.asarray(Image.open(SRC / 'world.200409.21600.jpg'), dtype=np.int16)
    lake = (elev > 0) & (d.max(2) < 18) & (d.sum(2) < 36)
    del d
    lake = dilate(erode(lake))          # Einzelpixel (Schattenhänge, dunkler Wald) verwerfen
    water = (elev == 0) | lake
    del lake
    # Land = 40 … 255 (linear über die GEBCO-Höhenskala), Wasser = 0.
    # Beim Verkleinern mittelt sich die Küste zu Zwischenwerten — so kann der
    # Shader die Küstenlinie später genauer als ein Texel auflösen.
    v = np.where(water, 0.0, 40.0 + elev.astype(np.float32) * (215.0 / 255.0)).astype(np.float32)
    del water, elev
    img = Image.fromarray(v, mode='F')
    for size, name in (((8192, 4096), 'terrain_8k.png'), ((4096, 2048), 'terrain_4k.png')):
        small = np.asarray(img.resize(size, Image.BOX))
        Image.fromarray(np.clip(small + 0.5, 0, 255).astype(np.uint8), mode='L').save(OUT / name, optimize=True)
    return 'terrain'


if __name__ == '__main__':
    if len(sys.argv) > 2:                       # einzelne Teile neu bauen: … terrain night
        for name in sys.argv[2:]:
            print('fertig:', globals()[name](), flush=True)
        sys.exit()
    jobs = [('c', None), ('t', None), ('n', None)] + [('d', m) for m in range(1, 13)]
    with Pool(4) as pool:
        res = [pool.apply_async({'c': clouds, 't': terrain, 'n': night}[k]) if k != 'd'
               else pool.apply_async(day, (m,)) for k, m in jobs]
        for r in res:
            print('fertig:', r.get(), flush=True)
