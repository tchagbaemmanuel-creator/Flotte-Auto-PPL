/**
 * Modèles d’e-mails (sujet + texte brut + HTML).
 * Chaque fonction retourne { subject, text, html }.
 *
 * Modifiable sans toucher à notifications.js :
 *   newInscriptionForAdmin, accountApproved, newDemandeForApprobateur,
 *   demandeApproved, demandeRejected
 *
 * Variables .env : MAIL_ORG_NAME, MAIL_SIGNATURE, APP_URL
 */

const APP_URL = () => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const ORG = () => (process.env.MAIL_ORG_NAME || 'Flotte PPL').trim();
const SIGNATURE = () => (process.env.MAIL_SIGNATURE || 'Service Logistique — PPL').trim();

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch (_) {
    return String(s);
  }
}

function fmtDateTime(dateStr, heure) {
  const d = fmtDate(dateStr);
  if (!heure) return d;
  return `${d} à ${heure}`;
}

/** En-tête HTML commun (couleurs PPL) */
function htmlLayout(title, bodyHtml, ctaLabel, ctaUrl) {
  const url = ctaUrl || APP_URL();
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:24px 12px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(139,26,26,.12)">
        <tr>
          <td style="background:linear-gradient(135deg,#8B1A1A,#6B1313);padding:22px 28px">
            <div style="display:block;font-size:11px;color:#C8A84B;letter-spacing:2px;text-transform:uppercase">Flotte PPL</div>
            <div style="font-size:20px;font-weight:700;color:#fff;margin-top:6px">${esc(title)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;color:#374151;font-size:14px;line-height:1.65">
            ${bodyHtml}
            ${ctaLabel ? `
            <p style="margin:28px 0 0;text-align:center">
              <a href="${esc(url)}" style="display:inline-block;background:#8B1A1A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px">${esc(ctaLabel)}</a>
            </p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#faf8f5;padding:16px 28px;border-top:1px solid #e8e0d5;font-size:11px;color:#6b7280;line-height:1.5">
            ${esc(SIGNATURE())}<br>
            Cet e-mail est envoyé automatiquement par ${esc(ORG())}. Merci de ne pas répondre directement à ce message.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** 0 — Nouvelle demande d'accès → administrateur(s) */
function newInscriptionForAdmin(p, adminName) {
  const name = [p.prenom, p.nom].filter(Boolean).join(' ') || p.username;
  const service = p.service || p.dept || '';
  const poste = p.poste || '';
  const roleLabel = {
    demandeur: 'Demandeur de course',
    approbateur: 'Approbateur',
    manager: 'Gestionnaire',
    reader: 'Lecteur'
  }[p.role] || p.role || 'Demandeur';

  const subject = `${ORG()} — Nouvelle demande d'accès (@${p.username})`;

  const text =
    `Bonjour ${adminName || 'Administrateur'},\n\n` +
    `Une nouvelle demande d'accès à ${ORG()} vient d'être soumise.\n\n` +
    `── Demandeur ──\n` +
    `Nom : ${name}\n` +
    `E-mail : ${p.email || '—'}\n` +
    `Identifiant souhaité : ${p.username}\n` +
    (service ? `Service : ${service}\n` : '') +
    (poste ? `Poste : ${poste}\n` : '') +
    `Profil demandé : ${roleLabel}\n` +
    (p.motif ? `Motif : ${p.motif}\n` : '') +
    `Date : ${fmtDate(p.createdAt)}\n\n` +
    `Connectez-vous pour approuver ou rejeter cette demande.\n\n` +
    `Lien : ${APP_URL()}\n\n` +
    `Cordialement,\n${SIGNATURE()}`;

  const body =
    `<p>Bonjour <strong>${esc(adminName || 'Administrateur')}</strong>,</p>` +
    `<p>Une <strong>nouvelle demande d'accès</strong> à ${esc(ORG())} vient d'être soumise et attend votre validation.</p>` +
    `<table style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:16px 0" cellpadding="10" cellspacing="0">` +
    `<tr><td style="font-size:12px;color:#6b7280">Nom</td><td style="font-size:14px;font-weight:600">${esc(name)}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">E-mail</td><td style="font-size:14px">${esc(p.email || '—')}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Identifiant</td><td style="font-size:14px;font-weight:700;color:#8B1A1A">@${esc(p.username)}</td></tr>` +
    (service ? `<tr><td style="font-size:12px;color:#6b7280">Service</td><td style="font-size:14px">${esc(service)}</td></tr>` : '') +
    (poste ? `<tr><td style="font-size:12px;color:#6b7280">Poste</td><td style="font-size:14px">${esc(poste)}</td></tr>` : '') +
    `<tr><td style="font-size:12px;color:#6b7280">Profil demandé</td><td style="font-size:14px">${esc(roleLabel)}</td></tr>` +
    (p.motif ? `<tr><td style="font-size:12px;color:#6b7280">Motif</td><td style="font-size:14px">${esc(p.motif)}</td></tr>` : '') +
    `<tr><td style="font-size:12px;color:#6b7280">Date</td><td style="font-size:14px">${esc(fmtDate(p.createdAt))}</td></tr>` +
    `</table>` +
    `<p>Merci de vous connecter pour <strong>approuver ou rejeter</strong> cette demande depuis la page Comptes utilisateurs.</p>`;

  const html = htmlLayout('Nouvelle demande d\'accès', body, 'Traiter la demande', APP_URL());

  return { subject, text, html };
}

/** 1 — Compte approuvé (nouvel utilisateur) */
function accountApproved(p) {
  const name = [p.prenom, p.nom].filter(Boolean).join(' ') || p.username;
  const service = p.service || p.dept || '';
  const roleLabel = {
    demandeur: 'Demandeur de course',
    approbateur: 'Approbateur',
    manager: 'Gestionnaire',
    admin: 'Administrateur',
    reader: 'Lecteur'
  }[p.role] || p.role || 'Utilisateur';

  const subject = `${ORG()} — Votre accès est activé`;

  const text =
    `Bonjour ${name},\n\n` +
    `Bonne nouvelle : votre demande d'accès à la plateforme ${ORG()} a été validée par l'administration.\n\n` +
    `Vous pouvez dès maintenant vous connecter pour soumettre et suivre vos demandes de véhicule.\n\n` +
    `── Vos identifiants ──\n` +
    `Identifiant : ${p.username}\n` +
    (service ? `Service : ${service}\n` : '') +
    `Profil : ${roleLabel}\n\n` +
    `Lien de connexion : ${APP_URL()}\n\n` +
    `Conseil : conservez votre mot de passe en lieu sûr. En cas d'oubli, contactez votre administrateur Flotte PPL.\n\n` +
    `Cordialement,\n${SIGNATURE()}`;

  const body =
    `<p>Bonjour <strong>${esc(name)}</strong>,</p>` +
    `<p>Bonne nouvelle : votre demande d'accès à <strong>${esc(ORG())}</strong> a été <strong style="color:#059669">validée</strong> par l'administration.</p>` +
    `<p>Vous pouvez dès maintenant vous connecter pour <strong>soumettre et suivre vos demandes de véhicule</strong> au sein du parc automobile PPL.</p>` +
    `<table style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:20px 0" cellpadding="12" cellspacing="0">` +
    `<tr><td style="font-size:12px;color:#6b7280">Identifiant</td><td style="font-size:14px;font-weight:700;color:#8B1A1A">${esc(p.username)}</td></tr>` +
    (service ? `<tr><td style="font-size:12px;color:#6b7280">Service</td><td style="font-size:14px">${esc(service)}</td></tr>` : '') +
    `<tr><td style="font-size:12px;color:#6b7280">Profil</td><td style="font-size:14px">${esc(roleLabel)}</td></tr>` +
    `</table>` +
    `<p style="font-size:13px;color:#6b7280">💡 Conservez votre mot de passe en lieu sûr. En cas d'oubli, contactez votre administrateur.</p>`;

  const html = htmlLayout('Compte activé', body, 'Accéder à Flotte PPL', APP_URL());

  return { subject, text, html };
}

/** 2 — Nouvelle demande → approbateur */
function newDemandeForApprobateur(d, approbName) {
  const demandeur = d.demandeurNom || 'Un collaborateur';
  const urgent = d.typeUrgent || d.urgence === 'urgente';
  const subject = urgent
    ? `🚨 ${ORG()} — Demande URGENTE ${d.ref}`
    : `${ORG()} — Nouvelle demande de course ${d.ref}`;

  const text =
    `Bonjour ${approbName},\n\n` +
    `${demandeur} vient de soumettre une demande de mise à disposition de véhicule.\n` +
    (urgent ? `⚠️ Cette demande est marquée comme URGENTE.\n\n` : '\n') +
    `── Détails de la demande ──\n` +
    `Référence : ${d.ref}\n` +
    `Demandeur : ${demandeur}\n` +
    `Service : ${d.service || '—'}\n` +
    `Destination : ${d.destination || '—'}\n` +
    `Date de départ : ${fmtDateTime(d.dateDepart, d.heureDepart)}\n` +
    `Motif : ${d.motif || '—'}\n` +
    (d.passagers ? `Passagers : ${d.passagers}\n` : '') +
    (d.vehiculePref ? `Véhicule souhaité : ${d.vehiculePref}\n` : '') +
    `\nMerci de vous connecter pour approuver ou rejeter cette demande dans les meilleurs délais.\n\n` +
    `Lien : ${APP_URL()}\n\n` +
    `Cordialement,\n${SIGNATURE()}`;

  const urgBadge = urgent
    ? `<p style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;color:#991B1B;font-weight:700;font-size:13px">🚨 Demande marquée comme <strong>URGENTE</strong></p>`
    : '';

  const body =
    `<p>Bonjour <strong>${esc(approbName)}</strong>,</p>` +
    `<p><strong>${esc(demandeur)}</strong> vient de soumettre une <strong>demande de mise à disposition de véhicule</strong> sur ${esc(ORG())}.</p>` +
    urgBadge +
    `<table style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:16px 0" cellpadding="10" cellspacing="0">` +
    `<tr><td style="font-size:12px;color:#6b7280;width:38%">Référence</td><td style="font-size:14px;font-weight:700;color:#8B1A1A">${esc(d.ref)}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Demandeur</td><td style="font-size:14px">${esc(demandeur)}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Service</td><td style="font-size:14px">${esc(d.service || '—')}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Destination</td><td style="font-size:14px;font-weight:600">${esc(d.destination || '—')}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Date de départ</td><td style="font-size:14px">${esc(fmtDateTime(d.dateDepart, d.heureDepart))}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Motif</td><td style="font-size:14px">${esc(d.motif || '—')}</td></tr>` +
    (d.passagers ? `<tr><td style="font-size:12px;color:#6b7280">Passagers</td><td style="font-size:14px">${esc(d.passagers)}</td></tr>` : '') +
    (d.vehiculePref ? `<tr><td style="font-size:12px;color:#6b7280">Véhicule souhaité</td><td style="font-size:14px">${esc(d.vehiculePref)}</td></tr>` : '') +
    `</table>` +
    `<p>Merci de traiter cette demande <strong>dans les meilleurs délais</strong> (approbation ou rejet) depuis l'application.</p>`;

  const html = htmlLayout('Nouvelle demande de course', body, 'Traiter la demande', APP_URL());

  return { subject, text, html };
}

/** 3 — Demande approuvée → demandeur */
function demandeApproved(d, demandeurName) {
  const subject = `${ORG()} — Demande ${d.ref} approuvée ✅`;

  const text =
    `Bonjour ${demandeurName},\n\n` +
    `Votre demande de course a été approuvée.\n\n` +
    `── Récapitulatif ──\n` +
    `Référence : ${d.ref}\n` +
    `Destination : ${d.destination || '—'}\n` +
    `Date de départ : ${fmtDateTime(d.dateDepart, d.heureDepart)}\n` +
    (d.approbateurNom ? `Approuvée par : ${d.approbateurNom}\n` : '') +
    (d.vehiculeAffecte ? `Véhicule affecté : ${d.vehiculeAffecte}\n` : '') +
    `\nLe service logistique procédera à l'affectation du véhicule. Vous serez informé(e) de toute mise à jour.\n\n` +
    `Suivi : ${APP_URL()}\n\n` +
    `Cordialement,\n${SIGNATURE()}`;

  const body =
    `<p>Bonjour <strong>${esc(demandeurName)}</strong>,</p>` +
    `<p style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:12px 16px;color:#166534">` +
    `✅ Votre demande de course <strong>${esc(d.ref)}</strong> a été <strong>approuvée</strong>.` +
    `</p>` +
    `<table style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:16px 0" cellpadding="10" cellspacing="0">` +
    `<tr><td style="font-size:12px;color:#6b7280">Référence</td><td style="font-size:14px;font-weight:700">${esc(d.ref)}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Destination</td><td style="font-size:14px">${esc(d.destination || '—')}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Date de départ</td><td style="font-size:14px">${esc(fmtDateTime(d.dateDepart, d.heureDepart))}</td></tr>` +
    (d.approbateurNom ? `<tr><td style="font-size:12px;color:#6b7280">Approuvée par</td><td style="font-size:14px">${esc(d.approbateurNom)}</td></tr>` : '') +
    (d.vehiculeAffecte ? `<tr><td style="font-size:12px;color:#6b7280">Véhicule affecté</td><td style="font-size:14px;font-weight:600;color:#059669">${esc(d.vehiculeAffecte)}</td></tr>` : '') +
    `</table>` +
    `<p>Le service logistique finalisera l'affectation du véhicule. Consultez l'application pour le suivi en temps réel.</p>`;

  const html = htmlLayout('Demande approuvée', body, 'Voir ma demande', APP_URL());

  return { subject, text, html };
}

/** 4 — Demande rejetée → demandeur */
function demandeRejected(d, demandeurName, motifRejet) {
  const subject = `${ORG()} — Demande ${d.ref} non retenue`;

  const text =
    `Bonjour ${demandeurName},\n\n` +
    `Nous vous informons que votre demande de course n'a pas été retenue.\n\n` +
    `── Récapitulatif ──\n` +
    `Référence : ${d.ref}\n` +
    `Destination : ${d.destination || '—'}\n` +
    `Date souhaitée : ${fmtDateTime(d.dateDepart, d.heureDepart)}\n` +
    (d.approbateurNom ? `Traitée par : ${d.approbateurNom}\n` : '') +
    (motifRejet ? `\nMotif du rejet :\n${motifRejet}\n` : '') +
    `\nPour toute question ou pour soumettre une nouvelle demande, connectez-vous à ${ORG()}.\n\n` +
    `Lien : ${APP_URL()}\n\n` +
    `Cordialement,\n${SIGNATURE()}`;

  const motifBlock = motifRejet
    ? `<p style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin:16px 0">` +
      `<strong style="color:#991B1B">Motif du rejet :</strong><br>${esc(motifRejet)}</p>`
    : '';

  const body =
    `<p>Bonjour <strong>${esc(demandeurName)}</strong>,</p>` +
    `<p>Nous vous informons que votre demande de course <strong>${esc(d.ref)}</strong> n'a <strong>pas été retenue</strong> par votre approbateur.</p>` +
    motifBlock +
    `<table style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:16px 0" cellpadding="10" cellspacing="0">` +
    `<tr><td style="font-size:12px;color:#6b7280">Référence</td><td style="font-size:14px">${esc(d.ref)}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Destination</td><td style="font-size:14px">${esc(d.destination || '—')}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Date souhaitée</td><td style="font-size:14px">${esc(fmtDateTime(d.dateDepart, d.heureDepart))}</td></tr>` +
    (d.approbateurNom ? `<tr><td style="font-size:12px;color:#6b7280">Traitée par</td><td style="font-size:14px">${esc(d.approbateurNom)}</td></tr>` : '') +
    `</table>` +
    `<p>Vous pouvez soumettre une nouvelle demande corrigée depuis l'application si nécessaire.</p>`;

  const html = htmlLayout('Demande non retenue', body, 'Ouvrir Flotte PPL', APP_URL());

  return { subject, text, html };
}

/** Circuit validation — demande d’approbation à un niveau hiérarchique */
function newApprovalCircuitForApprover(payload, approbName) {
  const typeLabel = payload.typeLabel || payload.type || 'Document';
  const ref = payload.refLabel || '—';
  const requester = payload.requesterName || 'Un collaborateur';
  const subject = `${ORG()} — Validation requise : ${typeLabel} (${ref})`;

  const details = (payload.summaryLines || [])
    .map((line) => `• ${line}`)
    .join('\n');

  const text =
    `Bonjour ${approbName},\n\n` +
    `${requester} vous demande de valider une demande sur ${ORG()}.\n\n` +
    `── Détails ──\n` +
    `Type : ${typeLabel}\n` +
    `Référence : ${ref}\n` +
    (details ? `${details}\n` : '') +
    `\nMerci de vous connecter à l'application pour approuver ou rejeter à votre niveau.\n\n` +
    `Lien : ${APP_URL()}\n\n` +
    `Cordialement,\n${SIGNATURE()}`;

  const summaryHtml = (payload.summaryLines || [])
    .map((line) => `<tr><td colspan="2" style="font-size:13px;padding:4px 0">${esc(line)}</td></tr>`)
    .join('');

  const body =
    `<p>Bonjour <strong>${esc(approbName)}</strong>,</p>` +
    `<p><strong>${esc(requester)}</strong> sollicite votre <strong>validation</strong> pour l'élément suivant :</p>` +
    `<table style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:16px 0" cellpadding="10" cellspacing="0">` +
    `<tr><td style="font-size:12px;color:#6b7280;width:38%">Type</td><td style="font-size:14px;font-weight:700;color:#8B1A1A">${esc(typeLabel)}</td></tr>` +
    `<tr><td style="font-size:12px;color:#6b7280">Référence</td><td style="font-size:14px">${esc(ref)}</td></tr>` +
    summaryHtml +
    `</table>` +
    `<p>Connectez-vous à <strong>${esc(ORG())}</strong> → <em>Comptes utilisateurs</em> → circuit de validation pour traiter la demande.</p>`;

  const html = htmlLayout('Validation requise', body, 'Ouvrir Flotte PPL', APP_URL());

  return { subject, text, html };
}

module.exports = {
  newInscriptionForAdmin,
  accountApproved,
  newDemandeForApprobateur,
  demandeApproved,
  demandeRejected,
  newApprovalCircuitForApprover
};
