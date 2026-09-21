# Orbital Botany · Station Hedera

Ein ruhiges, browserbasiertes Semi-Idle-Spiel. Du bewohnst allein eine kleine
Raumstation in **600 km Höhe** und baust dort Pflanzen an — Gemüse, Obst,
Kräuter, Blumen, irgendwann Kaffee und Vanille.

Das Spiel läuft in **Echtzeit**. Es ist mit der Uhr deines Rechners
synchronisiert: Wenn du die Seite schließt und zwei Tage später wiederkommst,
sind zwei Tage vergangen. Die Station rechnet beim Laden nach, was inzwischen
passiert ist — was gewachsen ist, was geerntet werden kann, was vertrocknet ist,
welche Frachtkapsel angedockt hat.

**→ [Jetzt spielen](https://simon23-12.github.io/orbital-botany/)**

---

## Worum es geht

Unter orbitalen Bedingungen — geregeltes Licht, ideale Nährlösung, kein Wetter —
wachsen Pflanzen hier **etwa zwanzigmal schneller** als auf der Erde. Was unten
ein Vierteljahr braucht, ist oben in vier Tagen erntereif. Trotzdem wartet man:
Ein Salat braucht gut zwei Tage, eine Tomate vier, ein Säulenapfel fünfundvierzig.

Gedacht ist das Spiel als etwas, das man über Monate **zwischendurch** spielt.
Ein paar Minuten morgens, ein paar abends.

## Was dabei hängen bleibt

Sämtliche botanischen Kennzahlen im Spiel sind echt. Das ist der eigentliche Punkt:

- **DLI** — das *Daily Light Integral* in mol/m²/Tag, die Maßeinheit, mit der im
  Gartenbau tatsächlich gerechnet wird. Salat will 14, Zwergweizen 40, Wasabi 6.
- **Liebigs Minimumgesetz** — es zählt immer nur der knappste Faktor. Doppelter
  Dünger bringt nichts, wenn das Licht fehlt.
- **Wasserbilanz** — eine Pflanze verdunstet 200 bis 500 Gramm Wasser je Gramm
  gebildeter Trockenmasse. Der Kondensator holt einen Teil davon zurück; nur die
  Differenz musst du von der Erde hochfliegen lassen.
- **Bestäubung** — im Orbit gibt es weder Insekten noch Wind. Tomatenblüten geben
  ihren Pollen nur bei Vibration um 400 Hz frei. Ohne dich setzt keine Frucht an.
- **pH und EC** — warum Eisen über pH 7 ausfällt und was zu viel Salz mit einer
  Wurzel macht.
- **Photoperiode** — warum Spinat über 13 Stunden Licht in Blüte schießt.

Dazu kommen ein paar Dinge, die man nur im Orbit lernt: dass die Station alle
96,5 Minuten einmal um die Erde fliegt, dass der Erdschatten je nach Betawinkel
bis zu 35 Minuten dauert — und dass es Phasen gibt, in denen die Bahn tagelang
gar nicht mehr in den Schatten eintaucht.

## Technik

Alles läuft ohne Server, ohne Build-Schritt, ohne Konto.

| | |
|---|---|
| **Grafik** | Three.js (WebGL2), eigene Shader, Bloom & Filmkorn |
| **Erde** | Satellitenkarten der NASA (Albedo, Nachtlichter, Relief, Rauheit, Wolken) in einem eigenen Shader, ergänzt um prozedurale Feinstruktur — ohne die wäre der Blick aus 600 km verwaschen. Fehlen die Bilder, erzeugt das Spiel Ersatzkarten selbst |
| **Bodenspur** | echt gerechnet: Die Erde dreht sich geografisch korrekt unter der Station durch, die Cupola sagt, worüber du gerade fliegst |
| **Bahnmechanik** | echt gerechnet: Keplersche Umlaufzeit, Betawinkel, Schattenanteil |
| **Musik** | generativ per Web Audio API — Drone, wandernde Akkordflächen, Glockentöne. Kein Audiomaterial, wiederholt sich praktisch nie |
| **Speichern** | `localStorage`, dazu Export/Import als JSON |
| **Abhängigkeiten** | nur Three.js, mitgeliefert unter `vendor/` |

### Räume

Außenansicht (zugleich das Menü), Lounge mit Panoramafenster, **Cupola** mit
Rundumsicht, Gewächsraum, Labor, Technik, Frachtschleuse — später
Hydroponik-Modul, Pilzkammer, Vertikalfarm und ein Kuppelgewächshaus im echten
Sonnenlicht.

Die Cupola ist der ISS-Aussichtskuppel nachempfunden: sechs trapezförmige
Seitenfenster um eine runde Mittelscheibe, dazwischen nur Rahmen — der Blick
nach draußen ist rundum frei. Von dort lassen sich Aufnahmen der überflogenen
Region machen, die das Erdbeobachtungsprogramm vergütet.

### Lokal starten

```bash
node tools/serve.mjs 8777
```

Dann `http://localhost:8777` öffnen. Ein simpler statischer Server genügt —
`python3 -m http.server` tut es auch.

### Aufbau

```
index.html
styles/main.css
src/
  core/      util, orbit (Bahnmechanik), save, events
  data/      plants, modules, research, shop, mails   ← Inhalte
  game/      state, sim (Wachstumsmodell), actions, mail
  gfx/       renderer, sky (Erde), station, exterior, interior, plants3d
  audio/     music (generativ), sfx
  ui/        ui (HUD), panels, icons
vendor/three/
```

Die Erdtexturen liegen unter `assets/planet/`, ihre Herkunft steht in
`assets/planet/HERKUNFT.md`.

Wer eigene Pflanzen hinzufügen will: `src/data/plants.js`. Ein Eintrag mit
echten Werten für `days`, `dli`, `water`, `temp`, `ph` reicht — den Rest macht
die Simulation.

### Tastatur

`W` alles gießen · `H` alles ernten · `M` Funkverkehr · `K` Kompendium ·
`Esc` zurück zur Außenansicht

---

Privates Projekt. Viel Ruhe da oben.
