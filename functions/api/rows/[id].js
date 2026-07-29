// =============================================================================
// Cloudflare Pages Function: PUT /api/rows/[id]
// =============================================================================
// Edits an existing row in data.json by:
//  1. Verifying @lyzr.ai Google OAuth token
//  2. Fetching data.json from GitHub
//  3. Patching the row + recording edit history (last 3 edits)
//  4. Recomputing aggregates
//  5. Committing updated data.json back to GitHub
// =============================================================================

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

// Read-modify-write with optimistic-concurrency retry on SHA conflict (409/422),
// so a concurrent edit cannot silently drop this one. See functions/api/rows.js
// for the full rationale.
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

// Apply an edit to a row in place, recording the diff into edit_history (last 3).
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

// ---- handler ----------------------------------------------------------------

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const rowId = params.id;

  if (!rowId) return json({ error: 'Missing row ID in URL' }, 400);

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
    console.error('PUT /api/rows/[id] error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
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
