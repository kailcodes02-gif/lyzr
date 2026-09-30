// Microsoft sign-in (MSAL.js v5, popup). Same Entra app registration as MS UI
// and GSIEvents ("Lyzr MS UI", single tenant). This page is its own redirect
// bridge: when it loads inside the popup with code=/error= in the URL it
// relays the response to the opener and stops.
export const MS_CLIENT_ID = 'cd569c2f-9121-4a99-8ba0-691c6df81cbd';
export const MS_TENANT_ID = '4b1018eb-9480-4542-89d0-4e6233aba226';
const SCOPES = ['User.Read'];
const KEY = 'ca.user';

export function isBridging() {
  const hasResponse = /[#?&](code|error)=/.test(location.hash + location.search);
  const inPopup = !!window.opener || window.parent !== window;
  if (hasResponse && inPopup) {
    if (window.msalRedirectBridge) window.msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {});
    document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Completing sign-in…</p>';
    return true;
  }
  if (hasResponse) history.replaceState(null, '', location.pathname);
  return false;
}

let appPromise = null;
function getMsal() {
  if (!appPromise) {
    appPromise = (async () => {
      const app = new msal.PublicClientApplication({
        auth: { clientId: MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/' + MS_TENANT_ID, redirectUri: location.origin + location.pathname },
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
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

async function doSignIn(app) {
  const res = await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
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

// Returns a fresh Graph token (silent renew) or null when the user must sign in again.
export async function getToken() {
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
  const u = localStorage.getItem(KEY);
  if (!u) return null;
  try { const user = JSON.parse(u); return (await getToken()) ? user : null; } catch { return null; }
}

export async function signOut() {
  localStorage.removeItem(KEY);
  try { const app = await getMsal(); const acct = app.getActiveAccount() || app.getAllAccounts()[0]; if (acct) await app.logoutPopup({ account: acct, mainWindowRedirectUri: location.origin + location.pathname }); } catch {}
  location.reload();
}
