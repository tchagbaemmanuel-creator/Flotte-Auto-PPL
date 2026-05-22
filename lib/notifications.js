/**
 * Notifications e-mail Flotte PPL
 *
 * Appelé depuis server.js → applyKeyUpdate() quand les clés changent :
 *   p5_inscriptions_pending → admin (nouvelle demande) + utilisateur (approuvé)
 *   p5_demandes_course       → approbateurs (nouvelle) + demandeur (décision)
 *
 * Chaque envoi réussi pose un horodatage sur l’entrée (adminNotifiedAt, etc.)
 * pour ne pas renvoyer le même mail. Textes HTML : lib/email-templates.js
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

function normalizeGrade(val) {
  const aliases = {
    direction_operations: 'chargee_operations',
    responsable_logistique: 'responsable_parc_auto',
    responsable_direct: 'responsable_service_demandeur'
  };
  return aliases[val] || val;
}

const GRADE_ORDER = {
  direction_generale: 1,
  chargee_operations: 2,
  responsable_service_demandeur: 3,
  responsable_parc_auto: 4,
  daf: 5,
  drh: 6,
  responsable_logistique: 7,
  responsable_direct: 8,
  securite: 9,
  autre: 10
};

function getSignatures(db) {
  const raw = db.p5_signatures;
  return Array.isArray(raw) ? raw : [];
}

/** Approbateurs du circuit (signatures + grade) triés terrain → direction */
function circuitApprovers(db) {
  const sigs = getSignatures(db);
  const accs = accounts(db).filter((a) => a.active !== false);
  const seen = new Set();
  const list = [];

  for (const s of sigs) {
    if (!s.grade || !s.signature || s.accId == null) continue;
    const acc = accs.find((a) => String(a.id) === String(s.accId));
    if (!acc || !acc.email) continue;
    const grade = normalizeGrade(s.grade);
    if (seen.has(grade)) continue;
    seen.add(grade);
    list.push({
      accId: acc.id,
      name: acc.name || 'Approbateur',
      email: String(acc.email).trim(),
      grade,
      order: GRADE_ORDER[grade] ?? 99
    });
  }

  list.sort((a, b) => b.order - a.order);
  return list;
}

/**
 * Destinataires « autres approbateurs » : niveaux sans validation, hors demandeur.
 * Repli : Chargée des opérations (Mme SALI) ou compte dont le nom contient SALIMATA.
 */
function approvalNotifyTargets(db, dossier, requesterAccId) {
  const steps = Array.isArray(dossier?.steps) ? dossier.steps : [];
  const seen = new Set();
  const targets = [];

  const add = (email, name) => {
    const key = String(email).trim().toLowerCase();
    if (!key || !key.includes('@') || seen.has(key)) return;
    seen.add(key);
    targets.push({ email: String(email).trim(), name: name || 'Approbateur' });
  };

  for (const req of circuitApprovers(db)) {
    if (requesterAccId != null && String(req.accId) === String(requesterAccId)) continue;
    const step = steps.find((s) => String(s.accId) === String(req.accId));
    if (step && (step.decision === 'approuve' || step.decision === 'approuve_conditions')) continue;
    add(req.email, req.name);
  }

  if (!targets.length) {
    for (const a of accounts(db)) {
      if (a.active === false || !a.email) continue;
      if (requesterAccId != null && String(a.id) === String(requesterAccId)) continue;
      const sig = getSignatures(db).find((s) => String(s.accId) === String(a.id));
      if (sig && normalizeGrade(sig.grade) === 'chargee_operations') add(a.email, a.name);
    }
  }

  if (!targets.length) {
    for (const a of accounts(db)) {
      if (a.active === false || !a.email) continue;
      if (requesterAccId != null && String(a.id) === String(requesterAccId)) continue;
      const n = String(a.name || '').toUpperCase();
      if (n.includes('SALIMATA') || n.includes('SALI ')) add(a.email, a.name);
    }
  }

  return targets;
}

function buildApprovalSummary(dossier) {
  const ctx = dossier?.contextObj && typeof dossier.contextObj === 'object' ? dossier.contextObj : {};
  const lines = [];
  const push = (label, val) => {
    if (val != null && String(val).trim()) lines.push(`${label} : ${String(val).trim()}`);
  };
  push('Véhicule', ctx.vehicleLabel || ctx.vehicle);
  push('Destination', ctx.destination);
  push('Motif', ctx.motif || ctx.objet);
  push('Date', ctx.date || ctx.dateOut);
  push('Prestataire', ctx.prestataire || ctx.prestataireName);
  if (!lines.length && ctx.ref) push('Référence', ctx.ref);
  return lines.slice(0, 8);
}

const APPROB_TYPE_LABELS = {
  sortie: 'Sortie véhicule',
  mission: 'Ordre de mission',
  entretien: 'Entretien véhicule',
  carburant_rechargement: 'Rechargement carte carburant',
  moto_location_vente: 'Location / Vente moto'
};

/** Cible e-mails — même logique que demande de course (approbateur désigné + rôle approbateur + admins). */
function approbationNotifyTargets(db, d) {
  return demandeCourseNotifyTargets(db, {
    ref: d.ref || d.refLabel,
    demandeurId: d.demandeurId,
    demandeurNom: d.demandeurNom,
    service: d.service,
    destination: d.refLabel || d.motif,
    dateDepart: d.createdAt,
    motif: d.motif || d.refLabel,
    typeUrgent: d.urgence === 'urgente',
    urgence: d.urgence
  });
}

/**
 * p5_approb — notification à la soumission (comme p5_demandes_course).
 * @returns {Array|null}
 */
async function onApprobationsUpdated(prev, next, db) {
  if (!Array.isArray(next)) return null;
  const prevMap = new Map();
  for (const p of Array.isArray(prev) ? prev : []) {
    if (p && p.id != null) prevMap.set(String(p.id), p);
  }

  let modified = false;
  const out = next.map((p) => (p && typeof p === 'object' ? { ...p } : p));

  for (let i = 0; i < out.length; i++) {
    const d = out[i];
    if (!d || d.id == null) continue;
    const statut = d.statut || d.status;
    if (statut === 'en_attente' && !d.adminNotifiedAt) {
      const ok = await notifyNewApprobation(d, db);
      if (ok) {
        out[i] = { ...d, adminNotifiedAt: new Date().toISOString() };
        modified = true;
      }
    }

    const row = out[i];
    const was = prevMap.get(String(d.id));
    const wasStatut = was && (was.statut || was.status);
    if (was && wasStatut !== statut) {
      if (statut === 'approuve' && !row.decisionNotifiedAt && row.demandeurEmail) {
        const mail = tpl.demandeApproved(
          { ref: row.ref, destination: row.refLabel, dateDepart: row.createdAt },
          row.demandeurNom || 'Collaborateur'
        );
        const r = await mailer.sendMail({ to: row.demandeurEmail, subject: mail.subject, text: mail.text, html: mail.html });
        if (r.ok) {
          out[i] = { ...row, decisionNotifiedAt: new Date().toISOString() };
          modified = true;
        }
      }
      if (statut === 'rejete' && !row.decisionNotifiedAt && row.demandeurEmail) {
        const mail = tpl.demandeRejected(
          { ref: row.ref, destination: row.refLabel, dateDepart: row.createdAt },
          row.demandeurNom || 'Collaborateur',
          row.motifRejet
        );
        const r = await mailer.sendMail({ to: row.demandeurEmail, subject: mail.subject, text: mail.text, html: mail.html });
        if (r.ok) {
          out[i] = { ...row, decisionNotifiedAt: new Date().toISOString() };
          modified = true;
        }
      }
    }
  }

  return modified ? out : null;
}

async function notifyNewApprobation(d, db) {
  const targets = approbationNotifyTargets(db, d);
  if (!targets.length) {
    console.log('[NOTIF] Pas d\'e-mail approbateur pour', d.ref || d.refLabel);
    return false;
  }
  const cfgLabel = {
    sortie: 'Sortie véhicule',
    mission: 'Ordre de mission',
    entretien: 'Entretien véhicule',
    carburant_rechargement: 'Rechargement carte carburant',
    moto_location_vente: 'Location / Vente moto'
  };
  const payload = {
    typeLabel: cfgLabel[d.type] || d.type || 'Demande',
    refLabel: d.refLabel || d.ref || '—',
    requesterName: d.demandeurNom || 'Collaborateur',
    summaryLines: [
      d.ref ? `Réf. ${d.ref}` : '',
      d.motif ? `Motif : ${d.motif}` : '',
      d.service ? `Service : ${d.service}` : ''
    ].filter(Boolean)
  };
  console.log('[NOTIF] Nouvelle approbation ' + (d.ref || d.id) + ' → ' + targets.map((t) => t.email).join(', '));
  let anyOk = false;
  for (const t of targets) {
    const mapped = {
      ref: d.ref || d.refLabel,
      demandeurNom: d.demandeurNom,
      service: d.service,
      destination: d.refLabel,
      dateDepart: d.createdAt,
      motif: payload.typeLabel + (d.motif ? ' — ' + d.motif : ''),
      typeUrgent: false
    };
    const { subject, text, html } = tpl.newDemandeForApprobateur(mapped, t.name);
    const r = await mailer.sendMail({ to: t.email, subject, text, html });
    if (r.ok) anyOk = true;
    else console.error('[NOTIF] Échec mail approbation', t.email, '—', r.reason);
  }
  return anyOk;
}

async function sendApprovalRequestEmails(db, dossier, requester) {
  const targets = approbationNotifyTargets(db, {
    ...dossier,
    demandeurId: requester?.id ?? requester?.accId ?? dossier.demandeurId,
    demandeurNom: requester?.name || dossier.demandeurNom
  });
  if (!targets.length) {
    console.log('[NOTIF] Circuit validation : aucun e-mail approbateur pour', dossier?.refLabel);
    return { ok: false, reason: 'no-targets', targets: [] };
  }

  const typeLabel = APPROB_TYPE_LABELS[dossier.type] || dossier.type || 'Document';
  const payload = {
    typeLabel,
    refLabel: dossier.refLabel || '—',
    requesterName: requester?.name || dossier.createdBy || 'Collaborateur',
    summaryLines: buildApprovalSummary(dossier)
  };

  console.log('[NOTIF] Demande validation ' + payload.refLabel + ' → ' + targets.map((t) => t.email).join(', '));
  let anyOk = false;
  for (const t of targets) {
    const { subject, text, html } = tpl.newApprovalCircuitForApprover(payload, t.name);
    const r = await mailer.sendMail({ to: t.email, subject, text, html });
    if (r.ok) anyOk = true;
    else console.error('[NOTIF] Échec mail circuit', t.email, '—', r.reason);
  }
  return { ok: anyOk, targets: targets.map((t) => t.email) };
}

module.exports = {
  onInscriptionsUpdated,
  onDemandesUpdated,
  onApprobationsUpdated,
  flushPendingInscriptionEmails,
  flushPendingDemandeEmails,
  sendApprovalRequestEmails,
  approbationNotifyTargets
};
