// =============================================================================
// Who is calling? Shared by /api/rows (pipeline + demo_pipeline writes).
// =============================================================================
// Two front ends write through the same API and sign in differently:
//   /pipeline/       Google Identity Services   (@lyzr.ai)
//   /demo_pipeline/  Microsoft, MSAL popup       (@lyzr.com, the Lyzr tenant's UPN domain)
// verifyLyzrToken(token) answers { name, email, provider } for a live Lyzr
// account, or null. A Microsoft access token is a JWT; a Google one is opaque.
// =============================================================================

// "Lyzr MS UI" Entra app (single tenant), same as GSIEvents, Campaign Analytics, MS UI
export const MS_TENANT_ID = '4b1018eb-9480-4542-89d0-4e6233aba226';
const LYZR_DOMAINS = ['lyzr.ai', 'lyzr.com'];
const DEV_EMAILS = ['kailcodes02@gmail.com'];

const isLyzrEmail = (email) => {
  const e = String(email || '').toLowerCase();
  return DEV_EMAILS.includes(e) || LYZR_DOMAINS.some((d) => e.endsWith('@' + d));
};

// One person, two addresses: name@lyzr.ai (Google) and name@lyzr.com (Microsoft).
export function sameLyzrPerson(a, b) {
  const split = (e) => { const s = String(e || '').toLowerCase().trim(); const i = s.lastIndexOf('@'); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };
  const [la, da] = split(a); const [lb, db] = split(b);
  if (!la || !lb) return false;
  if (la === lb && da === db) return true;
  return la === lb && LYZR_DOMAINS.includes(da) && LYZR_DOMAINS.includes(db);
}

function jwtClaims(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))));
  } catch { return null; }
}

async function verifyMicrosoftToken(token) {
  // Graph checks the signature, expiry and audience; a 200 from /me means the
  // token is genuine, so its tenant claim can be trusted. Any Graph token from
  // another tenant is refused here, before and after the call.
  const claims = jwtClaims(token);
  if (!claims || claims.tid !== MS_TENANT_ID) return null;
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const p = await res.json();
    const email = String(p.mail || p.userPrincipalName || '').toLowerCase();
    if (!isLyzrEmail(email)) return null;
    return { name: p.displayName || email, email, provider: 'microsoft' };
  } catch { return null; }
}

async function verifyGoogleToken(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const p = await res.json();
    const email = String(p.email || '').toLowerCase();
    const verified = p.email_verified === true || p.email_verified === 'true';
    if (!verified || !(email.endsWith('@lyzr.ai') || p.hd === 'lyzr.ai' || DEV_EMAILS.includes(email))) return null;
    return { name: p.name || email, email, provider: 'google' };
  } catch { return null; }
}

export async function verifyLyzrToken(token) {
  if (!token) return null;
  return jwtClaims(token) ? verifyMicrosoftToken(token) : verifyGoogleToken(token);
}
