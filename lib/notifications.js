/**
 * Notifications e-mail Flotte PPL — comptes approuvés, demandes de course.
 */

const mailer = require('./mailer');

const APP_URL = () => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');

function accounts(db) {
  return db.p5_ac || db.p5_accounts || [];
}

function findAccount(db, id) {
  if (id == null || id === '') return null;
  return accounts(db).find((a) => String(a.id) === String(id) && a.active !== false) || null;
}

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch (_) { return String(s); }
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
      const name = [p.prenom, p.nom].filter(Boolean).join(' ') || p.username;
      await mailer.sendMail({
        to: p.email,
        subject: 'Flotte PPL — Votre compte est approuvé',
        text:
          `Bonjour ${name},\n\n` +
          `Votre demande d'accès à Flotte PPL a été approuvée.\n\n` +
          `Identifiant : ${p.username}\n` +
          `Connectez-vous : ${APP_URL()}\n\n` +
          `— Flotte PPL`,
        html:
          `<p>Bonjour <strong>${name}</strong>,</p>` +
          `<p>Votre demande d'accès à <strong>Flotte PPL</strong> a été <strong>approuvée</strong>.</p>` +
          `<p><strong>Identifiant :</strong> ${p.username}<br>` +
          `<a href="${APP_URL()}">Se connecter à Flotte PPL</a></p>` +
          `<p style="color:#666;font-size:12px">— Flotte PPL</p>`
      });
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

    // Nouvelle demande → e-mail approbateur
    if (isNew && d.statut === 'en_attente') {
      await notifyApprobateurNewDemande(d, db);
    }

    // Changement statut → e-mail demandeur
    if (was && was.statut !== d.statut) {
      if (d.statut === 'approuve') await notifyDemandeurDecision(d, db, 'approuvée');
      if (d.statut === 'rejete') await notifyDemandeurDecision(d, db, 'rejetée', d.motifRejet);
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
  await mailer.sendMail({
    to: approb.email,
    subject: `Flotte PPL — Nouvelle demande de course (${d.ref})`,
    text:
      `Bonjour ${approb.name},\n\n` +
      `${d.demandeurNom || 'Un collaborateur'} a soumis une demande de course.\n\n` +
      `Réf. : ${d.ref}\n` +
      `Destination : ${d.destination || '—'}\n` +
      `Date : ${d.dateDepart || '—'} ${d.heureDepart || ''}\n` +
      `Motif : ${d.motif || '—'}\n\n` +
      `Connectez-vous pour approuver : ${APP_URL()}\n\n` +
      `— Flotte PPL`,
    html:
      `<p>Bonjour <strong>${approb.name}</strong>,</p>` +
      `<p><strong>${d.demandeurNom || 'Un collaborateur'}</strong> a soumis une demande de course.</p>` +
      `<ul>` +
      `<li><strong>Réf. :</strong> ${d.ref}</li>` +
      `<li><strong>Destination :</strong> ${d.destination || '—'}</li>` +
      `<li><strong>Date :</strong> ${d.dateDepart || '—'} ${d.heureDepart || ''}</li>` +
      `<li><strong>Motif :</strong> ${d.motif || '—'}</li>` +
      `</ul>` +
      `<p><a href="${APP_URL()}">Ouvrir Flotte PPL</a></p>`
  });
}

async function notifyDemandeurDecision(d, db, label, motifRejet) {
  let email = d.demandeurEmail;
  const demandeur = findAccount(db, d.demandeurId);
  if (!email && demandeur) email = demandeur.email;
  if (!email) {
    console.log('[NOTIF] Pas d\'e-mail demandeur pour', d.ref);
    return;
  }
  const name = d.demandeurNom || demandeur?.name || 'Collaborateur';
  const motifLine = motifRejet ? `\nMotif : ${motifRejet}\n` : '';
  await mailer.sendMail({
    to: email,
    subject: `Flotte PPL — Demande ${d.ref} ${label}`,
    text:
      `Bonjour ${name},\n\n` +
      `Votre demande de course ${d.ref} a été ${label}.\n` +
      `Destination : ${d.destination || '—'}\n` +
      `Date : ${d.dateDepart || '—'} ${d.heureDepart || ''}\n` +
      (d.approbateurNom ? `Par : ${d.approbateurNom}\n` : '') +
      motifLine +
      `\nConsultez le détail : ${APP_URL()}\n\n` +
      `— Flotte PPL`,
    html:
      `<p>Bonjour <strong>${name}</strong>,</p>` +
      `<p>Votre demande <strong>${d.ref}</strong> a été <strong>${label}</strong>.</p>` +
      `<ul>` +
      `<li><strong>Destination :</strong> ${d.destination || '—'}</li>` +
      `<li><strong>Date :</strong> ${fmtDate(d.dateDepart)} ${d.heureDepart || ''}</li>` +
      (d.approbateurNom ? `<li><strong>Par :</strong> ${d.approbateurNom}</li>` : '') +
      (motifRejet ? `<li><strong>Motif de rejet :</strong> ${motifRejet}</li>` : '') +
      `</ul>` +
      `<p><a href="${APP_URL()}">Voir dans Flotte PPL</a></p>`
  });
}

module.exports = { onInscriptionsUpdated, onDemandesUpdated };
