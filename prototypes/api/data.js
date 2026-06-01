// =============================================================================
// Vercel Serverless Function: GET /api/data
// =============================================================================
// Fetches data.json from the GitHub repository and returns it.
// Uses the SAME environment variables as the pipeline project — one DB.
//
// Set in Vercel Dashboard → Project Settings → Environment Variables:
//   GITHUB_OWNER  — e.g. "kailcodes02-gif"
//   GITHUB_REPO   — e.g. "lyzr"
//   GITHUB_TOKEN  — Personal Access Token with repo read scope
//   GITHUB_PATH   — "pipeline/data.json"
// =============================================================================

async function verifyGoogleToken(accessToken) {
  try {
    const url = `https://www.googleapis.com/oauth2/v3/userinfo`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const email = payload.email || '';
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const isLyzrOrDev = emailVerified && (
      email.endsWith('@lyzr.ai') ||
      payload.hd === 'lyzr.ai' ||
      email === 'kailcodes02@gmail.com'
    );
    if (isLyzrOrDev) return payload;
    return null;
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers. The Allow-Headers entry is required for the browser to send
  // the Authorization header on a cross-origin (preflighted) request; without
  // it the preflight fails and the real request never goes out.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Google OAuth verification
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return res.status(403).json({ error: 'Invalid token or access restricted to @lyzr.ai accounts' });
  }

  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, GITHUB_PATH } = process.env;

  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN || !GITHUB_PATH) {
    return res.status(503).json({ error: 'GitHub env vars not configured on this Vercel deployment.' });
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
    const ghRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'lyzr-prototypes-vercel-fn',
      },
    });

    if (!ghRes.ok) {
      return res.status(502).json({ error: `GitHub returned ${ghRes.status}` });
    }

    const meta = await ghRes.json();
    // GitHub encodes file content as base64. For >1MB blobs it returns
    // encoding: "none" with empty content, and for directories `content` is
    // absent; guard both so we fail clearly instead of returning garbage.
    if (typeof meta.content !== 'string' || meta.encoding !== 'base64') {
      return res.status(502).json({ error: 'Unexpected GitHub response (content not base64-encoded)' });
    }
    const content = Buffer.from(meta.content, 'base64').toString('utf-8');
    const data = JSON.parse(content);

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error: ' + err.message });
  }
}
