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
const { MongoClient } = require('mongodb');

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

/** Première URI Mongo valide parmi les variables usuelles (Render / autres hébergeurs). */
function resolveMongoUri() {
  const keys = ['MONGODB_URI', 'MONGO_URI', 'DATABASE_URL'];
  for (const k of keys) {
    const u = normalizeEnvString(process.env[k]);
    if (u.startsWith('mongodb://') || u.startsWith('mongodb+srv://')) return u;
  }
  return '';
}

// ─── CONFIG ───────────────────────────────────────────────────
const PORT          = process.env.PORT || 3000;
const JWT_SECRET    = process.env.JWT_SECRET || 'flotte_ppl_secret_2024_local';
const MONGODB_URI   = resolveMongoUri();
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
  pingInterval: 25000
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

let mongoClient     = null;
let mongoCollection = null;
/** Dernière erreur de connexion Mongo (message seul, jamais l’URI). */
let mongoConnectError = null;

async function saveDataMongo(data) {
  if (!mongoCollection) return;
  await mongoCollection.replaceOne(
    { _id: 'main' },
    { _id: 'main', data, updatedAt: new Date() },
    { upsert: true }
  );
}

function saveData(data) {
  const persistFile = !(mongoCollection && IS_RENDER);
  if (persistFile) {
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('[DATA] Erreur écriture:', e.message); }
  }
  saveDataMongo(data).catch((e) => console.error('[MONGO] Erreur écriture:', e.message));
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

/** Connexion Atlas et chargement du document principal si présent. */
async function initMongo() {
  mongoConnectError = null;
  if (IS_RENDER && !MONGODB_URI) {
    console.warn('[RENDER] MONGODB_URI manquant : les données seront perdues au redémarrage / redéploiement. Ajoutez la variable sur Render (Atlas → Connect → Drivers).');
  }
  if (!MONGODB_URI) {
    console.log('[MONGO] URI Mongo absente — essayez la clé exacte MONGODB_URI, ou MONGO_URI / DATABASE_URL (chaîne mongodb…). Persistance : fichiers JSON (data/).');
    return;
  }
  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 20_000,
      connectTimeoutMS: 20_000
    });
    await mongoClient.connect();
    const mdb = mongoClient.db(MONGODB_DB_NAME);
    mongoCollection = mdb.collection('app_state');
    const doc = await mongoCollection.findOne({ _id: 'main' });
    const fromMongo = doc && doc.data && typeof doc.data === 'object' ? doc.data : null;
    const keysMongo = fromMongo ? Object.keys(fromMongo).length : 0;
    const keysFile  = Object.keys(DB).length;
    if (keysMongo > 0) {
      DB = fromMongo;
      console.log(`[MONGO] Connecté — ${keysMongo} clé(s) chargée(s) depuis Atlas (${MONGODB_DB_NAME}.app_state).`);
    } else if (keysFile > 0) {
      await saveDataMongo(DB);
      console.log(`[MONGO] Connecté — données locales copiées vers Atlas (${keysFile} clé(s)).`);
    } else {
      console.log(`[MONGO] Connecté — base vide (prêt à enregistrer dans ${MONGODB_DB_NAME}.app_state).`);
    }
    mongoConnectError = null;
  } catch (e) {
    mongoConnectError = e.message || String(e);
    console.error('[MONGO] Connexion impossible:', mongoConnectError);
    if (/EBADNAME|querySrv/i.test(mongoConnectError)) {
      console.error('[MONGO] Cause fréquente : le mot de passe contient @ < > : / ? # sans encodage — l’URI est alors mal découpée (l’hôte doit être *.mongodb.net).');
      console.error('[MONGO] Corrigez : dans PowerShell, node -e "console.log(encodeURIComponent(\'VOTRE_MOT_DE_PASSE\'))" puis remplacez dans l’URI la partie après le premier : et avant le @ par ce résultat (sans guillemets en trop).');
    }
    if (IS_RENDER && MONGODB_URI) {
      console.error('[RENDER] Sans MongoDB, les données ne survivront pas aux redéploiements. Vérifiez MONGODB_URI et Network Access Atlas (0.0.0.0/0 ou IP Render).');
    }
    mongoCollection = null;
    if (mongoClient) {
      try { await mongoClient.close(); } catch (_) {}
    }
    mongoClient = null;
  }
}

// Auto-sauvegarde toutes les 30 secondes
setInterval(() => saveData(DB), 30000);

// Sauvegarde à la fermeture
async function shutdown(signal) {
  try {
    saveData(DB);
    if (mongoCollection) await saveDataMongo(DB);
  } catch (e) {
    console.error('[SHUTDOWN]', e.message);
  }
  if (mongoClient) {
    try { await mongoClient.close(); } catch (_) {}
  }
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
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });

  // Chercher d'abord dans la DB (comptes créés dans l'appli)
  let users = loadUsers();
  const dbAccounts = DB['p5_ac'] || DB['p5_accounts'] || [];
  if (dbAccounts.length) users = dbAccounts;

  const user = users.find(u => u.username === username && u.password === password && u.active !== false);
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
  res.json({ ok: true });
});

// ── STATUT serveur ──
app.get('/api/status', (req, res) => {
  const connected = [...io.sockets.sockets.values()].length;
  const envKeysTried = ['MONGODB_URI', 'MONGO_URI', 'DATABASE_URL'];
  const mongoEnvHints = Object.fromEntries(
    envKeysTried.map((k) => [k, !!normalizeEnvString(process.env[k])])
  );
  res.json({
    status: 'online',
    version: 'FlottePPL v20',
    connectedUsers: connected,
    dataKeys: Object.keys(DB).length,
    uptime: Math.floor(process.uptime()) + 's',
    mongo: !!mongoCollection,
    render: IS_RENDER,
    /** true si une des variables d’environnement contient une chaîne non vide (sans afficher la valeur). */
    mongoUriResolved: !!MONGODB_URI,
    mongoEnvPresent: mongoEnvHints,
    /** Si URI résolue mais mongo false : message d’erreur Atlas / réseau (sinon null). */
    mongoConnectError: MONGODB_URI && !mongoCollection ? mongoConnectError : null,
    hint: !MONGODB_URI
      ? 'Sur Render → Environment : ajoutez MONGODB_URI = chaîne complète Atlas (mongodb+srv://...). Redéployez.'
      : !mongoCollection && mongoConnectError
        ? (/EBADNAME|querySrv/i.test(mongoConnectError)
            ? 'URI invalide : encodez le mot de passe (caractères @ < > etc.) ; l’hôte doit être cluster0.xxx.mongodb.net sans caractère en trop en fin de variable.'
            : 'Vérifiez mot de passe (souvent à encoder), Network Access Atlas 0.0.0.0/0, et le nom de base dans l’URI.')
        : null
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
    socket._saveTimer = setTimeout(() => saveData(DB), 2000);
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
    const persist = mongoCollection
      ? 'MongoDB Atlas (connecté)'
      : MONGODB_URI
        ? 'MongoDB : échec de connexion (voir messages [MONGO] ci-dessus)'
        : 'fichiers JSON uniquement (data/)';
    console.log('[BOOT] Flotte PPL — build avec Socket.IO + persistance ' + (MONGODB_URI ? 'Mongo' : 'JSON'));
    console.log(`[BOOT] Mode données : ${persist}${IS_RENDER ? ' | Render' : ''}`);
    console.log(`[HTTP] Flotte PPL — http://${localIP}:${PORT}/`);
  });
})();
