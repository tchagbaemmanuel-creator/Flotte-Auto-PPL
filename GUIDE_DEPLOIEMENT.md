# 📖 Guide de déploiement — Flotte PPL v20

## Pourquoi pas GitHub Pages ?
Ton application utilise un **serveur Node.js** (Express + Socket.IO).
GitHub Pages ne supporte que les sites statiques.
→ On utilise **Render.com** (gratuit, connecté à GitHub).

---

## ÉTAPE 1 — Créer le dépôt GitHub

1. Aller sur https://github.com/new
2. Nom : `flotte-ppl`
3. Visibilité : **Private** (recommandé — contient des mots de passe)
4. Ne pas cocher "Add a README" (on a déjà le nôtre)
5. Cliquer **"Create repository"**

---

## ÉTAPE 2 — Uploader les fichiers

Dans le dépôt vide, cliquer **"uploading an existing file"** et déposer :
- `server.js`
- `FlottePPL_v30.html`
- `package.json`
- `render.yaml`
- `README.md`
- `.gitignore`
- `.env.example`

Commit → **"Commit changes"**

---

## ÉTAPE 3 — Créer le service sur Render.com

1. Aller sur https://render.com → **Sign up** avec GitHub
2. Cliquer **"New +"** → **"Web Service"**
3. Choisir ton dépôt `flotte-ppl`
4. Vérifier les paramètres :
   - **Name :** `flotte-ppl`
   - **Branch :** `main`
   - **Build Command :** `npm install`
   - **Start Command :** `node server.js`
   - **Plan :** Free
5. Section **"Environment Variables"** :
   - `JWT_SECRET` : une phrase longue et secrète (Render peut aussi en générer une via `render.yaml`).
   - **`MONGODB_URI`** (obligatoire pour garder les données) : copier l’URI depuis **Atlas → Connect → Drivers** (Node.js). Remplacer `<password>` par le mot de passe ; s’il contient `@`, `/`, etc., encoder le mot de passe seul (PowerShell : `node -e "console.log(encodeURIComponent('votre_mot_de_passe'))"`). L’URI doit contenir le nom de base, par ex. `...mongodb.net/flotte_ppl?retryWrites=true&w=majority`.
   - **`MONGODB_DB_NAME`** (optionnel) : `flotte_ppl` si tu veux forcer le nom de base (sinon celui dans l’URI suffit).
6. Dans **MongoDB Atlas → Network Access** : autoriser **`0.0.0.0/0`** (ou les IP de Render si tu préfères restreindre), sinon la connexion depuis Render échoue.
7. Cliquer **"Create Web Service"**

---

## ÉTAPE 4 — Attendre le déploiement

- Render va installer Node.js, faire `npm install`, et lancer le serveur
- Durée : 2-5 minutes
- Ton URL sera : `https://flotte-ppl.onrender.com`

---

## ⚠️ Limitation plan gratuit Render

Le service **s'endort après 15 minutes** d'inactivité.
La première visite après une pause prend ~30 secondes pour redémarrer.
→ Solution : UptimeRobot (gratuit) peut pinger ton URL toutes les 14 min.

---

## ÉTAPE 5 — Mettre à jour l'application

À chaque push sur GitHub → Render redéploie automatiquement.

---

## En cas de problème

- **Logs en temps réel** : dans Render → ton service → onglet "Logs"
- **Erreur 503** : le service redémarre, attendre 30s
- **Données / MongoDB** : sans `MONGODB_URI`, le disque Render est **éphémère** (perte au redéploiement). Avec `MONGODB_URI`, le serveur lit/écrit la collection **`app_state`** (document `_id: "main"`). Vérifier les logs `[MONGO] Connecté` ou les erreurs réseau / mot de passe.
- **Santé** : `GET https://ton-service.onrender.com/api/status` affiche `"mongo": true` si Atlas est connecté.
