/*  Oberfläche: HUD, Raumnavigation, Panels, Meldungen. */
import { el, $, $$, clear, num, compact, vol, watt, grams, dur, clockStr, dateStr, missionDay, clamp, clamp01, HOUR, MIN } from '../core/util.js';
import { icon } from './icons.js';
import * as S from '../game/state.js';
import * as SIM from '../game/sim.js';
import { solar, PERIOD, BETA_CRIT, beta, V_ORB, distanceTravelled, orbits } from '../core/orbit.js';
import { unread } from '../game/mail.js';
import { MODULES, MOD_BY_ID } from '../data/modules.js';
import { sfx } from '../audio/sfx.js';
import * as Panels from './panels.js';

export const UI = {
  app: null,
  panel: null,       // {id, arg}
  els: {},
  tipTimer: null,

  init(app) {
    this.app = app;
    this.els = {
      hud: $('#hud'), rooms: $('#rooms'), stage: $('#stage'),
      time: $('#hud-time'), date: $('#hud-date'), room: $('#hud-room'), sub: $('#hud-sub'),
      stats: $('#hud-stats'), orbit: $('#hud-orbit'), orbitLabel: $('#hud-orbit-label'),
      badge: $('#mail-badge'), toasts: $('#toasts'), modal: $('#modal'), modalBody: $('#modal-body'),
      tip: $('#tip'),
    };
    this.els.hud.hidden = false;
    this.els.rooms.hidden = false;
    this.els.stage.hidden = false;

    $('#btn-home').addEventListener('click', () => { sfx.close(); app.goExterior(); });
    $('#btn-mail').addEventListener('click', () => this.open('mail'));
    $('#btn-menu').addEventListener('click', () => this.open('menu'));
    this.els.modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) this.closeModal(); });

    document.addEventListener('keydown', e => {
      if (e.target.matches('input,textarea,select')) return;
      if (e.key === 'Escape') { if (!this.els.modal.hidden) this.closeModal(); else if (this.panel) this.close(); else app.goExterior(); }
      else if (e.key === 'm' || e.key === 'M') this.open('mail');
      else if (e.key === 'g' || e.key === 'G') { const m = app.st.modules.grow_a?.built ? 'grow_a' : null; if (m) app.goRoom(m); }
      else if (e.key === 'w' || e.key === 'W') this.doWaterAll();
      else if (e.key === 'h' || e.key === 'H') this.doHarvestAll();
      else if (e.key === 'k' || e.key === 'K') this.open('codex');
    });

    // Tooltips
    document.addEventListener('pointerover', e => {
      const t = e.target.closest('[data-tip]');
      if (!t) return this.hideTip();
      this.showTip(t.dataset.tip, e.clientX, e.clientY, t);
    });
    document.addEventListener('pointerdown', () => { this._dragging = true; });
    document.addEventListener('pointerup', () => { this._dragging = false; });
    document.addEventListener('pointercancel', () => { this._dragging = false; });
    document.addEventListener('pointermove', e => { this._pointerInPanel = !!e.target.closest?.('.panel'); }, { passive: true });
    document.addEventListener('wheel', () => { this._lastScroll = performance.now(); }, { passive: true, capture: true });
    document.addEventListener('scroll', () => { this._lastScroll = performance.now(); }, { passive: true, capture: true });
    document.addEventListener('touchmove', () => { this._lastScroll = performance.now(); }, { passive: true, capture: true });
    document.addEventListener('pointermove', e => {
      if (!this.els.tip.hidden) this.moveTip(e.clientX, e.clientY);
    });
    document.addEventListener('pointerout', e => {
      if (!e.relatedTarget?.closest?.('[data-tip]')) this.hideTip();
    });

    this.buildRooms();
    this.tickHud();
  },

  /* ───────────── Raumnavigation ───────────── */
  buildRooms() {
    const app = this.app, st = app.st;
    const box = clear(this.els.rooms);
    const order = ['lounge', 'cupola', 'grow_a', 'hydro', 'vertical', 'mycology', 'dome', 'lab', 'systems', 'cargo'];
    for (const id of order) {
      const def = MOD_BY_ID[id];
      if (!def) continue;
      const m = st.modules[id];
      const built = !!m?.built;
      const building = !!m?.building;
      if (!built && !building && st.level < def.level - 2) continue;
      const b = el('button', {
        class: 'room' + (built ? '' : ' is-locked') + (app.room === id ? ' is-active' : ''),
        title: def.name,
        onclick: () => {
          if (!built) {
            sfx.error();
            this.toast('info', def.name, building ? 'Wird gerade montiert.' : `Freigabe ab Stufe ${def.level} · im Ausbau bestellen.`);
            if (!building && st.level >= def.level) this.open('build');
            return;
          }
          sfx.open(); app.goRoom(id);
        },
        html: icon(def.icon) + `<span class="room__label">${def.name}${built ? '' : building ? ' · Montage' : ' · gesperrt'}</span>`,
      });
      if (built && def.slots) {
        const ready = st.slots.filter(s => s.mod === id && s.plant && (s.prog >= 1 || s.dead)).length;
        if (ready) b.append(el('i', { class: 'room__dot' }));
      }
      box.append(b);
    }
    box.append(el('div', { class: 'rooms__sep' }));
    for (const [id, ic, label] of [['build', 'rocket', 'Ausbau'], ['codex', 'book', 'Kompendium'], ['shop', 'box', 'Bestellen']]) {
      box.append(el('button', {
        class: 'room' + (this.panel?.id === id ? ' is-active' : ''), title: label,
        onclick: () => { sfx.click(); this.open(id); },
        html: icon(ic) + `<span class="room__label">${label}</span>`,
      }));
    }
  },

  setRoomLabel(title, sub) {
    this.els.room.textContent = title;
    this.els.sub.textContent = sub;
  },

  /* ───────────── Panels ───────────── */
  open(id, arg) {
    if (this.panel?.id === id && this.panel?.arg === arg) { this.close(); return; }
    this.panel = { id, arg };
    this.render();
    this.buildRooms();
  },
  close() {
    this.panel = null;
    this._panelKey = null;
    clear(this.els.stage);
    this.buildRooms();
  },

  /** Bedient der Spieler gerade etwas? Dann nicht dazwischenfunken. */
  isBusy() {
    if (this._dragging) return true;
    // kurz nach einer Scrollbewegung bleibt das Panel stehen
    if (performance.now() - (this._lastScroll || 0) < 2500) return true;
    const a = document.activeElement;
    if (a && a !== document.body && this.els.stage.contains(a)) return true;
    // Zeiger über einem Panel, das tatsächlich einen Scrollbalken hat
    if (this._pointerInPanel) {
      const b = $('.panel__body', this.els.stage);
      if (b && b.scrollHeight > b.clientHeight + 4) return true;
    }
    return false;
  },

  /**
   * @param {{auto?:boolean}} opts auto = turnusmäßige Aktualisierung
   */
  render(opts = {}) {
    if (!this.panel) return;
    const fn = Panels[this.panel.id];
    if (!fn) return;
    const key = this.panel.id + '\u0000' + (this.panel.arg ?? '');
    const same = this._panelKey === key && !!this.els.stage.firstElementChild;
    // Slider ziehen, Zahl eintippen: dann bleibt das Panel, wie es ist
    if (same && opts.auto && this.isBusy()) return;
    const scrollTop = $('.panel__body', this.els.stage)?.scrollTop || 0;
    const node = fn(this.app, this.panel.arg, this);
    // Die Einblendbewegung gehört zum Öffnen, nicht zu jeder Aktualisierung
    if (same) node.style.animation = 'none';
    clear(this.els.stage).append(node);
    this._panelKey = key;
    if (same) { const b = $('.panel__body', this.els.stage); if (b) b.scrollTop = scrollTop; }
    if (this._tipNode && !document.contains(this._tipNode)) this.hideTip();
  },
  refresh(opts) {
    if (this.panel) this.render(opts);
    this.buildRooms();
  },

  /* ───────────── HUD ───────────── */
  tickHud() {
    const st = this.app.st;
    const now = Date.now();
    this.els.time.textContent = clockStr(now);
    this.els.date.textContent = `${dateStr(now)} · Tag ${missionDay(now, st.t0)}`;

    const sol = solar(now);
    const dot = $('.o-sun', this.els.orbit);
    if (dot) dot.style.transform = `rotate(${sol.phase * 360}deg)`;
    const free = Math.abs(beta(now)) > BETA_CRIT;
    this.els.orbitLabel.textContent = free ? 'Dauersonne' : sol.lit ? 'Tag' : 'Nacht';
    this.els.orbitLabel.style.color = free ? 'var(--amber)' : sol.lit ? 'var(--amber)' : 'var(--ink-faint)';
    this.els.orbit.dataset.tip = free
      ? `<b>Beta-Hochphase</b>Betawinkel ${beta(now).toFixed(0)}° — über ${BETA_CRIT.toFixed(0)}° liegt die Bahn dauerhaft im Sonnenlicht. Kein Erdschatten.`
      : `<b>Orbitphase</b>${sol.lit ? 'Sonnenlicht' : 'Erdschatten'} · nächster Wechsel in ${dur(sol.nextChange, { short: true })}<br>Umlauf ${(PERIOD / 60000).toFixed(1)} min · Schatten ${(sol.eclipseMs / 60000).toFixed(0)} min · β ${beta(now).toFixed(0)}°`;

    const pw = SIM.powerReport(st, now);
    const wCap = S.waterCap(st), nCap = S.nutriCap(st);
    const bCap = S.batteryCap(st);
    const lvl = S.levelProgress(st);
    const ready = st.slots.filter(s => s.plant && s.prog >= 1).length;
    const thirsty = st.slots.filter(s => s.plant && !s.dead && s.moist < 0.25).length;

    const stats = [
      { ic: 'star', v: String(st.level), u: '', bar: lvl.pct, cls: 'ok',
        tip: `<b>Stufe ${st.level}</b>${num(lvl.have)} / ${num(lvl.need)} EP<br>Höhere Stufen geben neue Kulturen, Module und Forschung frei.` },
      { ic: 'seed', v: compact(st.credits), u: 'Cr', cls: '',
        tip: `<b>Guthaben</b>${num(st.credits)} Credits<br>Verdient: ${num(st.stats.earned)} · Ausgegeben: ${num(st.stats.spent)}` },
      { ic: 'droplet', v: num(st.water, 0), u: 'L', bar: st.water / wCap,
        cls: st.water < wCap * .15 ? 'bad' : st.water < wCap * .3 ? 'warn' : 'ok',
        tip: `<b>Wasser</b>${vol(st.water)} von ${num(wCap)} L<br>Rückgewinnung ${(S.recovery(st) * 100).toFixed(0)} %<br>Zurückgewonnen bisher: ${num(st.stats.waterRecovered, 0)} L` },
      { ic: 'salt', v: compact(st.nutrients), u: 'g', bar: st.nutrients / nCap,
        cls: st.nutrients < nCap * .1 ? 'bad' : st.nutrients < nCap * .25 ? 'warn' : 'ok',
        tip: `<b>Nährsalze</b>${grams(st.nutrients)} von ${grams(nCap)}<br>Vollnährsalz nach Hoagland-Rezeptur.` },
      { ic: 'bolt', v: watt(pw.gen - pw.load).replace(' ', ''), u: '', bar: st.battery / bCap,
        cls: pw.meanNet < 0 ? 'bad' : st.battery < bCap * .25 ? 'warn' : 'ok',
        tip: `<b>Energie</b>Erzeugung ${watt(pw.gen)} · Verbrauch ${watt(pw.load)}<br>Akku ${(st.battery * 1000).toFixed(0)} / ${(bCap * 1000).toFixed(0)} Wh<br>Über den Umlauf gemittelt: ${watt(pw.meanNet)}` },
      { ic: 'co2', v: num(st.co2 ?? st.co2Target, 0), u: 'ppm', cls: (st.co2Target > 1500 ? 'warn' : 'ok'),
        tip: `<b>CO₂</b>${num(st.co2Target)} ppm Sollwert<br>Erdatmosphäre: 420 ppm. Pflanzen legen bis etwa 1200 ppm deutlich zu.<br>Über 1500 ppm wird es für dich unangenehm.` },
    ];
    if (ready) stats.push({ ic: 'scissors', v: String(ready), u: 'reif', cls: 'ok', tip: `<b>${ready} erntereif</b>Taste H erntet alles.` });
    if (thirsty) stats.push({ ic: 'droplets', v: String(thirsty), u: 'durstig', cls: 'warn', tip: `<b>${thirsty} Tabletts trocken</b>Taste W gießt alles.` });

    const box = this.els.stats;
    box.innerHTML = stats.map(s => `
      <div class="stat stat--${s.cls || 'ok'}" data-tip="${(s.tip || '').replace(/"/g, '&quot;')}">
        ${icon(s.ic, 'stat__ico')}
        <span class="stat__v">${s.v}</span>${s.u ? `<span class="stat__u">${s.u}</span>` : ''}
        ${s.bar != null ? `<span class="stat__bar"><i style="width:${(clamp01(s.bar) * 100).toFixed(1)}%"></i></span>` : ''}
      </div>`).join('');

    const u = unread(st);
    this.els.badge.hidden = !u;
    this.els.badge.textContent = u > 99 ? '99+' : u;
  },

  /* ───────────── Sammelaktionen ───────────── */
  doWaterAll() {
    const r = this.app.act.waterAll(this.app.st);
    if (r.ok) { sfx.water(); this.toast('info', 'Gegossen', r.msg); } else sfx.error();
    this.app.save(); this.refresh(); this.app.syncScene();
  },
  doHarvestAll() {
    const st = this.app.st;
    const ready = st.slots.filter(s => s.plant && (s.prog >= 1 || s.dead));
    if (!ready.length) { sfx.error(); this.toast('info', 'Nichts reif', 'Keine Kultur ist erntebereit.'); return; }
    let cr = 0, xp = 0, n = 0, ups = 0;
    for (const s of ready) {
      const r = this.app.act.harvest(st, s.id);
      if (r.ok && r.value) { cr += r.value.credits; xp += r.value.xp; n++; ups += r.levelUps || 0; }
    }
    sfx.harvest();
    this.toast('ok', `${n}× geerntet`, `+${num(cr)} Cr · +${num(xp)} EP`);
    if (ups) this.levelUp(ups);
    this.app.save(); this.refresh(); this.app.syncScene();
  },
  levelUp(n) {
    sfx.levelup();
    const st = this.app.st;
    this.toast('xp', `Stufe ${st.level} erreicht`, 'Neue Kulturen und Ausbauten freigeschaltet.');
    this.app.rebuildStation();
  },

  /* ───────────── Meldungen ───────────── */
  toast(kind, title, text, ms = 5200) {
    const ic = { ok: 'check', info: 'info', warn: 'alert', bad: 'alert', xp: 'star', mail: 'mail' }[kind] || 'info';
    const t = el('div', { class: `toast toast--${kind}`, html: `${icon(ic)}<div><b>${title}</b>${text ? `<span>${text}</span>` : ''}</div>` });
    this.els.toasts.append(t);
    const kill = () => { t.classList.add('is-out'); setTimeout(() => t.remove(), 420); };
    t.addEventListener('click', kill);
    setTimeout(kill, ms);
    while (this.els.toasts.children.length > 5) this.els.toasts.firstChild.remove();
  },

  modal(html, opts = {}) {
    this.els.modalBody.innerHTML = html;
    this.els.modal.hidden = false;
    if (opts.onMount) opts.onMount(this.els.modalBody);
    sfx.open();
  },
  closeModal() { this.els.modal.hidden = true; sfx.close(); },

  showTip(html, x, y, node) {
    const t = this.els.tip;
    t.innerHTML = html;
    t.hidden = false;
    this._tipNode = node || null;
    this.moveTip(x, y);
  },
  moveTip(x, y) {
    const t = this.els.tip;
    const r = t.getBoundingClientRect();
    let nx = x + 16, ny = y + 16;
    if (nx + r.width > innerWidth - 10) nx = x - r.width - 14;
    if (ny + r.height > innerHeight - 10) ny = y - r.height - 14;
    t.style.left = Math.max(8, nx) + 'px';
    t.style.top = Math.max(8, ny) + 'px';
  },
  hideTip() { this.els.tip.hidden = true; this._tipNode = null; },
};
