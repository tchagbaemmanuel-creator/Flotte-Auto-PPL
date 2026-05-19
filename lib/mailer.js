/**
 * Envoi d'e-mails SMTP (Render / local).
 * Variables : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL
 */

const nodemailer = require('nodemailer');

let transporter = null;
let configured = false;
let lastVerifyError = null;

function normalizeSmtpPass(pass) {
  return String(pass ?? '')
    .replace(/\r/g, '')
    .replace(/\s/g, ''); // mot de passe application Google souvent collé avec espaces
}

function resolveFrom() {
  const user = (process.env.SMTP_USER || '').trim();
  const raw = (process.env.MAIL_FROM || '').trim();
  let name = 'Flotte PPL';
  const m = raw.match(/^([^<]+)</);
  if (m) name = m[1].trim().replace(/^["']|["']$/g, '');
  else if (raw && !raw.includes('@')) name = raw;
  // Gmail : l'expéditeur doit être le compte authentifié (sinon rejet silencieux / erreur)
  if (user.includes('@')) return `${name} <${user}>`;
  return raw || user || 'Flotte PPL';
}

function init() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = normalizeSmtpPass(process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD ?? '');
  if (!host || !user || !pass) {
    configured = false;
    transporter = null;
    return false;
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass }
  });
  configured = true;
  lastVerifyError = null;
  return true;
}

function isConfigured() {
  if (!transporter) init();
  return configured;
}

async function verifyConnection() {
  if (!isConfigured()) {
    lastVerifyError = 'smtp-not-configured';
    return false;
  }
  try {
    await transporter.verify();
    lastVerifyError = null;
    console.log('[MAIL] ✅ Connexion SMTP OK — expéditeur :', resolveFrom());
    return true;
  } catch (e) {
    lastVerifyError = e.message;
    console.error('[MAIL] ❌ Vérification SMTP échouée :', e.message);
    return false;
  }
}

function getLastVerifyError() {
  return lastVerifyError;
}

async function sendMail({ to, subject, text, html }) {
  if (!to) return { ok: false, reason: 'no-recipient' };
  if (!isConfigured()) {
    console.log('[MAIL] SMTP non configuré — e-mail non envoyé à', to, '—', subject);
    return { ok: false, reason: 'smtp-not-configured' };
  }
  const from = resolveFrom();
  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    console.log('[MAIL] ✅ Envoyé à', to, '—', subject, info.messageId ? '(' + info.messageId + ')' : '');
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[MAIL] ❌ Erreur envoi à', to, ':', e.message);
    if (e.response) console.error('[MAIL] Réponse SMTP :', e.response);
    return { ok: false, reason: e.message };
  }
}

module.exports = { init, isConfigured, verifyConnection, getLastVerifyError, sendMail, resolveFrom };
