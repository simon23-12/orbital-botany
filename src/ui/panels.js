/*  Alle Panels der Oberfläche. */
import { el, $, $$, clear, num, compact, vol, watt, grams, dur, dateFull, missionDay, clamp, clamp01, esc, richText, HOUR, MIN, DAY } from '../core/util.js';
import { icon, plantSvg, plantIcon } from './icons.js';
import * as S from '../game/state.js';
import * as SIM from '../game/sim.js';
import * as A from '../game/actions.js';
import { PLANTS, BY_ID as PL, cycleMs, stageAt, stagesOf, pollenWindow, GROWTH_FACTOR, TRAY_AREA } from '../data/plants.js';
import { MODULES, MOD_BY_ID } from '../data/modules.js';
import { RESEARCH, RES_BY_ID, BRANCHES } from '../data/research.js';
import { CATALOG, SHOP_BY_ID, SUPPLIES, COMFORT, freightFor } from '../data/shop.js';
import { openMail, personOf, markAllRead, unread } from '../game/mail.js';
import { solar, PERIOD, V_ORB, ALT, A as ORBIT_A, BETA_CRIT, beta, EARTH_ANGULAR, HORIZON, distanceTravelled, orbits, eclipseFraction, groundTrack, groundHeading, regionAt, formatCoords } from '../core/orbit.js';
import { sfx } from '../audio/sfx.js';
import { exportFile, importText, wipe } from '../core/save.js';
import { music } from '../audio/music.js';

/* ───────────────────────── Grundgerüst ───────────────────────── */

function panel({ title, sub, icon: ic, wide, narrow, tabs, body, foot, onTab, active }) {
  const p = el('div', { class: 'panel' + (wide ? ' panel--wide' : '') + (narrow ? ' panel--narrow' : '') });
  const head = el('div', { class: 'panel__head' });
  if (ic) head.append(el('span', { html: icon(ic), style: { color: 'var(--leaf)', display: 'flex' } }));
  head.append(el('h2', { text: title }));
  if (sub) head.append(el('span', { class: 'sub', text: sub }));
  p.append(head);
  if (tabs?.length) {
    const t = el('div', { class: 'tabs' });
    for (const tab of tabs) {
      t.append(el('button', {
        class: 'tab' + (tab.id === active ? ' is-active' : ''),
        onclick: () => { sfx.click(); onTab(tab.id); },
        html: esc(tab.label) + (tab.count != null ? `<span class="cnt">${tab.count}</span>` : ''),
      }));
    }
    p.append(t);
  }
  const b = el('div', { class: 'panel__body' });
  b.append(...[body].flat().filter(Boolean));
  p.append(b);
  if (foot) p.append(el('div', { class: 'panel__foot' }, ...[foot].flat().filter(Boolean)));
  return p;
}

const hint = (text, kind = '') => el('div', { class: 'hint' + (kind ? ' hint--' + kind : ''), html: icon(kind === 'amber' ? 'alert' : kind === 'leaf' ? 'leaf' : 'info') + `<div>${text}</div>` });
const secT = t => el('div', { class: 'sec-t', text: t });
const kv = (k, v, tip) => el('div', { class: 'kv', 'data-tip': tip || null }, el('span', { text: k }), el('b', { html: v }));
const bar = (pct, color) => el('div', { class: 'bar' }, el('i', { style: { width: (clamp01(pct) * 100).toFixed(1) + '%', background: color || 'var(--leaf)' } }));

function emptyState(ic, title, text) {
  return el('div', { class: 'empty', html: icon(ic) + `<p><b>${esc(title)}</b></p><p>${text}</p>` });
}

/* ───────────────────────── LOUNGE ───────────────────────── */

export function lounge(app, arg, UI) {
  const st = app.st, now = Date.now();
  const sol = solar(now);
  const md = missionDay(now, st.t0);
  const orb = orbits(st.t0, now);
  const lvl = S.levelProgress(st);
  const body = [];

  body.push(el('div', { class: 'card', style: { background: 'linear-gradient(135deg,rgba(95,217,142,.10),rgba(79,214,255,.05))' } },
    el('div', { class: 'card__t' },
      el('h3', { text: `Missionstag ${md}` }),
      el('span', { class: 'chip chip--cyan', text: sol.lit ? 'Im Sonnenlicht' : 'Im Erdschatten' })),
    el('p', { class: 'card__d', html: `Du bist seit ${dur(now - st.t0)} an Bord und hast in dieser Zeit <b>${num(orb, 0)} Erdumrundungen</b> hinter dir — rund ${num(distanceTravelled(now - st.t0) / 1e6, 1)} Millionen Kilometer.` }),
    bar(lvl.pct),
    el('div', { class: 'kv' }, el('span', { text: `Stufe ${st.level}` }), el('b', { text: `${num(lvl.have)} / ${num(lvl.need)} EP` })),
  ));

  /* Aufgaben */
  const ready = st.slots.filter(s => s.plant && s.prog >= 1);
  const dead = st.slots.filter(s => s.dead);
  const thirsty = st.slots.filter(s => s.plant && !s.dead && s.moist < .3);
  const pollen = st.slots.filter(s => {
    if (!s.plant || s.dead || s.pollen) return false;
    const p = PL[s.plant]; if (!p?.pollinate) return false;
    const w = pollenWindow(p); return w && s.prog >= w[0];
  });
  const sick = st.slots.filter(s => s.sick);
  const tasks = [];
  if (ready.length) tasks.push(['ok', 'scissors', `${ready.length} Kultur${ready.length > 1 ? 'en' : ''} erntereif`, () => UI.doHarvestAll()]);
  if (thirsty.length) tasks.push(['warn', 'droplets', `${thirsty.length} Tablett${thirsty.length > 1 ? 's' : ''} braucht Wasser`, () => UI.doWaterAll()]);
  if (pollen.length) tasks.push(['warn', 'bee', `${pollen.length} Blüte${pollen.length > 1 ? 'n' : ''} wartet auf Bestäubung`, null]);
  if (sick.length) tasks.push(['bad', 'bug', `${sick.length}× Befall festgestellt`, null]);
  if (dead.length) tasks.push(['bad', 'trash', `${dead.length} Kultur eingegangen — Platz reinigen`, null]);
  if (unread(st)) tasks.push(['info', 'mail', `${unread(st)} ungelesene Nachricht${unread(st) > 1 ? 'en' : ''}`, () => UI.open('mail')]);
  if (st.research.active) {
    const r = st.research.active;
    tasks.push(['info', 'beaker', `${RES_BY_ID[r.id]?.name}: noch ${dur(r.endsAt - now, { short: true })}`, () => UI.open('research')]);
  }
  const arriving = st.orders.filter(o => !o.done);
  for (const o of arriving) tasks.push(['info', 'rocket', `Fracht dockt in ${dur(o.arrivesAt - now, { short: true })} an`, () => UI.open('shop')]);

  body.push(secT('An Bord zu tun'));
  if (!tasks.length) body.push(el('div', { class: 'card', style: { textAlign: 'center', padding: '1.4rem' } },
    el('p', { class: 'card__d', style: { margin: 0 }, text: 'Alles versorgt. Setz dich ans Fenster.' })));
  for (const [kind, ic, text, fn] of tasks) {
    body.push(el('button', {
      class: 'card', style: { width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '.7rem', cursor: fn ? 'pointer' : 'default' },
      onclick: fn || (() => {}),
    },
      el('span', { html: icon(ic), style: { color: `var(--${kind === 'ok' ? 'leaf' : kind === 'warn' ? 'amber' : kind === 'bad' ? 'bad' : 'cyan'})`, display: 'flex', flex: 'none' } }),
      el('span', { text, style: { flex: '1', fontSize: '.88rem' } }),
      fn ? el('span', { html: icon('check'), style: { opacity: .4, display: 'flex' } }) : null,
    ));
  }

  /* Blick nach draußen */
  body.push(secT('Blick aus dem Fenster'));
  const free = Math.abs(beta(now)) > BETA_CRIT;
  body.push(el('div', { class: 'card' },
    kv('Bahnhöhe', `${num(ALT)} km`, '<b>600 km</b>Niedriger Erdorbit. Die ISS fliegt bei rund 400 km.'),
    kv('Geschwindigkeit', `${V_ORB.toFixed(2)} km/s`, `<b>Bahngeschwindigkeit</b>= √(µ/r). Rund ${num(V_ORB * 3600, 0)} km/h — einmal um die Erde in ${(PERIOD / 60000).toFixed(0)} Minuten.`),
    kv('Umlaufzeit', `${(PERIOD / 60000).toFixed(1)} min`),
    kv('Sichtbarer Horizont', `${num(HORIZON, 0)} km`, '<b>Horizont</b>Von hier oben siehst du bis zu 2829 km weit — etwa von Madrid bis Moskau.'),
    kv('Winkeldurchmesser der Erde', `${EARTH_ANGULAR.toFixed(0)}°`, '<b>Die Erde füllt 132°</b>deines Blickfelds. Sie ist kein Ball am Himmel, sondern eine Wand aus Erde unter dir.'),
    kv('Betawinkel', `${beta(now).toFixed(1)}°` + (free ? ' · Dauersonne' : ''), `<b>Betawinkel</b>Winkel zwischen Bahnebene und Sonnenrichtung. Über ${BETA_CRIT.toFixed(0)}° gibt es keinen Erdschatten mehr.`),
    kv(sol.lit ? 'Sonnenuntergang in' : 'Sonnenaufgang in', free ? '—' : dur(sol.nextChange, { short: true })),
  ));

  /* Stimmung */
  const comfortNames = st.comfort.map(c => SHOP_BY_ID[c]?.name).filter(Boolean);
  body.push(secT('Persönliches'));
  body.push(el('div', { class: 'card' },
    el('p', { class: 'card__d', html: comfortNames.length
      ? `In der Lounge stehen inzwischen: <b>${comfortNames.join(', ')}</b>.`
      : 'Die Lounge ist noch ziemlich leer. Im Bestellkatalog gibt es unter <b>Komfort</b> Dinge, die das ändern.' }),
    el('button', { class: 'btn btn--sm', onclick: () => UI.open('shop', 'Komfort'), html: icon('box') + 'Katalog öffnen' }),
  ));

  return panel({
    title: 'Lounge', sub: 'Modul 3 · Aufenthalt', icon: 'couch', body,
    foot: [
      el('button', { class: 'btn btn--primary', onclick: () => UI.doHarvestAll(), html: icon('scissors') + 'Alles ernten' }),
      el('button', { class: 'btn', onclick: () => UI.doWaterAll(), html: icon('droplets') + 'Alles gießen' }),
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => UI.open('menu'), html: icon('settings') }),
    ],
  });
}

/* ───────────────────────── CUPOLA ───────────────────────── */

export function cupola(app, arg, UI) {
  const st = app.st, now = Date.now();
  const g = groundTrack(now);
  const region = regionAt(g.lat, g.lon);
  const sol = solar(now);
  const head = groundHeading(now);
  const compass = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(head / 45) % 8];
  const body = [];

  body.push(el('div', { class: 'card', style: { background: 'linear-gradient(135deg,rgba(79,214,255,.10),rgba(95,217,142,.04))' } },
    el('div', { class: 'card__t' },
      el('h3', { text: region }),
      el('span', { class: 'chip ' + (sol.lit ? 'chip--amber' : 'chip--violet'), text: sol.lit ? 'Tagseite' : 'Nachtseite' })),
    el('p', { class: 'card__d mono', style: { fontSize: '.82rem', margin: '.1rem 0 .6rem' }, text: formatCoords(g.lat, g.lon) }),
    kv('Kurs über Grund', `${head.toFixed(0)}° ${compass}`, '<b>Kurs</b>Bei 51,6° Bahnneigung läuft die Bodenspur als Welle über die Karte — nie über die Pole, dafür 16-mal am Tag herum.'),
    kv('Bodengeschwindigkeit', `${num(V_ORB * 3600 * (6371 / (6371 + ALT)), 0)} km/h`, '<b>Über Grund</b>Etwas langsamer als die Bahngeschwindigkeit, weil der Boden näher am Erdmittelpunkt liegt.'),
    kv(sol.lit ? 'Sonnenuntergang in' : 'Sonnenaufgang in', sol.nextChange === Infinity ? 'keiner — Dauersonne' : dur(sol.nextChange, { short: true })),
    kv('Nächster Überflug derselben Stelle', `${(PERIOD / 60000).toFixed(0)} min später, ${num(24.5, 1)}° weiter westlich`),
  ));

  /* Erdbeobachtung */
  const last = st.flags.lastPhoto || 0;
  const ready = now - last >= A.PHOTO_COOLDOWN;
  const scope = st.comfort.includes('telescope');
  body.push(secT('Erdbeobachtung'));
  body.push(el('div', { class: 'card' },
    el('p', { class: 'card__d', html: scope
      ? 'Mit dem Spektiv am Fenster lassen sich brauchbare Aufnahmen machen. Das Erdbeobachtungsprogramm vergütet sie.'
      : 'Aufnahmen aus dem Orbit sind für die Bodenstation bares Geld wert. Mit einem <b>Spektiv</b> aus dem Katalog deutlich mehr.' }),
    el('button', {
      class: 'btn btn--cyan btn--block', disabled: !ready,
      onclick: () => {
        const r = A.photograph(st, { region, lat: g.lat, lon: g.lon, lit: sol.lit });
        if (r.ok) { sfx.research(); UI.toast('ok', 'Aufnahme im Kasten', `${region} · +${num(r.credits)} Cr · +${num(r.xp)} EP`); app.save(); UI.render(); }
        else { sfx.error(); UI.toast('info', 'Noch nicht', r.msg); }
      },
      html: icon('eye') + (ready ? 'Aufnahme machen' : `wieder in ${dur(A.PHOTO_COOLDOWN - (now - last), { short: true })}`),
    })));

  const log = st.flags.photoLog || [];
  if (log.length) {
    body.push(secT(`Archiv · ${st.stats.photos || log.length} Aufnahmen`));
    const seen = new Set();
    for (const e of log.slice(0, 12)) {
      body.push(el('div', { class: 'kv' },
        el('span', { html: `${esc(e.region)} ${e.night ? '<span class="chip chip--violet">Nacht</span>' : ''}` }),
        el('b', { text: dateFull(e.at).split(',')[0] })));
      seen.add(e.region);
    }
  }

  body.push(hint('Die Cupola der ISS wurde 2010 von der ESA geliefert. Ihre Mittelscheibe misst 80 cm und ist das größte Fenster, das je ins All geflogen ist — vier Lagen Quarzglas, davor eine Opferscheibe gegen Mikrometeoriten. Wenn niemand hinsieht, schließen Aluminiumläden.', 'leaf'));

  return panel({
    title: 'Cupola', sub: 'Aussichtskuppel · 7 Fenster', icon: 'cupola', narrow: true, body,
    foot: [
      el('button', { class: 'btn btn--sm btn--ghost', onclick: () => UI.close(), html: icon('x') + 'Nur schauen' }),
      el('span', { style: { flex: 1 } }),
      el('span', { class: 'sub', text: `Umlauf ${num(orbits(st.t0, now), 0)}` }),
    ],
  });
}

/* ───────────────────────── GEWÄCHSRAUM ───────────────────────── */

export function grow(app, modId, UI) {
  const st = app.st;
  const def = MOD_BY_ID[modId];
  const slots = st.slots.filter(s => s.mod === modId);
  const lamp = S.lampOf(st, modId);
  const body = [];
  const now = Date.now();

  /* Lichtsteuerung */
  if (def.sunlit) {
    const sol = solar(now);
    const shade = lamp.shade ?? .88;
    const dli = SIM.SUN_PPFD * (1 - shade) * (1 - sol.fraction) * 86400 / 1e6;
    body.push(hint('Hier scheint die <b>echte Sonne</b> — 1361 W/m², ohne Atmosphäre dazwischen. Das ist weit mehr, als jede Pflanze verträgt: Ohne Verschattung bleicht das Photosystem II aus. Stell die Beschattung passend zur Kultur ein.', 'amber'));
    const wrap = el('div', { class: 'card' });
    wrap.append(el('div', { class: 'card__t' }, el('h3', { text: 'Beschattung' }),
      el('span', { class: 'chip chip--amber', text: `${(shade * 100).toFixed(0)} %` })));
    const sl = el('input', { type: 'range', min: 0, max: 99, value: Math.round(shade * 100) });
    sl.addEventListener('input', () => {
      A.setLamp(st, modId, { shade: sl.value / 100 });
      app.save(); UI.render();
    });
    wrap.append(sl);
    wrap.append(kv('Tatsächliche Lichtmenge', `${dli.toFixed(1)} mol/m²/Tag`, '<b>DLI</b>Daily Light Integral: die Photonenmenge, die pro Tag ankommt.'));
    wrap.append(kv('Im Erdschatten', `${(sol.fraction * PERIOD / 60000).toFixed(0)} min je Umlauf dunkel`));
    body.push(wrap);
  } else if (def.dark) {
    body.push(hint('Pilze photosynthetisieren nicht — sie atmen wie Tiere. In dieser Kammer gibt es kein Licht, dafür 95 % Luftfeuchte und ständigen Luftwechsel: Zu viel CO₂ gibt lange Stiele und winzige Hüte.', 'leaf'));
  } else {
    const dli = lamp.ppfd * S.lightBonus(st) * lamp.hours * 3600 / 1e6;
    const watts = S.lampWatts(st, modId);
    const wrap = el('div', { class: 'card' });
    wrap.append(el('div', { class: 'card__t' },
      el('h3', { text: 'Lichtprogramm' }),
      el('label', { class: 'switch' },
        el('input', { type: 'checkbox', checked: lamp.on !== false, onchange: e => { A.setLamp(st, modId, { on: e.target.checked }); app.save(); app.syncScene(); UI.render(); } }),
        el('i', {}))));

    const mk = (label, key, min, max, step, unit, tip) => {
      const row = el('div', { style: { marginBottom: '.7rem' } });
      row.append(el('div', { class: 'kv', 'data-tip': tip },
        el('span', { text: label }), el('b', { text: `${lamp[key]} ${unit}` })));
      const sl = el('input', { type: 'range', min, max, step, value: lamp[key] });
      sl.addEventListener('input', () => { A.setLamp(st, modId, { [key]: +sl.value }); app.save(); app.syncScene(); UI.render(); });
      row.append(sl);
      return row;
    };
    wrap.append(mk('Lichtstärke (PPFD)', 'ppfd', 0, 700, 10, 'µmol/m²/s',
      '<b>PPFD</b>Photosynthetische Photonenflussdichte — wie viele nutzbare Lichtteilchen pro Sekunde auf einen Quadratmeter treffen. Volle Mittagssonne auf der Erde: etwa 2000.'));
    wrap.append(mk('Lichtzeit', 'hours', 0, 24, 1, 'h/Tag',
      '<b>Photoperiode</b>Viele Pflanzen messen die Länge der Dunkelheit. Spinat und Salat schießen über 13 h Licht in Blüte.'));
    wrap.append(el('div', { class: 'kv', 'data-tip': '<b>DLI = PPFD × Stunden × 3600 ÷ 1.000.000</b>Die Tageslichtmenge ist das, was die Pflanze wirklich zählt.' },
      el('span', { text: 'Ergibt DLI' }), el('b', { html: `<span style="color:var(--leaf)">${dli.toFixed(1)}</span> mol/m²/Tag` })));
    wrap.append(el('div', { class: 'kv' }, el('span', { text: 'Stromaufnahme' }), el('b', { text: watt(watts) })));
    wrap.append(el('div', { class: 'kv', 'data-tip': '<b>Lichtausbeute</b>µmol pro Joule. Gute Gartenbau-LEDs schaffen heute 3,0 bis 3,5.' },
      el('span', { text: 'Lichtausbeute' }), el('b', { text: `${S.ledEfficacy(st).toFixed(2)} µmol/J` })));
    body.push(wrap);
  }

  /* Plätze */
  body.push(secT(`Anbauplätze · ${slots.filter(s => s.plant).length} / ${slots.length} belegt`));
  const grid = el('div', { class: 'slots' });
  for (const s of slots) grid.append(slotCard(app, s, UI));
  body.push(grid);

  const def2 = MOD_BY_ID[modId];
  if (def2?.expand) {
    const m = st.modules[modId];
    const nextIdx = (m.expansions || []).length;
    const ex = def2.expand[nextIdx];
    if (ex) {
      body.push(secT('Ausbau'));
      body.push(el('div', { class: 'card' },
        el('div', { class: 'card__t' }, el('h3', { text: ex.name }),
          el('span', { class: 'chip chip--amber', text: `${num(ex.cost)} Cr` })),
        el('p', { class: 'card__d', text: `${ex.slots} zusätzliche Anbauplätze. Freigabe ab Stufe ${ex.level}.` }),
        el('button', {
          class: 'btn btn--primary btn--sm', disabled: st.level < ex.level || st.credits < ex.cost,
          onclick: () => {
            const r = A.expandModule(st, modId, nextIdx);
            UI.toast(r.ok ? 'ok' : 'bad', r.ok ? 'Ausgebaut' : 'Nicht möglich', r.msg);
            if (r.ok) { sfx.research(); app.save(); app.rebuildStation(); app.reloadRoom(); }
            UI.render();
          }, html: icon('plus') + 'Montieren',
        })));
    }
  }

  return panel({
    title: def.name, sub: `${(slots.length * TRAY_AREA).toFixed(2)} m² Anbaufläche`, icon: def.icon, wide: slots.length > 6, body,
    foot: [
      el('button', { class: 'btn btn--primary', onclick: () => UI.doHarvestAll(), html: icon('scissors') + 'Ernten' }),
      el('button', { class: 'btn', onclick: () => UI.doWaterAll(), html: icon('droplets') + 'Gießen' }),
      el('span', { style: { flex: 1 } }),
      el('span', { class: 'sub', text: `${def.power} W Grundlast` }),
    ],
  });
}

function slotCard(app, s, UI) {
  const st = app.st;
  if (!s.plant) {
    return el('button', {
      class: 'slot slot--empty', onclick: () => pickPlant(app, s, UI),
      html: icon('plus') + '<span>Aussäen</span>',
    });
  }
  const p = PL[s.plant];
  const stage = stageAt(p, s.prog);
  const a = SIM.analyse(st, s);
  const eta = SIM.etaHarvest(st, s);
  const dry = SIM.etaDry(st, s);
  const flags = [];
  if (s.dead) flags.push(['sick', 'x', 'Eingegangen']);
  else {
    if (s.prog >= 1) flags.push(['ready', 'check', 'Erntereif']);
    if (s.moist < .25) flags.push(['thirst', 'droplet', 'Braucht Wasser']);
    if (a && a.light < .35 && p.dli > .5) flags.push(['dark', 'moon', 'Zu wenig Licht']);
    if (a && a.over) flags.push(['sick', 'sun', 'Lichtüberschuss — das Photosystem bleicht aus']);
    if (s.sick) flags.push(['sick', 'bug', s.sick]);
    const w = p.pollinate ? pollenWindow(p) : null;
    if (w && !s.pollen && s.prog >= w[0]) flags.push(['pollen', 'bee', 'Bestäubung fällig']);
  }
  const card = el('button', {
    class: 'slot' + (s.prog >= 1 && !s.dead ? ' is-ready' : '') + (s.dead ? ' is-dead' : ''),
    onclick: () => slotDetail(app, s, UI),
  });
  card.append(el('div', { class: 'slot__viz', html: plantSvg(p, s.prog, s.dead ? 0 : s.health, s.id, stage.i) }));
  card.append(el('div', { class: 'slot__n', text: p.name }));
  card.append(el('div', { class: 'slot__s', text: s.dead ? 'eingegangen' : s.prog >= 1 ? 'erntereif' : `${stage.name} · ${dur(eta, { short: true, max: 1 })}` }));
  const wrap = el('div', { class: 'slot__bar' });
  wrap.append(bar(s.prog, s.dead ? 'var(--bad)' : s.prog >= 1 ? 'var(--leaf)' : 'linear-gradient(90deg,var(--leaf),var(--cyan))'));
  if (!s.dead) {
    const w = el('div', { class: 'bar bar--thin', style: { marginTop: '3px' } },
      el('i', { style: { width: (s.moist * 100).toFixed(0) + '%', background: s.moist < .25 ? 'var(--bad)' : 'var(--cyan)' } }));
    wrap.append(w);
  }
  card.append(wrap);
  if (flags.length) {
    const f = el('div', { class: 'slot__flags' });
    for (const [cls, ic, tip] of flags) f.append(el('span', { class: 'flag flag--' + cls, html: icon(ic), 'data-tip': tip }));
    card.append(f);
  }
  return card;
}

function pickPlant(app, slot, UI) {
  const st = app.st;
  const mod = MOD_BY_ID[slot.mod];
  const avail = PLANTS.filter(p => {
    if (mod?.dark) return p.archetype === 'fungus';
    return p.archetype !== 'fungus';
  });
  let html = `<h2>Was soll auf diesen Platz?</h2><p>Tablett ${TRAY_AREA} m² in ${mod?.name}. Saatgut wird verbraucht.</p><div class="pick" style="margin-top:1rem">`;
  for (const p of avail) {
    const have = st.seeds[p.id] || 0;
    const locked = p.level > st.level;
    const dis = locked || have < 1 || st.substrate < 1;
    html += `<button class="pickitem" data-p="${p.id}" ${dis ? 'disabled' : ''}>
      <span class="pickitem__ic">${plantSvg(p, .9, 1, p.id, 3)}</span>
      <span class="pickitem__m"><b>${esc(p.name)}</b><span>${locked ? 'ab Stufe ' + p.level : `${have} Samen · ${(cycleMs(p) / HOUR).toFixed(0)} h · DLI ${p.dli}`}</span></span>
    </button>`;
  }
  html += `</div><p style="margin-top:1rem;font-size:.8rem;color:var(--ink-faint)">Substratpads vorrätig: <b>${st.substrate}</b>${st.substrate < 1 ? ' — im Katalog nachbestellen!' : ''}</p>`;
  UI.modal(html, {
    onMount(root) {
      for (const b of $$('.pickitem', root)) b.addEventListener('click', () => {
        const r = A.plantSeed(st, slot.id, b.dataset.p);
        if (r.ok) {
          sfx.sow();
          UI.toast('ok', 'Ausgesät', `${PL[b.dataset.p].name} — ${(cycleMs(PL[b.dataset.p]) / HOUR).toFixed(0)} Stunden bis zur Ernte.`);
          app.save(); app.syncScene(); UI.closeModal(); UI.render();
        } else { sfx.error(); UI.toast('bad', 'Geht nicht', r.msg); }
      });
    },
  });
}

function slotDetail(app, s, UI) {
  const st = app.st;
  const p = PL[s.plant];
  if (!p) return;
  const a = SIM.analyse(st, s);
  const stage = stageAt(p, s.prog);
  const stages = stagesOf(p);
  const eta = SIM.etaHarvest(st, s);
  const dry = SIM.etaDry(st, s);
  const val = SIM.harvestValue(st, s);
  const w = p.pollinate ? pollenWindow(p) : null;
  const needPollen = w && !s.pollen && s.prog >= w[0];

  const f = (label, v, ideal, tip) => {
    const pct = clamp01(v);
    const col = pct > .85 ? 'var(--leaf)' : pct > .5 ? 'var(--amber)' : 'var(--bad)';
    return `<div class="kv" data-tip="${tip.replace(/"/g, '&quot;')}"><span>${label}</span><b style="color:${col}">${(pct * 100).toFixed(0)} %</b></div>
      <div class="bar bar--thin" style="margin:-2px 0 .5rem"><i style="width:${(pct * 100).toFixed(0)}%;background:${col}"></i></div>`;
  };

  let html = `<h2>${esc(p.name)}</h2><p class="lat" style="font-style:italic;color:var(--ink-faint);margin:-.2rem 0 1rem">${esc(p.latin)} · ${esc(p.family)}</p>`;

  if (s.dead) {
    html += `<div class="hint hint--amber">${icon('alert')}<div>Diese Kultur ist eingegangen. Totes Pflanzenmaterial in einem geschlossenen, feuchten Kreislauf ist eine Schimmelquelle — Platz jetzt reinigen.</div></div>`;
  } else {
    html += `<div class="bar" style="margin-bottom:.35rem"><i style="width:${(s.prog * 100).toFixed(1)}%;background:linear-gradient(90deg,var(--leaf),var(--cyan))"></i></div>
      <div class="kv"><span>${esc(stage.name)} · Phase ${stage.i + 1} von ${stages.length}</span><b>${(s.prog * 100).toFixed(0)} %</b></div>
      <div class="kv"><span>${s.prog >= 1 ? 'Erntereif' : 'Erntereif in'}</span><b>${s.prog >= 1 ? 'jetzt' : (eta === Infinity ? 'gestoppt' : dur(eta))}</b></div>`;

    html += `<div class="sec-t">Was die Pflanze gerade bekommt</div>`;
    html += `<p style="font-size:.8rem;color:var(--ink-dim);margin:-.2rem 0 .7rem">Nach dem <b>Minimumgesetz</b> zählt nur der knappste Faktor. Bei dir bremst gerade: <b style="color:var(--amber)">${a.limiting}</b>.</p>`;
    html += f('Licht', a.light, p.dli, `<b>Licht</b>${a.dli.toFixed(1)} von ${p.dli} mol/m²/Tag gewünscht.<br>Unter ${p.dliMin} mol wächst fast nichts mehr.`);
    html += f('Wasser', a.water, 0, `<b>Substratfeuchte</b>${(s.moist * 100).toFixed(0)} %<br>Trocken in ${dry === Infinity ? 'automatisch versorgt' : dur(dry, { short: true })}.<br>Gesamtbedarf dieser Kultur: ${p.water} L je Tablett.`);
    html += f('Nährstoffe', a.nut, 0, `<b>Nährsalzladung</b>${(s.nut * 100).toFixed(0)} %<br>Bedarf über den Zyklus: ${p.n} g · Leitwert ${p.ec} mS/cm.`);
    html += f('Temperatur', a.temp, 0, `<b>Temperatur</b>Station: ${st.tempTarget.toFixed(1)} °C<br>Diese Art will ${p.temp[1]} °C (Bereich ${p.temp[0]}–${p.temp[2]} °C).`);
    html += f('pH-Wert', a.ph, 0, `<b>pH</b>Medium: ${S.CONST.BASE_PH}<br>Ziel dieser Art: ${p.ph[0]}–${p.ph[1]}<br>Außerhalb fallen Nährstoffe als unlösliche Verbindungen aus.`);
    html += `<div class="kv" data-tip="<b>CO₂-Zuschlag</b>Bei ${num(st.co2Target)} ppm und gutem Licht."><span>CO₂-Zuschlag</span><b style="color:var(--cyan)">+${((a.co2 - 1) * 100).toFixed(0)} %</b></div>`;
    html += `<div class="kv"><span>Gesundheit</span><b style="color:${s.health > .7 ? 'var(--leaf)' : 'var(--amber)'}">${(s.health * 100).toFixed(0)} %</b></div>`;
    if (a.over) html += `<div class="hint hint--amber" style="margin-top:.7rem">${icon('sun')}<div><b>Zu viel Licht.</b> Diese Art bekommt ${a.dli.toFixed(1)} statt ${p.dli} mol/m²/Tag. Über dem Dreifachen des Sollwerts kommt mehr Energie an, als die Pflanze abführen kann — das Photosystem II bleicht aus und die Blätter werden fahl. Lichtstärke oder Lichtzeit senken.</div></div>`;
    if (s.sick) html += `<div class="hint hint--amber" style="margin-top:.7rem">${icon('bug')}<div>Befall: <b>${esc(s.sick)}</b>. Wachstum halbiert. Mit einer Nützlingskarte behandeln (vorrätig: ${st.flags.beneficials || 0}).</div></div>`;
    if (needPollen) html += `<div class="hint hint--amber" style="margin-top:.7rem">${icon('bee')}<div><b>Bestäubung fällig.</b> Ohne Bestäubung setzt keine Frucht an und die Entwicklung bleibt stehen. Im Orbit gibt es weder Insekten noch Wind — das musst du machen.</div></div>`;
    html += `<div class="sec-t">Zu erwarten</div>
      <div class="kv"><span>Ertrag</span><b>${p.yieldG ? grams(val.massG) : 'Zierpflanze'}</b></div>
      <div class="kv"><span>Erlös</span><b>${num(val.credits)} Cr</b></div>
      <div class="kv"><span>Erfahrung</span><b>${num(val.xp)} EP</b></div>`;
  }

  html += `<div class="fact" style="margin-top:1rem">${richText(p.fact)}</div>`;
  if (p.tip) html += `<p style="font-size:.82rem;color:var(--ink-faint);font-style:italic">${esc(p.tip)}</p>`;

  html += `<div class="mail-acts">`;
  if (s.dead) html += `<button class="btn btn--danger" data-a="clear">${icon('trash')}Platz reinigen</button>`;
  else {
    if (s.prog >= 1) html += `<button class="btn btn--primary" data-a="harvest">${icon('scissors')}Ernten</button>`;
    html += `<button class="btn" data-a="water">${icon('droplets')}Gießen</button>`;
    if (needPollen) html += `<button class="btn btn--cyan" data-a="pollen">${icon('bee')}Bestäuben</button>`;
    if (s.sick) html += `<button class="btn" data-a="treat" ${st.flags.beneficials > 0 ? '' : 'disabled'}>${icon('bug')}Nützlinge einsetzen</button>`;
    html += `<button class="btn btn--ghost btn--sm" data-a="clear">${icon('trash')}Verwerfen</button>`;
  }
  html += `<button class="btn btn--ghost btn--sm" data-a="codex">${icon('book')}Im Kompendium</button></div>`;

  UI.modal(html, {
    onMount(root) {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const act = b.dataset.a;
        let r;
        if (act === 'harvest') {
          r = A.harvest(st, s.id);
          if (r.ok) { sfx.harvest(); UI.toast('ok', 'Geerntet', `${p.name} · +${num(r.value.credits)} Cr · +${num(r.value.xp)} EP${r.seedBack ? ' · 1 Samen zurückgewonnen' : ''}`); if (r.levelUps) UI.levelUp(r.levelUps); }
        } else if (act === 'water') { r = A.waterSlot(st, s.id); if (r.ok) sfx.water(); }
        else if (act === 'pollen') { r = A.pollinate(st, s.id); if (r.ok) { sfx.research(); UI.toast('ok', 'Bestäubt', r.msg); } }
        else if (act === 'treat') { r = A.treat(st, s.id); if (r.ok) UI.toast('ok', 'Behandelt', r.msg); }
        else if (act === 'clear') { r = A.clearSlot(st, s.id); if (r.ok) sfx.whoosh(); }
        else if (act === 'codex') { UI.closeModal(); UI.open('codex', p.id); return; }
        if (r && !r.ok) { sfx.error(); UI.toast('bad', 'Geht nicht', r.msg); return; }
        app.save(); app.syncScene(); UI.closeModal(); UI.render();
      });
    },
  });
}

/* ───────────────────────── BESTELLEN ───────────────────────── */

const cart = {};

export function shop(app, tab, UI) {
  const st = app.st;
  tab = tab || 'Saatgut';
  const body = [];
  const now = Date.now();

  /* Laufende Lieferungen */
  const open = st.orders.filter(o => !o.done);
  if (open.length) {
    body.push(secT('Unterwegs'));
    for (const o of open) {
      const left = o.arrivesAt - now;
      const total = o.arrivesAt - o.placedAt;
      const items = Object.entries(o.items).map(([id, q]) => {
        const nm = id.startsWith('seed:') ? (PL[id.slice(5)]?.name || id) : SHOP_BY_ID[id]?.name || id;
        return `${q}× ${nm}`;
      }).join(', ');
      body.push(el('div', { class: 'delivery' },
        el('span', { class: 'delivery__ic', html: icon('rocket') }),
        el('div', { class: 'delivery__m' },
          el('b', { text: `Andocken in ${dur(left)}` }),
          el('span', { text: items }),
          bar(1 - left / total, 'var(--cyan)')),
      ));
    }
  }

  const tabs = [
    { id: 'Saatgut', label: 'Saatgut' },
    { id: 'Verbrauch', label: 'Verbrauch' },
    { id: 'Komfort', label: 'Komfort' },
  ];

  if (tab === 'Saatgut') {
    body.push(hint('Saatgut ist leicht und damit billig zu fliegen — der Frachtaufschlag richtet sich nach der Masse. Wasser ist das genaue Gegenteil.'));
    for (const p of PLANTS) {
      const locked = p.level > st.level;
      if (locked && p.level > st.level + 3) continue;
      const key = 'seed:' + p.id;
      body.push(shopRow(app, UI, {
        id: key, name: p.name, price: p.seed, locked, level: p.level,
        iconHtml: plantSvg(p, .9, 1, p.id, 3),
        desc: locked ? `Freigabe ab Stufe ${p.level}.`
          : `${(cycleMs(p) / HOUR).toFixed(0)} h Kultur · DLI ${p.dli} · ${p.water} L · Erlös ≈ ${num(p.value)} Cr`,
        extra: `Vorrat: ${st.seeds[p.id] || 0}`,
      }));
    }
  } else {
    const list = tab === 'Verbrauch' ? SUPPLIES : COMFORT;
    if (tab === 'Komfort') body.push(hint('Diese Dinge stehen danach sichtbar in deiner Lounge. Sie kosten Frachtmasse und bringen keinen Ertrag — bis auf die kleinen Vorteile, die dabeistehen.', 'leaf'));
    for (const it of list) {
      const locked = (it.level || 1) > st.level || (it.needs && !S.hasRes(st, it.needs));
      const owned = it.perk && st.comfort.includes(it.id);
      body.push(shopRow(app, UI, {
        id: it.id, name: it.name, price: it.price, locked, level: it.level || 1, owned,
        iconHtml: icon(it.icon),
        desc: it.desc,
        extra: it.perk ? `<span style="color:var(--leaf)">${esc(it.perk)}</span>` : `${it.mass} kg`,
      }));
    }
  }

  const t = A.cartTotal(st, cart);
  const foot = [
    el('div', { style: { flex: 1, minWidth: 0 } },
      el('div', { class: 'kv', style: { border: 0, padding: 0 } }, el('span', { text: 'Ware' }), el('b', { text: num(t.goods) + ' Cr' })),
      el('div', { class: 'kv', style: { border: 0, padding: 0 }, 'data-tip': `<b>Frachtkosten</b>Grundgebühr 40 Cr plus 6 Cr je Kilogramm.<br>Masse: ${t.mass.toFixed(2)} kg` },
        el('span', { text: 'Fracht' }), el('b', { text: num(t.freight) + ' Cr' })),
      el('div', { class: 'kv', style: { border: 0, padding: 0, fontSize: '.95rem' } },
        el('span', { text: 'Gesamt' }), el('b', { style: { color: t.total > st.credits ? 'var(--bad)' : 'var(--amber)' }, text: num(t.total) + ' Cr' }))),
    el('button', {
      class: 'btn btn--primary', disabled: !t.total || t.total > st.credits,
      onclick: () => {
        const r = A.placeOrder(st, cart);
        if (r.ok) {
          sfx.whoosh();
          UI.toast('ok', 'Auftrag erteilt', r.msg);
          for (const k of Object.keys(cart)) delete cart[k];
          app.save(); UI.render();
        } else { sfx.error(); UI.toast('bad', 'Nicht möglich', r.msg); }
      },
      html: icon('rocket') + `Bestellen (${(S.deliveryMs(st) / HOUR).toFixed(0)} h)`,
    }),
  ];

  return panel({
    title: 'Bestellkatalog', sub: `Lieferzeit ${(S.deliveryMs(st) / HOUR).toFixed(0)} h`, icon: 'box', wide: true,
    tabs, active: tab, onTab: id => UI.open('shop', id), body, foot,
  });
}

function shopRow(app, UI, o) {
  const st = app.st;
  const qty = cart[o.id] || 0;
  const row = el('div', { class: 'shopitem' + (o.locked ? ' is-locked' : ''), style: o.locked ? { opacity: .45 } : null });
  row.append(el('span', { class: 'shopitem__ic', html: o.iconHtml }));
  row.append(el('div', { class: 'shopitem__m' },
    el('b', { text: o.name }),
    el('p', { html: esc(o.desc) }),
    el('span', { class: 'chip', html: o.extra })));
  const act = el('div', { class: 'shopitem__a' });
  act.append(el('span', { class: 'price' + (o.price > st.credits ? ' is-bad' : ''), text: num(o.price) + ' Cr' }));
  if (o.locked) act.append(el('span', { class: 'chip', text: `Stufe ${o.level}` }));
  else if (o.owned) act.append(el('span', { class: 'chip chip--leaf', text: 'an Bord' }));
  else {
    const q = el('div', { class: 'qty' });
    const inp = el('input', { type: 'number', value: String(qty), min: 0, max: 99 });
    const set = v => { const n = clamp(Math.round(v) || 0, 0, 99); if (n) cart[o.id] = n; else delete cart[o.id]; UI.render(); };
    q.append(el('button', { html: icon('minus'), onclick: () => set((cart[o.id] || 0) - 1) }));
    q.append(inp);
    q.append(el('button', { html: icon('plus'), onclick: () => set((cart[o.id] || 0) + 1) }));
    inp.addEventListener('change', () => set(+inp.value));
    act.append(q);
  }
  row.append(act);
  return row;
}

/* ───────────────────────── FUNKVERKEHR ───────────────────────── */

let mailSel = null;

export function mail(app, arg, UI) {
  const st = app.st;
  const items = st.mail.items;
  if (arg) mailSel = arg;
  if (!mailSel || !items.find(m => m.uid === mailSel)) mailSel = items[0]?.uid || null;

  const wrap = el('div', { class: 'mail-wrap' });
  const list = el('div', { class: 'mail-list' });
  for (const m of items) {
    const per = personOf(m.from);
    list.append(el('button', {
      class: 'mail-item' + (m.uid === mailSel ? ' is-active' : '') + (m.read ? '' : ' is-unread'),
      onclick: () => { sfx.click(); mailSel = m.uid; const before = st.level; openMail(st, m.uid); if (st.level > before) UI.levelUp(1); app.save(); UI.render(); UI.tickHud(); },
    },
      el('b', { text: m.subject }),
      el('span', { text: `${per.name} · ${dateFull(m.at)}` })));
  }
  if (!items.length) list.append(emptyState('mail', 'Keine Nachrichten', 'Die Bodenstation meldet sich von selbst.'));
  wrap.append(list);

  const read = el('div', { class: 'mail-read' });
  const m = items.find(x => x.uid === mailSel);
  if (m) {
    const per = personOf(m.from);
    read.append(el('h3', { text: m.subject }));
    read.append(el('div', { class: 'mail-meta', html: `<b style="color:var(--${per.tone || 'ink'})">${esc(per.name)}</b> · ${esc(per.role)}<br>${esc(per.addr)} · ${dateFull(m.at)}` }));
    read.append(el('div', { class: 'mail-body', html: richText(m.body) }));
    if (m.sig) read.append(el('div', { class: 'mail-sig', html: esc(m.sig).replace(/\n/g, '<br>') }));
    if (m.reward) {
      const bits = [];
      if (m.reward.credits) bits.push(`${num(m.reward.credits)} Credits`);
      if (m.reward.xp) bits.push(`${num(m.reward.xp)} EP`);
      if (m.reward.seeds) bits.push(Object.entries(m.reward.seeds).map(([k, v]) => `${v}× ${PL[k]?.name || k}`).join(', '));
      read.append(el('div', { class: 'mail-att', html: icon('box') + `<div><b>Anhang gutgeschrieben:</b> ${bits.join(' · ')}</div>` }));
    }
  } else read.append(emptyState('mail', 'Nichts ausgewählt', 'Wähle links eine Nachricht.'));
  wrap.append(read);

  return panel({
    title: 'Funkverkehr', sub: `${unread(st)} ungelesen`, icon: 'mail', wide: true, body: wrap,
    foot: [
      el('button', { class: 'btn btn--sm', onclick: () => { markAllRead(st); app.save(); UI.render(); UI.tickHud(); }, html: icon('check') + 'Alle gelesen' }),
      el('span', { style: { flex: 1 } }),
      el('span', { class: 'sub', text: `${items.length} Nachrichten` }),
    ],
  });
}

/* ───────────────────────── FORSCHUNG ───────────────────────── */

export function research(app, tab, UI) {
  const st = app.st;
  const now = Date.now();
  const body = [];
  const act = st.research.active;

  if (act) {
    const r = RES_BY_ID[act.id];
    const pct = clamp01((now - act.startedAt) / (act.endsAt - act.startedAt));
    body.push(el('div', { class: 'card', style: { borderColor: 'rgba(184,146,255,.4)', background: 'rgba(184,146,255,.06)' } },
      el('div', { class: 'card__t' }, el('h3', { text: r.name }), el('span', { class: 'chip chip--violet', text: 'läuft' })),
      el('p', { class: 'card__d', text: r.desc }),
      bar(pct, 'var(--violet)'),
      el('div', { class: 'kv' }, el('span', { text: 'Fertig in' }), el('b', { text: dur(act.endsAt - now) }))));
  } else {
    body.push(hint('Forschung kostet Credits und echte Zeit — sie läuft weiter, während du offline bist. Es kann immer nur ein Vorhaben gleichzeitig laufen.'));
  }

  for (const branch of BRANCHES) {
    body.push(secT(branch));
    for (const r of RESEARCH.filter(x => x.branch === branch)) {
      const done = st.research.done.includes(r.id);
      const reqOk = r.req.every(q => st.research.done.includes(q));
      const lvlOk = st.level >= r.level;
      const locked = !reqOk || !lvlOk;
      const card = el('div', { class: 'card' + (done ? ' is-done' : '') + (locked ? ' is-locked' : '') });
      card.append(el('div', { class: 'card__t' },
        el('h3', { text: r.name }),
        done ? el('span', { class: 'chip chip--leaf', text: 'erforscht' })
             : el('span', { class: 'chip chip--amber', text: `${num(r.cost)} Cr · ${r.hours} h` })));
      card.append(el('p', { class: 'card__d', text: r.desc }));
      card.append(el('p', { class: 'card__d', style: { color: 'var(--leaf)', fontSize: '.78rem' }, text: '→ ' + r.effect }));
      if (!done) {
        const why = !lvlOk ? `Erst ab Stufe ${r.level}` : !reqOk ? `Voraussetzung: ${r.req.map(q => RES_BY_ID[q]?.name).join(', ')}` : null;
        if (why) card.append(el('span', { class: 'chip', text: why }));
        else card.append(el('button', {
          class: 'btn btn--sm btn--primary', disabled: !!act || st.credits < r.cost,
          onclick: () => {
            const res = A.startResearch(st, r.id);
            if (res.ok) { sfx.research(); UI.toast('ok', 'Forschung gestartet', res.msg); app.save(); UI.render(); }
            else { sfx.error(); UI.toast('bad', 'Nicht möglich', res.msg); }
          }, html: icon('beaker') + 'Starten',
        }));
      }
      if (r.fact) card.append(el('div', { class: 'fact', style: { marginTop: '.6rem', fontSize: '.8rem' }, html: richText(r.fact) }));
      body.push(card);
    }
  }

  return panel({
    title: 'Labor', sub: `${st.research.done.length} / ${RESEARCH.length} erforscht`, icon: 'flask', body,
    foot: [el('button', { class: 'btn btn--sm', onclick: () => UI.open('codex'), html: icon('book') + 'Kompendium' })],
  });
}

/* ───────────────────────── AUSBAU ───────────────────────── */

export function build(app, arg, UI) {
  const st = app.st;
  const now = Date.now();
  const body = [hint('Jedes neue Modul wird unten gefertigt, hochgeflogen und von einem Roboterarm angesetzt. Das dauert — und danach steht es auch in der Außenansicht.')];

  for (const def of MODULES) {
    const m = st.modules[def.id];
    const built = !!m?.built, building = !!m?.building;
    const card = el('div', { class: 'card' + (built ? ' is-done' : '') });
    card.append(el('div', { class: 'card__t' },
      el('span', { html: icon(def.icon), style: { color: 'var(--cyan)', display: 'flex' } }),
      el('h3', { text: def.name }),
      built ? el('span', { class: 'chip chip--leaf', text: 'gebaut' })
        : building ? el('span', { class: 'chip chip--cyan', text: 'Montage · ' + dur(m.readyAt - now, { short: true }) })
        : el('span', { class: 'chip chip--amber', text: num(def.cost) + ' Cr' })));
    card.append(el('p', { class: 'card__d', text: def.desc }));
    if (def.slots) card.append(el('span', { class: 'chip', text: `${def.slots} Anbauplätze` }), ' ');
    card.append(el('span', { class: 'chip', text: `${def.power} W` }));
    if (def.fact) card.append(el('div', { class: 'fact', style: { marginTop: '.6rem', fontSize: '.8rem' }, html: richText(def.fact) }));

    if (!built && !building && !def.start) {
      const ok = st.level >= def.level && st.credits >= def.cost;
      card.append(el('div', { style: { marginTop: '.6rem' } },
        st.level < def.level
          ? el('span', { class: 'chip', text: `Freigabe ab Stufe ${def.level}` })
          : el('button', {
            class: 'btn btn--sm btn--primary', disabled: !ok,
            onclick: () => {
              const r = A.buildModule(st, def.id);
              if (r.ok) { sfx.research(); UI.toast('ok', 'Beauftragt', r.msg); app.save(); app.rebuildStation(); UI.render(); }
              else { sfx.error(); UI.toast('bad', 'Nicht möglich', r.msg); }
            }, html: icon('rocket') + `Bauen (${def.buildHours || 8} h)`,
          })));
    }

    if (built && def.expand) {
      const exps = m.expansions || [];
      for (let i = 0; i < def.expand.length; i++) {
        const ex = def.expand[i];
        const has = exps.includes(i);
        const prevOk = i === 0 || exps.includes(i - 1);
        card.append(el('div', { class: 'kv', style: { marginTop: '.4rem' } },
          el('span', { text: `${ex.name} (+${ex.slots})` }),
          has ? el('b', { style: { color: 'var(--leaf)' }, text: 'montiert' })
            : el('button', {
              class: 'btn btn--sm', disabled: !prevOk || st.level < ex.level || st.credits < ex.cost,
              onclick: () => {
                const r = A.expandModule(st, def.id, i);
                if (r.ok) { sfx.research(); UI.toast('ok', 'Ausgebaut', r.msg); app.save(); app.rebuildStation(); app.reloadRoom(); UI.render(); }
                else { sfx.error(); UI.toast('bad', 'Nicht möglich', r.msg); }
              }, html: `${num(ex.cost)} Cr`,
            })));
      }
    }
    body.push(card);
  }

  const slots = st.slots.length;
  return panel({
    title: 'Stationsausbau', sub: `${slots} Plätze · ${(slots * TRAY_AREA).toFixed(2)} m²`, icon: 'rocket', body,
  });
}

/* ───────────────────────── TECHNIK ───────────────────────── */

export function systems(app, arg, UI) {
  const st = app.st;
  const now = Date.now();
  const pw = SIM.powerReport(st, now);
  const sol = pw.sun;
  const body = [];

  body.push(secT('Energie'));
  const pc = el('div', { class: 'card' });
  pc.append(kv('Solarerzeugung gerade', watt(pw.gen), `<b>Solarleistung</b>Spitzenleistung ${watt(pw.peak)}.<br>Im Erdschatten null.`));
  pc.append(kv('Über den Umlauf gemittelt', watt(pw.meanGen)));
  pc.append(kv('Grundlast der Module', watt(pw.base)));
  pc.append(kv('Lampen', watt(pw.lamps)));
  pc.append(kv('Bilanz je Umlauf', watt(pw.meanNet), '<b>Bilanz</b>Ist sie negativ, entlädt sich der Akku über die Zeit und die Lampen werden abgeregelt.'));
  pc.append(el('div', { class: 'kv' }, el('span', { text: 'Akkuladung' }),
    el('b', { text: `${(st.battery * 1000).toFixed(0)} / ${(S.batteryCap(st) * 1000).toFixed(0)} Wh` })));
  pc.append(bar(st.battery / S.batteryCap(st), pw.meanNet < 0 ? 'var(--bad)' : 'var(--leaf)'));
  pc.append(el('p', { class: 'card__d', style: { marginTop: '.6rem' }, html: `Die Station durchläuft je Umlauf bis zu <b>${(sol.eclipseMs / 60000).toFixed(0)} Minuten Erdschatten</b>. In dieser Zeit speist nur der Akku. ${Math.abs(beta(now)) > BETA_CRIT ? '<b style="color:var(--amber)">Derzeit Beta-Hochphase: kein Schatten.</b>' : ''}` }));
  body.push(pc);

  body.push(secT('Wasserkreislauf'));
  const wc = el('div', { class: 'card' });
  wc.append(kv('Tankinhalt', `${vol(st.water)} / ${num(S.waterCap(st))} L`));
  wc.append(bar(st.water / S.waterCap(st), 'var(--cyan)'));
  wc.append(kv('Rückgewinnungsrate', `${(S.recovery(st) * 100).toFixed(0)} %`,
    '<b>Wasserrückgewinnung</b>Der Kondensator holt transpiriertes Wasser aus der Kabinenluft zurück. Die ISS erreicht rund 93 %.'));
  wc.append(kv('Bisher verbraucht', `${num(st.stats.waterUsed, 0)} L`));
  wc.append(kv('Davon zurückgewonnen', `${num(st.stats.waterRecovered, 0)} L`));
  wc.append(kv('Tatsächlicher Verlust', `${num(st.stats.waterUsed - st.stats.waterRecovered, 0)} L`));
  wc.append(kv('Bewässerung', ['von Hand', 'Dochtbewässerung', 'Tropfautomatik'][S.autoWater(st)]));
  wc.append(kv('Nährsalze', `${grams(st.nutrients)} / ${grams(S.nutriCap(st))}`));
  wc.append(kv('Substratpads', String(st.substrate)));
  body.push(wc);

  body.push(secT('Atmosphäre & Klima'));
  const cc = el('div', { class: 'card' });
  const maxCo2 = S.hasRes(st, 'co2') ? 1600 : 1200;
  const co2Row = el('div', { style: { marginBottom: '.8rem' } });
  co2Row.append(el('div', { class: 'kv', 'data-tip': '<b>CO₂</b>Erdatmosphäre: 420 ppm. Auf der ISS liegen die Werte betriebsbedingt bei 2000 bis 5000 ppm.<br>Pflanzen legen bis etwa 1200 ppm deutlich zu — darüber kippt der Effekt, und für dich wird es dumpf.' },
    el('span', { text: 'CO₂-Sollwert' }), el('b', { text: `${num(st.co2Target)} ppm` })));
  const co2sl = el('input', { type: 'range', min: 400, max: maxCo2, step: 20, value: st.co2Target });
  co2sl.addEventListener('input', () => { A.setClimate(st, { co2: +co2sl.value }); app.save(); UI.render(); UI.tickHud(); });
  co2Row.append(co2sl);
  cc.append(co2Row);

  const tRow = el('div', {});
  tRow.append(el('div', { class: 'kv', 'data-tip': '<b>Temperatur</b>Jede Art hat ihr Optimum. Wasabi will 13 °C, Gurke 26 °C — mit einem einzigen Sollwert für die ganze Station ist das ein Kompromiss.<br>Die Forschung „Zonenthermik" hebt das auf.' },
    el('span', { text: 'Stationstemperatur' }), el('b', { text: `${st.tempTarget.toFixed(1)} °C` })));
  const tsl = el('input', { type: 'range', min: 8, max: 30, step: .5, value: st.tempTarget });
  tsl.addEventListener('input', () => { A.setClimate(st, { temp: +tsl.value }); app.save(); UI.render(); });
  tRow.append(tsl);
  cc.append(tRow);

  /* Welche Kulturen passen zur eingestellten Temperatur? */
  const active = [...new Set(st.slots.filter(s => s.plant).map(s => s.plant))];
  if (active.length) {
    cc.append(el('div', { class: 'sec-t', text: 'Eignung der laufenden Kulturen' }));
    for (const id of active) {
      const p = PL[id];
      const q = SIM.qTemp(st.tempTarget, p.temp);
      cc.append(el('div', { class: 'kv' }, el('span', { text: `${p.name} (Optimum ${p.temp[1]} °C)` }),
        el('b', { style: { color: q > .85 ? 'var(--leaf)' : q > .5 ? 'var(--amber)' : 'var(--bad)' }, text: `${(q * 100).toFixed(0)} %` })));
    }
  }
  body.push(cc);

  body.push(secT('Bahn'));
  const oc = el('div', { class: 'card' });
  oc.append(kv('Zurückgelegt', `${num(distanceTravelled(now - st.t0) / 1e6, 2)} Mio km`));
  oc.append(kv('Erdumrundungen', num(orbits(st.t0, now), 0)));
  oc.append(kv('Bahngeschwindigkeit', `${V_ORB.toFixed(3)} km/s`));
  oc.append(kv('Umlaufzeit', `${(PERIOD / 60000).toFixed(2)} min`));
  oc.append(kv('Betawinkel', `${beta(now).toFixed(1)}°`));
  oc.append(kv('Schattenanteil', `${(eclipseFraction(now) * 100).toFixed(1)} %`));
  body.push(oc);

  return panel({ title: 'Technik', sub: 'Lebenserhaltung', icon: 'gauge', body });
}

/* ───────────────────────── KOMPENDIUM ───────────────────────── */

export function codex(app, sel, UI) {
  const st = app.st;
  const body = [];
  if (sel && PL[sel]) {
    const p = PL[sel];
    const c = st.codex[p.id] || {};
    const known = c.seen || p.level <= st.level;
    body.push(el('button', { class: 'btn btn--sm btn--ghost', onclick: () => UI.open('codex'), html: icon('x') + 'Zurück' }));
    const d = el('div', { class: 'codex-detail', style: { marginTop: '.8rem' } });
    d.append(el('div', { style: { display: 'flex', gap: '1rem', alignItems: 'flex-start' } },
      el('div', { style: { width: '110px', flex: 'none' }, html: plantSvg(p, .95, 1, p.id, 4) }),
      el('div', {}, el('h3', { text: p.name }),
        el('div', { class: 'lat', text: `${p.latin} · ${p.family}` }),
        el('div', {}, ...p.tags.map(t => el('span', { class: 'chip chip--leaf', text: t, style: { marginRight: '.3rem' } }))))));
    d.append(el('div', { class: 'fact', html: richText(p.fact) }));
    if (p.tip) d.append(el('p', { style: { fontStyle: 'italic', color: 'var(--ink-faint)', fontSize: '.84rem' }, text: p.tip }));

    d.append(secT('Was sie braucht'));
    d.append(kv('Kulturdauer auf der Erde', `${p.days} Tage`, `<b>Erdzeit</b>Hier oben ${GROWTH_FACTOR}× schneller: ${(cycleMs(p) / HOUR).toFixed(0)} Stunden.`));
    d.append(kv('Auf der Station', `${(cycleMs(p) / HOUR).toFixed(1)} h`));
    d.append(kv('Keimdauer', `${p.germ} Tage (Erde)`));
    d.append(kv('Lichtbedarf (DLI)', `${p.dli} mol/m²/Tag`, '<b>Daily Light Integral</b>Die Photonenmenge pro Quadratmeter und Tag, gemessen im Bereich 400–700 nm.'));
    d.append(kv('Minimum', `${p.dliMin} mol/m²/Tag`));
    d.append(kv('Wasserbedarf', `${p.water} L je Tablett`, `<b>Wasser</b>${(p.water / (p.days / GROWTH_FACTOR)).toFixed(1)} L pro Stationstag. Der Kreislauf holt ${(S.recovery(st) * 100).toFixed(0)} % davon zurück.`));
    d.append(kv('Nährsalze', `${p.n} g je Kultur`));
    d.append(kv('Leitwert (EC)', `${p.ec} mS/cm`, '<b>EC</b>Elektrische Leitfähigkeit der Nährlösung. Zu hoch, und die Wurzel verliert osmotisch Wasser an das Medium.'));
    d.append(kv('pH-Bereich', `${p.ph[0]} – ${p.ph[1]}`));
    d.append(kv('Temperatur', `${p.temp[0]} – ${p.temp[2]} °C, ideal ${p.temp[1]} °C`));
    d.append(kv('Bestäubung', p.pollinate ? 'erforderlich' : 'nicht nötig'));
    d.append(kv('Ertrag', p.yieldG ? grams(p.yieldG) : 'Zierpflanze'));
    d.append(kv('Erlös', `${num(p.value)} Cr`));
    d.append(kv('Schwierigkeit', '★'.repeat(p.difficulty) + '☆'.repeat(Math.max(0, 8 - p.difficulty))));

    d.append(secT('Entwicklungsphasen'));
    let acc = 0;
    for (const [nm, frac] of stagesOf(p)) {
      d.append(kv(nm, `${dur(frac * cycleMs(p), { short: true })}`));
      acc += frac;
    }
    if (c.harvested) {
      d.append(secT('Deine Bilanz'));
      d.append(kv('Geerntet', `${c.harvested}×`));
      if (c.best) d.append(kv('Beste Qualität', `${(c.best * 100).toFixed(0)} %`));
    }
    body.push(d);
  } else {
    const done = PLANTS.filter(p => st.codex[p.id]?.harvested).length;
    body.push(hint(`Jede Art, die du anbaust, wird hier vollständig beschrieben — mit den echten gartenbaulichen Kennzahlen. <b>${done} von ${PLANTS.length}</b> bereits geerntet.`, 'leaf'));
    const grid = el('div', { class: 'codex-grid' });
    for (const p of PLANTS) {
      const seen = st.codex[p.id]?.seen || p.level <= st.level;
      grid.append(el('button', {
        class: 'codex-card' + (seen ? '' : ' is-unknown'),
        onclick: () => { sfx.click(); UI.open('codex', p.id); },
        html: (seen ? plantSvg(p, .9, 1, p.id, 3) : icon('lock')) +
          `<b>${seen ? esc(p.name) : '? ? ?'}</b>` +
          (st.codex[p.id]?.harvested ? `<span class="chip chip--leaf">${st.codex[p.id].harvested}×</span>` : seen ? `<span class="chip">Stufe ${p.level}</span>` : ''),
      }));
    }
    body.push(grid);
  }
  return panel({ title: 'Botanisches Kompendium', sub: `${PLANTS.length} Arten`, icon: 'book', wide: !sel, body });
}

/* ───────────────────────── MENÜ ───────────────────────── */

export function menu(app, arg, UI) {
  const st = app.st;
  const body = [];

  body.push(secT('Ton'));
  const audio = el('div', { class: 'card' });
  const sw = (label, checked, fn) => {
    const l = el('label', { class: 'switch', style: { marginBottom: '.6rem' } });
    const i = el('input', { type: 'checkbox', checked });
    i.addEventListener('change', () => fn(i.checked));
    l.append(i, el('i', {}), el('span', { text: label }));
    return l;
  };
  audio.append(sw('Musik', st.settings.music, v => { st.settings.music = v; music.setEnabled(v); app.save(); }));
  const mv = el('input', { type: 'range', min: 0, max: 100, value: Math.round(st.settings.musicVol * 100) });
  mv.addEventListener('input', () => { st.settings.musicVol = mv.value / 100; music.setVolume(st.settings.musicVol); app.save(); });
  audio.append(el('div', { class: 'field' }, el('label', { text: 'Musiklautstärke' }), mv));
  audio.append(sw('Geräusche', st.settings.sfx, v => { st.settings.sfx = v; sfx.set(v, st.settings.sfxVol); app.save(); }));
  const sv = el('input', { type: 'range', min: 0, max: 100, value: Math.round(st.settings.sfxVol * 100) });
  sv.addEventListener('input', () => { st.settings.sfxVol = sv.value / 100; sfx.set(st.settings.sfx, st.settings.sfxVol); app.save(); });
  audio.append(el('div', { class: 'field' }, el('label', { text: 'Geräuschlautstärke' }), sv));
  audio.append(el('p', { class: 'card__d', style: { marginBottom: 0 }, html: `Der Soundtrack wird live erzeugt und wiederholt sich nicht. Gerade läuft: <b>${esc(music.trackName || '—')}</b>` }));
  body.push(audio);

  body.push(secT('Darstellung'));
  const gfx = el('div', { class: 'card' });
  const qsel = el('select', {});
  for (const [v, label] of [['auto', 'Automatisch'], ['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch'], ['ultra', 'Ultra']]) {
    qsel.append(el('option', { value: v, selected: st.settings.quality === v, text: label }));
  }
  qsel.addEventListener('change', () => {
    st.settings.quality = qsel.value; app.save();
    UI.toast('info', 'Neu laden nötig', 'Die Qualitätsstufe wird beim nächsten Start übernommen.');
  });
  gfx.append(el('div', { class: 'field' }, el('label', { text: 'Grafikqualität' }), qsel));
  gfx.append(sw('Leuchten (Bloom)', st.settings.bloom, v => { st.settings.bloom = v; app.stage.setBloom(v); app.save(); }));
  gfx.append(el('p', { class: 'card__d', style: { marginBottom: 0 }, text: `Erkannt: ${app.stage.qualityName}` }));
  body.push(gfx);

  body.push(secT('Spielstand'));
  const save = el('div', { class: 'card' });
  save.append(el('p', { class: 'card__d', html: `Der Spielstand liegt im Speicher dieses Browsers und wird alle paar Sekunden gesichert. Für ein Backup oder den Umzug auf einen anderen Rechner als Datei herunterladen.` }));
  save.append(el('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap' } },
    el('button', { class: 'btn btn--sm', onclick: () => { app.save(); exportFile(st); UI.toast('ok', 'Heruntergeladen', 'JSON-Datei gesichert.'); }, html: icon('download') + 'Als JSON sichern' }),
    el('button', {
      class: 'btn btn--sm', html: icon('upload') + 'Datei laden',
      onclick: () => {
        const inp = el('input', { type: 'file', accept: '.json,application/json' });
        inp.addEventListener('change', async () => {
          const f = inp.files[0]; if (!f) return;
          try {
            const txt = await f.text();
            const loaded = importText(txt);
            app.replaceState(loaded);
            UI.toast('ok', 'Geladen', 'Spielstand übernommen.');
          } catch (e) { UI.toast('bad', 'Fehler', e.message); }
        });
        inp.click();
      },
    }),
  ));
  save.append(el('p', { class: 'card__d', style: { marginTop: '.6rem', marginBottom: 0 }, text: `Zuletzt gesichert: ${dateFull(st.seen)}` }));
  body.push(save);

  body.push(secT('Statistik'));
  const stat = el('div', { class: 'card' });
  const s = st.stats;
  stat.append(kv('Missionstag', String(missionDay(Date.now(), st.t0))));
  stat.append(kv('Ausgesät', `${s.planted}×`));
  stat.append(kv('Geerntet', `${s.harvested}×`));
  stat.append(kv('Biomasse', grams(s.massG)));
  stat.append(kv('Eingegangen', `${s.deaths}×`));
  stat.append(kv('Bestäubt', `${s.pollinated}×`));
  stat.append(kv('Lieferungen', `${s.deliveries}`));
  stat.append(kv('Forschung', `${s.researchDone} / ${RESEARCH.length}`));
  stat.append(kv('Verdient', `${num(s.earned)} Cr`));
  stat.append(kv('Ausgegeben', `${num(s.spent)} Cr`));
  stat.append(kv('Wasser verbraucht', `${num(s.waterUsed, 0)} L`));
  stat.append(kv('Wasser zurückgewonnen', `${num(s.waterRecovered, 0)} L`));
  stat.append(kv('Arten geerntet', `${PLANTS.filter(p => st.codex[p.id]?.harvested).length} / ${PLANTS.length}`));
  body.push(stat);

  body.push(secT('Neu beginnen'));
  body.push(el('div', { class: 'card' },
    el('p', { class: 'card__d', text: 'Setzt die Mission vollständig zurück. Sichere vorher, wenn du den Stand behalten willst.' }),
    el('button', {
      class: 'btn btn--sm btn--danger', html: icon('trash') + 'Mission zurücksetzen',
      onclick: () => {
        UI.modal(`<h2>Wirklich zurücksetzen?</h2><p>Alle ${st.stats.harvested} Ernten, Stufe ${st.level} und der gesamte Ausbau gehen verloren. Das lässt sich nicht rückgängig machen.</p>
          <div class="mail-acts"><button class="btn btn--danger" id="cfm">${icon('trash')}Ja, alles löschen</button><button class="btn" data-close>Abbrechen</button></div>`, {
          onMount(root) {
            $('#cfm', root).addEventListener('click', () => { wipe(); location.reload(); });
          },
        });
      },
    })));

  body.push(el('p', { style: { textAlign: 'center', color: 'var(--ink-faint)', fontSize: '.72rem', marginTop: '1.5rem' }, html: 'Orbital Botany · alle botanischen Kennzahlen sind echt<br>Viel Ruhe da oben.' }));

  return panel({ title: 'Menü', sub: 'Einstellungen & Spielstand', icon: 'settings', body });
}

