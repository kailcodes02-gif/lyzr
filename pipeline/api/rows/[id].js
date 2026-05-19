// Vercel Serverless Function: PUT /api/rows/[id]
// Edits an existing row in data.json via GitHub Contents API

function parseOwners(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(s => s.trim()).filter(Boolean);
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
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
    if (!by_segment[r.segment]) by_segment[r.segment] = { count: 0, acv: 0, stages: {} };
    by_segment[r.segment].count += 1; by_segment[r.segment].acv += acv;
    by_segment[r.segment].stages[r.stage] = (by_segment[r.segment].stages[r.stage] || 0) + 1;
    if (r.company) {
      uniqueCompanies.add(r.company);
      if (!companyMap[r.company]) companyMap[r.company] = { company: r.company, deals: 0, acv: 0 };
      companyMap[r.company].deals += 1; companyMap[r.company].acv += acv;
    }
    for (const o of (r.opportunity_owners || [])) {
      if (!ownerMap[o]) ownerMap[o] = { name: o, deals: 0, acv: 0 };
      ownerMap[o].deals += 1; ownerMap[o].acv += acv;
    }
  }
  data.aggregates = {
    total_rows: rows.length, total_acv, acv_open, acv_won, acv_lost,
    unique_companies: uniqueCompanies.size, by_stage, by_segment,
    owner_leaderboard: Object.values(ownerMap).sort((a,b) => b.acv-a.acv||b.deals-a.deals),
    top_companies: Object.values(companyMap).sort((a,b) => b.acv-a.acv||b.deals-a.deals),
  };
  data.facets = {
    segments: [...new Set(rows.map(r=>r.segment).filter(Boolean))].sort(),
    stages: [...new Set(rows.map(r=>r.stage).filter(Boolean))],
    categories: [...new Set(rows.map(r=>r.category).filter(Boolean))].sort(),
    industries: [...new Set(rows.map(r=>r.industry?.startsWith('BFSI')?'BFSI':r.industry).filter(Boolean))].sort(),
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
    const p = await res.json();
    return (p.hd === 'lyzr.ai' && p.email_verified) ? p : null;
  } catch { return null; }
}

async function ghGet(owner, repo, token, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'lyzr-pipeline' },
  });
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const meta = await res.json();
  return { data: JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8')), sha: meta.sha };
}

async function ghPut(owner, repo, token, path, data, sha, message, branch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'lyzr-pipeline' },
    body: JSON.stringify({ message, content, sha, branch: branch || 'main' }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`GitHub write failed: ${res.status} — ${e}`); }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const rowId = req.query.id;
  if (!rowId) return res.status(400).json({ error: 'Missing row id' });

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await verifyGoogleToken(auth.slice(7));
  if (!user) return res.status(403).json({ error: 'Invalid token or not a @lyzr.ai account' });

  const { GITHUB_OWNER: owner, GITHUB_REPO: repo, GITHUB_TOKEN: token, GITHUB_PATH: ghPath, GITHUB_BRANCH: branch } = process.env;
  if (!owner || !repo || !token || !ghPath) return res.status(503).json({ error: 'GitHub env vars not configured on this server' });

  try {
    const { data, sha } = await ghGet(owner, repo, token, ghPath);
    const idx = data.rows.findIndex(r => r.id === rowId);
    if (idx === -1) return res.status(404).json({ error: `Row ${rowId} not found` });

    const existing = data.rows[idx];
    const body = req.body;
    const editableFields = ['company','industry','project','use_case','category','stage','prototype_link','acv','time_period','close_date_raw','close_quarter','opportunity_owners','prototype_owners','segment'];
    const changes = {};

    for (const field of editableFields) {
      if (body[field] === undefined) continue;
      const oldVal = existing[field];
      let newVal = body[field];
      if (field === 'opportunity_owners' || field === 'prototype_owners') newVal = parseOwners(newVal);
      if (field === 'acv') newVal = newVal ? Number(newVal) : null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes[field] = { old: oldVal, new: newVal };
        existing[field] = newVal;
      }
    }
    if (changes.prototype_link) existing.prototype_link_text = existing.prototype_link;
    if (changes.acv) existing.acv_raw = existing.acv ? String(existing.acv) : null;

    if (Object.keys(changes).length > 0) {
      if (!existing.edit_history) existing.edit_history = [];
      existing.edit_history.unshift({ edited_by: user.name || user.email, edited_at: new Date().toISOString(), changes });
      if (existing.edit_history.length > 3) existing.edit_history = existing.edit_history.slice(0, 3);
    }

    data.rows[idx] = existing;
    recomputeAggregates(data);
    await ghPut(owner, repo, token, ghPath, data, sha, `data: edit "${existing.project}" [${rowId}] by ${user.email}`, branch);
    return res.status(200).json({ success: true, row: existing, changes });
  } catch (err) {
    console.error('PUT /api/rows/[id] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
