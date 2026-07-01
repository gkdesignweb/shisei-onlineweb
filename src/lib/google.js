// Google OAuth 2.0 — minimal authorization-code flow.
// Settings keys: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL
import { getSetting } from './settings.js';

const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export async function buildGoogleLoginUrl(state) {
  const clientId    = await getSetting('GOOGLE_CLIENT_ID');
  const callbackUrl = await getSetting('GOOGLE_CALLBACK_URL');
  if (!clientId || !callbackUrl) throw new Error('Google OAuth not configured');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(code) {
  const clientId     = await getSetting('GOOGLE_CLIENT_ID');
  const clientSecret = await getSetting('GOOGLE_CLIENT_SECRET');
  const callbackUrl  = await getSetting('GOOGLE_CALLBACK_URL');
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl,
    grant_type: 'authorization_code',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function fetchGoogleProfile(accessToken) {
  const r = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Google profile fetch failed: ${r.status}`);
  return r.json(); // { sub, email, name, picture, ... }
}
