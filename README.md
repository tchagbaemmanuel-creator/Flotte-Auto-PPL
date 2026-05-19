# Flotte PPL — Gestion parc automobile

Application web avec synchronisation temps réel.  
**Stack :** Node.js + Express + Socket.IO + JWT + MongoDB Atlas (optionnel, recommandé sur Render).

---

Ce projet peut être hébergé sur **Render.com** (plan gratuit).  
URL typique : `https://<nom-du-service>.onrender.com`

---

## Démarrage local

```bash
npm install
node server.js
```

Ouvrir `http://localhost:3000` (copier `.env.example` vers `.env` pour `JWT_SECRET` et éventuellement `MONGODB_URI`).

---

## Déploiement Render

1. [render.com](https://render.com) → **New Web Service** → connecter ce dépôt.
2. **Build :** `npm install` — **Start :** `node server.js`
3. Variables d’environnement (détail : **`MONGODB_EN_LIGNE.md`**) :
   - **`JWT_SECRET`**
   - **`MONGODB_USER`** + **`MONGODB_PASSWORD`** + **`MONGODB_HOST`** (recommandé)
   - ou **`MONGODB_URI`**
   - **`MONGODB_DB_NAME`** : `flotte_ppl`

4. Vérifier : `https://<service>.onrender.com/api/status` → `"mongo": true`

Sur Atlas : **Network Access** → `0.0.0.0/0` pour Render.

---

## Structure

```
├── server.js
├── FlottePPL_v31.html
├── package.json
├── render.yaml
├── .gitignore
├── .env.example
└── data/              ← JSON local (non versionné ; en prod Render → MongoDB)
```

---

*Synchronisation temps réel multi-utilisateurs.*
