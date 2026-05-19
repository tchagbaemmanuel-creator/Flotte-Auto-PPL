/**
 * Teste la connexion MongoDB (local ou variables Render).
 * Usage : node scripts/check-mongo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../lib/database');

const { uri, source } = db.resolveUri(process.env);
const dbName = (process.env.MONGODB_DB_NAME || 'flotte_ppl').trim();

console.log('─── Test MongoDB Flotte PPL ───');
console.log('Source URI :', source);
console.log('Base       :', dbName);

if (!uri) {
  console.log('\n❌ Mongo NON configuré.');
  console.log('   Créez un fichier .env (voir .env.example) ou définissez sur Render :');
  console.log('   MONGODB_USER + MONGODB_PASSWORD + MONGODB_HOST');
  console.log('   ou MONGODB_URI');
  process.exit(1);
}

(async () => {
  const ok = await db.connect(uri, dbName, { preferIpv4: true });
  if (!ok) {
    console.log('\n❌ Échec connexion :', db.getState().error);
    process.exit(1);
  }
  const stats = await db.getStorageStats();
  console.log('\n✅ Mongo CONNECTÉ');
  console.log('   Clés kv_store :', stats.kvKeys);
  console.log('   Comptes users :', stats.users);
  console.log('   Fichiers média:', stats.mediaFiles, '(' + Math.round(stats.mediaBytes / 1024) + ' Ko)');
  await db.disconnect();
  process.exit(0);
})();
