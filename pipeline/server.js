// =============================================================================
// Lyzr Pipeline — Express API Server
// =============================================================================
// A lightweight server that:
//  1. Serves the static frontend (index.html, styles.css, etc.)
//  2. Provides CRUD endpoints that read/write data.json
//  3. Verifies Google OAuth tokens before allowing writes
//  4. Tracks edit history (last 3 edits per row)
// =============================================================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html'],
}));

// =============================================================================
// DATA HELPERS
// =============================================================================

/** Read data.json from disk */
function readData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

/** Write data.json to disk */
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Recompute all aggregates from the rows array */
function recomputeAggregates(data) {
  const rows = data.rows;

  // Basic counts
  const total_rows = rows.length;
  let total_acv = 0, acv_open = 0, acv_won = 0, acv_lost = 0;
  const by_stage = {};
  const by_segment = {};
  const companyMap = {};
  const ownerMap = {};
  const uniqueCompanies = new Set();

  for (const r of rows) {
    const acv = r.acv || 0;
    total_acv += acv;

    // ACV buckets by stage
    if (r.stage === 'lost') {
      acv_lost += acv;
    } else if (r.stage === 'win' || r.stage === 'customer') {
      acv_won += acv;
    } else {
      acv_open += acv;
    }

    // by_stage
    by_stage[r.stage] = (by_stage[r.stage] || 0) + 1;

    // by_segment
    if (!by_segment[r.segment]) {
      by_segment[r.segment] = { count: 0, acv: 0, stages: {} };
    }
    by_segment[r.segment].count += 1;
    by_segment[r.segment].acv += acv;
    by_segment[r.segment].stages[r.stage] =
      (by_segment[r.segment].stages[r.stage] || 0) + 1;

    // Unique companies
    if (r.company) uniqueCompanies.add(r.company);

    // Company aggregation
    if (r.company) {
      if (!companyMap[r.company]) companyMap[r.company] = { company: r.company, deals: 0, acv: 0 };
      companyMap[r.company].deals += 1;
      companyMap[r.company].acv += acv;
    }

    // Owner aggregation
    if (r.opportunity_owners) {
      for (const o of r.opportunity_owners) {
        if (!ownerMap[o]) ownerMap[o] = { name: o, deals: 0, acv: 0 };
        ownerMap[o].deals += 1;
        ownerMap[o].acv += acv;
      }
    }
  }

  // Leaderboards
  const owner_leaderboard = Object.values(ownerMap)
    .sort((a, b) => b.acv - a.acv || b.deals - a.deals);
  const top_companies = Object.values(companyMap)
    .sort((a, b) => b.acv - a.acv || b.deals - a.deals);

  // Facets
  const facets = {
    segments: [...new Set(rows.map(r => r.segment).filter(Boolean))].sort(),
    stages: [...new Set(rows.map(r => r.stage).filter(Boolean))],
    categories: [...new Set(rows.map(r => r.category).filter(Boolean))].sort(),
    industries: [...new Set(rows.map(r => r.industry).filter(Boolean))].sort(),
  };

  data.aggregates = {
    total_rows,
    total_acv,
    acv_open,
    acv_won,
    acv_lost,
    unique_companies: uniqueCompanies.size,
    by_stage,
    by_segment,
    owner_leaderboard,
    top_companies,
  };
  data.facets = facets;
  data.generated_at = new Date().toISOString();

  return data;
}

/** Generate the next ID for a segment */
function generateId(rows, segment) {
  const prefix = ({
    'Internal': 'INT',
    'Accenture': 'ACC',
    'GSI-SI': 'GSI',
    'Enterprises': 'ENT',
  })[segment] || 'ROW';

  // Find max numeric suffix across ALL rows (not just the segment)
  let maxNum = 0;
  for (const r of rows) {
    const match = r.id?.match(/-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(4, '0')}`;
}

/** Generate the next sn */
function generateSn(rows) {
  let maxSn = 0;
  for (const r of rows) {
    if (r.sn > maxSn) maxSn = r.sn;
  }
  return maxSn + 1;
}

// =============================================================================
// GOOGLE TOKEN VERIFICATION
// =============================================================================

/**
 * Verify a Google OAuth2 access token by calling the userinfo endpoint.
 * Returns the user info payload if valid + @lyzr.ai, else null.
 */
function verifyGoogleToken(accessToken) {
  return new Promise((resolve) => {
    const url = `https://www.googleapis.com/oauth2/v3/userinfo`;
    https.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.hd === 'lyzr.ai' && payload.email_verified) {
            resolve(payload);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/** Express middleware: require valid @lyzr.ai token for write endpoints */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return res.status(403).json({ error: 'Invalid token or not a @lyzr.ai account' });
  }
  req.user = user; // { name, email, picture, hd, ... }
  next();
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

/** GET /api/data — return the full dataset */
app.get('/api/data', (req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (err) {
    console.error('Error reading data:', err);
    res.status(500).json({ error: 'Failed to read data' });
  }
});

/** POST /api/rows — add a new row */
app.post('/api/rows', requireAuth, (req, res) => {
  try {
    const data = readData();
    const body = req.body;

    // Validate required fields
    if (!body.segment || !body.project || !body.stage) {
      return res.status(400).json({
        error: 'Missing required fields: segment, project, stage',
      });
    }

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
      // Audit trail
      created_by: req.user.name || req.user.email,
      created_at: new Date().toISOString(),
      edit_history: [],
    };

    data.rows.push(newRow);
    recomputeAggregates(data);
    writeData(data);

    res.status(201).json({ success: true, row: newRow });
  } catch (err) {
    console.error('Error adding row:', err);
    res.status(500).json({ error: 'Failed to add row' });
  }
});

/** PUT /api/rows/:id — edit an existing row */
app.put('/api/rows/:id', requireAuth, (req, res) => {
  try {
    const data = readData();
    const rowIndex = data.rows.findIndex(r => r.id === req.params.id);
    if (rowIndex === -1) {
      return res.status(404).json({ error: `Row ${req.params.id} not found` });
    }

    const existing = data.rows[rowIndex];
    const body = req.body;

    // Track what changed
    const editableFields = [
      'company', 'industry', 'project', 'use_case', 'category', 'stage',
      'prototype_link', 'acv', 'time_period', 'close_date_raw', 'close_quarter',
      'opportunity_owners', 'prototype_owners', 'segment',
    ];

    const changes = {};
    for (const field of editableFields) {
      if (body[field] !== undefined) {
        const oldVal = existing[field];
        let newVal = body[field];

        // Parse owners if needed
        if (field === 'opportunity_owners' || field === 'prototype_owners') {
          newVal = parseOwners(newVal);
        }
        // Parse ACV
        if (field === 'acv') {
          newVal = newVal ? Number(newVal) : null;
        }

        // Compare (stringify for arrays)
        const oldStr = JSON.stringify(oldVal);
        const newStr = JSON.stringify(newVal);
        if (oldStr !== newStr) {
          changes[field] = { old: oldVal, new: newVal };
          existing[field] = newVal;
        }
      }
    }

    // Update derived fields
    if (changes.prototype_link) {
      existing.prototype_link_text = existing.prototype_link;
    }
    if (changes.acv) {
      existing.acv_raw = existing.acv ? String(existing.acv) : null;
    }

    // Add to edit history (keep last 3)
    if (Object.keys(changes).length > 0) {
      if (!existing.edit_history) existing.edit_history = [];
      existing.edit_history.unshift({
        edited_by: req.user.name || req.user.email,
        edited_at: new Date().toISOString(),
        changes,
      });
      // Keep only last 3
      if (existing.edit_history.length > 3) {
        existing.edit_history = existing.edit_history.slice(0, 3);
      }
    }

    data.rows[rowIndex] = existing;
    recomputeAggregates(data);
    writeData(data);

    res.json({ success: true, row: existing, changes });
  } catch (err) {
    console.error('Error editing row:', err);
    res.status(500).json({ error: 'Failed to edit row' });
  }
});

// =============================================================================
// HELPERS
// =============================================================================

/** Parse owner input — accepts string (comma-separated) or array */
function parseOwners(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(s => s.trim()).filter(Boolean);
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log(`\n  🟠 Lyzr Pipeline server running at http://localhost:${PORT}\n`);
});
