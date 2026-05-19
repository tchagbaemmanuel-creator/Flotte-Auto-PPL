/**
 * Envoi d'e-mails SMTP (Render / local).
 * Variables : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL
 */

const nodemailer = require('nodemailer');

let transporter = null;
let configured = false;

function init() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD ?? '';
  if (!host || !user || !pass) {
    configured = false;
    return false;
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: String(pass).replace(/\r/g, '') }
  });
  configured = true;
  return true;
}

function isConfigured() {
  if (!transporter) init();
  return configured;
}

async function sendMail({ to, subject, text, html }) {
  if (!to) return { ok: false, reason: 'no-recipient' };
  if (!isConfigured()) {
    console.log('[MAIL] SMTP non configuré — e-mail non envoyé à', to, '—', subject);
    return { ok: false, reason: 'smtp-not-configured' };
  }
  const from = (process.env.MAIL_FROM || process.env.SMTP_USER || 'Flotte PPL').trim();
  try {
    await transporter.sendMail({ from, to, subject, text, html });
    console.log('[MAIL] ✅ Envoyé à', to, '—', subject);
    return { ok: true };
  } catch (e) {
    console.error('[MAIL] Erreur envoi à', to, ':', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { init, isConfigured, sendMail };
