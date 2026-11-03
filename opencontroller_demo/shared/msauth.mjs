// Microsoft sign-in for Lyzr people (MSAL.js v5, popup), same Entra app as Campaign Analytics,
// GSIEvents and MS UI ("Lyzr MS UI", single tenant). The landing page /opencontroller_demo/ is the
// redirect URI and doubles as the popup bridge: when it loads inside the popup with code= or
// error= in the URL it relays the response to the opener and stops (see isBridging).
//
// Embedded on the public page EMBED_URL (WordPress BetterLinks, which frames this landing page and forwards
// its query string into the frame), Microsoft sends people back to that lyzr.ai address instead, with the
// response in the query, so the sign-in window only ever shows Microsoft and lyzr.ai. The copy of this page
// framed in that window is the bridge; it shares the embedded page's storage partition (same top-level
// site), so MSAL's BroadcastChannel reaches the embedded page.
//
// Entra needs both SPA redirect URIs on that app: https://lyzr.kailash-gm.com/opencontroller_demo/ and
// https://www.lyzr.ai/opencontroller-demo/.
export const MS_CLIENT_ID = 'cd569c2f-9121-4a99-8ba0-691c6df81cbd';
export const MS_TENANT_ID = '4b1018eb-9480-4542-89d0-4e6233aba226';
const SCOPES = ['User.Read'];
export const REDIRECT_PATH = '/opencontroller_demo/';
export const EMBED_URL = 'https://www.lyzr.ai/opencontroller-demo/';

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
  document.body.innerHTML = '<p style="font-family:system-ui;margin:0;padding:24px;min-height:100vh;box-sizing:border-box;color:#1F2022;background:#FAFAF9">Completing sign-in… this window closes by itself.</p>';
  if (window.msalRedirectBridge) {
    window.msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {
      document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Sign-in could not be passed back. Close this window and try again.</p>';
    });
  }
  return true;
}

export const isFramed = () => { try { return window.top !== window; } catch { return true; } };

// true when framed by EMBED_URL's site (remembered for this tab: the frame's referrer changes once it navigates)
export function onLyzrEmbed() {
  if (!isFramed()) return false;
  const site = new URL(EMBED_URL).origin;
  try { if (sessionStorage.getItem('ocdemo.embed') === site) return true; } catch { /* storage blocked */ }
  let parent = location.ancestorOrigins && location.ancestorOrigins.length ? location.ancestorOrigins[location.ancestorOrigins.length - 1] : '';
  if (!parent && document.referrer) { try { parent = new URL(document.referrer).origin; } catch { /* ignore */ } }
  if (parent !== site) return false;
  try { sessionStorage.setItem('ocdemo.embed', site); } catch { /* storage blocked */ }
  return true;
}

let appPromise = null;
let popupWindow = null;
let redirectResult = null;
function getMsal() {
  if (!appPromise) {
    appPromise = (async () => {
      const embed = onLyzrEmbed();
      const app = new msal.PublicClientApplication({
        auth: {
          clientId: MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/' + MS_TENANT_ID,
          redirectUri: embed ? EMBED_URL : location.origin + REDIRECT_PATH,
          // lyzr.ai forwards the query string into its frame, not the #fragment
          ...(embed ? { OIDCOptions: { responseMode: 'query', defaultScopes: ['openid', 'profile', 'offline_access'] } } : {}),
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
      // the bridge's own window.close() only reaches its frame when the window is the lyzr.ai page
      app.addEventCallback((ev) => { if (ev.eventType === 'msal:popupOpened' && ev.payload) popupWindow = ev.payload.popupWindow; });
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
    // Microsoft's page will not load inside a frame, so an embedded page cannot fall back to a redirect
    if (e && POPUP_BLOCKED.has(e.errorCode) && isFramed()) throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this page and try again.');
    if (e && POPUP_BLOCKED.has(e.errorCode)) { await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); return new Promise(() => {}); }
    if (e && e.errorCode === 'user_cancelled') throw new Error('Sign-in was closed before it finished.');
    throw new Error((e && (e.errorMessage || e.message)) ? String(e.errorMessage || e.message).split('\n')[0].slice(0, 220) : 'Microsoft sign-in failed.');
  }
  finally { try { if (popupWindow && !popupWindow.closed) popupWindow.close(); } catch { /* ignore */ } popupWindow = null; }
  app.setActiveAccount(res.account);
  return res.accessToken;
}

// Full-page sign-in in this window; the page comes back to REDIRECT_PATH (see takeRedirectToken).
export async function signInRedirect() {
  if (!window.msal) throw new Error('Microsoft sign-in is still loading, try again in a second.');
  const app = await getMsal();
  clearStaleInteraction();
  await app.loginRedirect({ scopes: SCOPES, prompt: 'select_account', redirectStartPage: location.origin + REDIRECT_PATH });
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
