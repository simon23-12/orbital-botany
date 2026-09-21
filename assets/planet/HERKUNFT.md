# Herkunft der Erdtexturen

| Datei | Inhalt | Quelle |
|---|---|---|
| `earth_day_4096.jpg` | Tagseite (Blue Marble) | NASA Earth Observatory |
| `earth_night_4096.jpg` | Nachtlichter (Black Marble / VIIRS) | NASA Earth Observatory |
| `earth_bump_roughness_clouds_4096.jpg` | R = Relief, G = Rauheit, B = Wolken | NASA-Daten, kombiniert im three.js-Projekt |

Die Bilder stammen aus dem Beispielverzeichnis von
[three.js](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)
(MIT-Lizenz) und beruhen auf gemeinfreien Daten der NASA.

Der Shader in `src/gfx/sky.js` liest daraus Albedo, Stadtlichter, Relief,
Oberflächenrauheit und Wolkendecke. Weil man aus 600 km Höhe nur wenige hundert
Kilometer Boden sieht, reichen 4096 Texel nicht aus — die Feinstruktur ergänzt
hochfrequentes Simplex-Rauschen direkt im Shader.

Fehlen die Dateien, erzeugt das Spiel Ersatzkarten im selben Format auf der
Grafikkarte (`generateEarthTextures`), sodass es auch ohne sie läuft.
