// Microsoft sign-in (MSAL.js v5, popup). Same Entra app registration as MS UI
// and GSIEvents ("Lyzr MS UI", single tenant). This page is its own redirect
// bridge: when it loads inside the popup with code=/error= in the URL it
// relays the response to the opener and stops.
export const MS_CLIENT_ID = 'cd569c2f-9121-4a99-8ba0-691c6df81cbd';
export const MS_TENANT_ID = '4b1018eb-9480-4542-89d0-4e6233aba226';
const SCOPES = ['User.Read'];
const KEY = 'ca.user';
const LOCAL = 'ca.local'; // { token, email, name, expires_at } from /api/ca/login

// MSAL puts {id, meta:{interactionType}} base64-encoded in `state` (before the "|"). Popup
// responses are relayed to the opener; redirect responses are handled by MSAL in this window.
function stateMeta(url) {
  const m = /[#?&]state=([^&]+)/.exec(url); if (!m) return null;
  try { const raw = decodeURIComponent(m[1]).split('|')[0]; return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))).meta || null; } catch { return null; }
}
const inMsalWindow = () => typeof window.name === 'string' && window.name.startsWith('msal.');

export function isBridging() {
  // The popup comes back to this page with the sign-in response in the URL.
  // Microsoft's login pages set Cross-Origin-Opener-Policy, which cuts the
  // popup's link to this window (window.opener is null), so we must not
  // require an opener: any popup response carrying MSAL's `state` is handed
  // to the bridge, which relays it over BroadcastChannel and closes the popup.
  const url = location.hash + location.search;
  const hasResponse = /[#?&](code|error)=/.test(url) && /[#?&]state=/.test(url);
  const meta = hasResponse ? stateMeta(url) : null;
  if (!hasResponse || (meta && meta.interactionType === 'redirect')) {
    // Not a popup relay. If this window used to be the sign-in popup (Chrome can open it as
    // a tab, and it keeps the "msal." name), make it an ordinary tab again so a later
    // sign-in here is not refused with block_nested_popups, and drop a stale ?state=.
    if (inMsalWindow()) { try { window.name = ''; } catch { /* ignore */ } }
    if (!hasResponse && /[?&]state=/.test(location.search) && !/[#?&](code|error)=/.test(url)) history.replaceState(null, '', location.origin + location.pathname + location.hash);
    return false;
  }
  document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Completing sign-in… this window closes by itself. If it does not, close it and go back to the dashboard.</p>';
  if (window.msalRedirectBridge) {
    window.msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {
      document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Sign-in could not be passed back to the dashboard. Close this window and click Sign in again.</p>';
    });
  }
  return true;
}

let appPromise = null;
let redirectResult = null;
function getMsal() {
  if (!appPromise) {
    appPromise = (async () => {
      const app = new msal.PublicClientApplication({
        auth: { clientId: MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/' + MS_TENANT_ID, redirectUri: location.origin + location.pathname },
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
      // Completes a full-page redirect sign-in (the fallback when popups are blocked).
      try { redirectResult = await app.handleRedirectPromise(); } catch { redirectResult = null; }
      if (redirectResult && redirectResult.account) app.setActiveAccount(redirectResult.account);
      return app;
    })();
  }
  return appPromise;
}

// MSAL keeps an "interaction in progress" lock in browser storage. A popup
// that was closed, blocked or failed (for example before the redirect URI was
// registered) can leave it behind, and every later click then fails with
// interaction_in_progress. Only one sign-in can run from this tab at a time
// (guarded below), so any lock present when the button is pressed is stale.
function clearStaleInteraction() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      for (const k of Object.keys(store)) if (/interaction[._-]?status/i.test(k)) store.removeItem(k);
    } catch { /* storage blocked */ }
  }
}

let signingIn = null;
export async function signIn() {
  if (!window.msal) throw new Error('Microsoft sign-in is still loading, try again.');
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const app = await getMsal();
    clearStaleInteraction();
    try { return await doSignIn(app); }
    catch (e) {
      if (e && e.errorCode === 'interaction_in_progress') { clearStaleInteraction(); return await doSignIn(app); }
      throw e;
    }
  })();
  try { return await signingIn; } finally { signingIn = null; }
}

const POPUP_BLOCKED = new Set(['block_nested_popups', 'popup_window_error', 'empty_window_error']);
async function doSignIn(app) {
  let res;
  try { res = await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' }); }
  catch (e) {
    // Popup refused (blocked by the browser, or this window is itself a popup): sign in with
    // a full-page redirect instead; handleRedirectPromise() finishes it when we come back.
    if (e && POPUP_BLOCKED.has(e.errorCode)) { try { window.name = ''; } catch { /* ignore */ } await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); return new Promise(() => {}); }
    throw e;
  }
  app.setActiveAccount(res.account);
  const user = await profile(res.accessToken);
  localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

async function profile(token) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Could not read your Microsoft profile.');
  const p = await r.json();
  const email = (p.mail || p.userPrincipalName || '').toLowerCase();
  if (!email) throw new Error('Could not read your Microsoft profile.');
  return { name: p.displayName || email, email };
}

// ---- email + password (named outside accounts; see functions/api/ca/login.js) ----
function localSession() { try { const s = JSON.parse(localStorage.getItem(LOCAL) || 'null'); return s && s.token && Date.parse(s.expires_at) > Date.now() ? s : null; } catch { return null; } }
export async function signInLocal(email, password) {
  const r = await fetch('/api/ca/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Sign-in failed (${r.status})`);
  localStorage.setItem(LOCAL, JSON.stringify({ token: data.token, email: data.email, name: data.name, expires_at: data.expires_at }));
  const user = { name: data.name || data.email, email: data.email, local: true };
  localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

// Returns a fresh Graph token (silent renew), the local session token, or null when the user must sign in again.
export async function getToken() {
  const local = localSession(); if (local) return local.token;
  if (!window.msal) return null;
  try {
    const app = await getMsal();
    const acct = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!acct) return null;
    const res = await app.acquireTokenSilent({ scopes: SCOPES, account: acct });
    return res.accessToken;
  } catch { return null; }
}

export async function restore() {
  const local = localSession(); if (local) return { name: local.name || local.email, email: local.email, local: true };
  localStorage.removeItem(LOCAL);
  if (window.msal) {
    const app = await getMsal();
    if (redirectResult && redirectResult.accessToken) {
      try { const user = await profile(redirectResult.accessToken); localStorage.setItem(KEY, JSON.stringify(user)); redirectResult = null; return user; } catch { /* fall through */ }
    }
  }
  const u = localStorage.getItem(KEY);
  if (!u) return null;
  try { const user = JSON.parse(u); return (await getToken()) ? user : null; } catch { return null; }
}

export async function signOut() {
  const wasLocal = !!localSession();
  localStorage.removeItem(KEY); localStorage.removeItem(LOCAL);
  if (wasLocal) { location.reload(); return; }
  try { const app = await getMsal(); const acct = app.getActiveAccount() || app.getAllAccounts()[0]; if (acct) await app.logoutPopup({ account: acct, mainWindowRedirectUri: location.origin + location.pathname }); } catch {}
  location.reload();
}
