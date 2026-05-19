/**
 * Envoi d'e-mails — Brevo API (HTTPS, compatible Render) ou SMTP (local).
 *
 * Render (plan gratuit) : SMTP sortant souvent bloqué → utiliser Brevo.
 *   BREVO_API_KEY=xxx
 *   BREVO_SENDER_EMAIL=contact@prestigepoultry.com  (adresse validée dans Brevo)
 *
 * Local : SMTP_HOST, SMTP_USER, SMTP_PASS…
 */

const nodemailer = require('nodemailer');

let transporter = null;
let smtpConfigured = false;
let lastVerifyError = null;

function getBrevoKey() {
  return (process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || '').trim();
}

function normalizeSmtpPass(pass) {
  return String(pass ?? '').replace(/\r/g, '').replace(/\s/g, '');
}

function parseEmailFromEnv(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  // Une seule adresse expéditeur (pas la liste MAIL_ADMIN_NOTIFY)
  const first = s.split(/[,;]/)[0].trim();
  if (first.includes('@')) return first;
  return '';
}

function resolveSender() {
  const name = (process.env.MAIL_ORG_NAME || 'Flotte PPL').trim();
  const email = parseEmailFromEnv(
    process.env.BREVO_SENDER_EMAIL ||
    process.env.MAIL_FROM ||
    process.env.SMTP_USER ||
    ''
  );
  return { name, email };
}

function resolveFrom() {
  const { name, email } = resolveSender();
  if (email.includes('@')) return `${name} <${email}>`;
  return name || 'Flotte PPL';
}

function isRenderHost() {
  return process.env.RENDER === 'true';
}

function getProvider() {
  if (getBrevoKey()) return 'brevo';
  if (isRenderHost()) return null; // SMTP bloqué sur Render gratuit
  if (smtpConfigured || initSmtp()) return 'smtp';
  return null;
}

function initSmtp() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = normalizeSmtpPass(process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD ?? '');
  if (!host || !user || !pass) {
    smtpConfigured = false;
    transporter = null;
    return false;
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
    auth: { user, pass }
  });
  smtpConfigured = true;
  return true;
}

function init() {
  lastVerifyError = null;
  if (getBrevoKey()) {
    initSmtp(); // optionnel en secours local
    return true;
  }
  return initSmtp();
}

function isConfigured() {
  if (getBrevoKey()) {
    const { email } = resolveSender();
    return !!email.includes('@');
  }
  if (isRenderHost()) return false;
  if (!transporter) initSmtp();
  return smtpConfigured;
}

async function verifyBrevo() {
  const key = getBrevoKey();
  const { email } = resolveSender();
  if (!key) return false;
  if (!email.includes('@')) {
    lastVerifyError = 'BREVO_SENDER_EMAIL (ou SMTP_USER) manquant';
    console.error('[MAIL] ❌', lastVerifyError);
    return false;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body.slice(0, 200) || `HTTP ${res.status}`);
    }
    lastVerifyError = null;
    console.log('[MAIL] ✅ Brevo API OK — expéditeur :', email);
    return true;
  } catch (e) {
    lastVerifyError = e.message;
    console.error('[MAIL] ❌ Brevo API :', e.message);
    return false;
  }
}

async function verifyConnection() {
  if (getBrevoKey()) return verifyBrevo();
  if (isRenderHost()) {
    lastVerifyError = 'Sur Render : ajoutez BREVO_API_KEY et BREVO_SENDER_EMAIL (SMTP bloqué).';
    console.error('[MAIL] ❌', lastVerifyError);
    return false;
  }
  if (!initSmtp()) {
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
    if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(e.message) && process.env.RENDER === 'true') {
      console.error('[MAIL] 💡 Sur Render, le SMTP sortant est souvent bloqué. Utilisez BREVO_API_KEY (API HTTPS).');
    }
    return false;
  }
}

function getLastVerifyError() {
  return lastVerifyError;
}

async function sendViaBrevo({ to, subject, text, html }) {
  const key = getBrevoKey();
  const { name, email } = resolveSender();
  if (!key || !email.includes('@')) {
    return { ok: false, reason: 'brevo-not-configured' };
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': key,
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { name, email },
        to: [{ email: to }],
        subject,
        textContent: text || undefined,
        htmlContent: html || undefined
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body.slice(0, 300) || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    console.log('[MAIL] ✅ Brevo →', to, '—', subject, data.messageId ? '(' + data.messageId + ')' : '');
    return { ok: true, messageId: data.messageId };
  } catch (e) {
    console.error('[MAIL] ❌ Brevo envoi →', to, ':', e.message);
    return { ok: false, reason: e.message };
  }
}

async function sendViaSmtp({ to, subject, text, html }) {
  if (!initSmtp()) {
    return { ok: false, reason: 'smtp-not-configured' };
  }
  const from = resolveFrom();
  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    console.log('[MAIL] ✅ SMTP →', to, '—', subject);
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[MAIL] ❌ SMTP →', to, ':', e.message);
    return { ok: false, reason: e.message };
  }
}

async function sendMail({ to, subject, text, html }) {
  if (!to) return { ok: false, reason: 'no-recipient' };
  if (getBrevoKey()) return sendViaBrevo({ to, subject, text, html });
  if (isRenderHost()) {
    console.error('[MAIL] ❌ Render : BREVO_API_KEY manquante — mail non envoyé à', to);
    return { ok: false, reason: 'brevo-required-on-render' };
  }
  if (!isConfigured()) {
    console.log('[MAIL] Non configuré — e-mail non envoyé à', to);
    return { ok: false, reason: 'mail-not-configured' };
  }
  return sendViaSmtp({ to, subject, text, html });
}

module.exports = {
  init,
  isConfigured,
  getProvider,
  verifyConnection,
  getLastVerifyError,
  sendMail,
  resolveFrom
};
