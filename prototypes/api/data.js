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

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, GITHUB_PATH } = process.env;

  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN || !GITHUB_PATH) {
    return res.status(503).json({ error: 'GitHub env vars not configured on this Vercel deployment.' });
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
    const ghRes = await fetch(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'lyzr-prototypes-vercel-fn',
      },
    });

    if (!ghRes.ok) {
      return res.status(502).json({ error: `GitHub returned ${ghRes.status}` });
    }

    const meta = await ghRes.json();
    // GitHub encodes file content as base64
    const content = Buffer.from(meta.content, 'base64').toString('utf-8');
    const data = JSON.parse(content);

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error: ' + err.message });
  }
}
