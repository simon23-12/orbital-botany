/*  Bestellkatalog. Jede Lieferung braucht Echtzeit (Standard 12 h). */

export const SUPPLIES = [
  { id: 'water50', cat: 'Verbrauch', name: 'Wasserfracht 50 L', icon: 'droplet', price: 260, mass: 50,
    desc: 'Entgastes Reinstwasser in Blasentanks. Ergänzt die Verluste, die die Aufbereitung nicht auffängt.',
    give: { water: 50 } },
  { id: 'water200', cat: 'Verbrauch', name: 'Wasserfracht 200 L', icon: 'droplet', price: 880, mass: 200, level: 3,
    desc: 'Großgebinde. Günstiger je Liter, braucht aber Tankkapazität.',
    give: { water: 200 } },
  { id: 'nutri500', cat: 'Verbrauch', name: 'Nährsalze 500 g', icon: 'flask', price: 180, mass: 0.5,
    desc: 'Vollnährsalz nach Hoagland-Rezeptur: Nitrat, Phosphat, Kalium plus Spurenelemente bis hin zu Molybdän.',
    give: { nutrients: 500 } },
  { id: 'nutri2000', cat: 'Verbrauch', name: 'Nährsalze 2 kg', icon: 'flask', price: 620, mass: 2, level: 3,
    desc: 'Vorratsgebinde für die großen Module.',
    give: { nutrients: 2000 } },
  { id: 'substrate', cat: 'Verbrauch', name: 'Substratpads (10 Stk.)', icon: 'grid', price: 150, mass: 1.2,
    desc: 'Gesinterte Tonpads mit Kapillarvlies. Ein Pad je Anbauplatz und Kultur.',
    give: { substrate: 10 } },
  { id: 'co2cart', cat: 'Verbrauch', name: 'CO₂-Patrone', icon: 'wind', price: 340, mass: 4, level: 5, needs: 'co2',
    desc: 'Hebt die Kohlendioxidkonzentration der Wuchsräume für mehrere Tage auf 1100 ppm.',
    give: { co2cart: 1 } },
  { id: 'beneficials', cat: 'Verbrauch', name: 'Nützlingskarte', icon: 'bug', price: 290, mass: 0.1, level: 3,
    desc: 'Raubmilben und Schlupfwespen auf Trägerkarte. Beendet einen Befall ohne Chemie.',
    give: { beneficials: 3 } },
];

/*  Komfort — steht sichtbar in der Lounge und bringt kleine dauerhafte Vorteile. */
export const COMFORT = [
  { id: 'blanket', cat: 'Komfort', name: 'Wolldecke', icon: 'couch', price: 320, mass: 1.4, level: 1,
    desc: 'Grob gewebt, schwer, riecht nach Zuhause. Liegt danach auf der Couch.',
    perk: 'Die Station fühlt sich weniger nach Labor an.', effect: { mood: 1 } },
  { id: 'coffeemaker', cat: 'Komfort', name: 'Espressomaschine', icon: 'coffee', price: 1400, mass: 6, level: 3,
    desc: 'Eine echte Siebträgermaschine, umgebaut für 400 ml Wasser im Kreislauf.',
    perk: 'Forschung läuft 12 % schneller.', effect: { research: 0.12, mood: 1 } },
  { id: 'record', cat: 'Komfort', name: 'Plattenspieler', icon: 'disc', price: 900, mass: 4, level: 2,
    desc: 'Magnetisch gelagert, damit die Nadel bei Manövern nicht springt.',
    perk: 'Schaltet zusätzliche Stücke im Soundtrack frei.', effect: { music: 1, mood: 1 } },
  { id: 'telescope', cat: 'Komfort', name: 'Spektiv am Fenster', icon: 'telescope', price: 2200, mass: 9, level: 4,
    desc: 'Klein, aber gut: Vom Fenster aus erkennst du Wolkenstraßen, Blitzgewitter, nachts die Städte.',
    perk: 'Erdbeobachtung: gelegentliche Bonusgutschriften vom Erdbeobachtungsprogramm.', effect: { observe: 1, mood: 1 } },
  { id: 'bonsaishelf', cat: 'Komfort', name: 'Moosgarten-Schale', icon: 'sprout', price: 1800, mass: 3, level: 5,
    desc: 'Eine flache Schale mit Sternmoos und einem Stein aus Island.',
    perk: 'Moos ist der älteste Landpflanzen-Typ überhaupt. Beruhigt.', effect: { mood: 2 } },
  { id: 'lamp', cat: 'Komfort', name: 'Warmlichtleuchte', icon: 'lamp', price: 700, mass: 2, level: 2,
    desc: '2700 Kelvin. Nach 16 Sonnenaufgängen am Tag braucht das Auge irgendwann Abend.',
    perk: 'Macht die Lounge abends warm.', effect: { mood: 1 } },
  { id: 'cat', cat: 'Komfort', name: 'Stoffkatze „Laika"', icon: 'cat', price: 450, mass: 0.3, level: 2,
    desc: 'Ein Geschenk der Bodenmannschaft. Sitzt mit ernstem Blick auf der Fensterbank.',
    perk: 'Niemand weiß genau, warum das hilft.', effect: { mood: 2 } },
  { id: 'guitar', cat: 'Komfort', name: 'Reisegitarre', icon: 'music', price: 1100, mass: 2.4, level: 6,
    desc: 'Parlour-Größe, Nylonsaiten, damit die Halsspannung den Rahmen nicht verzieht.',
    perk: 'Chris Hadfield hatte auch eine.', effect: { mood: 2, music: 1 } },
];

export const CATALOG = [...SUPPLIES, ...COMFORT];
export const SHOP_BY_ID = Object.fromEntries(CATALOG.map(i => [i.id, i]));

/** Frachtkosten: pauschal plus Massenzuschlag — Startkosten sind real der größte Posten. */
export const FREIGHT_BASE = 40;
export const FREIGHT_PER_KG = 6;
export function freightFor(mass) { return Math.round(FREIGHT_BASE + FREIGHT_PER_KG * mass); }
