// =============================================================================
// Cloudflare Pages Function: GET /api/data
// =============================================================================
// Reads data.json from the GitHub repository (via Contents API) and returns it.
// Same source file as the pipeline — single source of truth.
//
// Required environment variables (set in Cloudflare / Vercel dashboard):
//   GITHUB_OWNER  — e.g. "kailcodes02-gif"
//   GITHUB_REPO   — e.g. "lyzr"
//   GITHUB_TOKEN  — Personal Access Token with repo read scope
//   GITHUB_PATH   — path to data.json inside repo, e.g. "pipeline/data.json"
// =============================================================================

export async function onRequestGet(context) {
  const { env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // If env vars not configured, return 503 so the frontend falls back to static data
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN || !env.GITHUB_PATH) {
    return new Response(JSON.stringify({ error: 'GitHub env vars not configured' }), {
      status: 503,
      headers: corsHeaders,
    });
  }

  try {
    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}`;
    const ghRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'lyzr-prototypes-cf-function',
      },
    });

    if (!ghRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch from GitHub', status: ghRes.status }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const meta = await ghRes.json();
    // Guard against >1MB blobs (encoding: "none", empty content) and directories
    // (no `content`) so we fail clearly instead of crashing on atob(undefined).
    if (typeof meta.content !== 'string' || meta.encoding !== 'base64') {
      return new Response(
        JSON.stringify({ error: 'Unexpected GitHub response (content not base64-encoded)' }),
        { status: 502, headers: corsHeaders }
      );
    }
    const content = atob(meta.content.replace(/\n/g, ''));
    const data = JSON.parse(content);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error: ' + err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
