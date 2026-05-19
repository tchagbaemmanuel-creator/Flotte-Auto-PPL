/**
 * ═══════════════════════════════════════════════════════════════
 *   FLOTTE PPL — Serveur de synchronisation temps réel
 *   Node.js + Socket.IO + JWT
 *   Compatible FlottePPL_v30.html
 * ═══════════════════════════════════════════════════════════════
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const fs         = require('fs');
const path       = require('path');
const cors       = require('cors');
const db         = require('./lib/database');

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
const HTML_FILE  = path.join(__dirname, 'FlottePPL_v30.html');

// ─── INITIALISATION ───────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e9 // 1 Go — sync photos / exports
});

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

function saveData(data) {
  const persistFile = !(isMongoConnected() && IS_RENDER);
  if (persistFile) {
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('[DATA] Erreur écriture:', e.message); }
  }
  if (isMongoConnected()) {
    db.saveAll(data).catch((e) => console.error('[MONGO] Erreur écriture:', e.message));
  }
}

function persistKeyToMongo(key) {
  if (!isMongoConnected() || !key || key.startsWith('_ppl')) return;
  db.saveKey(key, DB[key]).catch((e) => console.error('[MONGO] Clé ' + key + ':', e.message));
  if (key === 'p5_ac' || key === 'p5_accounts') {
    db.persistUsersFromData(DB).catch((e) => console.error('[MONGO] users:', e.message));
  }
}

/** Fusionne les demandes d'inscription (évite d'écraser la file serveur avec le localStorage incomplet du demandeur). */
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

// Auto-sauvegarde toutes les 30 secondes
setInterval(() => saveData(DB), 30000);

// Sauvegarde à la fermeture
async function shutdown(signal) {
  try {
    saveData(DB);
    if (isMongoConnected()) await db.saveAll(DB);
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
        <p>Placez <strong>FlottePPL_v30.html</strong> dans le même dossier que <code>server.js</code></p>
        <p>Dossier attendu : <code>${__dirname}</code></p>
      </body></html>
    `);
  }
});

app.get('/FlottePPL_v30.html', (req, res) => {
  if (fs.existsSync(HTML_FILE)) res.sendFile(HTML_FILE);
  else res.redirect('/');
});

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
app.post('/api/data/:key', (req, res) => {
  const key   = decodeURIComponent(req.params.key);
  const value = req.body?.value;
  const user  = req.body?.user || 'HTTP';
  if (!key || key === '_ppl_jwt') return res.status(400).json({ error: 'Clé invalide' });

  if (key === 'p5_inscriptions_pending' && Array.isArray(value)) {
    DB[key] = mergeInscriptionPending(DB[key], value);
    console.log(`[INSCRIPTION] Mise à jour file d'attente (${DB[key].length} entrée(s)) par ${user}`);
  } else {
    DB[key] = value;
  }

  io.emit('data-update', { key, value: DB[key], changedBy: user });
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
    version: 'FlottePPL v30',
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
  socket.on('set-key', ({ key, value, user }) => {
    if (!key || key === '_ppl_jwt') return;
    const who = user || userName;
    if (key === 'p5_inscriptions_pending' && Array.isArray(value)) {
      DB[key] = mergeInscriptionPending(DB[key], value);
      io.emit('data-update', { key, value: DB[key], changedBy: who });
    } else {
      DB[key] = value;
      socket.broadcast.emit('data-update', { key, value, changedBy: who });
    }
    // Sauvegarde différée (évite les écritures trop fréquentes)
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
    // Sauvegarde finale
    saveData(DB);
  });
});

// ─── DÉMARRAGE ────────────────────────────────────────────────
(async () => {
  await initMongo();
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
