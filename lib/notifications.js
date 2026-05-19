/**
 * Notifications e-mail Flotte PPL — déclencheurs + envoi.
 * Textes : lib/email-templates.js
 */

const mailer = require('./mailer');
const tpl = require('./email-templates');

function accounts(db) {
  return db.p5_ac || db.p5_accounts || [];
}

function findAccount(db, id) {
  if (id == null || id === '') return null;
  return accounts(db).find((a) => String(a.id) === String(id) && a.active !== false) || null;
}

function adminAccounts(db) {
  return accounts(db).filter((a) => a.role === 'admin' && a.active !== false && a.email);
}

/** E-mails fixes (Render / .env) : MAIL_ADMIN_NOTIFY=admin@ppl.ci,autre@ppl.ci */
function parseNotifyList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));
}

function adminNotifyTargets(db) {
  const seen = new Set();
  const targets = [];

  const add = (email, name) => {
    const key = String(email).trim().toLowerCase();
    if (!key || !key.includes('@') || seen.has(key)) return;
    seen.add(key);
    targets.push({ email: String(email).trim(), name: name || 'Administrateur' });
  };

  for (const a of adminAccounts(db)) add(a.email, a.name);
  for (const e of parseNotifyList(process.env.MAIL_ADMIN_NOTIFY)) add(e, null);
  if (!targets.length) {
    const smtpUser = (process.env.SMTP_USER || '').trim();
    if (smtpUser.includes('@')) add(smtpUser, null);
  }

  return targets;
}

/**
 * Traite les inscriptions : envoie les mails manqués, marque adminNotifiedAt / approvalNotifiedAt.
 * @returns {Array|null} tableau mis à jour si des flags ont été ajoutés, sinon null
 */
async function onInscriptionsUpdated(prev, next, db) {
  if (!Array.isArray(next)) return null;
  const prevMap = new Map();
  for (const p of Array.isArray(prev) ? prev : []) {
    if (p && p.id != null) prevMap.set(String(p.id), p);
  }

  let modified = false;
  const out = next.map((p) => (p && typeof p === 'object' ? { ...p } : p));

  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (!p || p.id == null) continue;
    const was = prevMap.get(String(p.id));

    if (p.status === 'pending' && !p.adminNotifiedAt) {
      const ok = await notifyAdminsNewInscription(p, db);
      if (ok) {
        out[i] = { ...p, adminNotifiedAt: new Date().toISOString() };
        modified = true;
      }
    }

    const row = out[i];
    if (!row.email) continue;
    const nowApproved = row.status === 'approved';
    const wasApproved = was && was.status === 'approved';
    if (nowApproved && !wasApproved && !row.approvalNotifiedAt) {
      const { subject, text, html } = tpl.accountApproved(row);
      const r = await mailer.sendMail({ to: row.email, subject, text, html });
      if (r.ok) {
        out[i] = { ...row, approvalNotifiedAt: new Date().toISOString() };
        modified = true;
      }
    }
  }

  return modified ? out : null;
}

/** Au démarrage : rattraper les inscriptions en attente jamais notifiées par e-mail. */
async function flushPendingInscriptionEmails(db) {
  const list = db.p5_inscriptions_pending;
  if (!Array.isArray(list) || !list.length) return;
  const needs = list.some((p) => p && p.status === 'pending' && !p.adminNotifiedAt);
  const needsApproval = list.some((p) => p && p.status === 'approved' && p.email && !p.approvalNotifiedAt);
  if (!needs && !needsApproval) return;
  console.log('[NOTIF] Rattrapage e-mails inscriptions en attente…');
  const updated = await onInscriptionsUpdated(list, list, db);
  if (updated) {
    db.p5_inscriptions_pending = updated;
    return updated;
  }
}

async function notifyAdminsNewInscription(p, db) {
  const targets = adminNotifyTargets(db);
  if (!targets.length) {
    console.log('[NOTIF] Pas d\'e-mail admin (comptes admin, MAIL_ADMIN_NOTIFY ni SMTP_USER) @' + (p.username || p.id));
    return false;
  }
  console.log('[NOTIF] Nouvelle inscription @' + p.username + ' → ' + targets.map((t) => t.email).join(', '));
  let anyOk = false;
  for (const t of targets) {
    const { subject, text, html } = tpl.newInscriptionForAdmin(p, t.name);
    const r = await mailer.sendMail({ to: t.email, subject, text, html });
    if (r.ok) anyOk = true;
    else console.error('[NOTIF] Échec mail admin', t.email, '—', r.reason);
  }
  return anyOk;
}

async function onDemandesUpdated(prev, next, db) {
  if (!Array.isArray(next)) return;
  const prevMap = new Map();
  for (const d of Array.isArray(prev) ? prev : []) {
    if (d && d.id != null) prevMap.set(String(d.id), d);
  }

  for (const d of next) {
    if (!d || d.id == null) continue;
    const id = String(d.id);
    const was = prevMap.get(id);
    const isNew = !was;

    if (isNew && d.statut === 'en_attente') {
      await notifyApprobateurNewDemande(d, db);
    }

    if (was && was.statut !== d.statut) {
      if (d.statut === 'approuve') await notifyDemandeurDecision(d, db, 'approuve');
      if (d.statut === 'rejete') await notifyDemandeurDecision(d, db, 'rejete', d.motifRejet);
    }
  }
}

async function notifyApprobateurNewDemande(d, db) {
  const demandeur = findAccount(db, d.demandeurId);
  let approb = null;
  if (demandeur && demandeur.approbateurId) {
    approb = findAccount(db, demandeur.approbateurId);
  }
  if (!approb) {
    approb = accounts(db).find((a) => a.role === 'admin' && a.email);
  }
  if (!approb || !approb.email) {
    console.log('[NOTIF] Pas d\'e-mail approbateur pour demande', d.ref);
    return;
  }
  const { subject, text, html } = tpl.newDemandeForApprobateur(d, approb.name);
  await mailer.sendMail({ to: approb.email, subject, text, html });
}

async function notifyDemandeurDecision(d, db, statut, motifRejet) {
  let email = d.demandeurEmail;
  const demandeur = findAccount(db, d.demandeurId);
  if (!email && demandeur) email = demandeur.email;
  if (!email) {
    console.log('[NOTIF] Pas d\'e-mail demandeur pour', d.ref);
    return;
  }
  const name = d.demandeurNom || demandeur?.name || 'Collaborateur';
  let mail;
  if (statut === 'approuve') {
    mail = tpl.demandeApproved(d, name);
  } else {
    mail = tpl.demandeRejected(d, name, motifRejet);
  }
  await mailer.sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
}

module.exports = {
  onInscriptionsUpdated,
  onDemandesUpdated,
  flushPendingInscriptionEmails
};
