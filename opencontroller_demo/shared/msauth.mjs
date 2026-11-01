// Microsoft sign-in for Lyzr people (MSAL.js v5, popup), same Entra app as Campaign Analytics,
// GSIEvents and MS UI ("Lyzr MS UI", single tenant). The landing page /opencontroller_demo/ is the
// redirect URI and doubles as the popup bridge: when it loads inside the popup with code= or
// error= in the URL it relays the response to the opener and stops (see isBridging).
//
// Entra needs the SPA redirect URI https://lyzr.kailash-gm.com/opencontroller_demo/ on that app.
export const MS_CLIENT_ID = 'cd569c2f-9121-4a99-8ba0-691c6df81cbd';
export const MS_TENANT_ID = '4b1018eb-9480-4542-89d0-4e6233aba226';
const SCOPES = ['User.Read'];
export const REDIRECT_PATH = '/opencontroller_demo/';

function stateMeta(url) {
  const m = /[#?&]state=([^&]+)/.exec(url); if (!m) return null;
  try {
    const raw = decodeURIComponent(m[1]).split('|')[0];
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))).meta || null;
  } catch { return null; }
}

// true when this window is the sign-in popup coming back: the response is relayed and the page stops.
export function isBridging() {
  const url = location.hash + location.search;
  const hasResponse = /[#?&](code|error)=/.test(url) && /[#?&]state=/.test(url);
  const meta = hasResponse ? stateMeta(url) : null;
  if (!hasResponse || (meta && meta.interactionType === 'redirect')) {
    if (typeof window.name === 'string' && window.name.startsWith('msal.')) { try { window.name = ''; } catch { /* ignore */ } }
    return false;
  }
  document.body.innerHTML = '<p style="font-family:system-ui;padding:24px;color:#C4B8AE;background:#160F0B">Completing sign-in… this window closes by itself.</p>';
  if (window.msalRedirectBridge) {
    window.msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {
      document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Sign-in could not be passed back. Close this window and try again.</p>';
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
        auth: { clientId: MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/' + MS_TENANT_ID, redirectUri: location.origin + REDIRECT_PATH },
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
      try { redirectResult = await app.handleRedirectPromise(); } catch { redirectResult = null; }
      if (redirectResult && redirectResult.account) app.setActiveAccount(redirectResult.account);
      return app;
    })();
  }
  return appPromise;
}

function clearStaleInteraction() {
  for (const store of [sessionStorage, localStorage]) {
    try { for (const k of Object.keys(store)) if (/interaction[._-]?status/i.test(k)) store.removeItem(k); } catch { /* storage blocked */ }
  }
}

// A token from a finished full-page redirect sign-in (popup blocked), or null.
export async function takeRedirectToken() {
  if (!window.msal) return null;
  await getMsal();
  const t = redirectResult && redirectResult.accessToken;
  redirectResult = null;
  return t || null;
}

const POPUP_BLOCKED = new Set(['block_nested_popups', 'popup_window_error', 'empty_window_error']);
// -> a Microsoft Graph access token
export async function signIn() {
  if (!window.msal) throw new Error('Microsoft sign-in is still loading, try again in a second.');
  const app = await getMsal();
  clearStaleInteraction();
  let res;
  try { res = await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' }); }
  catch (e) {
    if (e && POPUP_BLOCKED.has(e.errorCode)) { await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); return new Promise(() => {}); }
    if (e && e.errorCode === 'user_cancelled') throw new Error('Sign-in was closed before it finished.');
    throw new Error((e && (e.errorMessage || e.message)) ? String(e.errorMessage || e.message).split('\n')[0].slice(0, 220) : 'Microsoft sign-in failed.');
  }
  app.setActiveAccount(res.account);
  return res.accessToken;
}

// A token without a prompt when this browser already signed in (here or on Campaign Analytics).
export async function silentToken() {
  if (!window.msal) return null;
  try {
    const app = await getMsal();
    const acct = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!acct) return null;
    return (await app.acquireTokenSilent({ scopes: SCOPES, account: acct })).accessToken;
  } catch { return null; }
}
