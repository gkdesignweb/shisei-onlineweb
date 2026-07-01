import nodemailer from 'nodemailer';
import { getSetting } from './settings.js';

// Transporter is rebuilt on each send so admin SMTP changes apply immediately.
// At this scale that's a fine trade-off — nodemailer transporter construction
// is cheap and avoids needing a cache-bust wiring across modules.
export async function sendMail({ to, subject, text, html }) {
  if (!to) return;

  const host = await getSetting('SMTP_HOST');
  const port = parseInt((await getSetting('SMTP_PORT')) || '587', 10);
  const user = await getSetting('SMTP_USER');
  const pass = await getSetting('SMTP_PASS');
  const from = await getSetting('SMTP_FROM');

  // Fall back to stub if host or auth is missing. Real send only when both are set.
  if (!host || !user) {
    console.log('[mailer:stub]', subject, '→', to);
    if (text) console.log('[mailer:stub]', text);
    return;
  }

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({ from, to, subject, text, html });
  } catch (err) {
    // Don't let a transport failure crash the request handler upstream
    console.warn('[mailer] send failed:', err.code ?? err.message);
    console.log('[mailer:fallback]', subject, '→', to);
    if (text) console.log('[mailer:fallback]', text);
  }
}
