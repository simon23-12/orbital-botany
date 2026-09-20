/*  Pflanzendatenbank.
 *
 *  Alle Kennzahlen sind echte gartenbauliche Werte, soweit sie sich sinnvoll
 *  auf ein Anbautablett von 0,25 m² herunterrechnen lassen:
 *
 *    days    Tage bis zur Ernte auf der Erde (die Station ist 20× schneller)
 *    dli     Daily Light Integral in mol/m²/Tag — die Lichtmenge, die die Pflanze
 *            pro Tag wirklich braucht. Praxiswert aus dem Gewächshausbau.
 *    water   Liter pro Tablett über die gesamte Kultur (Transpiration + Aufnahme)
 *    ec      Leitfähigkeit der Nährlösung in mS/cm
 *    ph      Zielbereich des Wurzelmediums
 *    temp    [Minimum, Optimum, Maximum] in °C
 *    n       Nährsalzbedarf in Gramm pro Tablett
 *
 *  `fact` ist jeweils echtes Pflanzenwissen — das ist der eigentliche Punkt.
 */

export const GROWTH_FACTOR = 20;          // Beschleunigung gegenüber der Erde
export const TRAY_AREA = 0.25;            // m² pro Anbauplatz

/** Wachstumsphasen je Archetyp — Anteile am Gesamtzyklus. */
export const STAGE_SETS = {
  leafy:  [['Keimung', .12], ['Sämling', .22], ['Blattentwicklung', .46], ['Erntereif', .20]],
  root:   [['Keimung', .14], ['Sämling', .20], ['Laubbildung', .32], ['Knollenbildung', .24], ['Erntereif', .10]],
  fruit:  [['Keimung', .10], ['Sämling', .16], ['Vegetativ', .26], ['Blüte', .16], ['Fruchtansatz', .22], ['Erntereif', .10]],
  flower: [['Keimung', .12], ['Sämling', .20], ['Vegetativ', .34], ['Knospen', .18], ['Blüte', .16]],
  grain:  [['Keimung', .10], ['Bestockung', .24], ['Schossen', .26], ['Ährenschieben', .20], ['Reife', .20]],
  fungus: [['Durchwachsung', .55], ['Primordien', .20], ['Fruchtkörper', .15], ['Erntereif', .10]],
  woody:  [['Keimung', .08], ['Jungpflanze', .30], ['Aufbau', .28], ['Blüte', .14], ['Fruchtreife', .20]],
};

const P = (o) => o;

export const PLANTS = [

/* ───────────────────────── STUFE 1 — Der Probelauf ───────────────────────── */
P({
  id: 'kresse', name: 'Gartenkresse', latin: 'Lepidium sativum', family: 'Kreuzblütler',
  level: 1, seed: 8, value: 26, xp: 12, days: 10, germ: 2,
  dli: 6, dliMin: 3, water: 3, n: 4, ec: 1.0, ph: [5.5, 6.8], temp: [8, 18, 28],
  yieldG: 110, archetype: 'leafy', stages: 'leafy', pollinate: false, difficulty: 1,
  color: { leaf: 0x6fcf6f, accent: 0x9ade7a },
  tags: ['Blattgemüse', 'Anfänger'],
  fact: 'Kressesamen keimen auf nassem Papier ohne jedes Substrat. Sie umgeben sich beim Quellen mit einer Schleimhülle aus Pektinen — Myxospermie. Die Hülle hält ein Vielfaches ihres Gewichts an Wasser fest und hat der Pflanze die Besiedlung von Halbwüsten ermöglicht.',
  tip: 'Kresse ist der klassische Test für ein neues Substrat: keimt sie nicht, stimmt etwas mit Wasser oder Salzgehalt nicht.',
}),
P({
  id: 'radieschen', name: 'Radieschen', latin: 'Raphanus sativus var. sativus', family: 'Kreuzblütler',
  level: 1, seed: 14, value: 48, xp: 20, days: 25, germ: 4,
  dli: 10, dliMin: 5, water: 9, n: 10, ec: 1.6, ph: [6.0, 7.0], temp: [6, 16, 24],
  yieldG: 420, archetype: 'root', stages: 'root', pollinate: false, difficulty: 1,
  color: { leaf: 0x77c95e, accent: 0xe4436b },
  tags: ['Wurzelgemüse', 'Schnellkultur'],
  fact: 'Die rote Kugel ist keine Wurzel, sondern ein verdicktes Hypokotyl — der Stängelabschnitt zwischen Keimblättern und Wurzel. Wird es zu warm oder zu trocken, schießt die Pflanze statt zu verdicken, und die Knolle wird holzig und pelzig.',
  tip: 'Über 20 °C werden Radieschen scharf und hohl. Kühl und gleichmäßig feucht halten.',
}),
P({
  id: 'salat', name: "Römersalat 'Outredgeous'", latin: 'Lactuca sativa', family: 'Korbblütler',
  level: 1, seed: 20, value: 85, xp: 34, days: 45, germ: 5,
  dli: 14, dliMin: 7, water: 34, n: 22, ec: 1.2, ph: [5.5, 6.5], temp: [7, 18, 26],
  yieldG: 900, archetype: 'leafy', stages: 'leafy', pollinate: false, difficulty: 1,
  color: { leaf: 0x8e3f5a, accent: 0xc0586f },
  tags: ['Blattgemüse', 'Raumfahrtgeschichte'],
  fact: 'Genau diese rote Römersorte war am 10. August 2015 das erste im Orbit gewachsene Gemüse, das Astronauten essen durften — Experiment VEG-01 auf der ISS. Die rote Färbung stammt von Anthocyanen, die die Pflanze unter starkem Licht als UV-Schutz bildet.',
  tip: 'Salat wird bei über 26 °C bitter: er bildet Lactucopikrin, einen Milchsaft-Bitterstoff, und schießt in Blüte.',
}),

/* ───────────────────────── STUFE 2 ───────────────────────── */
P({
  id: 'rucola', name: 'Rucola', latin: 'Eruca vesicaria', family: 'Kreuzblütler',
  level: 2, seed: 16, value: 66, xp: 26, days: 30, germ: 4,
  dli: 12, dliMin: 6, water: 16, n: 12, ec: 1.4, ph: [6.0, 7.0], temp: [8, 18, 25],
  yieldG: 320, archetype: 'leafy', stages: 'leafy', pollinate: false, difficulty: 1,
  color: { leaf: 0x5ea54a, accent: 0x88c76a },
  tags: ['Blattgemüse', 'Würzkraut'],
  fact: 'Die Schärfe kommt aus Senfölglykosiden. Erst wenn ein Blatt verletzt wird, trifft das Enzym Myrosinase auf sie und setzt in Sekunden Isothiocyanate frei — eine chemische Waffe, die im unverletzten Blatt getrennt gelagert wird.',
  tip: 'Je älter und trockener, desto schärfer. Wer milden Rucola will, erntet jung und wässert gleichmäßig.',
}),
P({
  id: 'spinat', name: 'Spinat', latin: 'Spinacia oleracea', family: 'Fuchsschwanzgewächse',
  level: 2, seed: 22, value: 92, xp: 36, days: 40, germ: 6,
  dli: 14, dliMin: 7, water: 26, n: 20, ec: 1.8, ph: [6.0, 7.0], temp: [5, 16, 24],
  yieldG: 700, archetype: 'leafy', stages: 'leafy', pollinate: false, difficulty: 2,
  color: { leaf: 0x3f8c4e, accent: 0x63b06a },
  tags: ['Blattgemüse', 'Langtagpflanze'],
  fact: 'Spinat ist eine Langtagpflanze: Sobald die Lichtphase etwa 13 Stunden überschreitet, schaltet er von Blattbildung auf Blüte um. Im Orbit lässt sich das exakt steuern — Photoperiode unter 13 h halten, dann bleibt er im Blattstadium.',
  tip: 'Der hohe Oxalsäuregehalt bindet Calcium. Kurze Blanchierzeit senkt ihn um rund ein Drittel.',
}),
P({
  id: 'basilikum', name: 'Basilikum', latin: 'Ocimum basilicum', family: 'Lippenblütler',
  level: 2, seed: 26, value: 120, xp: 44, days: 60, germ: 7,
  dli: 20, dliMin: 11, water: 30, n: 24, ec: 1.6, ph: [5.5, 6.5], temp: [15, 24, 32],
  yieldG: 380, archetype: 'herb', stages: 'leafy', pollinate: false, difficulty: 2,
  color: { leaf: 0x4fa34a, accent: 0x7cc46a },
  tags: ['Kräuter', 'Wärmeliebend'],
  fact: 'Basilikum verträgt keine Kälte. Unter etwa 10 °C verlieren die Zellmembranen ihre Fluidität, es kommt zu Leckagen und die Blätter werden binnen Stunden schwarz. Das ist kein Frostschaden, sondern eine Kältestarre der Lipiddoppelschicht.',
  tip: 'Immer über einem Blattpaar schneiden, nie einzelne Blätter zupfen — dann verzweigt die Pflanze und bleibt buschig.',
}),
P({
  id: 'bohne', name: 'Zwergbuschbohne', latin: 'Phaseolus vulgaris', family: 'Hülsenfrüchtler',
  level: 3, seed: 30, value: 150, xp: 54, days: 55, germ: 8,
  dli: 22, dliMin: 12, water: 45, n: 14, ec: 2.0, ph: [6.0, 6.8], temp: [12, 22, 30],
  yieldG: 600, archetype: 'bush', stages: 'fruit', pollinate: false, difficulty: 2,
  color: { leaf: 0x52a04a, accent: 0x93c16a },
  tags: ['Hülsenfrucht', 'Stickstoffsammler'],
  fact: 'Bohnen leben mit Knöllchenbakterien der Gattung Rhizobium zusammen. Die Bakterien binden Luftstickstoff und liefern ihn als Ammonium; die Pflanze zahlt mit Zucker. Ein Bohnenbeet düngt so seinen eigenen Boden mit bis zu 40 kg Stickstoff je Hektar.',
  tip: 'Bohnen nur schwach mit Stickstoff düngen — sonst stellen sie die Symbiose ein und bilden nur Blätter.',
}),

/* ───────────────────────── STUFE 3 — Blüten & Früchte ───────────────────────── */
P({
  id: 'tagetes', name: 'Studentenblume', latin: 'Tagetes patula', family: 'Korbblütler',
  level: 3, seed: 24, value: 130, xp: 48, days: 50, germ: 6,
  dli: 15, dliMin: 8, water: 22, n: 16, ec: 1.4, ph: [6.0, 7.0], temp: [10, 22, 30],
  yieldG: 0, archetype: 'flower', stages: 'flower', pollinate: false, difficulty: 2,
  color: { leaf: 0x3e7d43, accent: 0xff9b2e },
  tags: ['Zierpflanze', 'Nützlich'],
  fact: 'Tagetes gibt über die Wurzeln α-Terthienyl ab. Der Stoff wird unter Licht hochreaktiv und tötet wurzelparasitische Fadenwürmer im Umkreis ab. Deshalb steht sie in Gemüsebeeten zwischen den Reihen — als lebendes Pflanzenschutzmittel.',
  tip: 'Verblühtes regelmäßig ausknipsen: solange keine Samen reifen, blüht die Pflanze ununterbrochen weiter.',
}),
P({
  id: 'zinnie', name: 'Zinnie', latin: 'Zinnia elegans', family: 'Korbblütler',
  level: 3, seed: 34, value: 190, xp: 62, days: 60, germ: 6,
  dli: 16, dliMin: 9, water: 28, n: 18, ec: 1.5, ph: [5.8, 6.8], temp: [12, 23, 31],
  yieldG: 0, archetype: 'flower', stages: 'flower', pollinate: false, difficulty: 3,
  color: { leaf: 0x4a8c4e, accent: 0xff5f8a },
  tags: ['Zierpflanze', 'Raumfahrtgeschichte'],
  fact: 'Am 16. Januar 2016 blühte auf der ISS die erste Blume im Orbit: eine Zinnie. Vorher wäre sie fast eingegangen — in Schwerelosigkeit tropft Gießwasser nicht ab, sondern bleibt als Film auf den Blättern hängen, und darin wuchs Schimmel. Scott Kelly bekam erst Erfolg, als er nach Gefühl statt nach Vorschrift goss.',
  tip: 'Luftbewegung ist bei Zinnien wichtiger als Licht: stehende feuchte Luft bedeutet Mehltau.',
}),
P({
  id: 'erdbeere', name: 'Monatserdbeere', latin: 'Fragaria vesca', family: 'Rosengewächse',
  level: 4, seed: 55, value: 320, xp: 96, days: 90, germ: 14,
  dli: 20, dliMin: 11, water: 55, n: 26, ec: 1.4, ph: [5.5, 6.5], temp: [10, 20, 28],
  yieldG: 340, archetype: 'bush', stages: 'fruit', pollinate: true, difficulty: 3,
  color: { leaf: 0x3d8248, accent: 0xe6314c },
  tags: ['Obst', 'Bestäubung nötig'],
  fact: 'Eine Erdbeere ist botanisch keine Beere. Die gelben Körnchen auf der Oberfläche sind die eigentlichen Früchte — Nüsschen —, das rote Fleisch ist die aufgeschwollene Blütenachse. Jedes Nüsschen muss einzeln bestäubt werden; bleiben welche aus, wächst das Fleisch dort nicht mit und die Frucht wird schief.',
  tip: 'Schief gewachsene Erdbeeren sind fast immer ein Bestäubungsproblem, kein Nährstoffmangel.',
}),
P({
  id: 'microtom', name: "Tomate 'Micro-Tom'", latin: 'Solanum lycopersicum', family: 'Nachtschattengewächse',
  level: 4, seed: 60, value: 360, xp: 110, days: 80, germ: 7,
  dli: 22, dliMin: 12, water: 70, n: 40, ec: 2.6, ph: [5.5, 6.5], temp: [13, 23, 30],
  yieldG: 480, archetype: 'vine', stages: 'fruit', pollinate: true, difficulty: 3,
  color: { leaf: 0x3a7a3f, accent: 0xef3f2a },
  tags: ['Fruchtgemüse', 'Bestäubung nötig'],
  fact: 'Tomatenblüten geben ihren Pollen nur ab, wenn sie mit etwa 400 Hz vibrieren — Buzz Pollination. Hummeln beißen sich an der Blüte fest und lassen ihre Flugmuskulatur schwirren. Ohne Hummeln, Wind oder Vibration setzt keine Frucht an, egal wie üppig die Pflanze steht.',
  tip: "'Micro-Tom' wurde als Zierpflanze gezüchtet und ist heute die Modell-Tomate der Forschung: 15 cm hoch, voller Zyklus in unter drei Monaten.",
}),
P({
  id: 'chili', name: "Chili 'Española Improved'", latin: 'Capsicum annuum', family: 'Nachtschattengewächse',
  level: 5, seed: 70, value: 430, xp: 132, days: 100, germ: 12,
  dli: 22, dliMin: 13, water: 85, n: 44, ec: 2.2, ph: [5.8, 6.8], temp: [15, 25, 32],
  yieldG: 300, archetype: 'bush', stages: 'fruit', pollinate: true, difficulty: 4,
  color: { leaf: 0x357a3d, accent: 0xff4420 },
  tags: ['Fruchtgemüse', 'Raumfahrtgeschichte'],
  fact: 'Diese Hatch-Sorte aus New Mexico wurde 2021 im Experiment Plant Habitat-04 auf der ISS geerntet — der längste Pflanzenversuch der Station. Capsaicin bindet an den Hitzerezeptor TRPV1 von Säugetieren; Vögel besitzen diesen Rezeptor in anderer Form, schmecken nichts und verbreiten die Samen unbeschadet.',
  tip: 'Trockenstress in der Fruchtphase treibt den Schärfegrad hoch — mildere Früchte bekommt man mit gleichmäßiger Bewässerung.',
}),

/* ───────────────────────── STUFE 4 ───────────────────────── */
P({
  id: 'moehre', name: 'Pariser Karotte', latin: 'Daucus carota subsp. sativus', family: 'Doldenblütler',
  level: 5, seed: 40, value: 210, xp: 76, days: 70, germ: 14,
  dli: 14, dliMin: 8, water: 32, n: 18, ec: 1.8, ph: [6.0, 6.8], temp: [7, 18, 26],
  yieldG: 550, archetype: 'root', stages: 'root', pollinate: false, difficulty: 3,
  color: { leaf: 0x59a04e, accent: 0xff8d21 },
  tags: ['Wurzelgemüse'],
  fact: 'Karotten waren bis ins 17. Jahrhundert violett, weiß oder gelb. Das Orange ist eine niederländische Züchtung — und das β-Carotin darin wird erst durch Erhitzen und etwas Fett wirklich verfügbar: gekochte Möhren liefern mehr Vitamin A als rohe.',
  tip: 'Steiniges oder frisch gedüngtes Substrat lässt die Wurzel sich gabeln. Tiefes, feines Medium ist entscheidend.',
}),
P({
  id: 'gurke', name: 'Mini-Snackgurke', latin: 'Cucumis sativus', family: 'Kürbisgewächse',
  level: 6, seed: 75, value: 470, xp: 148, days: 60, germ: 5,
  dli: 25, dliMin: 15, water: 120, n: 52, ec: 2.4, ph: [5.5, 6.5], temp: [16, 26, 34],
  yieldG: 1400, archetype: 'vine', stages: 'fruit', pollinate: true, difficulty: 4,
  color: { leaf: 0x4b9e46, accent: 0x2f8c3a },
  tags: ['Fruchtgemüse', 'Hoher Wasserbedarf'],
  fact: 'Eine Gurke besteht zu 96 % aus Wasser und transpiriert entsprechend enorm. Auf der ISS zeigte das Experiment CARA, dass Gurkenwurzeln ohne Schwerkraft dem Wasser folgen: Hydrotropismus ist stärker als Gravitropismus — die Wurzel findet die Feuchtigkeit auch ohne Oben und Unten.',
  tip: 'Moderne Snacksorten sind parthenokarp: sie setzen Früchte ohne Bestäubung an. Samenfeste Sorten brauchen sie.',
}),
P({
  id: 'paprika', name: 'Blockpaprika', latin: 'Capsicum annuum var. grossum', family: 'Nachtschattengewächse',
  level: 6, seed: 85, value: 520, xp: 164, days: 95, germ: 12,
  dli: 22, dliMin: 13, water: 110, n: 56, ec: 2.4, ph: [5.8, 6.5], temp: [16, 25, 32],
  yieldG: 1100, archetype: 'bush', stages: 'fruit', pollinate: true, difficulty: 4,
  color: { leaf: 0x357a3d, accent: 0xf5c518 },
  tags: ['Fruchtgemüse'],
  fact: 'Grün, gelb, rot sind keine Sorten, sondern Reifestufen derselben Frucht. Mit der Reife bauen sich Chlorophylle ab und Carotinoide auf — der Vitamin-C-Gehalt verdoppelt sich dabei etwa. Rote Paprika hat mehr Vitamin C als jede Zitrusfrucht.',
  tip: 'Die erste Blüte in der Gabelung ausbrechen: die Pflanze baut dann erst Gerüst auf und trägt insgesamt deutlich mehr.',
}),
P({
  id: 'kartoffel', name: 'Mikroknollen-Kartoffel', latin: 'Solanum tuberosum', family: 'Nachtschattengewächse',
  level: 7, seed: 90, value: 560, xp: 176, days: 100, germ: 18,
  dli: 20, dliMin: 12, water: 95, n: 48, ec: 2.0, ph: [5.2, 6.4], temp: [10, 18, 26],
  yieldG: 2200, archetype: 'root', stages: 'root', pollinate: false, difficulty: 4,
  color: { leaf: 0x467f45, accent: 0xd8b070 },
  tags: ['Grundnahrung', 'Kalorienträger'],
  fact: 'Die Kartoffel liefert pro Quadratmeter und Tag mehr verwertbare Kalorien als fast jede andere Kulturpflanze — deshalb steht sie in jedem ernsthaften Konzept für Langzeitmissionen. 1995 wuchsen im Space Shuttle Columbia die ersten Mikroknollen im All.',
  tip: 'Licht auf der Knolle bildet Solanin — grüne Stellen sind giftig und gehören großzügig weg.',
}),
P({
  id: 'sonnenblume', name: 'Zwergsonnenblume', latin: 'Helianthus annuus', family: 'Korbblütler',
  level: 7, seed: 50, value: 300, xp: 108, days: 75, germ: 7,
  dli: 30, dliMin: 18, water: 70, n: 34, ec: 1.8, ph: [6.0, 7.2], temp: [12, 24, 33],
  yieldG: 120, archetype: 'flower', stages: 'flower', pollinate: false, difficulty: 3,
  color: { leaf: 0x4c8c3f, accent: 0xffc22e },
  tags: ['Zierpflanze', 'Lichthungrig'],
  fact: 'Junge Sonnenblumen folgen der Sonne, indem die Ost- und Westseite des Stängels abwechselnd schneller wachsen — eine innere Uhr steuert das, auch im Dunkeln läuft sie weiter. Ausgewachsene Blütenköpfe hören damit auf und stehen fest nach Osten: sie erwärmen sich morgens schneller und ziehen dadurch messbar mehr Bestäuber an.',
  tip: 'Der „Blütenkopf" ist ein Korb aus bis zu 2000 Einzelblüten, angeordnet in Fibonacci-Spiralen.',
}),

/* ───────────────────────── STUFE 5 — Spezialkulturen ───────────────────────── */
P({
  id: 'austernpilz', name: 'Austernseitling', latin: 'Pleurotus ostreatus', family: 'Seitlingsverwandte',
  level: 8, seed: 65, value: 400, xp: 140, days: 25, germ: 0,
  dli: 0.4, dliMin: 0, water: 40, n: 6, ec: 0, ph: [5.5, 6.5], temp: [12, 20, 27],
  yieldG: 900, archetype: 'fungus', stages: 'fungus', pollinate: false, difficulty: 3,
  dark: true,
  color: { leaf: 0xa89b84, accent: 0xd8cbb0 },
  tags: ['Pilzkultur', 'Braucht kein Licht'],
  fact: 'Pilze photosynthetisieren nicht — sie atmen wie Tiere und brauchen Sauerstoff, kein Licht. Licht steuert bei Seitlingen nur, wohin der Hut wächst. Und Pleurotus ist räuberisch: Er lähmt Fadenwürmer mit einem Nervengift und verdaut sie, um an Stickstoff zu kommen.',
  tip: 'In der Fruchtungsphase ist frische Luft alles: zu viel CO₂ gibt lange Stiele und winzige Hüte.',
}),
P({
  id: 'orchidee', name: 'Schmetterlingsorchidee', latin: 'Phalaenopsis amabilis', family: 'Orchideen',
  level: 8, seed: 110, value: 690, xp: 200, days: 150, germ: 30,
  dli: 8, dliMin: 4, water: 22, n: 10, ec: 0.8, ph: [5.5, 6.5], temp: [16, 24, 30],
  yieldG: 0, archetype: 'flower', stages: 'flower', pollinate: false, difficulty: 5,
  color: { leaf: 0x2f6e46, accent: 0xf0a8d0 },
  tags: ['Zierpflanze', 'CAM-Pflanze'],
  fact: 'Phalaenopsis betreibt CAM-Photosynthese: Sie öffnet ihre Spaltöffnungen nur nachts, bindet CO₂ als Apfelsäure und verarbeitet es erst am Tag bei geschlossenen Poren. So verliert sie kaum Wasser — eine Anpassung an das Leben als Aufsitzerpflanze im Baumkronendach, wo es keinen Bodenwasservorrat gibt.',
  tip: 'Die grünen Luftwurzeln photosynthetisieren mit. Ein undurchsichtiger Topf nimmt der Pflanze Leistung weg.',
}),
P({
  id: 'weizen', name: "Zwergweizen 'USU-Apogee'", latin: 'Triticum aestivum', family: 'Süßgräser',
  level: 9, seed: 45, value: 380, xp: 150, days: 70, germ: 5,
  dli: 40, dliMin: 22, water: 90, n: 50, ec: 2.0, ph: [6.0, 7.0], temp: [10, 22, 28],
  yieldG: 380, archetype: 'grass', stages: 'grain', pollinate: false, difficulty: 4,
  color: { leaf: 0x86a84e, accent: 0xe0c073 },
  tags: ['Getreide', 'Grundnahrung'],
  fact: "'Apogee' wurde an der Utah State University eigens für Raumstationen gezüchtet: knapp 40 cm hoch statt 80, und — entscheidend — unempfindlich gegen Blattspitzennekrose unter Dauerlicht. Normaler Weizen bekommt bei 24 Stunden Licht abgestorbene Blattspitzen; Apogee nicht. Er wuchs im russischen Svet-Gewächshaus auf der Mir.",
  tip: 'Weizen ist ein Selbstbestäuber: Die Blüte öffnet sich kaum, der Pollen fällt direkt auf die eigene Narbe.',
}),
P({
  id: 'mimose', name: 'Mimose', latin: 'Mimosa pudica', family: 'Hülsenfrüchtler',
  level: 9, seed: 80, value: 520, xp: 170, days: 65, germ: 10,
  dli: 12, dliMin: 7, water: 26, n: 14, ec: 1.2, ph: [5.5, 6.8], temp: [16, 24, 32],
  yieldG: 0, archetype: 'herb', stages: 'flower', pollinate: false, difficulty: 4,
  color: { leaf: 0x54945a, accent: 0xef9fd0 },
  tags: ['Kuriosum', 'Zierpflanze'],
  fact: 'Die Mimose klappt ihre Fiederblätter in etwa einer Zehntelsekunde zusammen. In den Blattgelenken verlieren Zellen schlagartig Kalium, das Wasser folgt osmotisch, der Druck bricht zusammen. Bemerkenswerter ist, dass sie lernt: Wird eine Pflanze wiederholt harmlos erschüttert, hört sie nach wenigen Durchgängen auf zu reagieren — und erinnert sich daran wochenlang.',
  tip: 'Jedes Zuklappen kostet Energie. Ständiges Antippen schwächt die Pflanze wirklich.',
}),
P({
  id: 'venus', name: 'Venusfliegenfalle', latin: 'Dionaea muscipula', family: 'Sonnentaugewächse',
  level: 10, seed: 130, value: 810, xp: 240, days: 120, germ: 25,
  dli: 18, dliMin: 10, water: 30, n: 1, ec: 0.1, ph: [4.0, 5.0], temp: [5, 24, 35],
  yieldG: 0, archetype: 'herb', stages: 'flower', pollinate: false, difficulty: 5,
  color: { leaf: 0x4e9a48, accent: 0xd0304a },
  tags: ['Karnivore', 'Kuriosum'],
  fact: 'Die Falle zählt. Erst wenn innerhalb von etwa 20 Sekunden zwei Sinneshaare berührt werden, schnappt sie zu — beim fünften Reiz beginnt die Verdauung. Gezählt wird über Calciumsignale, die zwischen den Reizen langsam abklingen: ein Kurzzeitgedächtnis ohne Nervensystem. Jede Falle kann das nur drei- bis viermal, dann stirbt sie ab.',
  tip: 'Nur salzfreies Wasser. Die Pflanze stammt aus nährstoffarmen Mooren, normales Leitungswasser verbrennt ihr die Wurzeln.',
}),

/* ───────────────────────── STUFE 6 — Hohe Kunst ───────────────────────── */
P({
  id: 'wasabi', name: 'Echter Wasabi', latin: 'Eutrema japonicum', family: 'Kreuzblütler',
  level: 11, seed: 210, value: 1650, xp: 380, days: 540, germ: 30,
  dli: 6, dliMin: 3, water: 160, n: 30, ec: 1.0, ph: [6.0, 7.0], temp: [8, 13, 20],
  yieldG: 240, archetype: 'leafy', stages: 'leafy', pollinate: false, difficulty: 6,
  color: { leaf: 0x3f7a4e, accent: 0x9fd08a },
  tags: ['Luxuskultur', 'Kühl & schattig'],
  fact: 'Wasabi wächst in Japan in fließendem Quellwasser bei 8 bis 18 °C im Schatten — und braucht anderthalb Jahre. Die Schärfe entsteht erst beim Reiben, wenn Zellen zerstört werden, und verfliegt binnen 15 Minuten, weil die Isothiocyanate flüchtig sind. Fast alles, was weltweit als Wasabi verkauft wird, ist gefärbter Meerrettich.',
  tip: 'Über 20 °C bekommt Wasabi Wurzelfäule. Von allen Kulturen hier die heikelste bei der Temperatur.',
}),
P({
  id: 'safran', name: 'Safran-Krokus', latin: 'Crocus sativus', family: 'Schwertliliengewächse',
  level: 11, seed: 190, value: 1900, xp: 410, days: 180, germ: 20,
  dli: 12, dliMin: 7, water: 40, n: 16, ec: 1.2, ph: [6.0, 8.0], temp: [0, 16, 28],
  yieldG: 4, archetype: 'flower', stages: 'flower', pollinate: false, difficulty: 6,
  color: { leaf: 0x5f8f5a, accent: 0x9a5fd0 },
  tags: ['Luxuskultur', 'Handernte'],
  fact: 'Safran sind die drei Narben einer Blüte, von Hand gezupft. Für ein Kilo braucht es etwa 150 000 Blüten und 400 Arbeitsstunden. Die Pflanze ist triploid und damit steril — sie kann keine Samen bilden, jede Knolle weltweit ist ein Klon derselben Linie, seit über 3000 Jahren vegetativ vermehrt.',
  tip: 'Der Krokus braucht einen heißen, trockenen Sommer in der Ruhephase, sonst blüht er im Herbst nicht.',
}),
P({
  id: 'vanille', name: 'Vanille', latin: 'Vanilla planifolia', family: 'Orchideen',
  level: 12, seed: 260, value: 2400, xp: 480, days: 270, germ: 40,
  dli: 10, dliMin: 5, water: 120, n: 28, ec: 1.0, ph: [5.5, 7.0], temp: [18, 26, 32],
  yieldG: 160, archetype: 'vine', stages: 'fruit', pollinate: true, difficulty: 7,
  color: { leaf: 0x3d7e4a, accent: 0xe8d9a0 },
  tags: ['Luxuskultur', 'Handbestäubung'],
  fact: 'Vanille ist eine Kletterorchidee. Ihre Blüte öffnet sich für einen einzigen Vormittag, und außerhalb Mexikos fehlt die bestäubende Melipona-Biene — deshalb wird weltweit von Hand bestäubt. Die Technik erfand 1841 der zwölfjährige versklavte Edmond Albius auf Réunion: mit einem Bambussplitter die trennende Lippe anheben, Pollen auf die Narbe drücken. Sie wird bis heute unverändert angewandt.',
  tip: 'Die grüne Schote riecht nach nichts. Das Aroma entsteht erst in monatelanger Fermentation aus Glucovanillin.',
}),
P({
  id: 'kaffee', name: 'Arabica-Kaffee', latin: 'Coffea arabica', family: 'Rötegewächse',
  level: 12, seed: 300, value: 2900, xp: 560, days: 730, germ: 60,
  dli: 15, dliMin: 8, water: 220, n: 70, ec: 1.6, ph: [5.5, 6.5], temp: [15, 22, 28],
  yieldG: 500, archetype: 'woody', stages: 'woody', pollinate: true, difficulty: 7,
  color: { leaf: 0x2f6b3c, accent: 0xc4382c },
  tags: ['Luxuskultur', 'Gehölz'],
  fact: 'Arabica stammt aus dem Bergnebelwald Äthiopiens und wächst dort im Halbschatten — volle Sonne verbrennt die Blätter und erschöpft den Strauch. Bis zur ersten Ernte vergehen drei bis vier Jahre. Coffein ist ein Insektizid: In den Blättern lähmt es Fraßfeinde, im Nektar dagegen liegt es in einer so niedrigen Dosis vor, dass Bienen sich den Ort der Blüte besser merken.',
  tip: 'Die Kaffeekirsche ist eine Steinfrucht; die „Bohne" ist ihr Samen. Ein Strauch liefert im Jahr Kaffee für etwa zwei Wochen.',
}),
P({
  id: 'apfel', name: 'Säulenapfel', latin: 'Malus domestica', family: 'Rosengewächse',
  level: 13, seed: 340, value: 3200, xp: 640, days: 900, germ: 60,
  dli: 25, dliMin: 15, water: 300, n: 90, ec: 1.8, ph: [6.0, 7.0], temp: [-5, 20, 30],
  yieldG: 2600, archetype: 'woody', stages: 'woody', pollinate: true, difficulty: 8,
  color: { leaf: 0x4a8442, accent: 0xd8322f },
  tags: ['Obstgehölz', 'Krönung'],
  fact: 'Jeder Apfelkern ergibt eine völlig neue Sorte — Äpfel sind extrem heterozygot. Jede Sorte, die es gibt, ist deshalb ein Klon: ein einziger Sämling, seit Jahrhunderten weiterveredelt. Der Säulenwuchs geht auf eine einzige Mutation zurück, die 1961 in British Columbia an einem Zweig der Sorte McIntosh entdeckt wurde.',
  tip: 'Äpfel brauchen Kältestunden unter 7 °C, um im Frühjahr auszutreiben. Ohne Winter keine Blüte.',
}),
];

/* Kleine Datenkorrekturen für die beiden Farbwerte oben nicht nötig — bereinigt: */
for (const p of PLANTS) {
  if (typeof p.color.leaf !== 'number') p.color.leaf = 0x4e9a48;
}

export const BY_ID = Object.fromEntries(PLANTS.map(p => [p.id, p]));
export const plant = id => BY_ID[id];

/** Dauer eines vollen Zyklus auf der Station, in ms. */
export function cycleMs(p) { return p.days * 86400_000 / GROWTH_FACTOR; }
/** Keimdauer auf der Station, in ms. */
export function germMs(p) { return p.germ * 86400_000 / GROWTH_FACTOR; }
/** Wasserbedarf pro ms Wachstum, Liter. */
export function waterRate(p) { return p.water / cycleMs(p); }
/** Nährsalzbedarf pro ms, Gramm. */
export function nutrientRate(p) { return p.n / cycleMs(p); }
/** Phasen dieser Pflanze. */
export function stagesOf(p) { return STAGE_SETS[p.stages] || STAGE_SETS.leafy; }
/** Index und Name der Phase bei Fortschritt 0…1. */
export function stageAt(p, t) {
  const st = stagesOf(p); let acc = 0;
  for (let i = 0; i < st.length; i++) {
    acc += st[i][1];
    if (t < acc || i === st.length - 1) return { i, name: st[i][0], from: acc - st[i][1], to: acc };
  }
  return { i: 0, name: st[0][0], from: 0, to: 1 };
}
/** Ab welchem Fortschritt ist Bestäubung fällig? (Beginn der Blütephase) */
export function pollenWindow(p) {
  const st = stagesOf(p); let acc = 0;
  for (const [name, f] of st) {
    if (name === 'Blüte' || name === 'Knospen') return [acc, acc + f * 2];
    acc += f;
  }
  return null;
}
export const PLANTS_BY_LEVEL = lvl => PLANTS.filter(p => p.level <= lvl);
