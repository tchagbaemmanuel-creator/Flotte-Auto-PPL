# Connecter MongoDB en ligne (Atlas + Render)

## Étape 1 — Cluster MongoDB Atlas (gratuit)

1. [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) → compte gratuit.
2. **Build a Database** → **M0 FREE** → région proche (ex. `AWS / eu-west-1`).
3. **Database Access** → **Add New Database User** :
   - Nom : ex. `flotte_ppl_user`
   - Mot de passe : générer et **noter** (vous en aurez besoin sur Render).
4. **Network Access** → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`)  
   *(obligatoire pour Render ; sinon connexion refusée)*.
5. **Database** → **Connect** → **Drivers** → copier l’**host** :
   - Exemple : `cluster0.abcde.mongodb.net` (sans `mongodb+srv://`).

---

## Étape 2 — Variables sur Render.com

1. [render.com](https://render.com) → votre service **flotte-ppl** (ou créer un **Web Service** depuis GitHub).
2. **Environment** → ajouter :

| Variable | Valeur |
|----------|--------|
| `MONGODB_USER` | utilisateur Atlas (étape 1) |
| `MONGODB_PASSWORD` | mot de passe Atlas |
| `MONGODB_HOST` | `cluster0.xxxxx.mongodb.net` |
| `MONGODB_DB_NAME` | `flotte_ppl` |
| `JWT_SECRET` | phrase longue secrète (Render peut en générer une) |

**Option alternative** : une seule variable `MONGODB_URI`  
`mongodb+srv://USER:MOT_DE_PASSE@cluster0.xxxxx.mongodb.net/flotte_ppl?retryWrites=true&w=majority`  
*(si le mot de passe contient `@`, `#`, etc., encoder le mot de passe avec `encodeURIComponent`)*.

3. **Save Changes** → Render redéploie automatiquement.

---

## Étape 3 — Vérifier que c’est connecté

Après le déploiement (2–5 min), ouvrez dans le navigateur :

```
https://VOTRE-SERVICE.onrender.com/api/status
```

Réponse attendue :

```json
{
  "mongo": true,
  "mongoMode": "kv_store+gridfs",
  "mongoStorage": { "kvKeys": 0, "users": 0, "mediaFiles": 0, "mediaBytes": 0 }
}
```

Dans les **Logs Render**, vous devez voir :

```
[MONGO] Connecté — base « flotte_ppl » (kv_store + GridFS media).
```

Si `"mongo": false`, lisez `mongoConnectError` et `hint` dans `/api/status`.

---

## Test en local (avant Render)

```powershell
cd "c:\Flotte  auto ppl\Flotte-Auto-PPL"
copy .env.example .env
# Éditer .env avec les mêmes valeurs qu’Atlas
npm install
node scripts/check-mongo.js
npm start
```

Puis : http://localhost:3000/api/status

---

## Stockage gratuit

- **Atlas M0** : **512 Mo** pour tout le cluster (données + photos).
- Au-delà : passer à un tier payant (M2, M5, M10…) dans Atlas.
