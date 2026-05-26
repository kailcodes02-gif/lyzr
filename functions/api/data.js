// =============================================================================
// Cloudflare Pages Function: GET /api/data
// =============================================================================
// Reads data.json from the GitHub repository (via Contents API) and returns it.
// This lets the live app always serve the latest committed data.
//
// Required environment variables (set in Cloudflare Pages dashboard):
//   GITHUB_OWNER  — e.g. "kailcodes02-gif"
//   GITHUB_REPO   — e.g. "lyzr"
//   GITHUB_TOKEN  — Personal Access Token with repo read/write scope
//   GITHUB_PATH   — path to data.json inside repo, e.g. "pipeline/data.json"
// =============================================================================

export async function onRequestGet(context) {
  const { env } = context;

  // If env vars not configured, return 503 so the frontend falls back to static data.json
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN || !env.GITHUB_PATH) {
    return new Response(JSON.stringify({ error: 'GitHub env vars not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}`;
    const ghRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'lyzr-pipeline-cf-function',
      },
    });

    if (!ghRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch from GitHub' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const meta = await ghRes.json();
    // GitHub returns base64-encoded content
    const content = atob(meta.content.replace(/\n/g, ''));
    const data = JSON.parse(content);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
