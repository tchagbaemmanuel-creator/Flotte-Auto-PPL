/**
 * Persistance MongoDB — Flotte PPL
 * - Une collection par clé métier (pas de plafond 16 Mo sur tout le parc)
 * - GridFS pour photos / pièces jointes (volume quasi illimité selon Atlas / disque)
 */

const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

const MEDIA_PREFIX = '/api/media/';
const MEDIA_MIN_CHARS = 40 * 1024; // ~40 Ko base64 → GridFS

let mongoClient = null;
let mongoDb = null;
let kvCollection = null;
let usersCollection = null;
let metaCollection = null;
let gridBucket = null;
let mongoConnectError = null;
let mongoUriSource = 'none';

function getState() {
  return {
    connected: !!kvCollection,
    client: mongoClient,
    kv: kvCollection,
    users: usersCollection,
    meta: metaCollection,
    gridBucket,
    error: mongoConnectError,
    uriSource: mongoUriSource
  };
}

function buildUriFromParts(env) {
  const user = normalize(env.MONGODB_USER || env.MONGO_USER);
  const host = normalize(env.MONGODB_HOST || env.MONGO_HOST);
  const passRaw = env.MONGODB_PASSWORD ?? env.MONGO_PASSWORD;
  if (passRaw == null || user === '' || host === '') return '';
  const pass = String(passRaw).replace(/\r/g, '');
  if (pass === '') return '';
  const dbName = (normalize(env.MONGODB_DB_NAME || 'flotte_ppl') || 'flotte_ppl').replace(/^\/+|\/+$/g, '');
  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${dbName}?retryWrites=true&w=majority`;
}

function resolveUri(env) {
  const fromParts = buildUriFromParts(env);
  if (fromParts) return { uri: fromParts, source: 'split' };
  for (const k of ['MONGODB_URI', 'MONGO_URI', 'DATABASE_URL']) {
    const u = normalize(env[k]);
    if (u.startsWith('mongodb://') || u.startsWith('mongodb+srv://')) return { uri: u, source: 'uri' };
  }
  return { uri: '', source: 'none' };
}

function normalize(v) {
  if (v == null) return '';
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function connect(uri, dbName, opts = {}) {
  mongoConnectError = null;
  kvCollection = null;
  usersCollection = null;
  metaCollection = null;
  gridBucket = null;

  if (!uri) {
    console.log('[MONGO] URI absente — définissez MONGODB_USER + PASSWORD + HOST ou MONGODB_URI.');
    return false;
  }

  try {
    const clientOpts = {
      serverSelectionTimeoutMS: 20_000,
      connectTimeoutMS: 20_000,
      maxPoolSize: 20
    };
    if (opts.preferIpv4) clientOpts.family = 4;

    mongoClient = new MongoClient(uri, clientOpts);
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    kvCollection = mongoDb.collection('kv_store');
    usersCollection = mongoDb.collection('users');
    metaCollection = mongoDb.collection('meta');
    gridBucket = new GridFSBucket(mongoDb, { bucketName: 'media' });

    await kvCollection.createIndex({ updatedAt: -1 });
    await usersCollection.createIndex({ username: 1 }, { sparse: true });

    console.log(`[MONGO] Connecté — base « ${dbName} » (kv_store + GridFS media).`);
    mongoConnectError = null;
    return true;
  } catch (e) {
    mongoConnectError = e.message || String(e);
    console.error('[MONGO] Connexion impossible:', mongoConnectError);
    await disconnect();
    return false;
  }
}

async function disconnect() {
  if (mongoClient) {
    try { await mongoClient.close(); } catch (_) {}
  }
  mongoClient = null;
  mongoDb = null;
  kvCollection = null;
  usersCollection = null;
  metaCollection = null;
  gridBucket = null;
}

/** Charge toutes les clés depuis kv_store, ou migre l’ancien document app_state monolithique. */
async function loadAllKeys(legacyCollection) {
  if (!kvCollection) return {};

  const count = await kvCollection.countDocuments();
  if (count > 0) {
    const data = {};
    const cursor = kvCollection.find({});
    for await (const doc of cursor) {
      if (doc && doc._id != null && doc.value !== undefined) data[String(doc._id)] = doc.value;
    }
    console.log(`[MONGO] ${Object.keys(data).length} clé(s) chargée(s) depuis kv_store.`);
    return data;
  }

  if (legacyCollection) {
    const legacy = await legacyCollection.findOne({ _id: 'main' });
    const fromLegacy = legacy && legacy.data && typeof legacy.data === 'object' ? legacy.data : null;
    if (fromLegacy && Object.keys(fromLegacy).length > 0) {
      console.log('[MONGO] Migration app_state → kv_store…');
      for (const [key, value] of Object.entries(fromLegacy)) {
        await saveKey(key, value, { skipMedia: false });
      }
      await metaCollection.replaceOne(
        { _id: 'migration' },
        { _id: 'migration', appStateMigratedAt: new Date(), keys: Object.keys(fromLegacy).length },
        { upsert: true }
      );
      console.log(`[MONGO] Migration terminée — ${Object.keys(fromLegacy).length} clé(s).`);
      return fromLegacy;
    }
  }

  return {};
}

async function uploadBuffer(buffer, metadata = {}) {
  if (!gridBucket) throw new Error('GridFS indisponible');
  return new Promise((resolve, reject) => {
    const name = metadata.filename || `media_${Date.now()}`;
    const uploadStream = gridBucket.openUploadStream(name, { metadata });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id.toString()));
    uploadStream.end(buffer);
  });
}

async function processValueForStorage(val, depth = 0) {
  if (depth > 25) return val;

  if (typeof val === 'string') {
    if (val.startsWith(MEDIA_PREFIX) || val.startsWith('ppl-media://')) return val;
    if (val.startsWith('data:') && val.length >= MEDIA_MIN_CHARS && gridBucket) {
      try {
        const comma = val.indexOf(',');
        const meta = val.slice(5, comma);
        const mime = meta.split(';')[0] || 'application/octet-stream';
        const b64 = val.slice(comma + 1);
        const buf = Buffer.from(b64, 'base64');
        const id = await uploadBuffer(buf, { mime, size: buf.length, at: new Date() });
        return MEDIA_PREFIX + id;
      } catch (e) {
        console.error('[MONGO] GridFS upload:', e.message);
        return val;
      }
    }
    return val;
  }

  if (Array.isArray(val)) {
    const out = new Array(val.length);
    for (let i = 0; i < val.length; i++) out[i] = await processValueForStorage(val[i], depth + 1);
    return out;
  }

  if (val && typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val)) {
      out[k] = await processValueForStorage(val[k], depth + 1);
    }
    return out;
  }

  return val;
}

async function saveKey(key, value, opts = {}) {
  if (!kvCollection || !key || key === '_ppl_jwt') return;
  let toStore = value;
  if (!opts.skipMedia && gridBucket) {
    toStore = await processValueForStorage(value);
  }
  await kvCollection.replaceOne(
    { _id: key },
    { _id: key, value: toStore, updatedAt: new Date() },
    { upsert: true }
  );
}

async function saveAll(data, opts = {}) {
  if (!kvCollection || !data || typeof data !== 'object') return;
  const keys = Object.keys(data).filter((k) => k && !k.startsWith('_ppl'));
  for (const key of keys) {
    await saveKey(key, data[key], opts);
  }
}

function userStableId(u) {
  if (!u || typeof u !== 'object') return null;
  if (u.id != null && String(u.id).trim() !== '') return String(u.id);
  if (u.username != null && String(u.username).trim() !== '') return String(u.username);
  return null;
}

async function persistUsersFromData(data) {
  if (!usersCollection || !data) return;
  const list = data.p5_ac || data.p5_accounts;
  if (!Array.isArray(list) || !list.length) return;
  const ops = [];
  const ids = [];
  for (const u of list) {
    const sid = userStableId(u);
    if (!sid) continue;
    ids.push(sid);
    ops.push({
      replaceOne: {
        filter: { _id: sid },
        replacement: { ...u, _id: sid },
        upsert: true
      }
    });
  }
  if (!ops.length) return;
  await usersCollection.bulkWrite(ops, { ordered: false });
  const unique = [...new Set(ids)];
  if (unique.length) {
    await usersCollection.deleteMany({ _id: { $nin: unique } });
  }
}

async function loadUsersTable() {
  if (!usersCollection) return [];
  const docs = await usersCollection.find({}).toArray();
  return docs.map((d) => {
    const { _id, ...rest } = d;
    return rest;
  });
}

async function syncUsersWithData(data) {
  const acc = data.p5_ac || data.p5_accounts || [];
  if (acc.length) {
    await persistUsersFromData(data);
    return;
  }
  const fromTable = await loadUsersTable();
  if (fromTable.length) {
    data.p5_ac = fromTable;
  }
}

async function getStorageStats() {
  if (!mongoDb) return { kvKeys: 0, users: 0, mediaFiles: 0, mediaBytes: 0 };
  const kvKeys = kvCollection ? await kvCollection.countDocuments() : 0;
  const users = usersCollection ? await usersCollection.countDocuments() : 0;
  let mediaFiles = 0;
  let mediaBytes = 0;
  if (gridBucket) {
    const files = mongoDb.collection('media.files');
    mediaFiles = await files.countDocuments();
    const agg = await files.aggregate([{ $group: { _id: null, total: { $sum: '$length' } } }]).toArray();
    mediaBytes = agg[0] ? agg[0].total : 0;
  }
  return { kvKeys, users, mediaFiles, mediaBytes };
}

function openMediaDownloadStream(fileId) {
  if (!gridBucket) return null;
  try {
    return gridBucket.openDownloadStream(new ObjectId(String(fileId)));
  } catch (_) {
    return null;
  }
}

async function getMediaMetadata(fileId) {
  if (!mongoDb) return null;
  try {
    return await mongoDb.collection('media.files').findOne({ _id: new ObjectId(String(fileId)) });
  } catch (_) {
    return null;
  }
}

module.exports = {
  MEDIA_PREFIX,
  resolveUri,
  connect,
  disconnect,
  getState,
  loadAllKeys,
  saveKey,
  saveAll,
  persistUsersFromData,
  loadUsersTable,
  syncUsersWithData,
  getStorageStats,
  openMediaDownloadStream,
  getMediaMetadata,
  setUriSource: (s) => { mongoUriSource = s; }
};
