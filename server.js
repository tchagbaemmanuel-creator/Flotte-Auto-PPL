/**
 * ═══════════════════════════════════════════════════════════════
 *   FLOTTE PPL — Serveur de synchronisation temps réel
 *   Node.js + Socket.IO + JWT
 *   Compatible FlottePPL_v31.html
 * ═══════════════════════════════════════════════════════════════
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const fs         = require('fs');
const path       = require('path');
const cors       = require('cors');
const compression = require('compression');
const db         = require('./lib/database');
const { mergeDemandesCourse, mergeInscriptionPending } = require('./lib/merge');
const notifications = require('./lib/notifications');
const mailer     = require('./lib/mailer');

require('dotenv').config({ path: path.join(__dirname, '.env') });

/** Nettoie une URI copiée-collée (espaces, guillemets). */
function normalizeEnvString(v) {
  if (v == null) return '';
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

// ─── CONFIG ───────────────────────────────────────────────────
const PORT          = process.env.PORT || 3000;
const JWT_SECRET    = process.env.JWT_SECRET || 'flotte_ppl_secret_2024_local';
const { uri: MONGODB_URI, source: MONGO_URI_SOURCE } = db.resolveUri(process.env);
db.setUriSource(MONGO_URI_SOURCE);
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'flotte_ppl';
/** Render injecte RENDER=true ; le disque du conteneur n’est pas persistant entre redéploiements. */
const IS_RENDER     = process.env.RENDER === 'true';
const DATA_FILE  = path.join(__dirname, 'data', 'flotte_data.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const HTML_FILE  = path.join(__dirname, 'FlottePPL_v31.html');

// ─── INITIALISATION ───────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e9 // 1 Go — sync photos / exports
});

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '1gb' }));

// Créer le dossier data si absent
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// ─── PERSISTANCE JSON ─────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch(e) { console.error('[DATA] Erreur lecture:', e.message); }
  return {};
}

function isMongoConnected() {
  return db.getState().connected;
}

function mongoConnectError() {
  return db.getState().error;
}

/** Clés modifiées depuis la dernière écriture Mongo (évite saveAll toutes les 30 s → bande passante). */
const dirtyMongoKeys = new Set();

function markMongoDirty(key) {
  if (key && !key.startsWith('_ppl')) dirtyMongoKeys.add(key);
}

async function flushDirtyMongoKeys() {
  if (!isMongoConnected() || dirtyMongoKeys.size === 0) return;
  const keys = [...dirtyMongoKeys];
  dirtyMongoKeys.clear();
  for (const key of keys) {
    try {
      await db.saveKey(key, DB[key]);
      if (key === 'p5_ac' || key === 'p5_accounts') await db.persistUsersFromData(DB);
    } catch (e) {
      console.error('[MONGO] Clé ' + key + ':', e.message);
      dirtyMongoKeys.add(key);
    }
  }
}

function saveData(data) {
  const persistFile = !(isMongoConnected() && IS_RENDER);
  if (persistFile) {
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('[DATA] Erreur écriture:', e.message); }
  }
  // En local sans Render : sauvegarde Mongo complète occasionnelle OK
  if (isMongoConnected() && !IS_RENDER) {
    db.saveAll(data).catch((e) => console.error('[MONGO] Erreur écriture:', e.message));
  }
}

function persistKeyToMongo(key) {
  if (!isMongoConnected() || !key || key.startsWith('_ppl')) return;
  markMongoDirty(key);
  db.saveKey(key, DB[key]).catch((e) => {
    console.error('[MONGO] Clé ' + key + ':', e.message);
    markMongoDirty(key);
  });
  if (key === 'p5_ac' || key === 'p5_accounts') {
    db.persistUsersFromData(DB).catch((e) => console.error('[MONGO] users:', e.message));
  }
}

/** Applique une mise à jour de clé (fusion + notifications + Mongo). */
async function applyKeyUpdate(key, value, user) {
  const prev = DB[key];
  let next = value;

  if (key === 'p5_inscriptions_pending' && Array.isArray(value)) {
    next = mergeInscriptionPending(prev, value);
    try {
      const withFlags = await notifications.onInscriptionsUpdated(prev, next, DB);
      if (withFlags) next = withFlags;
    } catch (e) {
      console.error('[NOTIF]', e.message);
    }
    console.log(`[INSCRIPTION] Mise à jour file d'attente (${next.length} entrée(s)) par ${user}`);
  } else if (key === 'p5_demandes_course' && Array.isArray(value)) {
    next = mergeDemandesCourse(prev, value);
    try {
      const withFlags = await notifications.onDemandesUpdated(prev, next, DB);
      if (withFlags) next = withFlags;
    } catch (e) {
      console.error('[NOTIF]', e.message);
    }
  } else {
    next = value;
  }

  DB[key] = next;
  markMongoDirty(key);
  return next;
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch(e) {}
  // Comptes par défaut (identiques à ceux de l'appli)
  const defaults = [
    { id:1, name:'Administrateur PPL', username:'admin',      password:'ppl2024',   role:'admin',   email:'admin@ppl.ci',      dept:'Direction',   active:true },
    { id:2, name:'Gestionnaire',       username:'logistique', password:'flotte123', role:'manager', email:'logistique@ppl.ci', dept:'Logistique',  active:true },
    { id:3, name:'Opérateur',          username:'operateur',  password:'op2024',    role:'reader',  email:'operateur@ppl.ci',  dept:'Opérations',  active:true }
  ];
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2));
  return defaults;
}

// Sur Render avec Atlas : ne pas partir d’un JSON éphémère sur disque ; Atlas est la source de vérité.
let DB = IS_RENDER && MONGODB_URI ? {} : loadData();

/** Connexion Atlas — kv_store (par clé) + GridFS médias ; migration auto depuis app_state. */
async function initMongo() {
  if (IS_RENDER && !MONGODB_URI) {
    console.warn('[RENDER] MongoDB non configuré : ajoutez MONGODB_USER + MONGODB_PASSWORD + MONGODB_HOST (recommandé), ou MONGODB_URI complète (Atlas → Connect).');
  }
  if (!MONGODB_URI) return;
  if (MONGO_URI_SOURCE === 'split') {
    console.log('[MONGO] URI construite depuis USER + PASSWORD + HOST (encodage géré par le serveur).');
  }
  const ok = await db.connect(MONGODB_URI, MONGODB_DB_NAME, { preferIpv4: IS_RENDER });
  if (!ok) {
    const err = mongoConnectError() || '';
    if (/EBADNAME|querySrv/i.test(err)) {
      console.error('[MONGO] Cause fréquente : mot de passe avec @ < > — utilisez MONGODB_USER + PASSWORD + HOST séparés.');
    }
    if (/SSL alert|tlsv1 alert|0A000438|ssl3_read_bytes/i.test(err)) {
      console.error('[MONGO] Erreur SSL/TLS : identifiants ou cluster incorrect.');
    }
    if (IS_RENDER) {
      console.error('[RENDER] Sans MongoDB, les données ne survivront pas aux redéploiements.');
    }
    return;
  }
  const legacyCol = db.getState().client.db(MONGODB_DB_NAME).collection('app_state');
  const fromMongo = await db.loadAllKeys(legacyCol);
  const keysMongo = Object.keys(fromMongo).length;
  const keysFile = Object.keys(DB).length;
  if (keysMongo > 0) {
    DB = fromMongo;
    console.log(`[MONGO] ${keysMongo} clé(s) en mémoire (kv_store + GridFS).`);
  } else if (keysFile > 0) {
    await db.saveAll(DB);
    console.log(`[MONGO] Données locales copiées vers kv_store (${keysFile} clé(s)).`);
  } else {
    console.log('[MONGO] Base vide — prêt à enregistrer.');
  }
  await db.syncUsersWithData(DB);
}

// Auto-sauvegarde : fichier local OU clés Mongo modifiées uniquement (pas de saveAll sur Render)
setInterval(() => {
  if (isMongoConnected() && IS_RENDER) {
    flushDirtyMongoKeys().catch((e) => console.error('[MONGO] flush:', e.message));
  } else {
    saveData(DB);
  }
}, 30000);

// Sauvegarde à la fermeture
async function shutdown(signal) {
  try {
    if (isMongoConnected()) await flushDirtyMongoKeys();
    saveData(DB);
  } catch (e) {
    console.error('[SHUTDOWN]', e.message);
  }
  await db.disconnect();
  if (signal) console.log('\n✅ Données sauvegardées. Arrêt.');
  process.exit(0);
}

process.on('SIGINT',  () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

// ─── UTILITAIRES ──────────────────────────────────────────────
function verifyJWT(token) {
  if (!token || token === 'local') return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch(e) { return null; }
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '?';
}

// ─── ROUTES HTTP ──────────────────────────────────────────────

// Servir l'application HTML
app.get('/', (req, res) => {
  if (fs.existsSync(HTML_FILE)) {
    res.sendFile(HTML_FILE);
  } else {
    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#f8f6f2">
        <h2>⚠️ Fichier introuvable</h2>
        <p>Placez <strong>FlottePPL_v31.html</strong> dans le même dossier que <code>server.js</code></p>
        <p>Dossier attendu : <code>${__dirname}</code></p>
      </body></html>
    `);
  }
});

app.get('/FlottePPL_v31.html', (req, res) => {
  if (fs.existsSync(HTML_FILE)) res.sendFile(HTML_FILE);
  else res.redirect('/');
});

app.get('/FlottePPL_v30.html', (req, res) => res.redirect('/FlottePPL_v31.html'));

// ── AUTH : Login ──
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });

  let users = loadUsers();
  if (isMongoConnected()) {
    try {
      const fromMongo = await db.loadUsersTable();
      if (fromMongo.length) users = fromMongo;
    } catch (e) {
      console.error('[AUTH] Lecture collection users:', e.message);
    }
  }
  const dbAccounts = DB['p5_ac'] || DB['p5_accounts'] || [];
  if (dbAccounts.length) users = dbAccounts;

  const uname = String(username).trim().toLowerCase();
  const user = users.find(u =>
    u.username && String(u.username).trim().toLowerCase() === uname &&
    u.password === password &&
    u.active !== false
  );
  if (!user) {
    console.log(`[AUTH] Échec login: ${username} depuis ${getClientIP(req)}`);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log(`[AUTH] ✅ Connexion: ${user.name} (${user.role})`);
  res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role, dept: user.dept } });
});

// ── AUTH : Verify token ──
app.get('/api/auth/verify', (req, res) => {
  const auth  = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  const payload = verifyJWT(token);
  if (!payload) return res.status(401).json({ error: 'Token invalide' });
  res.json({ valid: true, user: payload });
});

// ── DATA : Lire toutes les données ──
app.get('/api/data', (req, res) => {
  res.json(DB);
});

// ── DATA : Lire une clé ──
app.get('/api/data/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  res.json(DB[key] !== undefined ? DB[key] : null);
});

// ── DATA : Écrire une clé (fallback HTTP sans socket) ──
app.post('/api/data/:key', async (req, res) => {
  const key   = decodeURIComponent(req.params.key);
  const value = req.body?.value;
  const user  = req.body?.user || 'HTTP';
  if (!key || key === '_ppl_jwt') return res.status(400).json({ error: 'Clé invalide' });

  const stored = await applyKeyUpdate(key, value, user);
  io.emit('data-update', { key, value: stored, changedBy: user });
  persistKeyToMongo(key);
  res.json({ ok: true });
});

// ── MÉDIAS GridFS (photos, scans) ──
app.get('/api/media/:id', async (req, res) => {
  const id = req.params.id;
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'ID invalide' });
  const stream = db.openMediaDownloadStream(id);
  if (!stream) return res.status(404).json({ error: 'Fichier introuvable' });
  try {
    const meta = await db.getMediaMetadata(id);
    if (meta?.metadata?.mime) res.setHeader('Content-Type', meta.metadata.mime);
    else if (meta?.contentType) res.setHeader('Content-Type', meta.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── STATUT serveur ──
app.get('/api/status', async (req, res) => {
  const connected = [...io.sockets.sockets.values()].length;
  const envKeysTried = ['MONGODB_URI', 'MONGO_URI', 'DATABASE_URL'];
  const mongoEnvHints = Object.fromEntries(
    envKeysTried.map((k) => [k, !!normalizeEnvString(process.env[k])])
  );
  mongoEnvHints.MONGODB_USER = !!normalizeEnvString(process.env.MONGODB_USER || process.env.MONGO_USER);
  mongoEnvHints.MONGODB_PASSWORD = !!(process.env.MONGODB_PASSWORD ?? process.env.MONGO_PASSWORD);
  mongoEnvHints.MONGODB_HOST = !!normalizeEnvString(process.env.MONGODB_HOST || process.env.MONGO_HOST);

  let hint = null;
  if (!MONGODB_URI) {
    hint = 'Render → Environment : ajoutez MONGODB_USER, MONGODB_PASSWORD, MONGODB_HOST (recommandé) ou une MONGODB_URI valide, puis redéployez.';
  }
  const mErr = mongoConnectError();
  if (!isMongoConnected() && mErr) {
    if (/EBADNAME|querySrv/i.test(mErr)) {
      hint = 'URI invalide : utilisez MONGODB_USER + MONGODB_PASSWORD + MONGODB_HOST pour éviter les caractères spéciaux dans une seule chaîne.';
    } else if (/SSL alert|tlsv1 alert|0A000438|ssl3_read_bytes/i.test(mErr)) {
      hint = 'Erreur SSL : identifiants ou cluster incorrect. Définissez MONGODB_USER + MONGODB_PASSWORD + MONGODB_HOST (mot de passe brut OK). Vérifiez Network Access Atlas (0.0.0.0/0).';
    } else {
      hint = 'Vérifiez mot de passe, Network Access Atlas 0.0.0.0/0, et le nom de base.';
    }
  }

  let mongoStorage = null;
  if (isMongoConnected()) {
    try { mongoStorage = await db.getStorageStats(); } catch (_) {}
  }

  res.json({
    status: 'online',
    version: 'FlottePPL v31',
    connectedUsers: connected,
    dataKeys: Object.keys(DB).length,
    uptime: Math.floor(process.uptime()) + 's',
    mongo: isMongoConnected(),
    mongoMode: 'kv_store+gridfs',
    mongoStorage,
    render: IS_RENDER,
    mongoUsersTable: isMongoConnected(),
    mongoUriSource: MONGO_URI_SOURCE,
    mongoUriResolved: !!MONGODB_URI,
    mongoEnvPresent: mongoEnvHints,
    mongoConnectError: MONGODB_URI && !isMongoConnected() ? mErr : null,
    mail: mailer.isConfigured(),
    mailProvider: mailer.getProvider(),
    mailFrom: mailer.isConfigured() ? mailer.resolveFrom() : null,
    mailVerifyError: mailer.getLastVerifyError(),
    mailEnv: {
      BREVO_API_KEY: !!normalizeEnvString(process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY),
      BREVO_SENDER_EMAIL: !!normalizeEnvString(process.env.BREVO_SENDER_EMAIL),
      SMTP_HOST: !!normalizeEnvString(process.env.SMTP_HOST),
      SMTP_USER: !!normalizeEnvString(process.env.SMTP_USER),
      SMTP_PASS: !!(process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD),
      MAIL_FROM: !!normalizeEnvString(process.env.MAIL_FROM),
      APP_URL: !!normalizeEnvString(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL),
      MAIL_ADMIN_NOTIFY: !!normalizeEnvString(process.env.MAIL_ADMIN_NOTIFY)
    },
    mailHint: IS_RENDER && mailer.getProvider() === 'smtp'
      ? 'Render bloque souvent le SMTP sortant (timeout). Ajoutez BREVO_API_KEY + BREVO_SENDER_EMAIL sur Render.'
      : (!mailer.isConfigured()
        ? 'Ajoutez BREVO_API_KEY (Render) ou SMTP_* (local).'
        : null),
    hint
  });
});

// ─── SOCKET.IO ────────────────────────────────────────────────
const onlineUsers = new Map(); // socketId → { name, role }

io.on('connection', (socket) => {
  const auth     = socket.handshake?.auth;
  const token    = auth?.token;
  const payload  = verifyJWT(token);
  const userName = payload?.name || auth?.name || 'Utilisateur';
  const userRole = payload?.role || 'reader';

  console.log(`[SOCKET] ✅ Connecté: ${userName} (${socket.id.slice(0,8)})`);

  // Envoyer toutes les données au nouvel arrivant
  socket.emit('initial-data', DB);

  // Informer les autres
  socket.broadcast.emit('user-joined', { name: userName, role: userRole });
  onlineUsers.set(socket.id, { name: userName, role: userRole });
  io.emit('users-online', [...onlineUsers.values()]);

  // ── Mise à jour d'une clé ──
  socket.on('set-key', async ({ key, value, user }) => {
    if (!key || key === '_ppl_jwt') return;
    const who = user || userName;
    const stored = await applyKeyUpdate(key, value, who);
    io.emit('data-update', { key, value: stored, changedBy: who });
    clearTimeout(socket._saveTimer);
    socket._saveTimer = setTimeout(() => {
      if (!(isMongoConnected() && IS_RENDER)) {
        try {
          const tmp = DATA_FILE + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(DB, null, 2), 'utf8');
          fs.renameSync(tmp, DATA_FILE);
        } catch (e) { console.error('[DATA] Erreur écriture:', e.message); }
      }
      if (isMongoConnected()) persistKeyToMongo(key);
    }, 2000);
  });

  // ── Sync complète (admin) ──
  socket.on('request-full-sync', () => {
    socket.emit('initial-data', DB);
  });

  // ── Hello utilisateur (après login) ──
  socket.on('user-hello', ({ name, role }) => {
    onlineUsers.set(socket.id, { name: name || userName, role: role || userRole });
    io.emit('users-online', [...onlineUsers.values()]);
  });

  // ── Déconnexion ──
  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] 🔴 Déconnecté: ${userName} (${reason})`);
    onlineUsers.delete(socket.id);
    socket.broadcast.emit('user-left', { name: userName });
    io.emit('users-online', [...onlineUsers.values()]);
    if (isMongoConnected() && IS_RENDER) {
      flushDirtyMongoKeys().catch((e) => console.error('[MONGO] flush disconnect:', e.message));
    } else {
      saveData(DB);
    }
  });
});

// ─── DÉMARRAGE ────────────────────────────────────────────────
(async () => {
  mailer.init();
  if (mailer.isConfigured()) {
    await mailer.verifyConnection();
  }
  await initMongo();
  try {
    const patched = await notifications.flushPendingInscriptionEmails(DB);
    if (patched) {
      DB.p5_inscriptions_pending = patched;
      markMongoDirty('p5_inscriptions_pending');
      if (isMongoConnected()) {
        await db.saveKey('p5_inscriptions_pending', patched);
      }
    }
  } catch (e) {
    console.error('[NOTIF] Rattrapage inscriptions:', e.message);
  }
  try {
    const patchedDem = await notifications.flushPendingDemandeEmails(DB);
    if (patchedDem) {
      DB.p5_demandes_course = patchedDem;
      markMongoDirty('p5_demandes_course');
      if (isMongoConnected()) {
        await db.saveKey('p5_demandes_course', patchedDem);
      }
    }
  } catch (e) {
    console.error('[NOTIF] Rattrapage demandes:', e.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let localIP = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
      }
      if (localIP !== 'localhost') break;
    }
    const persist = isMongoConnected()
      ? 'MongoDB Atlas — kv_store + GridFS (connecté)'
      : MONGODB_URI
        ? 'MongoDB : échec de connexion (voir messages [MONGO] ci-dessus)'
        : 'fichiers JSON uniquement (data/)';
    console.log('[BOOT] Flotte PPL — build avec Socket.IO + persistance ' + (MONGODB_URI ? 'Mongo' : 'JSON'));
    console.log(`[BOOT] Mode données : ${persist}${IS_RENDER ? ' | Render' : ''}`);
    console.log(`[HTTP] Flotte PPL — http://${localIP}:${PORT}/`);
  });
})();
