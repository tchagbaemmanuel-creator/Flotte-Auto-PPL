/**
 * Récupération des comptes — Flotte PPL (LECTURE SEULE)
 *
 * Se connecte à MongoDB Atlas et extrait les comptes depuis les DEUX sources :
 *   1) kv_store._id = "p5_ac"        (liste vivante synchronisée par les clients)
 *   2) collection "users"            (sauvegarde séparée, souvent intacte après un effacement)
 *
 * Le script NE MODIFIE RIEN. Il affiche les comptes trouvés et écrit la meilleure
 * liste dans « comptes-recuperes.json » (format réimportable côté application).
 *
 * ── Utilisation ──
 *  A) En local :
 *       1. Copier .env.example en .env et y mettre MONGODB_USER + MONGODB_PASSWORD + MONGODB_HOST
 *          (ou MONGODB_URI complète) — les mêmes valeurs que sur Render.
 *       2. npm install   (si besoin)
 *       3. node recover-accounts.js
 *  B) Sur Render (onglet « Shell ») où les variables d'env existent déjà :
 *       node recover-accounts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const db = require('./lib/database');

function describe(u) {
  return [
    '   • ' + (u.username || '(sans username)'),
    u.name || '',
    u.role || '',
    'actif=' + (u.active !== false),
    u.password ? 'mdp=oui' : 'mdp=NON'
  ].join('  |  ');
}

(async () => {
  const { uri, source } = db.resolveUri(process.env);
  if (!uri) {
    console.error('\n❌ Aucune URI MongoDB trouvée.');
    console.error('   Définissez MONGODB_USER + MONGODB_PASSWORD + MONGODB_HOST,');
    console.error('   ou MONGODB_URI complète (dans .env en local, ou variables Render).');
    process.exit(1);
  }

  const dbName = process.env.MONGODB_DB_NAME || 'flotte_ppl';
  console.log('[MONGO] Connexion (source URI = ' + source + ')…');
  const ok = await db.connect(uri, dbName, { preferIpv4: true });
  if (!ok) {
    console.error('\n❌ Connexion impossible : ' + (db.getState().error || 'inconnue'));
    process.exit(1);
  }

  // 1) kv_store → p5_ac / p5_accounts
  let kvAcc = [];
  try {
    const all = await db.loadAllKeys();
    kvAcc = Array.isArray(all.p5_ac) ? all.p5_ac
          : (Array.isArray(all.p5_accounts) ? all.p5_accounts : []);
  } catch (e) {
    console.warn('[kv_store] Lecture impossible : ' + e.message);
  }

  // 2) collection "users" (sauvegarde séparée)
  let usersAcc = [];
  try {
    usersAcc = await db.loadUsersTable();
  } catch (e) {
    console.warn('[users] Lecture impossible : ' + e.message);
  }

  console.log('\n────────── RÉSULTATS ──────────');
  console.log('kv_store « p5_ac »     : ' + kvAcc.length + ' compte(s)');
  console.log('collection « users »   : ' + usersAcc.length + ' compte(s)');

  if (kvAcc.length) {
    console.log('\n[kv_store]');
    kvAcc.forEach(function (u) { console.log(describe(u)); });
  }
  if (usersAcc.length) {
    console.log('\n[users]');
    usersAcc.forEach(function (u) { console.log(describe(u)); });
  }

  // Fusion : on garde l'union par username (la source la plus complète gagne).
  const byUser = {};
  function addAll(list) {
    list.forEach(function (u) {
      if (!u || !u.username) return;
      const k = String(u.username).trim().toLowerCase();
      const ex = byUser[k];
      // Préférer l'entrée qui possède un mot de passe.
      if (!ex || (!ex.password && u.password)) byUser[k] = u;
    });
  }
  addAll(usersAcc);
  addAll(kvAcc);
  const merged = Object.keys(byUser).map(function (k) { return byUser[k]; });

  console.log('\n────────── FUSION ──────────');
  console.log('Total comptes uniques  : ' + merged.length);
  merged.forEach(function (u) { console.log(describe(u)); });

  if (merged.length) {
    fs.writeFileSync('comptes-recuperes.json', JSON.stringify(merged, null, 2), 'utf8');
    console.log('\n✅ Comptes écrits dans : comptes-recuperes.json');
    console.log('   (aucune donnée modifiée côté serveur)');
  } else {
    console.log('\n⚠️ Aucun compte trouvé dans MongoDB.');
  }

  await db.disconnect();
  process.exit(0);
})().catch(function (e) {
  console.error('\nErreur inattendue : ' + (e && e.message ? e.message : e));
  process.exit(1);
});
