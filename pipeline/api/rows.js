// Vercel Serverless Function: POST /api/rows + PUT /api/rows (with ?id=)
// Handles both Add (POST) and Edit (PUT /api/rows?id=xxx)

function parseOwners(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(s => s.trim()).filter(Boolean);
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}

function generateId(rows, segment) {
  const prefix = ({ Internal:'INT', Accenture:'ACC', 'GSI-SI':'GSI', Enterprises:'ENT' })[segment] || 'ROW';
  let max = 0;
  for (const r of rows) {
    const m = r.id?.match(/-(\d+)$/);
    if (m && parseInt(m[1]) > max) max = parseInt(m[1]);
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
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
    if (!by_segment[r.segment]) by_segment[r.segment] = { count: 0, acv: 0, stages: {} };
    by_segment[r.segment].count += 1;
    by_segment[r.segment].acv += acv;
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
    owner_leaderboard: Object.values(ownerMap).sort((a,b) => b.acv - a.acv || b.deals - a.deals),
    top_companies: Object.values(companyMap).sort((a,b) => b.acv - a.acv || b.deals - a.deals),
  };
  data.facets = {
    segments: [...new Set(rows.map(r => r.segment).filter(Boolean))].sort(),
    stages: [...new Set(rows.map(r => r.stage).filter(Boolean))],
    categories: [...new Set(rows.map(r => r.category).filter(Boolean))].sort(),
    industries: [...new Set(rows.map(r => r.industry?.startsWith('BFSI') ? 'BFSI' : r.industry).filter(Boolean))].sort(),
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' });
  const user = await verifyGoogleToken(auth.slice(7));
  if (!user) return res.status(403).json({ error: 'Invalid token or not a @lyzr.ai account' });

  const { GITHUB_OWNER: owner, GITHUB_REPO: repo, GITHUB_TOKEN: token, GITHUB_PATH: ghPath, GITHUB_BRANCH: branch } = process.env;
  if (!owner || !repo || !token || !ghPath) return res.status(503).json({ error: 'GitHub env vars not configured on this server' });

  const body = req.body;

  // ── POST → add new row ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!body.segment || !body.project || !body.stage) {
      return res.status(400).json({ error: 'Missing required fields: segment, project, stage' });
    }
    try {
      const { data, sha } = await ghGet(owner, repo, token, ghPath);
      const newRow = {
        id: generateId(data.rows, body.segment),
        segment: body.segment, sn: generateSn(data.rows),
        company: body.company || null, industry: body.industry || null,
        project: body.project, use_case: body.use_case || body.project,
        category: body.category || null, stage: body.stage,
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
      data.rows.push(newRow);
      recomputeAggregates(data);
      await ghPut(owner, repo, token, ghPath, data, sha, `data: add "${newRow.project}" [${newRow.id}] by ${user.email}`, branch);
      return res.status(201).json({ success: true, row: newRow });
    } catch (err) {
      console.error('POST /api/rows error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
