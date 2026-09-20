/*  Funkverkehr: Auslöser prüfen, zustellen, Anhänge gutschreiben. */

import { MAILS, MAIL_BY_ID, FLAVOR, PEOPLE, SERIES } from '../data/mails.js';
import * as S from './state.js';
import { beta, BETA_CRIT } from '../core/orbit.js';
import { uid, HOUR, DAY, clamp, pick, missionDay } from '../core/util.js';
import { emit } from '../core/events.js';

/** Platzhalter füllen. */
export function format(text, st) {
  return String(text)
    .replace(/Liebe\{r\}/g, 'Hallo')
    .replace(/\{name\}/g, st.name || 'Kommandant')
    .replace(/\{station\}/g, 'Hedera')
    .replace(/\{day\}/g, String(missionDay(Date.now(), st.t0)))
    .replace(/\{level\}/g, String(st.level));
}

const has = (st, id) => st.mail.items.some(m => m.tpl === id);
const sentAt = (st, id) => st.mail.items.find(m => m.tpl === id)?.at || 0;

function cooldownOk(st, id, hours, now) {
  const last = st.mail.cooldowns[id] || 0;
  return now - last >= hours * HOUR;
}

/** Wird ein Auslöser gerade erfüllt? */
function fires(st, m, now) {
  const t = m.trigger;
  if (!t) return false;
  if (t.start) return true;
  if (t.after) {
    const a = sentAt(st, t.after);
    return a > 0 && now - a >= (t.delayM || 0) * 60_000;
  }
  if (t.day != null) return missionDay(now, st.t0) >= t.day;
  if (t.level != null) return st.level >= t.level;
  if (t.firstHarvest) return st.stats.harvested >= 1;
  if (t.harvest) return (st.codex[t.harvest]?.harvested || 0) >= 1;
  if (t.firstDelivery) return st.stats.deliveries >= 1;
  if (t.waterLow) return st.water < S.waterCap(st) * 0.15 && cooldownOk(st, m.id, t.cooldownH || 24, now);
  if (t.powerLow) return !!st.flags.brownout && cooldownOk(st, m.id, t.cooldownH || 24, now);
  if (t.death) return st.stats.deaths > (st.mail.deathSeen || 0) && cooldownOk(st, m.id, t.cooldownH || 40, now);
  if (t.pollinationDue) return !!st.flags.pollenDue;
  if (t.eclipseFree) return Math.abs(beta(now)) > BETA_CRIT;
  return false;
}

function deliver(st, tpl, now, fromOverride) {
  const from = fromOverride || tpl.from;
  const person = PEOPLE[from] || PEOPLE.sys;
  const item = {
    uid: uid(), tpl: tpl.id || null, from,
    subject: format(tpl.subject, st),
    body: format(tpl.body, st),
    sig: tpl.sig ? format(tpl.sig, st) : person.name,
    at: now, read: false,
    reward: tpl.reward ? { ...tpl.reward } : null, claimed: !tpl.reward,
  };
  st.mail.items.unshift(item);
  if (st.mail.items.length > 160) st.mail.items.length = 160;
  emit('mail:new', item);
  return item;
}

/** Alle fälligen Nachrichten zustellen. */
export function checkMail(st, now = Date.now()) {
  const out = [];
  st.mail.cooldowns ||= {};

  for (const m of MAILS) {
    if (m.series || !m.trigger) continue;
    if (has(st, m.id)) {
      // wiederholbare Systemmeldungen
      if (m.trigger.cooldownH && fires(st, m, now)) {
        st.mail.cooldowns[m.id] = now;
        if (m.trigger.death) st.mail.deathSeen = st.stats.deaths;
        out.push(deliver(st, m, now));
      }
      continue;
    }
    if (fires(st, m, now)) {
      st.mail.cooldowns[m.id] = now;
      if (m.trigger.death) st.mail.deathSeen = st.stats.deaths;
      out.push(deliver(st, m, now));
    }
  }

  /* Briefreihe von Prof. Bello — alle ~34 Stunden der nächste. */
  if (now >= (st.mail.nextSeriesAt || 0) && st.mail.seriesIdx < SERIES.length) {
    const tpl = MAIL_BY_ID[SERIES[st.mail.seriesIdx]];
    if (tpl) {
      const item = deliver(st, tpl, now);
      item.subject = `Brief Nr. ${st.mail.seriesIdx + 3} — ` + item.subject.replace(/^Brief\s*—\s*/, '');
      out.push(item);
    }
    st.mail.seriesIdx++;
    st.mail.nextSeriesAt = now + (30 + Math.random() * 14) * HOUR;
  }

  /* Gelegentliche Lebenszeichen. */
  if (now >= (st.mail.nextFlavorAt || 0)) {
    const tpl = pick(FLAVOR);
    out.push(deliver(st, { ...tpl, id: null }, now));
    st.mail.nextFlavorAt = now + (26 + Math.random() * 40) * HOUR;
  }

  return out;
}

export function unread(st) { return st.mail.items.filter(m => !m.read).length; }

export function openMail(st, mailUid) {
  const m = st.mail.items.find(x => x.uid === mailUid);
  if (!m) return null;
  m.read = true;
  if (m.reward && !m.claimed) {
    const r = m.reward;
    if (r.credits) { st.credits += r.credits; st.stats.earned += r.credits; }
    if (r.xp) S.addXp(st, r.xp);
    if (r.mood) st.mood = clamp(st.mood + r.mood, 0, 10);
    if (r.seeds) for (const [id, n] of Object.entries(r.seeds)) st.seeds[id] = (st.seeds[id] || 0) + n;
    m.claimed = true;
    emit('mail:reward', { mail: m, reward: r });
  }
  return m;
}

export function markAllRead(st) { for (const m of st.mail.items) m.read = true; }
export const personOf = from => PEOPLE[from] || PEOPLE.sys;
