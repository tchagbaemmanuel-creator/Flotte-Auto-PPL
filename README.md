# 🚗 Flotte PPL — Gestion Parc Auto v20

Application web de gestion de parc automobile avec synchronisation temps réel.
**Stack :** Node.js + Express + Socket.IO + JWT

---

## 🌐 Déploiement en ligne

Ce projet est hébergé sur **Render.com** (serveur gratuit).

> URL : *(sera renseignée après déploiement)*

---



---

## 🚀 Démarrage local

```bash
npm install
node server.js
# Ouvrir http://localhost:3000
```

---

## ☁️ Déploiement sur Render.com

### Prérequis
- Compte GitHub avec ce dépôt
- Compte Render.com (gratuit)

### Étapes
1. Aller sur [render.com](https://render.com) → **New Web Service**
2. Connecter ce dépôt GitHub
3. Configurer :
   - **Build Command :** `npm install`
   - **Start Command :** `node server.js`
4. Ajouter la variable d'environnement :
   - `JWT_SECRET` = une longue chaîne aléatoire secrète
5. Cliquer **Deploy**

---

## 📁 Structure

```
flotte-ppl/
├── server.js              ← Serveur Node.js + Socket.IO
├── FlottePPL_v20.html     ← Application front-end
├── package.json
├── .gitignore
├── .env.example           ← Variables d'environnement (modèle)
└── data/                  ← Données JSON (ignoré par Git)
```

---



*Version 20 — Synchronisation temps réel multi-utilisateurs*
"# Flotte-Auto-PPL" 
