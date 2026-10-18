/*  Aufträge, Fotowünsche und Laborexperimente — die Texte.
 *
 *  Platzhalter in Aufträgen: {qty} {plant} {due} {bonus}
 *  Platzhalter in Fotowünschen: {region} {when} {first} {bonus}
 */

/* Wer unten etwas bestellt. Jeder Auftrag nimmt eine zufällige Vorlage. */
export const CONTRACT_TEMPLATES = [
  {
    from: 'tobi', subject: 'Bestellung aus der Kantine: {plant}',
    body:
`Moin {name},

kleine Anfrage, die nicht über den offiziellen Tisch geht: Die Kantine hier in Noordwijk will am Monatsende einen „Orbit-Teller" anbieten. Marketingidee von oben, frag nicht.

Gebraucht werden **{qty}× {plant}**, Ernte bis **{due}**. Die Kapsel nimmt es beim nächsten Rückflug mit.

Zusätzlich zum normalen Erlös gibt es **{bonus} Credits** aus dem Veranstaltungsbudget. Wenn's nicht klappt, auch nicht schlimm — dann gibt's halt wieder Erbsensuppe.`,
    sig: 'Tobi',
  },
  {
    from: 'lena', subject: 'Hilfst du mir? ({plant})',
    body:
`Hey,

ich hab meinem Kochkurs erzählt, dass mein Geschwisterkind im Weltraum Gemüse anbaut. Jetzt wollen alle probieren. Alle. Es ist ein bisschen eskaliert.

Schaffst du **{qty}× {plant}** bis **{due}**? Die Agentur meint, das geht mit der Rückfracht, solange es unter einem Kilo bleibt.

Der Kurs legt zusammen: **{bonus} Credits**. Ich hab gesagt, du nimmst kein Geld, aber sie bestehen drauf.

Danke!! ♥`,
    sig: 'Lena',
  },
  {
    from: 'ayo', subject: 'Für mein Seminar: {plant}',
    body:
`Liebe{r} {name},

meine Studierenden in Ibadan vergleichen in diesem Semester Pflanzen aus dem Orbit mit Pflanzen aus dem Gewächshaus — Blattdicke, Zuckergehalt, Spaltöffnungen. Es wäre ein großes Geschenk, wenn Sie **{qty}× {plant}** liefern könnten, geerntet bis **{due}**.

Die Fakultät hat für Probenmaterial ein kleines Budget: **{bonus} Credits**. Mehr ist es leider nicht, aber die Ergebnisse schicke ich Ihnen.`,
    sig: 'Ayo Bello',
  },
  {
    from: 'marit', subject: 'Auftrag: {plant} für die Delegation',
    body:
`{name},

nächste Woche besucht eine Delegation aus dem Ministerium das Kontrollzentrum. Man möchte etwas in der Hand halten, das tatsächlich von Hedera stammt.

Bitte **{qty}× {plant}**, Ernte bis **{due}**. Das Programm vergütet das mit **{bonus} Credits** zusätzlich zum regulären Ankauf.

Ich muss nicht erklären, warum das wichtig ist.`,
    sig: 'Dr. Marit Lindqvist',
  },
  {
    from: 'nour', subject: 'Nachtschicht-Wunsch: {plant}',
    body:
`Hi {name},

die Nachtschicht hat abgestimmt. Wir wollen etwas Frisches, das nicht aus dem Automaten kommt, und wir wollen, dass es von dir ist.

**{qty}× {plant}**, bis **{due}**. Wir haben gesammelt: **{bonus} Credits**.

Um 3 Uhr früh schmeckt alles besser, was über uns gewachsen ist.`,
    sig: 'Nour',
  },
];

/* Ziele für Fotowünsche. `lit` = Station auf der Tagseite (true) oder im Erdschatten (false). */
export const PHOTO_TARGETS = [
  { region: 'Sahara', lit: true, why: 'Die Dünenfelder des Erg Chebbi dienen als Kalibrierfläche für Satellitensensoren — kaum ein Ort der Erde ist so gleichmäßig hell.' },
  { region: 'Himalaya', lit: true, why: 'Die Glaziologie in Innsbruck vergleicht die Schneegrenze mit den Aufnahmen vom letzten Jahr.' },
  { region: 'Amazonasbecken', lit: true, why: 'Waldbrandmonitoring: Rauchfahnen sehen von oben viel früher aus wie Rauchfahnen als von unten.' },
  { region: 'Australien', lit: true, why: 'Die roten Böden des Outback sind eisenoxidreich — eine Uni in Perth will die Farbe aus dem Orbit messen.' },
  { region: 'Patagonien', lit: true, why: 'Das Südliche Patagonische Eisfeld verliert jedes Jahr Masse. Jede Aufnahme hilft.' },
  { region: 'Ostafrika · Rift Valley', lit: true, why: 'Der Ostafrikanische Graben reißt jährlich ein paar Millimeter weiter auf. Die Geologie hätte gern Schrägaufnahmen.' },
  { region: 'Madagaskar', lit: true, why: 'Die Flüsse Madagaskars führen nach starkem Regen rote Erde ins Meer — die Insel „blutet". Das will eine Umweltgruppe dokumentieren.' },
  { region: 'Anden', lit: true, why: 'Die Salzseen im Altiplano sind die größten Lithiumlager der Welt. Eine Redaktion möchte ein Bild davon.' },
  { region: 'Great Plains', lit: true, why: 'Kreisrunde Felder der Pivot-Bewässerung, kilometerweit — ein Lehrbuchverlag sucht genau diese Aufnahme.' },
  { region: 'Naher Osten', lit: true, why: 'Die aufgeschütteten Inseln vor Dubai — Palmen und eine Weltkarte aus Sand — fehlen noch im Bildarchiv eines Schulbuchverlags.' },
  { region: 'Mitteleuropa', lit: false, why: 'Lichtverschmutzung: Ein Projekt der Sternwarte Wien vergleicht die Nachtbilder über die Jahre.' },
  { region: 'Indien', lit: false, why: 'Die Lichter entlang der Gangesebene — zum Diwali-Fest will eine Zeitung in Delhi eine Aufnahme vom Orbit.' },
  { region: 'Ostchina', lit: false, why: 'Megastädte bei Nacht: Ein Stadtplanungsinstitut misst, wie schnell das Perlflussdelta zusammenwächst.' },
  { region: 'Japan', lit: false, why: 'Die Fischereiflotten vor Japan arbeiten mit grellen Lampen. Aus dem Orbit sieht man sie als Lichtteppich auf dem Meer.' },
  { region: 'Nordamerika · Ostküste', lit: false, why: 'Der Bogen von Boston bis Washington ist bei Nacht eine einzige Lichterkette. Ein Museum möchte ein Plakat daraus machen.' },
  { region: 'Mittelmeer', lit: false, why: 'Die Küsten des Mittelmeers zeichnen sich nachts als Lichtsaum ab. Eine Schulklasse in Marseille hat darum gebeten.' },
];

export const PHOTO_REQUEST_MAIL = {
  from: 'geo', subject: 'Fotowunsch: {region} ({when})',
  body:
`Hallo {name},

das Erdbeobachtungsprogramm hat eine konkrete Anfrage:

**{region}**, aufgenommen {when}.

{why}

Nach unserer Bahnrechnung öffnet sich das nächste Fenster **{first}**. Die genauen Zeiten zeigt dir die Cupola mit einem Countdown — das Fenster ist meist nur ein paar Minuten offen.

Eine passende Aufnahme vergüten wir mit dem **Dreifachen** des üblichen Satzes. Sie zählt nicht gegen die Sperrzeit für normale Aufnahmen.`,
  sig: 'Jun Watanabe\nErdbeobachtung · ESA/OAB',
};

/* Laborexperimente — laufen parallel zur Forschung, eines zur Zeit. */
export const EXPERIMENTS = [
  { id: 'germ', name: 'Keimratentest', hours: 2, base: 15, perLevel: 3, xp: 8, icon: 'sprout',
    desc: 'Hundert Samen auf feuchtem Filterpapier, ausgezählt nach zwei Stunden Stationszeit.',
    fact: 'Die Keimrate ist die wichtigste Qualitätszahl für Saatgut. Handelsware muss in der EU je nach Art mindestens 65 bis 85 % erreichen.' },
  { id: 'agar', name: 'Wurzelwachstum auf Agar', hours: 6, base: 45, perLevel: 8, xp: 22, icon: 'beaker',
    desc: 'Keimlinge auf senkrechten Agarplatten. Die Kamera misst, wie die Wurzeln auf die künstliche Schwerkraft reagieren.',
    fact: 'Wurzeln spüren die Schwerkraft mit Stärkekörnern in der Wurzelspitze, den Statolithen. In echter Schwerelosigkeit wachsen sie in Wellen und Schleifen.' },
  { id: 'samples', name: 'Probenpaket für die Erde', hours: 12, base: 80, perLevel: 14, xp: 40, icon: 'box',
    desc: 'Blatt-, Wurzel- und Substratproben, gefriergetrocknet und beschriftet für die Rückfracht.',
    fact: 'Proben von der ISS kommen in Kühlboxen bei −80 °C zurück. Die Dragon-Kapsel ist derzeit das einzige Fahrzeug, das nennenswert Fracht zur Erde bringen kann.' },
];
export const EXP_BY_ID = Object.fromEntries(EXPERIMENTS.map(e => [e.id, e]));
