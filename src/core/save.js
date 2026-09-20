/*  Speichern im Browser + Export/Import als JSON. */
import { migrate, freshState, SAVE_VERSION } from '../game/state.js';

export const KEY = 'orbital-botany.save.v1';
export const BACKUP = 'orbital-botany.backup.v1';

export function save(st) {
  try {
    const json = JSON.stringify(st);
    const prev = localStorage.getItem(KEY);
    if (prev && prev.length > 200) localStorage.setItem(BACKUP, prev);
    localStorage.setItem(KEY, json);
    return true;
  } catch (e) {
    console.warn('[save] fehlgeschlagen', e);
    return false;
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('[load] beschädigt, versuche Sicherung', e);
    try {
      const b = localStorage.getItem(BACKUP);
      if (b) return migrate(JSON.parse(b));
    } catch {}
    return null;
  }
}

export function wipe() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(BACKUP);
}

export function exportFile(st) {
  const payload = { game: 'orbital-botany', version: SAVE_VERSION, exported: new Date().toISOString(), state: st };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `hedera_${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function importText(text) {
  const data = JSON.parse(text);
  const raw = data?.state ?? data;
  const st = migrate(raw);
  if (!st || !Array.isArray(st.slots)) throw new Error('Kein gültiger Spielstand');
  return st;
}

export const newGame = name => freshState(name);
