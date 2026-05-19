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

function parseOwners(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((s) => s.trim()).filter(Boolean);
  return String(input).split(',').map((s) => s.trim()).filter(Boolean);
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
    if (payload.hd === 'lyzr.ai' && payload.email_verified) return payload;
    return null;
  } catch {
    return null;
  }
}

async function fetchDataFromGitHub(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'lyzr-pipeline-cf-function',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const meta = await res.json();
  const content = atob(meta.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: meta.sha };
}

async function commitDataToGitHub(env, data, sha, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
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
    throw new Error(`GitHub PUT failed: ${res.status} — ${err}`);
  }
  return res.json();
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

  // Check env vars
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN || !env.GITHUB_PATH) {
    return json({ error: 'GitHub environment variables not configured on the server.' }, 503);
  }

  try {
    // 1. Fetch current data
    const { data, sha } = await fetchDataFromGitHub(env);

    // 2. Build new row
    const newRow = {
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
      acv: body.acv ? Number(body.acv) : null,
      acv_raw: body.acv ? String(body.acv) : null,
      time_period: body.time_period || null,
      close_date_raw: body.close_date_raw || null,
      close_quarter: body.close_quarter || null,
      created_by: user.name || user.email,
      created_at: new Date().toISOString(),
      edit_history: [],
    };

    // 3. Append + recompute
    data.rows.push(newRow);
    recomputeAggregates(data);

    // 4. Commit back to GitHub
    await commitDataToGitHub(
      env,
      data,
      sha,
      `data: add project "${newRow.project}" [${newRow.id}] by ${user.email}`
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
