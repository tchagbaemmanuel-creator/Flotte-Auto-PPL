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

async function onInscriptionsUpdated(prev, next, db) {
  if (!Array.isArray(next)) return;
  const prevMap = new Map();
  for (const p of Array.isArray(prev) ? prev : []) {
    if (p && p.id != null) prevMap.set(String(p.id), p);
  }
  for (const p of next) {
    if (!p || !p.email) continue;
    const was = prevMap.get(String(p.id));
    const nowApproved = p.status === 'approved';
    const wasApproved = was && was.status === 'approved';
    if (nowApproved && !wasApproved) {
      const { subject, text, html } = tpl.accountApproved(p);
      await mailer.sendMail({ to: p.email, subject, text, html });
    }
  }
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

module.exports = { onInscriptionsUpdated, onDemandesUpdated };
