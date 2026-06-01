// =============================================================================
// Cloudflare Pages Function: /api/snapshot
// =============================================================================
// Captures and lists dated snapshots of the pipeline aggregates so trend over
// time becomes possible (Section D: pipeline trend tracking).
//
//   POST /api/snapshot
//     Auth: either a valid @lyzr.ai Google Bearer token (manual / dashboard
//     button) OR an `X-Snapshot-Secret` header matching env.SNAPSHOT_SECRET
//     (for unattended cron). Reads the current data.json from GitHub, extracts
//     its `aggregates` plus a date stamp, and writes
//     pipeline/snapshots/<YYYY-MM-DD>.json back to the repo (overwriting that
//     day's snapshot if it already exists). Returns the stored snapshot.
//
//   GET /api/snapshot           -> { snapshots: ["2026-06-01", ...] } (dates)
//   GET /api/snapshot?date=YYYY-MM-DD -> the stored snapshot for that date
//
// To run on a schedule: point a Cloudflare Cron Trigger (or a scheduled GitHub
// Action) at POST /api/snapshot with the X-Snapshot-Secret header set.
//
// Required env vars (same as the other functions):
//   GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, GITHUB_PATH (e.g. pipeline/data.json),
//   GITHUB_BRANCH (optional, defaults to "main")
// Optional:
//   SNAPSHOT_SECRET — shared secret enabling header-auth for cron.
// =============================================================================

// ---- helpers ----------------------------------------------------------------

// Snapshots live alongside data.json: dirname(GITHUB_PATH)/snapshots/.
function snapshotDir(env) {
  const path = env.GITHUB_PATH || 'pipeline/data.json';
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return dir ? `${dir}/snapshots` : 'snapshots';
}

// UTC date as YYYY-MM-DD (snapshots are daily; the TZ boundary is not critical).
function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function verifyGoogleToken(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const email = payload.email || '';
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const ok = emailVerified && (
      email.endsWith('@lyzr.ai') ||
      payload.hd === 'lyzr.ai' ||
      email === 'kailcodes02@gmail.com'
    );
    return ok ? payload : null;
  } catch {
    return null;
  }
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'lyzr-pipeline-cf-function',
  };
}

function contentsUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}

// Fetch a file's parsed JSON + sha, or null if it does not exist (404).
async function fetchFile(env, path) {
  const res = await fetch(contentsUrl(env, path), { headers: githubHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  const meta = await res.json();
  if (typeof meta.content !== 'string' || meta.encoding !== 'base64') {
    throw new Error(`Unexpected GitHub response for ${path}`);
  }
  const content = atob(meta.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: meta.sha };
}

// List a directory's entries, or [] if it does not exist (404).
async function listDir(env, path) {
  const res = await fetch(contentsUrl(env, path), { headers: githubHeaders(env) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list ${path} failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function commitFile(env, path, obj, sha, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
  const body = { message, content, branch: env.GITHUB_BRANCH || 'main' };
  if (sha) body.sha = sha; // sha only when overwriting an existing file
  const res = await fetch(contentsUrl(env, path), {
    method: 'PUT',
    headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${path} failed: ${res.status} — ${err}`);
  }
  return res.json();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function envConfigured(env) {
  return env.GITHUB_OWNER && env.GITHUB_REPO && env.GITHUB_TOKEN && env.GITHUB_PATH;
}

// ---- handlers ---------------------------------------------------------------

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!envConfigured(env)) {
    return json({ error: 'GitHub environment variables not configured' }, 503);
  }

  // Auth: Google @lyzr.ai bearer token OR the cron shared secret.
  let actor = 'cron';
  const secret = request.headers.get('X-Snapshot-Secret');
  const authHeader = request.headers.get('Authorization') || '';
  if (env.SNAPSHOT_SECRET && secret && secret === env.SNAPSHOT_SECRET) {
    actor = 'cron';
  } else if (authHeader.startsWith('Bearer ')) {
    const user = await verifyGoogleToken(authHeader.slice(7));
    if (!user) return json({ error: 'Invalid token or not a @lyzr.ai account' }, 403);
    actor = user.email || user.name || 'user';
  } else {
    return json({ error: 'Unauthorized: provide a @lyzr.ai Bearer token or X-Snapshot-Secret' }, 401);
  }

  try {
    const current = await fetchFile(env, env.GITHUB_PATH);
    if (!current) return json({ error: 'data.json not found' }, 404);

    const date = todayStamp();
    const snapshot = {
      date,
      captured_at: new Date().toISOString(),
      captured_by: actor,
      total_rows: current.data.aggregates?.total_rows ?? (current.data.rows || []).length,
      aggregates: current.data.aggregates || {},
    };

    const path = `${snapshotDir(env)}/${date}.json`;
    const existing = await fetchFile(env, path); // overwrite today's if present
    await commitFile(
      env, path, snapshot, existing ? existing.sha : null,
      `data: snapshot ${date} (${snapshot.total_rows} rows) by ${actor}`
    );

    return json({ success: true, snapshot }, 201);
  } catch (err) {
    console.error('POST /api/snapshot error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!envConfigured(env)) {
    return json({ error: 'GitHub environment variables not configured' }, 503);
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');

    if (date) {
      const file = await fetchFile(env, `${snapshotDir(env)}/${date}.json`);
      if (!file) return json({ error: `No snapshot for ${date}` }, 404);
      return json(file.data, 200);
    }

    const items = await listDir(env, snapshotDir(env));
    const snapshots = items
      .filter((it) => it.type === 'file' && it.name.endsWith('.json'))
      .map((it) => it.name.replace(/\.json$/, ''))
      .sort();
    return json({ snapshots }, 200);
  } catch (err) {
    console.error('GET /api/snapshot error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Snapshot-Secret',
    },
  });
}
