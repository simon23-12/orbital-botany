/*  Räume und Ausbaumodule der Station.
 *  `slots` = Anbauplätze à 0,25 m². `power` = Grundlast in Watt (ohne Lampen).
 */

export const MODULES = [
  {
    id: 'lounge', name: 'Lounge', short: 'Lounge', icon: 'couch', order: 1,
    slots: 0, power: 180, start: true, cost: 0, level: 1,
    desc: 'Couch, Panoramafenster, Ruhe. Von hier aus siehst du alle 96 Minuten einen Sonnenaufgang.',
  },
  {
    id: 'cupola', name: 'Cupola', short: 'Cupola', icon: 'cupola', order: 2,
    slots: 0, power: 60, start: true, cost: 0, level: 1,
    desc: 'Sechs trapezförmige Seitenfenster um eine runde Mittelscheibe. Der beste Platz der Station.',
    fact: 'Die Cupola der ISS wurde 2010 von der ESA geliefert. Ihr Mittelfenster misst 80 cm im Durchmesser und ist damit das größte, das je ins All geflogen ist. Jede Scheibe besteht aus vier Lagen Quarzglas mit einer Schutzscheibe davor, die Mikrometeoriten abfangen soll — und Aluminium-Fensterläden schützen sie, wenn niemand hinsieht.',
  },
  {
    id: 'grow_a', name: 'Gewächsraum A', short: 'Wuchs A', icon: 'sprout', order: 3,
    slots: 4, power: 120, start: true, cost: 0, level: 1,
    desc: 'Vier Tabletts unter LED-Panels. Der ursprüngliche Versuchsaufbau aus der Probephase.',
    expand: [
      { slots: 2, cost: 900, level: 2, name: 'Zweites Regalbord' },
      { slots: 2, cost: 2600, level: 4, name: 'Drittes Regalbord' },
    ],
  },
  {
    id: 'lab', name: 'Labor', short: 'Labor', icon: 'flask', order: 4,
    slots: 0, power: 260, start: true, cost: 0, level: 1,
    desc: 'Mikroskop, Spektrometer, Nährlösungsbank. Hier läuft die Forschung.',
  },
  {
    id: 'systems', name: 'Technik', short: 'Technik', icon: 'gauge', order: 5,
    slots: 0, power: 340, start: true, cost: 0, level: 1,
    desc: 'Wasseraufbereitung, Akkubank, Atmosphärenregelung. Das Herz der Lebenserhaltung.',
  },
  {
    id: 'cargo', name: 'Frachtschleuse', short: 'Fracht', icon: 'box', order: 6,
    slots: 0, power: 90, start: true, cost: 0, level: 1,
    desc: 'Andockpunkt für die Versorgungskapseln von Baikonur und Kourou.',
  },
  {
    id: 'hydro', name: 'Hydroponik-Modul', short: 'Hydro', icon: 'droplets', order: 7,
    slots: 8, power: 420, start: false, cost: 4800, level: 4, buildHours: 10,
    desc: 'Nährfilmtechnik in zwei Etagen. Wurzeln hängen in einem dünnen, ständig umgewälzten Nährlösungsfilm.',
    fact: 'NFT — Nutrient Film Technique — kommt mit wenigen Millimetern Lösung aus. Die Wurzeloberseite bleibt an der Luft, sonst würde sie ersticken.',
    expand: [{ slots: 4, cost: 5200, level: 6, name: 'Dritte Etage' }],
  },
  {
    id: 'mycology', name: 'Pilzkammer', short: 'Pilze', icon: 'mushroom', order: 8,
    slots: 6, power: 200, start: false, cost: 5600, level: 8, buildHours: 8,
    dark: true,
    desc: 'Dunkel, kühl, 95 % Luftfeuchte. Die einzige Kammer der Station ohne Lampen.',
    fact: 'Pilzkulturen sind auf Langzeitmissionen interessant, weil sie Pflanzenreste verwerten: aus Stroh und Blattabfall wird Protein.',
  },
  {
    id: 'vertical', name: 'Vertikalfarm', short: 'Vertikal', icon: 'layers', order: 9,
    slots: 18, power: 900, start: false, cost: 16500, level: 8, buildHours: 14,
    desc: 'Sechs Ebenen rotierender Anbautürme. Die dichteste Fläche der Station.',
    fact: 'Vertikale Systeme erreichen je Grundfläche das Zehn- bis Zwanzigfache eines Feldes — allerdings nur, weil man das Licht selbst bezahlt.',
    expand: [
      { slots: 6, cost: 12000, level: 10, name: 'Siebte Ebene' },
      { slots: 6, cost: 21000, level: 12, name: 'Achte Ebene' },
    ],
  },
  {
    id: 'dome', name: 'Kuppelgewächshaus', short: 'Kuppel', icon: 'dome', order: 10,
    slots: 12, power: 300, start: false, cost: 28000, level: 10, buildHours: 20,
    sunlit: true,
    desc: 'Eine begehbare Glaskuppel an der Zenitseite. Pflanzen wachsen hier im echten Sonnenlicht — solange die Station nicht im Erdschatten steht.',
    fact: 'Im freien Weltraum liefert die Sonne 1361 W/m² — die Solarkonstante. Unter Erdatmosphäre kommen davon höchstens 1000 W/m² an.',
    expand: [{ slots: 6, cost: 24000, level: 12, name: 'Erweiterter Ring' }],
  },
];

export const MOD_BY_ID = Object.fromEntries(MODULES.map(m => [m.id, m]));
export const GROW_MODULES = MODULES.filter(m => m.slots > 0 || m.expand);
