# Herkunft der Erdtexturen

| Datei | Inhalt | Quelle | Lizenz |
|---|---|---|---|
| `earth_day_8192.jpg` | Tagseite, 8192 × 4096 | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC BY 4.0 |
| `earth_day_4096.jpg` | Tagseite, 4096 × 2048 (sparsame Stufe) | three.js / NASA Earth Observatory | MIT / gemeinfrei |
| `earth_night_4096.jpg` | Nachtlichter (Black Marble / VIIRS) | three.js / NASA Earth Observatory | MIT / gemeinfrei |
| `earth_bump_roughness_clouds_4096.jpg` | R = Relief, G = Rauheit, B = Wolken | three.js, aus NASA-Daten kombiniert | MIT / gemeinfrei |

Die 8K-Tagkarte stammt von **Solar System Scope** und steht unter
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — sie beruht auf
Bildmaterial der NASA. Die übrigen Karten stammen aus dem Beispielverzeichnis
von [three.js](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets).

## Warum 8K nicht reicht

Aus 600 km Höhe blickt man auf wenige hundert Kilometer Boden. 8192 Texel für
40 000 km Erdumfang bedeuten 4,9 km je Texel — auf dem Bildschirm also noch rund
sechsfache Vergrößerung. Der Shader arbeitet deshalb auf zwei Ebenen:

1. **Kubische Vergrößerung** (Catmull-Rom) statt bilinearer Filterung. Die
   eingebaute Filterung macht aus vergrößerten Texeln Milchglas; die kubische
   Variante hält Kanten. Ab Qualitätsstufe *Mittel*.
2. **Eine vorberechnete Detailkarte** (`generateDetailTexture`) mit vier
   kachelbaren Rauschtypen: Gratmuster fürs Gelände, Körnung, Wolkenfasern und
   Ortschaften für die Nachtseite. Drei Abgriffe in verschiedenen Maßstäben
   ersetzen knapp dreißig Rauschauswertungen je Bildpunkt — das war der
   Unterschied zwischen 6 und 41 Bildern je Sekunde.

Die hoch aufgelöste Tagkarte wird nur auf den Stufen *Hoch* und *Ultra* geladen.
Fehlen die Dateien ganz, erzeugt das Spiel Ersatzkarten im selben Format auf der
Grafikkarte (`generateEarthTextures`) und läuft weiter.
