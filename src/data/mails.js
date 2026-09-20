/*  Funkverkehr mit der Erde.
 *
 *  Platzhalter im Text: {name} {station} {day} {level}
 *  Auslöser (trigger) werden deklarativ ausgewertet, siehe game/mail.js:
 *    start, day, level, firstHarvest, harvest, plants, research, module,
 *    credits, after (+delayH), death, pollinationDue, eclipseFree
 */

export const PEOPLE = {
  marit: { name: 'Dr. Marit Lindqvist', role: 'Programmleitung · Orbitale Agrarforschung', addr: 'm.lindqvist@oab.esa.int', tone: 'cyan' },
  tobi:  { name: 'Tobias Renner',       role: 'Bodenkontrolle · Logistik',                 addr: 't.renner@oab.esa.int',    tone: 'amber' },
  ayo:   { name: 'Prof. Ayo Bello',     role: 'Botanik · Emeritus, Ibadan',                addr: 'a.bello@uni-ibadan.ng',   tone: 'leaf' },
  nour:  { name: 'Nour Haddad',         role: 'Flugleitung · Nachtschicht',                addr: 'n.haddad@oab.esa.int',    tone: 'violet' },
  lena:  { name: 'Lena',                role: 'deine Schwester',                           addr: 'lena@privat',             tone: 'rose' },
  sys:   { name: 'HEDERA · Bordsystem', role: 'automatische Meldung',                      addr: 'core@hedera.station',     tone: '' },
};

export const MAILS = [

/* ══════════════════ ANKUNFT ══════════════════ */
{
  id: 'welcome', from: 'marit', trigger: { start: true },
  subject: 'Willkommen an Bord — und ein paar klare Worte',
  body:
`{name},

die Luke ist zu, die Kapsel abgekoppelt, und Sie sind jetzt allein auf Hedera. 220 Kubikmeter, fünf Module, 600 Kilometer unter Ihnen die Erde. Alle 96 Minuten einmal herum.

Damit keine Missverständnisse entstehen: Das hier ist **eine Probephase**. Neunzig Tage. Die Agentur hat diese Station nicht für ein Hobby gebaut, sondern um herauszufinden, ob sich eine Besatzung im Orbit selbst ernähren kann. Ihre Aufgabe ist Botanik, und Ihre Ergebnisse entscheiden, ob Hedera ausgebaut oder abgewickelt wird.

Die gute Nachricht kennen Sie: Unter unseren Bedingungen — geregeltes Licht, ideale Nährlösung, kein Tag-Nacht-Stress, kein Wetter — wachsen Pflanzen hier oben etwa **zwanzigmal schneller** als im Freiland. Was unten ein Vierteljahr braucht, haben Sie in vier oder fünf Tagen.

Die schlechte: Alles, was Sie brauchen, muss hochgeflogen werden. Wasser, Salze, Saatgut. **Zwölf Stunden** vom Auftrag bis zum Andocken, und jedes Kilogramm kostet. Gehen Sie sparsam damit um.

In Gewächsraum A stehen vier Tabletts. Fangen Sie mit *Kresse* an — sie verzeiht alles, und wir brauchen schnell ein erstes Ergebnis für die Akte.

Willkommen im Programm.`,
  sig: 'Dr. Marit Lindqvist\nProgrammleitung Orbitale Agrarforschung\nESA/OAB Noordwijk',
  reward: { seeds: { kresse: 4, radieschen: 2 } },
},
{
  id: 'tobi_hi', from: 'tobi', trigger: { after: 'welcome', delayM: 24 },
  subject: 'Moin von unten',
  body:
`Hey {name},

Tobi hier, Logistik. Ich bin der, der Ihnen — dir? Lass uns bei du bleiben, sonst wird das anstrengend auf 90 Tage — also, ich bin der, der dir das ganze Zeug hochschießt.

Merk dir drei Sachen:

1. **Bestellen dauert 12 Stunden.** Immer. Auch nachts, auch sonntags, auch wenn du bettelst. Die Kapsel muss erst mal in deine Bahnebene, das kostet Zeit.
2. **Bestell lieber einmal viel als fünfmal wenig.** Der Fixkostenanteil pro Start frisst dich sonst auf.
3. Wenn du oben etwas kaputt machst, sag es sofort. Nicht erst, wenn Marit die Auswertung sieht.

Der Kaffee hier unten ist übrigens grauenhaft. Falls du es irgendwann schaffst, oben welchen anzubauen, will ich die erste Bohne. Das ist keine Bitte.

Halt die Ohren steif da oben.`,
  sig: 'Tobi\nBodenkontrolle Logistik, Konsole 4',
  reward: { credits: 200 },
},
{
  id: 'ayo_hello', from: 'ayo', trigger: { after: 'tobi_hi', delayM: 90 },
  subject: 'Ein alter Mann mit einer Gießkanne',
  body:
`Liebe{r} {name},

man hat mir gesagt, ich solle Sie „fachlich begleiten". Ich bin 74 und seit neun Jahren emeritiert, also nehmen Sie das bitte als das, was es ist: Ich habe Zeit und rede gern über Pflanzen.

Eine Sache vorweg, weil sie alles andere erklärt.

Eine Pflanze macht nur zwei Dinge. Sie fängt Licht ein, und sie verliert Wasser. Das Zweite ist der Preis für das Erste: Um ein einziges Molekül CO₂ aus der Luft zu holen, muss sie ihre Spaltöffnungen aufmachen — und durch dieselbe Öffnung entweichen mehrere hundert Moleküle Wasser. **Für ein Gramm Trockenmasse verdunstet eine Pflanze zwischen 200 und 500 Gramm Wasser.** Das ist kein Fehler im System, das ist das System.

Wenn Sie das im Kopf behalten, verstehen Sie sofort, warum Ihre Station so gebaut ist, wie sie gebaut ist: Der Kondensator im Technikmodul holt das verdunstete Wasser aus der Kabinenluft zurück. Was Sie wirklich verbrauchen, ist nur, was der Kreislauf nicht auffängt.

Ich schreibe Ihnen von Zeit zu Zeit. Sie müssen nicht antworten, aber es freut mich, wenn Sie es tun.

Und: Fangen Sie klein an. Kresse ist keine Verlegenheitslösung, Kresse ist die ehrlichste Pflanze der Welt.`,
  sig: 'Ayo Bello\nUniversity of Ibadan, Department of Crop & Horticultural Sciences (em.)',
  reward: { xp: 25 },
},

/* ══════════════════ ERSTE SCHRITTE ══════════════════ */
{
  id: 'first_harvest', from: 'marit', trigger: { firstHarvest: true },
  subject: 'Protokoll 001 — angekommen',
  body:
`{name},

Ihre erste Ernte ist im Protokoll. Ich weiß, es ist Kresse, und ich weiß, wie das klingt. Trotzdem: In der Akte steht jetzt eine Zeile, die vorher nicht da war.

Der Erlös ist Ihnen gutgeschrieben. Sie können damit bestellen, was Sie für richtig halten — die Agentur mischt sich in Ihre Anbauplanung nicht ein, solange die Zahlen stimmen.

Eine Bitte für die Akte: Bauen Sie nicht nur das an, was schnell geht. Wir brauchen die Bandbreite. Blattgemüse, Wurzeln, irgendwann Früchte. Und ja, auch Blumen — es gibt gute Gründe dafür, und einer davon steht nicht im Forschungsantrag.`,
  sig: 'M. Lindqvist',
  reward: { credits: 300, xp: 40 },
},
{
  id: 'lvl2', from: 'marit', trigger: { level: 2 },
  subject: 'Freigabe Stufe 2',
  body:
`Die Auswertung Ihrer ersten Zyklen ist durch. Sie haben eine erweiterte Anbaufreigabe: *Rucola*, *Spinat*, *Basilikum*.

Spinat ist der interessante Fall. Er ist eine **Langtagpflanze** — überschreitet die tägliche Lichtphase etwa 13 Stunden, stellt er von Blattbildung auf Blüte um und wird ungenießbar. Unten steuert das die Jahreszeit. Hier oben steuern Sie das. Nutzen Sie es.

Außerdem ist ab jetzt der Ausbau von Gewächsraum A freigegeben. Zwei zusätzliche Tabletts, die Halterungen sind bereits verbaut.`,
  sig: 'M. Lindqvist',
  reward: { seeds: { spinat: 2 }, credits: 250 },
},
{
  id: 'nour_first', from: 'nour', trigger: { day: 3 },
  subject: 'Sie sind wach, oder?',
  body:
`Hallo,

Nour, Nachtschicht in der Flugleitung. Ich sehe Ihre Telemetrie auf Schirm 3 und Sie haben seit zwei Stunden das Licht in der Lounge an.

Ich mache das seit elf Jahren und ich sage Ihnen, was fast alle in der ersten Woche erleben: Sie können nicht schlafen, weil alle 45 Minuten die Sonne aufgeht. Sechzehn Sonnenaufgänge am Tag. Das Gehirn kommt damit nicht klar.

Zwei Dinge helfen. Erstens: Fensterblende zu, wenn Sie schlafen wollen — ja, wirklich, es ist eine Verschwendung, und es ist trotzdem richtig. Zweitens: Bleiben Sie stur bei Mitteleuropäischer Zeit. Die Station ist auf MEZ synchronisiert, nicht weil das physikalisch Sinn ergibt, sondern weil ein Mensch eine Uhr braucht, auf die er sich verlassen kann.

Und wenn Sie doch wach bleiben: Der Blick nach unten über dem nächtlichen Nordafrika ist es wert. Sahara, dann plötzlich die Lichterkette der Nilstädte. Ich habe das nie selbst gesehen, nur auf Schirmen.

Gute Nacht, von hier unten.`,
  sig: 'Nour Haddad\nFlugleitung, Schicht C',
},
{
  id: 'tobi_cargo1', from: 'tobi', trigger: { firstDelivery: true },
  subject: 'Kapsel angedockt — Lieferschein',
  body:
`Angedockt, Luke frei, Kram ist drin.

Zwei Hinweise aus der Praxis:

**Wasser ist schwer.** Ein Liter ist ein Kilo, und ein Kilo in den Orbit ist das Teuerste, was du bestellen kannst. Darum sitzt im Technikmodul ein Kondensator, der dir das Verdunstete zurückholt. Je besser der läuft, desto weniger muss ich fliegen. Investier da rein, im Ernst.

**Nährsalze sind leicht.** Ein Kilo Vollnährsalz reicht dir über Wochen. Bestell davon ruhig auf Vorrat, das tut nicht weh.

Übrigens, Marit hat mich gefragt, ob du „kooperativ" bist. Ich habe gesagt: keine Ahnung, er redet ja nur mit Pflanzen. War ein Scherz. Halb.`,
  sig: 'Tobi',
},

/* ══════════════════ WASSER & LICHT ══════════════════ */
{
  id: 'ayo_light', from: 'ayo', trigger: { level: 3 },
  subject: 'Brief Nr. 2 — Warum Licht eine Menge ist, keine Helligkeit',
  body:
`Liebe{r} {name},

Sie haben jetzt Lampen, die Sie regeln können, und damit die wichtigste Frage des ganzen Gartenbaus am Hals: Wie viel Licht ist genug?

Die Antwort ist nicht „hell". Die Antwort ist **DLI** — Daily Light Integral, das tägliche Lichtintegral. Man zählt dabei nicht Lumen (das misst, was das menschliche Auge sieht), sondern Photonen im Bereich 400–700 nm, also das, was Chlorophyll wirklich verwerten kann. Einheit: Mol Photonen pro Quadratmeter und Tag.

Rechnen Sie es so:

   **DLI = PPFD × Stunden × 3600 ÷ 1 000 000**

PPFD ist die Photonenstromdichte, die Ihre Lampe gerade liefert, in µmol/m²/s. Stellen Sie 250 ein und lassen 16 Stunden brennen, bekommt die Pflanze 14,4 mol/m²/Tag. Das ist exakt richtig für Salat.

Ein paar Richtwerte, die Sie sich merken sollten:

  Kresse, Wasabi:      6 mol   (Schattenpflanzen)
  Salat, Spinat:      14 mol
  Basilikum:          20 mol
  Tomate, Paprika:    22 mol
  Sonnenblume:        30 mol
  Zwergweizen:        40 mol

Und jetzt das Schöne: Die Pflanze zählt nur die Summe. Ob Sie ihr 14 mol in 8 Stunden bei hoher Leistung geben oder in 18 Stunden sanft — fast egal. *Fast.* Denn viele Pflanzen zählen zusätzlich die Länge der Nacht, und manche vertragen gar keine. Aber das ist Brief Nr. 3.

Herzlich`,
  sig: 'A. B.',
  reward: { xp: 60 },
},
{
  id: 'water_warn', from: 'sys', trigger: { waterLow: true, cooldownH: 20 },
  subject: '⚠ Wasservorrat unter 15 %',
  body:
`AUTOMATISCHE MELDUNG · SYSTEM LEBENSERHALTUNG

  Tankfüllstand:       kritisch
  Rückgewinnungsrate:  siehe Technikmodul
  Prognose:            Vorrat reicht nicht bis zum Ende der laufenden Kulturen

EMPFEHLUNG
  — Wasserfracht bestellen (Lieferzeit beachten)
  — oder Rückgewinnung ausbauen
  — oder Lichtleistung senken: weniger Licht, weniger Transpiration

HINWEIS: Bei vollständiger Entleerung stellen Kulturen die Photosynthese ein.
Welkepunkt tritt je nach Art nach wenigen Stunden ein.`,
  sig: 'HEDERA CORE · automatisch erzeugt',
},
{
  id: 'power_warn', from: 'sys', trigger: { powerLow: true, cooldownH: 20 },
  subject: '⚠ Energiebilanz negativ',
  body:
`AUTOMATISCHE MELDUNG · ENERGIEVERSORGUNG

  Akkuladung:   fallend
  Ursache:      Verbrauch übersteigt Solarertrag über den Umlauf gemittelt

Die Station durchläuft je Umlauf eine Schattenphase von bis zu 35 Minuten.
In dieser Zeit speist ausschließlich die Akkubank. Reicht die Kapazität nicht,
werden Lampen automatisch abgeregelt — mit entsprechendem Wachstumsverlust.

EMPFEHLUNG
  — Photoperiode kürzen oder PPFD senken
  — Akkukapazität erhöhen (Forschung: Pufferakku II)
  — Solarfläche erweitern (Forschung: Auslegerpaneele)`,
  sig: 'HEDERA CORE · automatisch erzeugt',
},

/* ══════════════════ BESTÄUBUNG ══════════════════ */
{
  id: 'pollen', from: 'ayo', trigger: { pollinationDue: true },
  subject: 'Brief Nr. 4 — Jetzt werden Sie zur Hummel',
  body:
`{name},

in Ihrem Gewächsraum steht eine blühende Pflanze, die Ihnen gerade eine Frage stellt, die im Orbit niemand sonst beantworten kann.

Auf der Erde erledigen das Insekten und Wind. Bei Ihnen gibt es weder das eine noch das andere. **Ohne Bestäubung keine Frucht.** Die Blüte verwelkt, fällt ab, die Pflanze hat wochenlang umsonst gearbeitet.

Für Tomaten müssen Sie wissen: Ihre Staubblätter sind zu einer Röhre verwachsen und geben den Pollen nur durch **Poren an der Spitze** ab, und zwar nur bei Erschütterung mit etwa **400 Hertz**. Hummeln beißen sich an der Blüte fest und lassen ihre Flugmuskulatur schwirren, ohne die Flügel zu bewegen — *buzz pollination*. Honigbienen beherrschen das nicht. Deshalb stehen in jedem Gewächshaus Europas Hummelvölker und keine Bienen.

Sie machen es mit dem Finger: an den Blütenstiel tippen, einmal, zweimal. Oder Sie bauen den Ventilator ein, wenn Sie ihn freigeschaltet haben.

Bei Erdbeeren ist es heikler. Jedes einzelne der gelben Körnchen auf der Frucht ist eine eigene kleine Nuss mit eigener Narbe, und jede muss bestäubt werden. Wird eine Seite übersehen, wächst das Fleisch dort nicht mit — daher die schiefen Erdbeeren aus dem Supermarkt. Das ist fast nie Düngermangel. Das sind fehlende Bienen.

Und Vanille: Die Blüte öffnet sich **einen einzigen Vormittag**. Wer sie verpasst, wartet ein Jahr.`,
  sig: 'A. B.',
  reward: { xp: 90 },
},

/* ══════════════════ AUSBAU ══════════════════ */
{
  id: 'lvl4_hydro', from: 'marit', trigger: { level: 4 },
  subject: 'Freigabe: Hydroponik-Modul',
  body:
`{name},

die Kommission hat getagt. Ihre Ertragskurve rechtfertigt den nächsten Schritt: Das **Hydroponik-Modul** ist zum Ausbau freigegeben. Acht Plätze in Nährfilmtechnik.

Zum Verfahren, weil Sie es verstehen sollten, bevor Sie es bestellen: Bei NFT — *Nutrient Film Technique* — steht keine Pflanze in Erde. Ein millimeterdünner Film Nährlösung läuft ununterbrochen durch eine leicht geneigte Rinne, die Wurzeln liegen darin. Entscheidend ist, dass die **Oberseite der Wurzeln an der Luft bleibt**: Wurzeln atmen. Eine ertränkte Wurzel stirbt schneller als eine vertrocknete.

Vorteil: etwa 90 % weniger Wasser als Freiland, kein Substrat, keine Bodenkrankheiten.
Nachteil: Fällt die Pumpe aus, haben Sie nicht Tage Zeit, sondern Stunden.

Ich empfehle außerdem, in die Wasserrückgewinnung zu investieren, bevor Sie die Fläche verdoppeln. Die Zahlen werden Ihnen sonst um die Ohren fliegen.`,
  sig: 'M. Lindqvist',
  reward: { credits: 1200 },
},
{
  id: 'lena1', from: 'lena', trigger: { day: 6 },
  subject: 'ich hab dich gesehen',
  body:
`hey du,

ich war gestern abend mit paul draußen, so gegen halb zehn, und wir haben nach oben geguckt weil in der app stand du kommst vorbei. und dann kam dieser punkt. kein blinken, kein flugzeug, einfach ein sehr ruhiger heller punkt der in vier minuten quer über den ganzen himmel gezogen ist.

paul hat gefragt ob da wirklich jemand drin ist und ich hab gesagt ja, mein bruder, und dann hab ich ein bisschen geheult, war mir egal.

schreib mal wie es ist. nicht die offizielle version, die les ich eh auf der agentur-seite. ich meine wie es wirklich ist. isst du genug. redest du mit dir selbst.

mama fragt ob du die blumen kriegst die sie dir schicken wollte. ich hab ihr erklärt dass das nicht so einfach geht. sie fragt trotzdem weiter.

hab dich lieb, du idiot.
L.`,
  sig: '',
  reward: { mood: 2 },
},
{
  id: 'ayo_liebig', from: 'ayo', trigger: { level: 5 },
  subject: 'Brief Nr. 6 — Das Fass mit der kürzesten Daube',
  body:
`{name},

Sie haben inzwischen genug Pflanzen gesehen, um die wichtigste Regel selbst bemerkt zu haben. Ich gebe ihr nur den Namen.

**Liebigs Minimumgesetz**, 1855: Das Wachstum richtet sich nicht nach dem Mittel aller Faktoren, sondern allein nach dem **knappsten**. Justus von Liebig hat dafür das Bild vom Fass geprägt: Ein Fass aus Dauben unterschiedlicher Länge fasst genau so viel, wie die kürzeste Daube hoch ist. Sie können die anderen Dauben verlängern, so viel Sie wollen — es läuft trotzdem an derselben Stelle über.

Praktisch heißt das: Wenn Ihre Tomate zu wenig Licht bekommt, bringt doppelter Dünger *nichts*. Nicht wenig — nichts. Und schlimmer, überschüssige Salze ziehen der Wurzel osmotisch das Wasser aus. Die Pflanze verdurstet mitten in der Nährlösung.

Suchen Sie also immer die kürzeste Daube. Licht, Wasser, Nährsalze, Temperatur, CO₂, pH-Wert — es ist immer genau einer davon, der bremst. Ihre Anzeigen an jedem Anbauplatz sagen Ihnen, welcher.

Und wenn alles stimmt und es *trotzdem* nicht läuft, dann ist es die Temperatur. Es ist erstaunlich oft die Temperatur.`,
  sig: 'A. B.',
  reward: { xp: 120 },
},
{
  id: 'eclipse_free', from: 'nour', trigger: { eclipseFree: true },
  subject: 'Hochbeta — Sie haben jetzt Dauersonne',
  body:
`Kurzer Hinweis aus der Flugleitung, bevor Sie sich wundern:

Ihre Bahnebene hat gerade einen **Betawinkel über 66°**. Das ist der Winkel zwischen Ihrer Bahnebene und der Richtung zur Sonne. Übersteigt er diesen Grenzwert, taucht die Station auf ihrer Bahn **überhaupt nicht mehr in den Erdschatten**. Keine Nacht mehr. Tagelang.

Für Sie heißt das:
  — **Volle Solarleistung rund um die Uhr.** Die Akkus werden entlastet.
  — Die Station wird wärmer, weil die Radiatoren durchgehend gegen Sonneneinstrahlung arbeiten.
  — Und psychologisch: kein Sonnenuntergang mehr. Manche finden das großartig. Manche werden davon seltsam.

Der Effekt hält ein paar Tage an, dann wandert die Bahnebene weiter und die Schattenphasen kommen zurück. Der ganze Zyklus dauert etwa **zweieinhalb Monate**.

Nutzen Sie die Zeit. Jetzt ist der Moment für die stromhungrigen Kulturen.`,
  sig: 'N. Haddad',
},
{
  id: 'tobi_joke', from: 'tobi', trigger: { day: 11 },
  subject: 'Frage von der Konsole',
  body:
`Mal was Ernstes zwischendurch:

Die Kollegen hier unten wetten, wie lange du durchhältst, bevor du anfängst, den Pflanzen Namen zu geben. Mein Tipp war Tag 9. Ich habe verloren, oder? Du hast es an Tag 4 gemacht.

Kein Urteil. Der Schotte, der vor dir oben war, hat seinen Basilikumtöpfen eine komplette Fußballaufstellung zugewiesen und sich beschwert, als „Torwart" eingegangen ist.

Ach so, fachlich, damit das hier durch die Freigabe geht: Falls dir mal eine Kultur eingeht — **sofort rausnehmen**. Totes Pflanzenmaterial in einem geschlossenen, feuchten Kreislauf ist eine Schimmelbrutstätte, und Schimmelsporen in einer Station, aus der man nicht rausgehen kann, sind kein Spaß. Auf der ISS hatten sie 2016 Fusarium im Veggie-System, eingeschleppt über das Saatgut. Seitdem wird alles vorher bestrahlt.

Gruß nach oben.`,
  sig: 'Tobi',
},

/* ══════════════════ ZWISCHENBILANZ ══════════════════ */
{
  id: 'eval30', from: 'marit', trigger: { day: 30 },
  subject: 'Zwischenbewertung Tag 30',
  body:
`{name},

ein Drittel der Probephase liegt hinter Ihnen. Die Kommission hat Ihre Daten gesichtet.

Ich sage es, wie es ist: Die Zahlen sind besser als bei Ihren beiden Vorgängern zum selben Zeitpunkt. Das ist erfreulich und es ist auch kein Grund, sich zurückzulehnen — die zweite Hälfte einer Isolationsmission ist die schwierigere. Das ist psychologisch gut belegt und gilt auch für Leute, die es besser wissen.

Zur Sache: Wir würden gern die **Bandbreite** erweitert sehen. Blattgemüse und Wurzeln haben Sie im Griff. Was in der Akte fehlt, sind Fruchtkulturen über einen vollständigen Zyklus und — die Kommission hat ausdrücklich danach gefragt — **Zierpflanzen**.

Dazu ein Wort, das nicht im Protokoll landet: Die Zierpflanzen stehen nicht aus Ertragsgründen auf der Liste. Es gibt eine ganze Reihe von Untersuchungen dazu, angefangen bei den sowjetischen Langzeitbesatzungen auf der Saljut, und alle sagen dasselbe: Besatzungen, die etwas Blühendes im Blickfeld haben, halten länger durch. Die ISS hat 2016 nicht aus Sentimentalität eine Zinnie gezogen.

Bauen Sie Blumen an, {name}. Es ist Teil des Auftrags.`,
  sig: 'M. Lindqvist',
  reward: { credits: 2500, xp: 200, seeds: { zinnie: 2 } },
},
{
  id: 'ayo_zinnia', from: 'ayo', trigger: { harvest: 'zinnie' },
  subject: 'Brief Nr. 9 — Die erste Blume im Orbit',
  body:
`Sie haben eine Zinnie zum Blühen gebracht. Erlauben Sie mir, dass ich das kurz würdige.

Am 16. Januar 2016 hat Scott Kelly auf der ISS ein Foto getwittert: eine orangefarbene Zinnie vor dem Fenster der Cupola, dahinter die Erde. Es war die erste Blüte, die im Orbit aufgegangen ist.

Was das Foto nicht zeigt: Das Experiment war zwei Wochen vorher praktisch tot. In Schwerelosigkeit tropft Gießwasser nicht ab — es bleibt als Film an Blättern und Stängeln kleben. Darin wuchs Schimmel. Zwei Pflanzen mussten entsorgt werden, der Rest stand mit gekrümmten Blättern da.

Kelly hat dann etwas getan, das in der Raumfahrt selten ist: Er hat sich über das Protokoll hinweggesetzt. Er hat die Bodenstation gebeten, ihm die Bewässerung freizugeben, weil er — Zitat — sehen könne, was die Pflanzen brauchten, und die Leute in Houston eben nicht. Er bekam die Freigabe. Die NASA nannte es danach intern „autonomous gardening".

Ich erzähle Ihnen das, weil es der Kern unseres Fachs ist. Sie können jede Kennzahl messen. Am Ende entscheidet trotzdem, ob Sie *hinsehen*.`,
  sig: 'A. B.',
  reward: { xp: 150, credits: 400 },
},
{
  id: 'death1', from: 'ayo', trigger: { death: true, cooldownH: 40 },
  subject: 'Es ist eine eingegangen',
  body:
`Ich sehe es in der Telemetrie. Lassen Sie mich Ihnen etwas sagen, bevor Sie sich ärgern.

Ich habe in vierzig Jahren mehr Pflanzen umgebracht als die meisten Menschen je besessen haben. Jede einzelne davon hat mir etwas beigebracht, was mir keine Messreihe beigebracht hätte. Eine tote Pflanze ist ein Datenpunkt, kein Versagen.

Gehen Sie nur der Frage nach, welche **Daube die kürzeste** war. War es Wasser? Dann hätten die Blätter vorher geschlappt und sich nach dem Gießen erholt. War es Licht? Dann wären die Triebe lang, dünn und blass geworden — Etiolement, die Pflanze streckt sich verzweifelt der Lichtquelle entgegen. War es Salz? Dann hätten die Blattränder braune, trockene Spitzen bekommen, von außen nach innen.

War es Wurzelfäule, hat sie von unten gestunken. Das merkt man sofort und man vergisst es nie wieder.

Und nun: rausnehmen, Platz reinigen, neu bestellen. Schimmel in einem geschlossenen System ist das einzige Problem, das Sie wirklich nicht wollen.`,
  sig: 'A. B.',
},
{
  id: 'lvl8_vertical', from: 'marit', trigger: { level: 8 },
  subject: 'Vertikalfarm freigegeben',
  body:
`{name},

Ihre Daten haben die Kommission überzeugt. Das große Modul ist freigegeben: die **Vertikalfarm**, achtzehn Plätze auf sechs Ebenen.

Die Rechnung dahinter, kurz: Eine vertikale Anlage erreicht je Quadratmeter Grundfläche das Zehn- bis Zwanzigfache eines Feldes. Der Haken ist die Energie. Unten ist Sonnenlicht gratis; in einer geschlossenen Halle bezahlen Sie jedes Photon einzeln, und der Strom ist der mit Abstand größte Posten jeder vertikalen Farm auf der Erde. Deshalb sind dort weltweit mehr Betreiber pleitegegangen als geblieben.

Hier oben ist die Rechnung eine andere: Die Sonne scheint 24 Stunden lang, Sie sammeln sie mit Paneelen und stecken sie in Ihre Lampen. Kein Wetter, keine Nacht, kein Winter. Ob das jemals wirtschaftlich wird, ist genau die Frage, für die diese Station gebaut wurde.

Prüfen Sie vorher Ihre Energiebilanz. Achtzehn Plätze unter voller Leistung sind mehr, als Ihre gegenwärtige Solarfläche trägt.`,
  sig: 'M. Lindqvist',
  reward: { credits: 5000, xp: 400 },
},
{
  id: 'lvl10_dome', from: 'marit', trigger: { level: 10 },
  subject: 'Die Kuppel',
  body:
`{name},

es gibt ein Modul, das seit dem Bau der Station in einem Lagerhaus in Bremen steht, weil niemand es je genehmigt bekommen hat. Sie haben es jetzt genehmigt bekommen.

Das **Kuppelgewächshaus**: eine begehbare Glashalbkugel an der Zenitseite, zwölf Plätze im ungefilterten Sonnenlicht. Kein Kunstlicht, keine Stromkosten. Die Solarkonstante liegt bei **1361 W/m²** — ohne Atmosphäre dazwischen. Das ist mehr Licht, als irgendeine Kulturpflanze der Erde je gesehen hat.

Drei Einschränkungen, die Sie ernst nehmen müssen:

1. Im Erdschatten ist es dort **stockdunkel**. Je nach Betawinkel bis zu 35 Minuten pro Umlauf.
2. Ohne Atmosphäre kommt **UV-C** durch, das unten vollständig von der Ozonschicht geschluckt wird. Das Glas ist beschichtet, aber die Beschichtung altert.
3. Es wird die Ingenieure nervös machen. Eine Druckkuppel aus Glas ist genau das, was in jeder Risikoanalyse rot markiert wird.

Bauen Sie sie trotzdem. Ich habe die Unterschrift schon geleistet.`,
  sig: 'M. Lindqvist',
  reward: { credits: 8000, xp: 600 },
},
{
  id: 'eval60', from: 'marit', trigger: { day: 60 },
  subject: 'Tag 60 — und eine persönliche Anmerkung',
  body:
`{name},

zwei Drittel. Die Zahlen brauche ich Ihnen nicht vorzulegen, Sie kennen sie besser als ich.

Etwas anderes. Sie haben nie gefragt, warum ausgerechnet ich dieses Programm leite, und ich erzähle es Ihnen jetzt, weil wir gerade an der Stelle sind, an der ich damals war.

Ich war 2019 selbst oben. Nicht auf Hedera, die gab es noch nicht — auf der ISS, 197 Tage. Ich war Ingenieurin, nicht Botanikerin, und ich habe das Veggie-System betreut, weil es sonst niemand machen wollte. Am Tag 130 ging mir ein Salat ein, an einem Wochenende, aus einem albernen Grund — ich hatte den Docht falsch gesteckt.

Ich habe deswegen in einem Modul der wertvollsten Immobilie der Menschheit gesessen und geweint. Über einen Salat.

Die Psychologen hatten dafür einen Fachbegriff parat, den ich schlecht fand. Ich glaube, es war einfacher: Es war das Einzige dort oben, das lebendig war und auf mich angewiesen. Alles andere in dieser Station war Technik, die auch ohne mich funktioniert hätte.

Ich erzähle das nicht, damit Sie sich Sorgen um mich machen. Ich erzähle es, damit Sie wissen: Wenn Sie das oben bemerken — es ist kein Fehler in Ihnen. Es ist der Punkt, an dem das Programm anfängt zu funktionieren.

Noch dreißig Tage. Dann reden wir über die Verlängerung.`,
  sig: 'Marit',
  reward: { credits: 6000, xp: 500 },
},
{
  id: 'eval90', from: 'marit', trigger: { day: 90 },
  subject: 'Die Probephase ist beendet',
  body:
`{name},

die Kommission hat heute Vormittag getagt. Ich fasse mich kurz, weil das Ergebnis kurz ist:

**Hedera wird weitergeführt. Unbefristet.**

Ihre Anbaufreigabe gilt ab sofort ohne Auflagen. Das Ausbaubudget ist verdreifacht. Und die Agentur hat der Verlängerung Ihres Aufenthalts zugestimmt, solange Sie sie wollen — Sie sind ab heute keine Probandin, kein Proband mehr, sondern **Leitung der Station**.

Was jetzt anfängt, ist der eigentlich interessante Teil. Wir wollen wissen, wie weit das geht. Kaffee im Orbit. Vanille. Ein tragender Apfelbaum in einer Glaskuppel über dem Pazifik. Nichts davon ist wirtschaftlich zu rechtfertigen, und genau deshalb macht es niemand außer uns.

Eine letzte Sache, dienstlich: Die Station braucht einen Namen für das Kuppelmodul. Die Tradition sieht vor, dass die Besatzung ihn vergibt. Nehmen Sie sich Zeit damit.

Ich bin froh, dass Sie das gemacht haben.`,
  sig: 'Marit Lindqvist\nProgrammleitung — und, wenn Sie wollen, irgendwann mal per Du',
  reward: { credits: 20000, xp: 2000 },
},

/* ══════════════════ AYO-BRIEFE (fortlaufende Reihe) ══════════════════ */
{ id: 'ayo_s1', from: 'ayo', series: true,
  subject: 'Brief — Warum Wurzeln nach unten wachsen (und im Orbit nicht)',
  body:
`Eine Frage, die Ihnen dort oben täglich begegnet, unten aber nie jemand stellt: Woher weiß eine Wurzel, wo unten ist?

Die Antwort steckt in der Wurzelspitze, in Zellen namens **Statozyten**. Darin liegen schwere, stärkegefüllte Körnchen — Statolithen —, die einfach nach unten sinken. Wo sie liegen bleiben, löst die Zelle eine Umverteilung des Wachstumshormons **Auxin** aus. Auxin hemmt in der Wurzel die Streckung. Die Unterseite wächst also langsamer als die Oberseite, und die Wurzel biegt sich nach unten.

Im Orbit sinkt nichts. Die Statolithen schweben, das Signal bleibt aus — und die Wurzel wächst zunächst in jede Richtung. Deshalb sahen die ersten Wurzelexperimente auf der Mir aus wie zerknüllte Wolle.

Und dann kam die Überraschung: Die Wurzeln fanden trotzdem ihr Ziel. Experimente auf der ISS haben gezeigt, dass sie einem **Feuchtigkeitsgradienten** folgen — Hydrotropismus. Der Mechanismus war immer da; auf der Erde wird er nur von der Schwerkraft übertönt.

Ihre Station hat künstliche Schwerkraft, also sehen Sie das nicht. Aber es beruhigt mich, dass es diesen zweiten Sinn gibt. Pflanzen haben immer einen Plan B.`,
  sig: 'A. B.', reward: { xp: 70 } },

{ id: 'ayo_s2', from: 'ayo', series: true,
  subject: 'Brief — Der pH-Wert ist keine Laune',
  body:
`Sie haben an jedem Anbauplatz eine pH-Anzeige und wahrscheinlich fragen Sie sich, warum die so eng geführt wird.

Der pH-Wert im Wurzelmedium entscheidet nicht, ob Nährstoffe **vorhanden** sind, sondern ob sie **löslich** sind. Und diese Löslichkeit verhält sich für jedes Element anders.

Im Bereich **5,5 bis 6,5** ist alles gleichzeitig verfügbar. Das ist der schmale Korridor, in dem der Gartenbau arbeitet.

Darüber, ab etwa pH 7, fällt Eisen als unlösliches Hydroxid aus. Die Pflanze steht in eisenreichem Substrat und hungert trotzdem — junge Blätter werden gelb, die Blattadern bleiben grün. Das nennt man Chlorose, und es ist das häufigste Mangelbild der Welt.

Darunter, unter pH 5, wird Aluminium löslich und vergiftet die Wurzelspitzen. Mangan ebenso.

Zwei Ausnahmen, die Sie oben brauchen werden: Die **Venusfliegenfalle** will pH 4 bis 5 und praktisch salzfreies Wasser — sie stammt aus nährstoffarmen Mooren und verbrennt an normalem Leitungswasser. **Safran** umgekehrt verträgt bis pH 8.

Die Pflanze düngt sich übrigens selbst am pH-Wert vorbei: Wurzeln geben Protonen ab, um ihre unmittelbare Umgebung anzusäuern. Aber das reicht nur für wenige Millimeter.`,
  sig: 'A. B.', reward: { xp: 70 } },

{ id: 'ayo_s3', from: 'ayo', series: true,
  subject: 'Brief — Was eigentlich in einer Pflanze verbrannt wird',
  body:
`Ein verbreiteter Irrtum, auch unter Studierenden: Die Pflanze „ernährt sich vom Boden".

Wiegen Sie einen Baum. Wiegen Sie die Erde im Topf davor und danach. Die Erde nimmt kaum ab. Woher kommt also die Masse?

**Aus der Luft.** Rund 95 % der Trockenmasse jeder Pflanze sind Kohlenstoff, Sauerstoff und Wasserstoff — aus CO₂ und Wasser. Ihr Salat baut sich buchstäblich aus Luft und Wasser zusammen. Die Nährsalze, über die wir so viel reden, machen die letzten 5 % aus: Stickstoff für Proteine und Chlorophyll, Phosphor für die Energiewährung ATP, Kalium für den Wasserhaushalt der Zellen.

Jan Baptist van Helmont hat das um 1640 herausgefunden, mit einem fünf Jahre lang in gewogener Erde gezogenen Weidenbaum. Er zog die falsche Schlussfolgerung — er hielt Wasser für die alleinige Quelle, CO₂ kannte man noch nicht —, aber die Messung war korrekt und hat alles ins Rollen gebracht.

Deshalb bringt Ihnen die CO₂-Anreicherung so viel, und deshalb ist Ihr Nährsalzverbrauch so klein gegenüber Ihrem Wasserverbrauch. Sie füttern keine Pflanze. Sie stellen ihr Licht, Luft und Wasser hin und halten sich raus.`,
  sig: 'A. B.', reward: { xp: 80 } },

{ id: 'ayo_s4', from: 'ayo', series: true,
  subject: 'Brief — Warum Ihre Lampen nicht lila sein müssen',
  body:
`Sie haben vielleicht Bilder von Vertikalfarmen gesehen, in denen alles in magentafarbenem Licht steht. Dahinter steckt eine halbrichtige Überlegung.

Chlorophyll a und b haben ihre Absorptionsmaxima im **Blauen (ca. 440 nm)** und im **Roten (ca. 660 nm)**. Grünes Licht wird überwiegend reflektiert — deshalb sehen Blätter grün aus. Der naheliegende Schluss: Man spart Energie, wenn man nur Blau und Rot anbietet. Daher das Lila.

Nur stimmt der Schluss nicht ganz. Grünes Licht wird zwar von den obersten Zellschichten schlechter absorbiert — genau deshalb dringt es **tiefer ins Blatt und tiefer in den Bestand** ein und treibt dort noch Photosynthese, wo Rot und Blau längst aufgebraucht sind. In dichten Beständen tragen die unteren Blätter spürbar zum Ertrag bei, und die leben von Grün.

Dazu kommt ein sehr praktischer Punkt: Unter magentafarbenem Licht können **Sie** nicht erkennen, ob ein Blatt vergilbt, fleckig oder befallen ist. Die Diagnose per Auge ist im Gartenbau die schnellste, die es gibt.

Nehmen Sie also Weißlicht mit erhöhtem Rotanteil. Das ist heute auch der Industriestandard, aus genau diesen beiden Gründen.`,
  sig: 'A. B.', reward: { xp: 80 } },

{ id: 'ayo_s5', from: 'ayo', series: true,
  subject: 'Brief — Wind, den es bei Ihnen nicht gibt',
  body:
`Eine Sache, die in Ihrer geschlossenen Station leicht untergeht: Pflanzen brauchen Bewegung.

Der Fachbegriff ist **Thigmomorphogenese** — Gestaltbildung durch Berührung. Ein Stängel, der regelmäßig gebogen wird, lagert mehr Stützgewebe ein: kürzer, dicker, fester. Ein Stängel ohne jeden mechanischen Reiz bleibt lang, dünn und kippt unter dem eigenen Gewicht um, sobald er Früchte trägt.

Gärtner nutzen das seit Jahrhunderten, ohne es zu benennen: In Japan werden Reissetzlinge vor dem Auspflanzen mit einem Brett gestreichelt. In Gewächshäusern laufen Ventilatoren nicht nur wegen der Luftfeuchte.

Der zweite Grund für Luftbewegung ist unsichtbar und wichtiger. Um jedes Blatt liegt eine ruhende **Grenzschicht** feuchter Luft. Steht die Luft, sättigt sich diese Schicht mit Wasserdampf, die Transpiration kommt zum Erliegen — und mit ihr der Transportstrom, der Calcium in die Blattspitzen bringt. Das Ergebnis kennt jeder Tomatengärtner: **Blütenendfäule**. Schwarze, eingesunkene Stellen an der Fruchtunterseite. Fast immer wird dann Calcium gedüngt, obwohl reichlich vorhanden ist. Es fehlt nicht das Calcium. Es fehlt der Wasserstrom, der es dorthin trägt.

Also: Lassen Sie es wehen. Sanft, aber ständig.`,
  sig: 'A. B.', reward: { xp: 90 } },

{ id: 'ayo_s6', from: 'ayo', series: true,
  subject: 'Brief — Die drei Wege, Zucker zu machen',
  body:
`Sie bauen inzwischen sehr verschiedene Dinge an, und es lohnt sich zu wissen, dass sie das Grundgeschäft auf drei unterschiedliche Weisen betreiben.

**C3** — der Normalfall, 85 % aller Pflanzenarten. Salat, Weizen, Tomate, fast alles bei Ihnen. Das Enzym RuBisCO bindet CO₂ direkt. Sein Konstruktionsfehler: Es verwechselt CO₂ mit O₂, und je wärmer und trockener es wird, desto öfter. Das Ergebnis heißt Photorespiration und kostet bis zu einem Viertel der Ernte. Deshalb hilft CO₂-Anreicherung ausgerechnet C3-Pflanzen so viel — mehr CO₂ heißt weniger Verwechslung.

**C4** — Mais, Zuckerrohr, Hirse. Sie pumpen CO₂ aktiv in eine innere Kammer und halten es dort auf hoher Konzentration. RuBisCO verwechselt dann fast nichts mehr. Das kostet Energie, lohnt sich aber bei Hitze und starkem Licht. C4 ist mindestens 60-mal unabhängig voneinander entstanden — die Evolution hat diesen Trick immer wieder neu erfunden.

**CAM** — Ihre Orchidee, Kakteen, Ananas. Sie öffnen ihre Spaltöffnungen **nur nachts**, binden CO₂ als Apfelsäure und verarbeiten es tagsüber bei fest verschlossenen Poren. Dadurch verlieren sie kaum Wasser; sie wachsen dafür langsam. Eine Orchidee, die über Tage nicht gegossen wird, verliert deutlich weniger als ein Salat in einer Stunde.

Wenn Sie also Ihre Wasserbilanz aufstellen: Die Orchidee ist nicht genügsam, weil sie klein ist. Sie ist genügsam, weil sie nachts atmet.`,
  sig: 'A. B.', reward: { xp: 90 } },

{ id: 'ayo_s7', from: 'ayo', series: true,
  subject: 'Brief — Samen sind Zeitkapseln',
  body:
`Sie bestellen Saatgut, als wäre es Material. Es ist etwas anderes.

Ein Samen ist ein vollständiger Embryo mit Proviant, der seinen Stoffwechsel fast vollständig anhält. Wassergehalt unter 10 %, Atmung kaum messbar. In diesem Zustand hält er es erstaunlich lange aus — und die Rekorde sind unheimlich:

Aus Samen der Dattelpalme, gefunden in der Festung **Masada** und auf rund 2000 Jahre datiert, wuchs 2005 ein Baum. Man hat ihn Methusalem genannt. Aus im sibirischen Permafrost eingefrorenem Gewebe von *Silene stenophylla* haben russische Forschende 2012 Pflanzen regeneriert; das Material war über **30 000 Jahre** alt.

Deshalb gibt es den Saatgut-Tresor auf **Spitzbergen**: über eine Million Proben bei −18 °C im Berg, als Rückversicherung der Menschheit. Er wurde bereits einmal in Anspruch genommen — von Syrien, nachdem die Genbank in Aleppo im Krieg verloren ging.

Was Sie oben interessieren sollte: Keimfähigkeit sinkt mit Wärme und Feuchte. Die Faustregel der Saatgutlagerung lautet, dass die Summe aus Temperatur in °F und relativer Luftfeuchte in % unter 100 bleiben soll. Kühl und trocken. Ihre Samenbank kann das.`,
  sig: 'A. B.', reward: { xp: 90 } },

{ id: 'ayo_s8', from: 'ayo', series: true,
  subject: 'Brief — Wie eine Pflanze weiß, dass es Herbst ist',
  body:
`Eine Frage, die Sie oben ganz praktisch stellen müssen, weil es bei Ihnen keinen Herbst gibt.

Pflanzen messen die Jahreszeit über die Tageslänge — genauer gesagt über die **Länge der ununterbrochenen Dunkelheit**. Das Messinstrument ist ein Pigment namens **Phytochrom**, das in zwei Formen existiert und zwischen ihnen hin- und herklappt: Rotes Licht schaltet es in die aktive Form, dunkelrotes Licht und langsame Umwandlung im Dunkeln zurück.

Der entscheidende Versuch stammt aus den 1940ern. Man unterbrach die Nacht einer Kurztagpflanze mit einem **einzigen Lichtblitz von wenigen Minuten** — und sie blühte nicht. Die lange Nacht war „gelöscht". Umgekehrt half es nicht, den Tag zu unterbrechen. Gezählt wird die Dunkelheit.

Für Sie bedeutet das konkret:
  — **Spinat, Salat** sind Langtagpflanzen: über etwa 13 h Licht schießen sie in Blüte.
  — **Chrysantheme, Soja, Reis** sind Kurztagpflanzen: sie blühen erst, wenn die Nächte lang werden.
  — **Tomate, Gurke, Tagetes** sind tagneutral, denen ist es gleich.

Und was oft vergessen wird: Auch die Dunkelheit selbst hat eine Aufgabe. Viele Arten reparieren nachts ihre Photosysteme und verlagern Stärke aus den Blättern. Dauerlicht funktioniert nur bei Arten, die eigens darauf gezüchtet wurden — Ihr Zwergweizen 'Apogee' ist genau so ein Fall.`,
  sig: 'A. B.', reward: { xp: 100 } },

{ id: 'ayo_s9', from: 'ayo', series: true,
  subject: 'Brief — Der Geschmack ist der Rest',
  body:
`Eine Beobachtung, die Sie oben machen werden, sobald Sie Ihre eigenen Tomaten essen.

Der Zucker- und Säuregehalt einer Frucht wird nicht nur durch Nährstoffe bestimmt, sondern ganz erheblich durch **Stress**. Eine Tomate, die reichlich Wasser bekommt, wird groß, wässrig und fad. Dieselbe Sorte mit knapp gehaltener Bewässerung in der Reifephase bildet weniger Fruchtfleisch, aber dieselbe Menge Zucker — die Konzentration steigt. Das ist das Prinzip hinter den teuren japanischen Tomaten und hinter jedem guten Weinberg: Ein Rebstock im Luxus macht mittelmäßigen Wein.

Bei Chili ist es die Schärfe, die unter Trockenstress steigt. Bei Rucola die Senföle. Bei Karotten umgekehrt: Stress macht sie holzig und bitter, dort wollen Sie Gleichmäßigkeit.

Und dann die andere Hälfte: **Aroma ist flüchtig.** Eine Tomate enthält über 400 flüchtige Verbindungen, von denen etwa 20 den Geschmack tragen. Die meisten entstehen erst in den letzten Reifetagen an der Pflanze und zerfallen im Kühlschrank binnen Tagen. Deshalb schmeckt eine Supermarkttomate nach nichts — sie ist grün geerntet, weil nur so transportfähig, und der Rest ist Physik.

Sie haben oben den einzigen Vorteil, den niemand kaufen kann: null Transportweg. Ernten Sie reif. Essen Sie sofort.`,
  sig: 'A. B.', reward: { xp: 100 } },

{ id: 'ayo_s10', from: 'ayo', series: true,
  subject: 'Brief — Pflanzen reden miteinander',
  body:
`Zum Schluss dieser Reihe etwas, das noch vor dreißig Jahren als Esoterik galt und heute Lehrbuchstoff ist.

Wird eine Akazie von Antilopen befressen, erhöht sie binnen Minuten ihren Gerbstoffgehalt, bis das Laub ungenießbar wird. So weit, so bekannt. Das Auffällige: **Benachbarte Bäume tun es auch** — Bäume, die niemand angerührt hat. Der verletzte Baum gibt Ethylen und andere flüchtige Stoffe ab, die Nachbarn nehmen sie wahr und fahren vorsorglich ihre Abwehr hoch.

Unterirdisch ist es noch dichter. Über Mykorrhiza-Netze sind Bäume eines Waldes physisch verbunden; über diese Pilzfäden wandern Kohlenstoff, Stickstoff und Warnsignale. Suzanne Simard hat das mit markiertem Kohlenstoff nachgewiesen — große Bäume versorgen beschattete Jungpflanzen, und zwar bevorzugt ihre eigenen Nachkommen. Die Presse nennt es „Wood Wide Web", was übertrieben ist, aber die Richtung stimmt.

Und noch eines: Mais, dessen Wurzeln von Larven angefressen werden, setzt einen Duftstoff frei, der gezielt **räuberische Fadenwürmer** anlockt. Die Pflanze ruft Verstärkung.

Ich erzähle Ihnen das, weil Sie dort oben in einer sehr einsamen Position sind und vielleicht das Gefühl haben, allein mit Maschinen zu sein. Sie sind es nicht. Was in Ihren Tabletts steht, ist die komplizierteste Chemie, die wir kennen, und sie ist auf ihre Weise sehr beschäftigt.

Ihr alter Ayo`,
  sig: 'A. B.', reward: { xp: 120, credits: 500 } },
];

/* Zufällige, kurze Lebenszeichen — Würze zwischendurch. */
export const FLAVOR = [
  { from: 'tobi', subject: 'Zwischenstand', body: `Nix Wichtiges. Wollte nur sagen: Die Kapsel für nächste Woche ist gepackt, und ich habe dir eigenmächtig zwei Tüten Saatgut mehr reingelegt als bestellt. Nicht weitersagen.\n\nHier unten regnet es seit drei Tagen. Ich beneide dich.` },
  { from: 'tobi', subject: 'Frage aus der Kantine', body: `Streitfrage hier unten: Schmeckt Essen im Orbit anders?\n\nAntwort für dich, falls du es nicht selbst gemerkt hast: ja, und zwar nicht wegen der Schwerkraft, sondern weil die Flüssigkeitsverschiebung nach oben eine Dauerverstopfung der Nase verursacht. Das Meiste vom Geschmack ist Geruch. Deswegen kippen sich alle da oben literweise Sriracha drüber.\n\nSag Bescheid, wenn du Nachschub brauchst.` },
  { from: 'nour', subject: 'Kleiner Hinweis', body: `Sie ziehen in 40 Minuten über Mitteleuropa, sichtbar, Helligkeit etwa −3,4 mag. Falls jemand unten für Sie hochschaut — jetzt wäre der Moment, das durchzugeben.\n\nWir haben hier übrigens eine Wette laufen, wie lange Sie brauchen, bis Sie die Kuppel bauen. Ich habe auf früh gesetzt.` },
  { from: 'nour', subject: 'Trümmerwarnung — Entwarnung', body: `Zur Information, damit Sie es nicht aus dem Protokoll erfahren: Wir hatten heute Nacht ein Konjunktionsereignis auf dem Schirm. Ein Fragment einer 2007 abgeschossenen Wettersatelliten-Stufe, Vorbeiflugabstand 1,9 km.\n\nWir haben nichts unternommen, weil unterhalb der Schwelle. Ich sage es Ihnen trotzdem, weil ich es unfair fände, wenn Sie es nicht wüssten. In 600 km Höhe sind rund 12 000 katalogisierte Objekte unterwegs und schätzungsweise über hunderttausend, die zu klein zum Katalogisieren und groß genug zum Durchschlagen sind.\n\nSchlafen Sie gut. Wirklich, das ist statistisch gemeint.` },
  { from: 'lena', subject: 'kurz', body: `paul hat in der schule erzählt dass sein onkel im weltall wohnt und gemüse anbaut und die lehrerin hat ihm nicht geglaubt. er war sehr beleidigt.\n\nkannst du ihm ein foto schicken wo man dich und was grünes sieht? irgendwas mit blättern. er will es ausdrucken.\n\nund iss was ordentliches.` },
  { from: 'lena', subject: 'mama', body: `mama hat angefangen, auf dem balkon kresse zu ziehen. auf watte, in einer untertasse, wie in der grundschule.\n\nsie stellt sie jeden abend ans fenster und sagt dann sowas wie "na, wie läufts bei euch beiden". ich weiß nicht ob ich das rührend oder besorgniserregend finden soll. wahrscheinlich beides.\n\nsie fragt ob deine auch so schnell geht. ich hab gesagt zwanzigmal schneller und sie hat gesagt das sei unfair.` },
  { from: 'marit', subject: 'Kurz und dienstlich', body: `Die Bildauswertung Ihrer letzten Zyklen ist in den Quartalsbericht eingeflossen. Zwei Kolleginnen aus Wageningen haben nachgefragt, ob sie Ihre Daten für eine Veröffentlichung nutzen dürfen.\n\nIch habe vorläufig zugestimmt und Sie als Koautor eingetragen. Falls Sie damit nicht einverstanden sind, sagen Sie es in den nächsten Tagen.\n\nAnsonsten: weiter so.` },
  { from: 'ayo', subject: 'Nur eine Kleinigkeit', body: `Mir fiel heute beim Gießen etwas ein, das Sie amüsieren wird.\n\nDie Gurke, die Sie vielleicht gerade ziehen, hat eine Ranke, die beim Anfassen eines Stabes innerhalb von zwanzig Minuten anfängt, sich zu winden. Und zwar — sehen Sie einmal genau hin — in der Mitte mit **umgekehrtem Drehsinn**. Eine Hälfte dreht links, die andere rechts, dazwischen liegt ein Wendepunkt.\n\nDas ist keine Laune. Eine Ranke, die nur in eine Richtung dreht, könnte sich gar nicht verkürzen, weil die Pflanze sonst mitgedreht werden müsste. Mit dem Wendepunkt wird die Ranke zur Zugfeder: Sie zieht die Pflanze heran und federt Windstöße ab.\n\nCharles Darwin hat darüber 1875 ein ganzes Buch geschrieben. Es heißt "The Movements and Habits of Climbing Plants" und ist streckenweise komisch, weil man einem sehr berühmten Mann dabei zusieht, wie er wochenlang Ranken anstarrt.` },
  { from: 'ayo', subject: 'Eine Frage, die mich nicht loslässt', body: `Falls Sie oben gerade Zeit haben, ein Gedankenspiel.\n\nWie alt ist die älteste Pflanze der Welt? Die übliche Antwort sind die Grannenkiefern in Kalifornien, knapp 5000 Jahre. Aber das gilt nur, wenn man einen Stamm zählt.\n\nIn Utah steht eine Espenkolonie namens **Pando**: 47 000 Stämme, genetisch identisch, verbunden durch ein einziges Wurzelsystem. Ein Organismus. Die Schätzungen für sein Alter reichen von 14 000 bis weit über 80 000 Jahre. Er wiegt etwa 6000 Tonnen und gilt damit auch als eines der schwersten Lebewesen der Erde.\n\nEr ist gerade dabei zu sterben, übrigens. Die jungen Triebe werden von Hirschen abgefressen, weil die Wölfe fehlen.\n\nEntschuldigen Sie, ich wollte mit etwas Schönem enden und bin wieder bei der Traurigkeit gelandet. Berufskrankheit.` },
  { from: 'sys', subject: 'Wartungshinweis', body: `AUTOMATISCHE MELDUNG · BETRIEB\n\nUmlaufzähler erreicht Vielfaches von 1000.\nZurückgelegte Strecke seit Missionsbeginn wird im Technikmodul angezeigt.\n\nKeine Maßnahme erforderlich.\nFilterwechsel Umluft empfohlen (Routine).` },
];

export const MAIL_BY_ID = Object.fromEntries(MAILS.map(m => [m.id, m]));
export const SERIES = MAILS.filter(m => m.series).map(m => m.id);
