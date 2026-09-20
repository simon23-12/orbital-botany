/*  Orbital Botany — Einstiegspunkt.
 *
 *  Baut Renderer, Himmel, Station und Oberfläche auf, lädt den Spielstand,
 *  rechnet die verstrichene Echtzeit nach und startet die Schleife.
 */
import * as THREE from 'three';
import { Stage } from './gfx/renderer.js';
import { Sky } from './gfx/sky.js';
import { Exterior } from './gfx/exterior.js';
import { Interior } from './gfx/interior.js';
import { MOD_BY_ID } from './data/modules.js';
import { RES_BY_ID } from './data/research.js';
import { BY_ID as PL } from './data/plants.js';
import * as S from './game/state.js';
import * as SIM from './game/sim.js';
import * as A from './game/actions.js';
import { checkMail, unread } from './game/mail.js';
import { load, save as saveGame, newGame } from './core/save.js';
import { solar, beta, BETA_CRIT, PERIOD } from './core/orbit.js';
import { UI } from './ui/ui.js';
import { icon } from './ui/icons.js';
import { music } from './audio/music.js';
import { sfx } from './audio/sfx.js';
import { $, el, num, dur, vol, grams, clamp, TAU, DEG, MIN, HOUR } from './core/util.js';

const bootBar = $('#boot-bar'), bootStatus = $('#boot-status'), bootEl = $('#boot');
const step = (pct, text) => {
  bootBar.style.width = pct + '%';
  if (text) bootStatus.textContent = text;
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
};

const app = {
  st: null, stage: null, sky: null, exterior: null, interior: null,
  room: null, mode: 'exterior', last: 0, saveTimer: 0, mailTimer: 0,
  sunLocal: new THREE.Vector3(0, 1, 0),

  /* ── Aufbau ── */
  async boot() {
    try {
      await step(8, 'Renderer wird gestartet …');
      let quality = 'auto';
      try { const pre = load(); if (pre?.settings?.quality) quality = pre.settings.quality; } catch {}
      this.stage = new Stage($('#webgl-root'), quality);

      await step(22, 'Erdtexturen werden berechnet …');
      const segs = this.stage.q.segs;
      const texSize = this.stage.qualityName === 'low' ? 1024 : this.stage.qualityName === 'ultra' ? 4096 : 2048;
      this.sky = new Sky(this.stage.renderer, segs, texSize);

      await step(52, 'Sterne werden gesetzt …');
      this.exterior = new Exterior(this.sky);
      this.interior = new Interior(this.sky);

      await step(66, 'Spielstand wird gesucht …');
      let st = load();
      const isNew = !st;
      if (!st) st = null;

      await step(78, 'Station wird zusammengesetzt …');
      if (st) this.attach(st);

      await step(92, 'Bereit.');
      this.showStart(isNew);
    } catch (e) {
      console.error(e);
      const err = $('#boot-err');
      err.hidden = false;
      err.textContent = 'Startfehler: ' + (e?.message || e) + '\n\nBitte Seite neu laden. Läuft WebGL in diesem Browser?';
    }
  },

  showStart(isNew) {
    const btn = $('#boot-start'), hintEl = $('#boot-hint');
    bootStatus.textContent = isNew ? 'Neue Mission' : 'Willkommen zurück';
    if (isNew) {
      const wrap = el('div', { class: 'field', style: { marginTop: '1.6rem', textAlign: 'left' } },
        el('label', { text: 'Wie sollen dich die Leute unten nennen?' }),
        el('input', { type: 'text', id: 'boot-name', placeholder: 'z. B. Simon', maxlength: 24, value: '' }));
      btn.parentElement.insertBefore(wrap, btn);
      setTimeout(() => $('#boot-name')?.focus(), 400);
      $('#boot-name').addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    }
    btn.hidden = false;
    hintEl.hidden = false;
    btn.querySelector('span').textContent = isNew ? 'Einschleusen' : 'Zurück an Bord';
    btn.addEventListener('click', async () => {
      const name = ($('#boot-name')?.value || '').trim();
      if (isNew) this.attach(newGame(name || 'Kommandant'));
      await this.begin();
    }, { once: true });
  },

  attach(st) {
    this.st = st;
    this.exterior.build(st);
  },

  async begin() {
    const st = this.st;
    /* Ton erst nach der Nutzergeste */
    if (st.settings.music) {
      try { await music.start(st.settings.musicVol); sfx.attach(music.ctx); } catch (e) { console.warn('Audio', e); }
    } else {
      try { await music.start(0); music.setEnabled(false); sfx.attach(music.ctx); } catch {}
    }
    sfx.set(st.settings.sfx, st.settings.sfxVol);
    music.setExtra(st.comfort.filter(c => ['record', 'guitar'].includes(c)).length);

    /* Verstrichene Echtzeit nachrechnen */
    const before = { level: st.level, credits: st.credits, harvest: st.stats.harvested };
    const res = SIM.catchUp(st, Date.now());
    const newMail = checkMail(st, Date.now());
    this.exterior.build(st);

    bootEl.classList.add('is-gone');
    setTimeout(() => { bootEl.style.display = 'none'; }, 1000);

    UI.init(this);
    this.goExterior();
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.save(); }
      else {
        const log = SIM.catchUp(this.st, Date.now()).log;
        checkMail(this.st, Date.now());
        this.syncScene(); UI.refresh(); UI.tickHud();
      }
    });
    window.addEventListener('beforeunload', () => this.save());

    if (res.ms > 4 * MIN) this.offlineReport(res, before, newMail);
    else if (newMail.length) UI.toast('info', 'Neue Nachricht', newMail[0].subject);
    this.save();
  },

  offlineReport(res, before, newMail) {
    const st = this.st;
    const counts = {};
    for (const e of res.log) counts[e.type] = (counts[e.type] || 0) + 1;
    const rows = [];
    const ready = st.slots.filter(s => s.plant && s.prog >= 1).length;
    if (ready) rows.push(['scissors', `<b>${ready}</b> Kultur${ready > 1 ? 'en' : ''} erntereif`]);
    if (counts.delivery) rows.push(['rocket', `<b>${counts.delivery}</b> Frachtkapsel${counts.delivery > 1 ? 'n' : ''} angedockt`]);
    if (counts.research) rows.push(['beaker', `Forschung abgeschlossen: <b>${res.log.filter(e => e.type === 'research').map(e => e.name).join(', ')}</b>`]);
    if (counts.module) rows.push(['rocket', `Modul montiert: <b>${res.log.filter(e => e.type === 'module').map(e => e.name).join(', ')}</b>`]);
    if (counts.sick) rows.push(['bug', `<b>${counts.sick}</b> Befall festgestellt`]);
    if (counts.death) rows.push(['alert', `<b>${counts.death}</b> Kultur eingegangen`]);
    if (counts.power) rows.push(['bolt', 'Energiebilanz war zeitweise negativ — Lampen wurden abgeregelt']);
    if (newMail.length) rows.push(['mail', `<b>${newMail.length}</b> neue Nachricht${newMail.length > 1 ? 'en' : ''}`]);
    if (st.level > before.level) rows.push(['star', `Stufe <b>${st.level}</b> erreicht`]);
    const thirsty = st.slots.filter(s => s.plant && !s.dead && s.moist < .25).length;
    if (thirsty) rows.push(['droplet', `<b>${thirsty}</b> Tablett${thirsty > 1 ? 's' : ''} ist trocken`]);
    const orbCount = Math.round(res.ms / PERIOD);

    UI.modal(`
      <h2>Während du weg warst</h2>
      <p>${dur(res.ms)} vergangen — die Station hat in dieser Zeit <b>${num(orbCount)}</b> Mal die Erde umrundet.</p>
      <div style="margin-top:1rem">
        ${rows.length ? rows.map(([ic, t]) => `<div class="kv"><span style="display:flex;align-items:center;gap:.5rem">${icon(ic)}<span>${t}</span></span></div>`).join('')
          : '<p style="color:var(--ink-faint)">Nichts Besonderes. Alles läuft.</p>'}
      </div>
      <div class="mail-acts">
        <button class="btn btn--primary" data-close>${icon('check')}Weiter</button>
        ${ready ? `<button class="btn" id="ofh">${icon('scissors')}Alles ernten</button>` : ''}
        ${newMail.length ? `<button class="btn" id="ofm">${icon('mail')}Nachrichten lesen</button>` : ''}
      </div>`, {
      onMount: root => {
        root.querySelector('#ofh')?.addEventListener('click', () => { UI.closeModal(); UI.doHarvestAll(); });
        root.querySelector('#ofm')?.addEventListener('click', () => { UI.closeModal(); UI.open('mail'); });
      },
    });
  },

  /* ── Szenenwechsel ── */
  goExterior() {
    this.mode = 'exterior';
    this.room = null;
    this.sky.earthGroup.position.set(0, -this.sky.earthDistance, 0);
    this.stage.use(this.exterior.scene, this.exterior.camera, {
      sky: { scene: this.sky.scene, camera: this.sky.camera },
      bloomStrength: 0.55, bloomRadius: .7, bloomThreshold: .78, grain: .028,
    });
    if (!this.exterior.controls) this.exterior.attachControls(this.stage.renderer.domElement);
    this.exterior.controls.enabled = true;
    UI.setRoomLabel('Außenansicht', 'Station Hedera · 600 km');
    UI.close();
    UI.buildRooms();
    this.bindPointer();
  },

  goRoom(id) {
    if (!this.st.modules[id]?.built) return;
    this.mode = 'interior';
    this.room = id;
    if (this.exterior.controls) this.exterior.controls.enabled = false;
    this.interior.setRoom(id, this.st);
    const dir = this.interior.ctx.window?.dir
      ? this.interior.ctx.window.dir.clone()
      : new THREE.Vector3(0, -1, 0);
    this.roomEarthDir = dir.clone().normalize();
    this.roomQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.roomEarthDir);
    this.sky.earthGroup.position.copy(this.roomEarthDir).multiplyScalar(this.sky.earthDistance);

    const def = MOD_BY_ID[id];
    this.stage.use(this.interior.scene, this.interior.camera, {
      sky: { scene: this.sky.scene, camera: this.sky.camera },
      bloomStrength: id === 'lounge' ? .48 : .38, bloomRadius: .6, bloomThreshold: .82, grain: .022, vignette: 1.1,
    });
    UI.setRoomLabel(def.name, def.short + ' · Modul');
    const panelId = id === 'lounge' ? 'lounge'
      : id === 'lab' ? 'research'
      : id === 'systems' ? 'systems'
      : id === 'cargo' ? 'shop'
      : 'grow';
    UI.open(panelId, panelId === 'grow' ? id : undefined);
    UI.buildRooms();
    this.bindPointer();
    sfx.whoosh();
  },

  reloadRoom() { if (this.mode === 'interior' && this.room) this.interior.setRoom(this.room, this.st); },
  rebuildStation() { this.exterior.build(this.st); },
  syncScene() { if (this.mode === 'interior') this.interior.syncPlants(this.st); },

  bindPointer() {
    const dom = this.stage.renderer.domElement;
    if (this._pointerBound) return;
    this._pointerBound = true;
    let downAt = 0, downX = 0, downY = 0;
    dom.addEventListener('pointerdown', e => { downAt = performance.now(); downX = e.clientX; downY = e.clientY; });
    dom.addEventListener('pointermove', e => {
      const nx = (e.clientX / innerWidth) * 2 - 1;
      const ny = -(e.clientY / innerHeight) * 2 + 1;
      if (this.mode === 'exterior') {
        const hit = this.exterior.pick(nx, ny);
        this.exterior.setHover(hit?.moduleId || null);
        dom.style.cursor = hit ? 'pointer' : 'grab';
        if (hit) {
          const def = MOD_BY_ID[hit.moduleId];
          const built = this.st.modules[hit.moduleId]?.built;
          UI.showTip(`<b>${def.name}</b>${built ? def.desc : `Noch nicht gebaut — Freigabe ab Stufe ${def.level}.`}`, e.clientX, e.clientY);
        } else UI.hideTip();
      } else {
        this.interior.setPointer(nx, ny);
        const hit = this.interior.pick(nx, ny);
        dom.style.cursor = hit ? 'pointer' : 'default';
      }
    });
    dom.addEventListener('pointerleave', () => { UI.hideTip(); this.interior.setPointer(0, 0); });
    dom.addEventListener('pointerup', e => {
      const dt = performance.now() - downAt;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dt > 400 || moved > 6) return;
      const nx = (e.clientX / innerWidth) * 2 - 1;
      const ny = -(e.clientY / innerHeight) * 2 + 1;
      if (this.mode === 'exterior') {
        const hit = this.exterior.pick(nx, ny);
        if (hit) {
          if (this.st.modules[hit.moduleId]?.built) { sfx.open(); this.goRoom(hit.moduleId); }
          else { sfx.error(); UI.open('build'); }
        }
      } else {
        const hit = this.interior.pick(nx, ny);
        if (hit) {
          const slot = this.st.slots.find(s => s.id === hit.slotId);
          if (slot) {
            sfx.click();
            UI.open(this.room === 'lounge' ? 'lounge' : 'grow', this.room);
            // Detailfenster über das Panel-Modul öffnen
            const ev = new CustomEvent('slot:open', { detail: slot.id });
            document.dispatchEvent(ev);
          }
        }
      }
    });
  },

  /* ── Schleife ── */
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const t = now / 1000;
    const st = this.st;
    const nowMs = Date.now();

    /* Simulation */
    const log = SIM.live(st, nowMs);
    if (log.length) this.handleLog(log);

    /* Sonnenstand im Stationssystem */
    const sol = solar(nowMs);
    const b = beta(nowMs) * DEG;
    const ang = sol.phase * TAU;
    this.sunLocal.set(Math.cos(b) * Math.sin(ang), Math.cos(b) * Math.cos(ang), Math.sin(b)).normalize();

    this.sky.update(dt, t);

    if (this.mode === 'exterior') {
      this.sky.setSun(this.sunLocal);
      this.exterior.setSun(this.sunLocal, sol.sun);
      this.exterior.update(dt, t, st);
      this.sky.syncTo(this.exterior.camera);
    } else {
      const sunRoom = this.sunLocal.clone().applyQuaternion(this.roomQuat);
      this.sky.setSun(sunRoom);
      this.interior.update(dt, t, st, sol);
      this.sky.syncTo(this.interior.camera);
    }

    this.stage.render(dt);

    /* HUD & Speichern */
    this.hudTimer = (this.hudTimer || 0) + dt;
    if (this.hudTimer > 0.5) { this.hudTimer = 0; UI.tickHud(); }
    this.panelTimer = (this.panelTimer || 0) + dt;
    if (this.panelTimer > 3.5) {
      this.panelTimer = 0;
      if (UI.panel && ['grow', 'lounge', 'research', 'shop', 'systems'].includes(UI.panel.id) && $('.modal[hidden]')) UI.render();
      this.syncScene();
    }
    this.mailTimer += dt;
    if (this.mailTimer > 25) {
      this.mailTimer = 0;
      const nm = checkMail(st, nowMs);
      for (const m of nm) { sfx.mail(); UI.toast('mail', 'Neue Nachricht', m.subject); }
      if (nm.length) UI.tickHud();
    }
    this.saveTimer += dt;
    if (this.saveTimer > 12) { this.saveTimer = 0; this.save(); }
  },

  handleLog(log) {
    for (const e of log) {
      if (e.type === 'ready') UI.toast('ok', 'Erntereif', e.name);
      else if (e.type === 'death') UI.toast('bad', 'Eingegangen', `${e.name} hat es nicht geschafft.`);
      else if (e.type === 'delivery') { sfx.dock(); UI.toast('ok', 'Fracht angedockt', 'Die Lieferung ist an Bord.'); this.rebuildStation(); }
      else if (e.type === 'research') { sfx.research(); UI.toast('xp', 'Forschung abgeschlossen', e.name); this.rebuildStation(); }
      else if (e.type === 'module') { sfx.dock(); UI.toast('xp', 'Modul montiert', e.name); this.rebuildStation(); UI.buildRooms(); }
      else if (e.type === 'sick') UI.toast('warn', 'Befall', `${e.name}: ${e.what}`);
      else if (e.type === 'power') UI.toast('warn', 'Energie knapp', 'Der Akku ist leer — die Lampen werden abgeregelt.');
    }
    if (log.length) { UI.refresh(); this.syncScene(); }
  },

  save() { if (this.st) saveGame(this.st); },
  replaceState(st) {
    this.st = st;
    this.save();
    location.reload();
  },
  act: A,
};

/* Slot-Detail aus der 3D-Szene heraus öffnen */
document.addEventListener('slot:open', e => {
  setTimeout(() => {
    const slot = app.st.slots.find(s => s.id === e.detail);
    if (!slot) return;
    const idx = app.st.slots.filter(s => s.mod === slot.mod).findIndex(s => s.id === slot.id);
    document.querySelectorAll('.slots .slot')[idx]?.click();
  }, 60);
});

window.addEventListener('error', ev => {
  if (!bootEl.classList.contains('is-gone')) {
    const err = $('#boot-err');
    err.hidden = false;
    err.textContent = 'Fehler: ' + ev.message;
  }
});

app.boot();
window.__app = app;
