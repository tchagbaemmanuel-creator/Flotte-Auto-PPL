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
3. Variables d’environnement :
   - **`JWT_SECRET`** : chaîne longue et secrète
   - **`MONGODB_URI`** : chaîne Atlas (mot de passe encodé si caractères spéciaux)
   - **`MONGODB_DB_NAME`** : `flotte_ppl` (optionnel si déjà dans l’URI)

Sur Atlas : **Network Access** → autoriser les IP du cloud (ex. `0.0.0.0/0` pour tester).

---

## Structure

```
├── server.js
├── FlottePPL_v30.html
├── package.json
├── render.yaml
├── .gitignore
├── .env.example
└── data/              ← JSON local (non versionné ; en prod Render → MongoDB)
```

---

*Synchronisation temps réel multi-utilisateurs.*
