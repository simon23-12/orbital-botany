/* Winziger Event-Bus. */
const map = new Map();
export function on(evt, fn) {
  if (!map.has(evt)) map.set(evt, new Set());
  map.get(evt).add(fn);
  return () => off(evt, fn);
}
export function off(evt, fn) { map.get(evt)?.delete(fn); }
export function emit(evt, payload) {
  const s = map.get(evt);
  if (!s) return;
  for (const fn of [...s]) { try { fn(payload); } catch (e) { console.error('[bus]', evt, e); } }
}
