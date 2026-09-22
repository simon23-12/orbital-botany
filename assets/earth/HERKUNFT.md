# Herkunft der Erddaten

Alle Karten beruhen auf gemeinfreien Daten der NASA bzw. von GEBCO und wurden
mit `tools/earth_textures.py` aus den Originalen erzeugt.

| Datei | Inhalt | Quelle |
|---|---|---|
| `day_MM_16k.jpg`, `day_MM_8k.jpg` | Tagseite je Monat, 16384 × 8192 bzw. 8192 × 4096 | [Blue Marble Next Generation](https://visibleearth.nasa.gov/collection/1484/blue-marble) (NASA Earth Observatory, 2004), Variante ohne Relief und Bathymetrie, 500 m-Mosaik auf 21600 × 10800 |
| `clouds_16k.jpg`, `clouds_8k.jpg` | Wolkenbedeckung, Graustufen | [Blue Marble Clouds](https://visibleearth.nasa.gov/images/57747/blue-marble-clouds) (NASA, MODIS), 1 km, zwei Kacheln à 21600 × 21600 |
| `night_8k.jpg`, `night_4k.jpg` | Nachtlichter, Graustufen | [Black Marble 2016](https://earthobservatory.nasa.gov/features/NightLights) (NASA, VIIRS Day/Night Band), 3 km |
| `terrain_8k.png`, `terrain_4k.png` | Wasser = 0, Land = 40 + Höhe | Höhen: [GEBCO 08](https://visibleearth.nasa.gov/images/73934/topography) über NASA Visible Earth; Seen aus der Blue-Marble-Tagkarte (dort fast schwarz) |

Alles gemeinfrei (NASA-Bildmaterial, GEBCO-Daten zur freien Nutzung).

## Warum die Erde so aussieht, wie sie aussieht

- **Kein Relief in der Tagkarte.** Die Blue-Marble-Varianten mit „Topography"
  haben eingebrannte Schattierung aus fester Richtung. Die Erde hier wird mit
  dem echten Sonnenstand beleuchtet, das Relief kommt aus den GEBCO-Höhen.
- **Dunkler Ozean.** Die Varianten mit Bathymetrie zeigen den Meeresboden in
  hellem Blau — aus dem All sieht man ihn nicht. Nur Flachwasser (Bahamas,
  Großes Barriereriff) ist wirklich türkis, und genau das zeigt die gewählte Karte.
- **Jahreszeiten.** Es wird die Aufnahme des aktuellen Monats geladen: Im
  Winter liegt über Kanada, Sibirien und Skandinavien Schnee.
- **Wolken zerfasern.** 16384 Texel sind am Boden 2,4 km — aus 600 km immer
  noch mehrfach vergrößert. Ein kachelbares 3D-Rauschen frisst dünne Stellen
  und Ränder aus, so bleiben Wolken auch aus der Nähe scharf.

Fehlen die Dateien, erzeugt das Spiel einfache Ersatzkarten auf der
Grafikkarte (`generateFallbackSet`) und läuft weiter.
