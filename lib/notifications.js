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

  for (const a of accounts(db)) {
    if (a.role === 'admin' && a.active !== false && a.email) add(a.email, a.name);
  }
  for (const e of parseNotifyList(process.env.MAIL_ADMIN_NOTIFY)) add(e, null);
  if (!targets.length) {
    const smtpUser = (process.env.SMTP_USER || '').trim();
    if (smtpUser.includes('@')) add(smtpUser, null);
  }

  return targets;
}

/** Destinataires nouvelle demande de course : admins + MAIL_ADMIN_NOTIFY + approbateur désigné */
function demandeCourseNotifyTargets(db, d) {
  const targets = adminNotifyTargets(db);
  const seen = new Set(targets.map((t) => t.email.toLowerCase()));

  const demandeur = findAccount(db, d.demandeurId);
  if (demandeur && demandeur.approbateurId) {
    const approb = findAccount(db, demandeur.approbateurId);
    if (approb && approb.email) {
      const key = approb.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ email: approb.email.trim(), name: approb.name || 'Approbateur' });
      }
    }
  }

  for (const a of accounts(db)) {
    if (a.role === 'approbateur' && a.active !== false && a.email) {
      const key = a.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ email: a.email.trim(), name: a.name || 'Approbateur' });
      }
    }
  }

  return targets;
}

/**
 * Inscriptions — adminNotifiedAt / approvalNotifiedAt
 * @returns {Array|null}
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

/**
 * Demandes de course — adminNotifiedAt (comme inscriptions)
 * @returns {Array|null}
 */
async function onDemandesUpdated(prev, next, db) {
  if (!Array.isArray(next)) return null;
  const prevMap = new Map();
  for (const d of Array.isArray(prev) ? prev : []) {
    if (d && d.id != null) prevMap.set(String(d.id), d);
  }

  let modified = false;
  const out = next.map((d) => (d && typeof d === 'object' ? { ...d } : d));

  for (let i = 0; i < out.length; i++) {
    const d = out[i];
    if (!d || d.id == null) continue;
    const was = prevMap.get(String(d.id));
    const statut = d.statut || d.status;

    if (statut === 'en_attente' && !d.adminNotifiedAt) {
      const ok = await notifyNewDemandeCourse(d, db);
      if (ok) {
        out[i] = { ...d, adminNotifiedAt: new Date().toISOString() };
        modified = true;
      }
    }

    const row = out[i];
    if (was && was.statut !== statut) {
      if (statut === 'approuve' && !row.decisionNotifiedAt) {
        const r = await notifyDemandeurDecision(row, db, 'approuve');
        if (r) {
          out[i] = { ...row, decisionNotifiedAt: new Date().toISOString() };
          modified = true;
        }
      }
      if (statut === 'rejete' && !row.decisionNotifiedAt) {
        const r = await notifyDemandeurDecision(row, db, 'rejete', row.motifRejet);
        if (r) {
          out[i] = { ...row, decisionNotifiedAt: new Date().toISOString() };
          modified = true;
        }
      }
    }
  }

  return modified ? out : null;
}

async function flushPendingDemandeEmails(db) {
  const list = db.p5_demandes_course;
  if (!Array.isArray(list) || !list.length) return;
  const needs = list.some((d) => d && (d.statut || d.status) === 'en_attente' && !d.adminNotifiedAt);
  if (!needs) return;
  console.log('[NOTIF] Rattrapage e-mails demandes de course en attente…');
  const updated = await onDemandesUpdated(list, list, db);
  if (updated) {
    db.p5_demandes_course = updated;
    return updated;
  }
}

async function notifyNewDemandeCourse(d, db) {
  const targets = demandeCourseNotifyTargets(db, d);
  if (!targets.length) {
    console.log('[NOTIF] Pas d\'e-mail pour demande de course', d.ref);
    return false;
  }
  console.log('[NOTIF] Nouvelle demande ' + (d.ref || d.id) + ' → ' + targets.map((t) => t.email).join(', '));
  let anyOk = false;
  for (const t of targets) {
    const { subject, text, html } = tpl.newDemandeForApprobateur(d, t.name);
    const r = await mailer.sendMail({ to: t.email, subject, text, html });
    if (r.ok) anyOk = true;
    else console.error('[NOTIF] Échec mail demande', t.email, '—', r.reason);
  }
  return anyOk;
}

async function notifyDemandeurDecision(d, db, statut, motifRejet) {
  let email = d.demandeurEmail;
  const demandeur = findAccount(db, d.demandeurId);
  if (!email && demandeur) email = demandeur.email;
  if (!email) {
    console.log('[NOTIF] Pas d\'e-mail demandeur pour', d.ref);
    return false;
  }
  const name = d.demandeurNom || demandeur?.name || 'Collaborateur';
  let mail;
  if (statut === 'approuve') {
    mail = tpl.demandeApproved(d, name);
  } else {
    mail = tpl.demandeRejected(d, name, motifRejet);
  }
  const r = await mailer.sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
  return r.ok;
}

module.exports = {
  onInscriptionsUpdated,
  onDemandesUpdated,
  flushPendingInscriptionEmails,
  flushPendingDemandeEmails
};
