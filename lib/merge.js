/** Fusionne les tableaux de demandes de course (évite l'écrasement multi-agents). */

function mergeDemandesCourse(prev, incoming) {
  if (!Array.isArray(incoming)) return incoming;
  const map = new Map();
  for (const d of Array.isArray(prev) ? prev : []) {
    if (d && d.id != null) map.set(String(d.id), d);
  }
  for (const d of incoming) {
    if (!d || d.id == null) continue;
    const id = String(d.id);
    const ex = map.get(id);
    if (!ex) {
      map.set(id, d);
      continue;
    }
    const exU = String(ex.updatedAt || ex.createdAt || '');
    const dU = String(d.updatedAt || d.createdAt || '');
    map.set(id, dU >= exU ? Object.assign({}, ex, d) : ex);
  }
  return Array.from(map.values()).sort((a, b) =>
    String(b.createdAt || b.dateDepart || '').localeCompare(String(a.createdAt || a.dateDepart || ''))
  );
}

function mergeInscriptionPending(prev, incoming) {
  if (!Array.isArray(incoming)) return incoming;
  const map = new Map();
  for (const p of Array.isArray(prev) ? prev : []) {
    if (p && p.id != null) map.set(String(p.id), p);
  }
  for (const p of incoming) {
    if (p && p.id != null) map.set(String(p.id), p);
  }
  return [...map.values()];
}

module.exports = { mergeDemandesCourse, mergeInscriptionPending };
