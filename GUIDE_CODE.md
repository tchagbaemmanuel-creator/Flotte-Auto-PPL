# Guide du code — Flotte PPL v31

Ce document explique **l’ensemble du projet** pour vous permettre de naviguer dans le code.
Les commentaires `// ═══` dans `FlottePPL_v31.html` reprennent les mêmes sections.

---

## Vue d’ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│  Navigateur — FlottePPL_v31.html (app monopage, ~27 000 lignes) │
│  • HTML : écrans (pages) + modales                               │
│  • CSS  : styles (lignes ~11–792)                                │
│  • JS   : logique métier (lignes ~4304–fin)                      │
│  • Stockage local : localStorage + IndexedDB (gros fichiers)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP REST + WebSocket (Socket.IO)
┌───────────────────────────▼─────────────────────────────────────┐
│  server.js — Node.js / Express                                   │
│  • Auth JWT (/api/auth/login)                                    │
│  • Données clé/valeur (/api/data)                                │
│  • Médias GridFS (/api/media/:id)                                │
│  • Temps réel : set-key, initial-data, users-online              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  data/*.json         MongoDB Atlas        E-mails (Brevo/SMTP)
  (local / backup)    kv_store + GridFS    lib/notifications.js
```

**Démarrage :** `npm start` → `http://localhost:3000/` sert le HTML et l’API.

---

## Fichiers du dépôt

| Fichier | Rôle |
|---------|------|
| `FlottePPL_v31.html` | Application complète (UI + logique client) |
| `server.js` | Serveur HTTP + Socket.IO + orchestration |
| `lib/database.js` | Connexion MongoDB, clés `kv_store`, GridFS |
| `lib/merge.js` | Fusion des tableaux (multi-utilisateurs) |
| `lib/notifications.js` | Déclencheurs e-mail (inscriptions, demandes) |
| `lib/mailer.js` | Envoi Brevo API ou SMTP |
| `lib/email-templates.js` | Textes HTML des e-mails |
| `scripts/check-mongo.js` | Test de connexion Mongo |
| `.env` | Secrets (non versionné) — voir `.env.example` |

---

## Clés de données (`K` dans le HTML)

Toutes les données métier sont des **tableaux ou objets JSON** stockés sous une clé courte :

| Clé | Constante `K` | Contenu |
|-----|---------------|---------|
| `p5_v` | `vehicles` | Véhicules du parc |
| `p5_d` | `drivers` | Conducteurs |
| `p5_t` | `trips` | Sorties / trajets |
| `p5_m` | `missions` | Ordres de mission (OM) |
| `p5_e` | `maint` | Entretiens / maintenance |
| `p5_f` | `fuel` | Consommations carburant |
| `p5_dc` | `docs` | Documents (assurance, etc.) |
| `p5_l` | `logs` | Journal d’activité |
| `p5_ac` | `accounts` | Comptes utilisateurs |
| `p5_inscriptions_pending` | — | Demandes d’accès en attente |
| `p5_demandes_course` | — | Demandes de mise à disposition véhicule |
| `p5_ty` | `Kx.tyres` | Pneumatiques |
| `p5_pa` | `Kx.pannes` | Pannes récurrentes |
| `p5_loc` / `p5_pr` | `Kl` | Locations / prestataires |
| `p5_lp` / `p5_oac` | `KLP` | Livraisons (legacy) / OAC |

**Fonctions de lecture typiques :** `gV()`, `gD()`, `gT()`, `load(K.xxx)`, `save(K.xxx, data)`.

---

## Rôles utilisateurs

| Rôle | Droits |
|------|--------|
| `admin` | Tout + comptes + corbeille |
| `manager` | Gestion opérationnelle du parc |
| `approbateur` | Valide les demandes de course |
| `demandeur` | Soumet des demandes |
| `reader` | Lecture seule |

Les éléments `.admin-only` dans le HTML sont masqués pour les non-admins.

---

## Flux principaux

### 1. Connexion

1. `doLogin()` → `loginCloud()` (POST `/api/auth/login`)
2. Si serveur OK : JWT dans `localStorage` (`_ppl_jwt`)
3. Sinon : comptes locaux dans `p5_ac` / `data/users.json`
4. `connectSocket()` → reçoit `initial-data` (copie serveur de `DB`)

### 2. Sauvegarde d’une modification

1. `save(clé, valeur)` → localStorage ou IndexedDB si > 200 Ko
2. `_pplPushServer()` → Socket `set-key` ou POST `/api/data/:key`
3. Serveur : `applyKeyUpdate()` → fusion + e-mails éventuels → `io.emit('data-update')`
4. Autres clients : `applyMergedKeyToStorage()` → rafraîchit l’UI

### 3. Inscription publique

1. Formulaire → `p5_inscriptions_pending`
2. POST HTTP garanti (pour déclencher l’e-mail admin côté serveur)
3. `notifications.onInscriptionsUpdated()` → mail aux admins

### 4. Demande de course

1. Stockée dans `p5_demandes_course`
2. Fusion `mergeDemandesCourse()` si plusieurs postes modifient
3. E-mails : nouvelle demande → approbateurs ; décision → demandeur

---

## Structure de `FlottePPL_v31.html`

### Partie CSS (lignes ~11–792)

Styles globaux PPL (bordeaux `#8B1A1A`, or `#C8A84B`), login, sidebar, tableaux, modales, documents imprimables (KPI, diplôme, bons).

### Partie HTML (lignes ~794–4303)

- **Login** `#login-wrap`
- **Sidebar** `#sb` — navigation `data-p="nom-page"`
- **Pages** `#page-*` — une div par module (voir liste ci-dessous)
- **Modales** — formulaires ajout/édition
- **Panneaux** — détail véhicule/conducteur, notifications

**Pages principales :**

| ID | Module |
|----|--------|
| `page-dashboard` | Tableau de bord |
| `page-vehicles` | Véhicules |
| `page-drivers` | Conducteurs |
| `page-sorties` / `page-missions` | Sorties & missions |
| `page-maintenance` | Entretien |
| `page-fuel` | Carburant |
| `page-accounts` | Comptes & inscriptions |
| `page-pneumatiques` / `page-pannes` | Pneus & pannes |
| `page-livraison-oac` | Livraison OAC |
| `page-eval-kpi` | Évaluation chauffeurs |
| … | (voir commentaires HTML) |

### Partie JavaScript (lignes ~4304–fin)

| Ligne ~ | Section |
|---------|---------|
| 4306 | Constantes `K`, logo |
| 4310 | Réseau : `SERVER_URL`, JWT, Socket.IO |
| 4684 | Stockage `save` / `load` / IndexedDB |
| 4874 | `initData()` — données par défaut |
| 4973 | Login / logout |
| 5524 | `renderAll()` — rafraîchit toutes les vues |
| 7557 | Modules v5.1 : pneus, pannes, dépréciation |
| 8134 | Locations & prestataires |
| 8834 | Livraison OAC, classement |
| 12973 | `_pplBoot()` — démarrage application |
| 21455 | Patchs v21+ (OAC, tâches, inspection) |

---

## `server.js` en détail

| Bloc | Fonction |
|------|----------|
| Config | `PORT`, `JWT_SECRET`, Mongo, fichiers `data/` |
| `DB` | Objet en mémoire = toutes les clés `p5_*` |
| `loadData` / `saveData` | Fichier JSON local |
| `initMongo` | Charge depuis Atlas, migre `app_state` |
| `applyKeyUpdate` | Écrit une clé + notifications |
| Routes `/api/auth/*` | Login et vérification JWT |
| Routes `/api/data/*` | Lecture/écriture sans socket |
| `io.on('connection')` | Sync temps réel |
| `shutdown` | Flush Mongo + sauvegarde à l’arrêt |

---

## Variables d’environnement (`.env.example`)

- **MongoDB :** `MONGODB_USER` + `PASSWORD` + `HOST` ou `MONGODB_URI`
- **E-mail Render :** `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`
- **E-mail local :** `SMTP_*`
- **Notifications :** `MAIL_ADMIN_NOTIFY`, `APP_URL`

---

## Conseils pour lire le code

1. Commencez par `GUIDE_CODE.md` (ce fichier) et `server.js`.
2. Dans le HTML, cherchez `// ═══` pour sauter aux modules.
3. Pour une fonction : Ctrl+F le nom (ex. `renderFleet`, `saveV`).
4. Les IDs HTML (`id="..."`) lient l’UI aux fonctions `onclick`.

---

*Document généré pour faciliter la compréhension du dépôt Flotte-Auto-PPL.*
