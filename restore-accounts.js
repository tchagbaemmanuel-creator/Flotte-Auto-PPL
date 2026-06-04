/**
 * Restauration des comptes vers MongoDB (kv_store p5_ac + collection users).
 * Lit comptes-complets.json (export localStorage admin).
 *
 * Usage : node restore-accounts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const db = require('./lib/database');

const INPUT = path.join(__dirname, 'comptes-complets.json');

function userKey(a) {
  return a && a.username ? String(a.username).trim().toLowerCase() : '';
}

/** Déduplique par username (garde l'entrée la plus récente si doublon). */
function dedupeByUsername(list) {
  const byUser = {};
  for (const u of list) {
    const k = userKey(u);
    if (!k) continue;
    const ex = byUser[k];
    if (!ex) {
      byUser[k] = u;
      continue;
    }
    const exT = String(ex.updatedAt || ex.createdAt || '');
    const uT = String(u.updatedAt || u.createdAt || '');
    if (uT >= exT) byUser[k] = u;
  }
  return Object.values(byUser);
}

(async () => {
  if (!fs.existsSync(INPUT)) {
    console.error('❌ Fichier introuvable : comptes-complets.json');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  } catch (e) {
    console.error('❌ JSON invalide dans comptes-complets.json :', e.message);
    process.exit(1);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    console.error('❌ comptes-complets.json doit être un tableau non vide.');
    process.exit(1);
  }

  const accounts = dedupeByUsername(raw);
  if (accounts.length < raw.length) {
    console.warn(`[INFO] ${raw.length - accounts.length} doublon(s) username fusionné(s) → ${accounts.length} compte(s).`);
  }

  const { uri, source } = db.resolveUri(process.env);
  if (!uri) {
    console.error('❌ MongoDB non configuré (.env).');
    process.exit(1);
  }

  const dbName = process.env.MONGODB_DB_NAME || 'flotte_ppl';
  console.log('[MONGO] Connexion (' + source + ')…');
  const ok = await db.connect(uri, dbName, { preferIpv4: true });
  if (!ok) {
    console.error('❌ Connexion impossible :', db.getState().error);
    process.exit(1);
  }

  await db.saveKey('p5_ac', accounts);
  await db.persistUsersFromData({ p5_ac: accounts });

  console.log('\n✅ Restauration terminée');
  console.log('   • kv_store « p5_ac » : ' + accounts.length + ' compte(s)');
  console.log('   • collection « users » : synchronisée');
  console.log('\nComptes restaurés :');
  accounts.forEach((u) => {
    console.log('   • ' + u.username + '  |  ' + (u.name || '') + '  |  ' + (u.role || '') + '  |  actif=' + (u.active !== false));
  });
  console.log('\n→ Demandez à chaque utilisateur de recharger l’application (F5).');

  await db.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('Erreur :', e.message || e);
  process.exit(1);
});
