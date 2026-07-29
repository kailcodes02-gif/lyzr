// =============================================================================
// Cloudflare Pages Function: POST /api/rows
// =============================================================================
// Adds a new row to data.json by:
//  1. Verifying the caller has a valid @lyzr.ai Google OAuth token
//  2. Fetching the current data.json from GitHub (Contents API)
//  3. Adding the new row + recomputing all aggregates
//  4. Committing the updated data.json back to GitHub
//
// Required environment variables (Cloudflare Pages → Settings → Variables):
//   GITHUB_OWNER  — GitHub username / org, e.g. "kailcodes02-gif"
//   GITHUB_REPO   — Repository name, e.g. "lyzr"
//   GITHUB_TOKEN  — Personal Access Token (classic), scopes: repo
//   GITHUB_PATH   — Path inside the repo, e.g. "pipeline/data.json"
//   GITHUB_BRANCH — Branch to commit to, e.g. "main"
// =============================================================================

// ---- helpers ----------------------------------------------------------------

const ALLOWED_SEGMENTS = ['Internal', 'Accenture', 'GSI-SI', 'Enterprises'];
// Sentinel returned by a mutate() callback to tell commitWithRetry to skip the
// commit entirely (e.g. the target row was not found).
const ABORT_COMMIT = Symbol('ABORT_COMMIT');

function parseOwners(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input).split(',').map((s) => s.trim()).filter(Boolean);
}

// Parse an ACV value into a finite number, or null. Guards against NaN
// (e.g. Number("abc")) leaking into the row and poisoning total_acv.
function parseAcv(input) {
  if (input === null || input === undefined || input === '') return null;
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

function generateId(rows, segment) {
  const prefix =
    ({ Internal: 'INT', Accenture: 'ACC', 'GSI-SI': 'GSI', Enterprises: 'ENT' })[segment] ||
    'ROW';
  let maxNum = 0;
  for (const r of rows) {
    const match = r.id?.match(/-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
}

function generateSn(rows) {
  let max = 0;
  for (const r of rows) if (r.sn > max) max = r.sn;
  return max + 1;
}

function recomputeAggregates(data) {
  const rows = data.rows;
  let total_acv = 0, acv_open = 0, acv_won = 0, acv_lost = 0;
  const by_stage = {}, by_segment = {}, companyMap = {}, ownerMap = {};
  const uniqueCompanies = new Set();

  for (const r of rows) {
    const acv = r.acv || 0;
    total_acv += acv;
    if (r.stage === 'lost') acv_lost += acv;
    else if (r.stage === 'win' || r.stage === 'customer') acv_won += acv;
    else acv_open += acv;

    by_stage[r.stage] = (by_stage[r.stage] || 0) + 1;

    if (!by_segment[r.segment])
      by_segment[r.segment] = { count: 0, acv: 0, stages: {} };
    by_segment[r.segment].count += 1;
    by_segment[r.segment].acv += acv;
    by_segment[r.segment].stages[r.stage] =
      (by_segment[r.segment].stages[r.stage] || 0) + 1;

    if (r.company) {
      uniqueCompanies.add(r.company);
      if (!companyMap[r.company])
        companyMap[r.company] = { company: r.company, deals: 0, acv: 0 };
      companyMap[r.company].deals += 1;
      companyMap[r.company].acv += acv;
    }

    for (const o of r.opportunity_owners || []) {
      if (!ownerMap[o]) ownerMap[o] = { name: o, deals: 0, acv: 0 };
      ownerMap[o].deals += 1;
      ownerMap[o].acv += acv;
    }
  }

  data.aggregates = {
    total_rows: rows.length,
    total_acv,
    acv_open,
    acv_won,
    acv_lost,
    unique_companies: uniqueCompanies.size,
    by_stage,
    by_segment,
    owner_leaderboard: Object.values(ownerMap).sort(
      (a, b) => b.acv - a.acv || b.deals - a.deals
    ),
    top_companies: Object.values(companyMap).sort(
      (a, b) => b.acv - a.acv || b.deals - a.deals
    ),
  };
  data.facets = {
    segments: [...new Set(rows.map((r) => r.segment).filter(Boolean))].sort(),
    stages: [...new Set(rows.map((r) => r.stage).filter(Boolean))],
    categories: [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(),
    industries: [
      ...new Set(
        rows
          .map((r) => (r.industry?.startsWith('BFSI') ? 'BFSI' : r.industry))
          .filter(Boolean)
      ),
    ].sort(),
  };
  data.generated_at = new Date().toISOString();
  return data;
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
    const isLyzrOrDev = emailVerified && (
      email.endsWith('@lyzr.ai') ||
      payload.hd === 'lyzr.ai' ||
      email === 'kailcodes02@gmail.com'
    );
    if (isLyzrOrDev) return payload;
    return null;
  } catch {
    return null;
  }
}

async function fetchDataFromGitHub(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'lyzr-pipeline-cf-function',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const meta = await res.json();
  // Decode base64 as UTF-8 (atob alone yields Latin-1 and mangles multi-byte
  // chars, which the UTF-8 encode in commitDataToGitHub then compounds on
  // every save).
  const content = new TextDecoder().decode(
    Uint8Array.from(atob(meta.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
  );
  return { data: JSON.parse(content), sha: meta.sha };
}

async function commitDataToGitHub(env, data, sha, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'lyzr-pipeline-cf-function',
    },
    body: JSON.stringify({
      message,
      content,
      sha,
      branch: env.GITHUB_BRANCH || 'main',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    const e = new Error(`GitHub PUT failed: ${res.status} — ${err}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Read-modify-write with optimistic-concurrency retry.
//
// GitHub's Contents API rejects a PUT whose `sha` no longer matches HEAD with a
// 409 (or sometimes 422). That happens when two edits race: both read the same
// SHA, the first commit wins, and the second is stale. Without a retry the
// second edit is silently lost (surfaced only as a 500). Here we re-fetch the
// latest data + SHA and re-apply the mutation, up to `maxAttempts` times.
//
// `mutate(data)` must mutate `data` in place (or return a value); it is called
// fresh on each attempt against the newest data so the change is never lost.
// If `mutate` returns the exported ABORT sentinel, no commit is made and the
// sentinel is returned (used e.g. when the target row no longer exists).
async function commitWithRetry(env, mutate, buildMessage, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, sha } = await fetchDataFromGitHub(env);
    const result = mutate(data);
    if (result === ABORT_COMMIT) return ABORT_COMMIT;
    const message = buildMessage(result, data);
    try {
      await commitDataToGitHub(env, data, sha, message);
      return result;
    } catch (err) {
      // Only a SHA conflict is retryable; anything else is a hard failure.
      if (err.status === 409 || err.status === 422) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `GitHub commit failed after ${maxAttempts} attempts (SHA conflict): ${lastErr && lastErr.message}`
  );
}

// ---- handler ----------------------------------------------------------------

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Auth
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization header' }, 401);
  }
  const token = authHeader.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return json({ error: 'Invalid token or not a @lyzr.ai account' }, 403);
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.segment || !body.project || !body.stage) {
    return json({ error: 'Missing required fields: segment, project, stage' }, 400);
  }
  if (!ALLOWED_SEGMENTS.includes(body.segment)) {
    return json({ error: `Invalid segment. Must be one of: ${ALLOWED_SEGMENTS.join(', ')}` }, 400);
  }

  // Check env vars
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN || !env.GITHUB_PATH) {
    return json({ error: 'GitHub environment variables not configured on the server.' }, 503);
  }

  try {
    // Build + append the new row, retrying on SHA conflict so the row is never
    // lost to a concurrent edit. The id/sn are (re)generated against the latest
    // rows on every attempt to avoid collisions.
    const newRow = await commitWithRetry(
      env,
      (data) => {
        const row = {
          id: generateId(data.rows, body.segment),
          segment: body.segment,
          sn: generateSn(data.rows),
          company: body.company || null,
          industry: body.industry || null,
          project: body.project,
          use_case: body.use_case || body.project,
          category: body.category || null,
          stage: body.stage,
          prototype_owners: parseOwners(body.prototype_owners),
          opportunity_owners: parseOwners(body.opportunity_owners),
          prototype_link: body.prototype_link || null,
          prototype_link_text: body.prototype_link || null,
          acv: parseAcv(body.acv),
          acv_raw: (body.acv === null || body.acv === undefined || body.acv === '') ? null : String(body.acv),
          time_period: body.time_period || null,
          close_date_raw: body.close_date_raw || null,
          close_quarter: body.close_quarter || null,
          created_by: user.name || user.email,
          created_at: new Date().toISOString(),
          edit_history: [],
        };
        data.rows.push(row);
        recomputeAggregates(data);
        return row;
      },
      (row) => `data: add project "${row.project}" [${row.id}] by ${user.email}`
    );

    return json({ success: true, row: newRow }, 201);
  } catch (err) {
    console.error('POST /api/rows error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rowId = url.searchParams.get('id');

  if (!rowId) return json({ error: 'Missing row ID in URL query parameter' }, 400);

  // Auth
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization header' }, 401);
  }
  const token = authHeader.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return json({ error: 'Invalid token or not a @lyzr.ai account' }, 403);
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.segment !== undefined && !ALLOWED_SEGMENTS.includes(body.segment)) {
    return json({ error: `Invalid segment. Must be one of: ${ALLOWED_SEGMENTS.join(', ')}` }, 400);
  }

  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN || !env.GITHUB_PATH) {
    return json({ error: 'GitHub environment variables not configured' }, 503);
  }

  try {
    const result = await commitWithRetry(
      env,
      (data) => {
        const rowIndex = data.rows.findIndex((r) => r.id === rowId);
        if (rowIndex === -1) return ABORT_COMMIT;
        const res = applyRowEdit(data.rows[rowIndex], body, user);
        recomputeAggregates(data);
        return res;
      },
      (res) => `data: edit "${(res && res.row && res.row.project) || rowId}" [${rowId}] by ${user.email}`
    );

    if (result === ABORT_COMMIT) {
      return json({ error: `Row ${rowId} not found` }, 404);
    }
    return json({ success: true, row: result.row, changes: result.changes }, 200);
  } catch (err) {
    console.error('PUT /api/rows error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

// Apply an edit to a row in place, recording the diff into edit_history.
// Shared by PUT /api/rows?id= and PUT /api/rows/:id. The caller is responsible
// for recomputing aggregates after; we do it here so every code path stays
// consistent.
function applyRowEdit(existing, body, user) {
  const editableFields = [
    'company', 'industry', 'project', 'use_case', 'category', 'stage',
    'prototype_link', 'acv', 'time_period', 'close_date_raw', 'close_quarter',
    'opportunity_owners', 'prototype_owners', 'segment',
  ];

  const changes = {};
  for (const field of editableFields) {
    if (body[field] === undefined) continue;
    const oldVal = existing[field];
    let newVal = body[field];

    if (field === 'opportunity_owners' || field === 'prototype_owners') {
      newVal = parseOwners(newVal);
    }
    if (field === 'acv') {
      newVal = parseAcv(newVal);
    }

    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);
    if (oldStr !== newStr) {
      changes[field] = { old: oldVal === undefined ? null : oldVal, new: newVal };
      existing[field] = newVal;
    }
  }

  if ('prototype_link' in changes) {
    existing.prototype_link_text = existing.prototype_link;
  }
  if ('acv' in changes) {
    existing.acv_raw = existing.acv === null ? null : String(existing.acv);
  }

  if (Object.keys(changes).length > 0) {
    if (!existing.edit_history) existing.edit_history = [];
    existing.edit_history.unshift({
      edited_by: user.name || user.email,
      edited_at: new Date().toISOString(),
      changes,
    });
    if (existing.edit_history.length > 3) {
      existing.edit_history = existing.edit_history.slice(0, 3);
    }
  }

  return { row: existing, changes };
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
