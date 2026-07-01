import { getSetting } from './settings.js';

export async function buildLineLoginUrl(state) {
  const clientId    = await getSetting('LINE_LOGIN_CHANNEL_ID');
  const callbackUrl = await getSetting('LINE_LOGIN_CALLBACK_URL');
  const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'profile openid email');
  return url.toString();
}

export async function exchangeLineCode(code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: await getSetting('LINE_LOGIN_CALLBACK_URL'),
    client_id: await getSetting('LINE_LOGIN_CHANNEL_ID'),
    client_secret: await getSetting('LINE_LOGIN_CHANNEL_SECRET'),
  });
  const res = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`LINE token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function fetchLineProfile(accessToken) {
  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('LINE profile fetch failed');
  return res.json();
}

export async function pushLineMessage(lineUserId, text) {
  const token = await getSetting('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN');
  if (!token || !lineUserId) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text }],
    }),
  });
  if (!res.ok) console.warn('[line] push failed:', await res.text());
}
