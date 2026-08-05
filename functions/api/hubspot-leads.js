// GSI Tracker: READ-ONLY HubSpot lead pull.
// Cloudflare Pages Function — the HubSpot token lives server-side only and
// nothing is ever written back to HubSpot. Callers must hold a valid Supabase
// session (any signed-in tracker user).
//
// PULL RULE (built-in, per Kailash 2026-08-05) — a lead is pulled when ANY of:
//   1. its company matches the GSI/SI target list below (or extras from the UI)
//   2. its HubSpot owner is one of the GSI owner emails below
//   3. "GSI" appears in its searchable text or any source-detail property
//
// POST { extraCompanies?: string[], from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
// -> { leads: [{ id, name, email, company, source, created, status,
//                lastActivity, lifecycle, owner, via: [...] }] }

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'

const DEFAULT_COMPANIES = [
  'Accenture', 'Hitachi', 'Birlasoft', 'Grid Dynamics', 'Denave', 'Accion Labs',
  'Trace3', 'Genpact', 'Cyient', 'Happiest Minds', 'Sonata Software', 'Data#3',
  'Telstra Purple', 'Fujitsu', 'NRI', 'Nomura Research Institute', 'NEC Corporation',
  'SCSK', 'ITOCHU Techno-Solutions', 'CTC', 'TIS Inc', 'NS Solutions', 'Datacom',
  'Spark New Zealand', 'NCS Group', 'Singtel', 'ST Engineering', 'Azentio Software',
  'Metrodata Electronics', 'FPT Software', 'Viettel Solutions', 'Attura', 'Kinetic IT',
  'Mantel Group', 'Brennan IT', 'ABeam Consulting', 'Fusion5', 'Crimson Logic',
  'Percept Solutions', 'IT Can Pte', 'Synapxe', 'Optimum Solutions',
  'Multipolar Technology', 'Lintasarta', 'Mitra Integrasi Informatika',
  'Sigma Cipta Caraka', 'CMC Technology', 'TMA Solutions', 'KMS Technology',
  'Rikkeisoft', 'NashTech', 'Sotatek', 'PSL', 'TCS', 'Infosys', 'Virtusa', 'Wipro',
  'CTS', 'NTT Data', 'CGI', 'DXC', 'Atos', 'EPAM', 'HCL', 'UST', 'Tech Mahindra',
  'LTI Mindtree', 'Avanade', 'Capgemini', 'Impetus', 'LTI', 'KPMG', 'Deloitte',
  'BCG', 'Bain', 'EXL', 'EY', 'McKinsey', 'PwC', 'Publicis Sapient',
  'Oliver Wyman', 'Kearney', 'L.E.K. Consulting', 'Roland Berger',
  'OC&C Strategy Consultants', 'AlixPartners', 'West Monroe', 'Valtech',
  'Credera', 'Thoughtworks', 'EPAM Systems', 'Perficient', 'Protiviti',
  'Simon-Kucher', 'BearingPoint', 'PA Consulting', 'Arthur D. Little', 'Capco',
  'Booz Allen Hamilton',
]

const OWNER_EMAILS = [
  'anju@lyzr.ai',
  'praveen.sukumar@lyzr.ai',
  'bharath@lyzr.ai',
  'kaushik.venkatesan@lyzr.ai',
  'pooja@lyzr.ai',
]

const PROPS = [
  'firstname', 'lastname', 'email', 'company', 'createdate',
  'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
  'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2',
  'hs_lead_status', 'lifecyclestage', 'notes_last_updated', 'lastmodifieddate',
  'hubspot_owner_id',
]

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || '' },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.email ? user : null
}

function dateFilters(from, to) {
  const f = []
  if (from) f.push({ propertyName: 'createdate', operator: 'GTE', value: new Date(from).getTime() })
  if (to) f.push({ propertyName: 'createdate', operator: 'LTE', value: new Date(to + 'T23:59:59').getTime() })
  return f
}

async function hsSearch(token, body) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: PROPS, limit: 100, sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }], ...body }),
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function collect(token, searchBody, tag, into, maxPages = 2) {
  let after
  let pages = 0
  do {
    const data = await hsSearch(token, after ? { ...searchBody, after } : searchBody)
    for (const r of data.results || []) {
      const existing = into.get(r.id)
      if (existing) {
        if (!existing.via.includes(tag)) existing.via.push(tag)
      } else {
        into.set(r.id, { raw: r, via: [tag] })
      }
    }
    after = data.paging?.next?.after
    pages++
  } while (after && pages < maxPages)
}

async function fetchOwners(token) {
  const byId = {}
  const idByEmail = {}
  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/owners?limit=500', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      for (const o of data.results || []) {
        byId[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id
        if (o.email) idByEmail[o.email.toLowerCase()] = o.id
      }
    }
  } catch { /* names are nice-to-have */ }
  return { byId, idByEmail }
}

export async function onRequestPost({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://lyzr.kailash-gm.com',
    'Cache-Control': 'no-store',
  }
  try {
    const user = await requireUser(request, env)
    if (!user) return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers })

    const token = env.HUBSPOT_ACCESS_TOKEN
    if (!token) return new Response(JSON.stringify({ error: 'HUBSPOT_ACCESS_TOKEN not configured on Pages project' }), { status: 503, headers })

    const body = await request.json().catch(() => ({}))
    const extra = (body.extraCompanies || []).map(c => String(c).trim()).filter(Boolean)
    const companies = [...new Set([...DEFAULT_COMPANIES, ...extra])]
    const { from, to } = body
    const dates = dateFilters(from, to)

    const { byId: ownerNames, idByEmail } = await fetchOwners(token)
    const found = new Map() // id -> { raw, via[] }

    // Rule 1: company list — 5 filterGroups per search request
    for (let i = 0; i < companies.length; i += 5) {
      const batch = companies.slice(i, i + 5)
      await collect(token, {
        filterGroups: batch.map(name => ({
          filters: [{ propertyName: 'company', operator: 'CONTAINS_TOKEN', value: name }, ...dates],
        })),
      }, 'company', found, 1) // 1 page per batch keeps us under the 50-subrequest cap
    }

    // Rule 2: owned by the GSI owner emails
    const ownerIds = OWNER_EMAILS.map(e => idByEmail[e]).filter(Boolean)
    if (ownerIds.length) {
      await collect(token, {
        filterGroups: [{
          filters: [{ propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds }, ...dates],
        }],
      }, 'owner', found, 4)
    }

    // Rule 3: "GSI" anywhere — free-text index + all source-detail properties
    await collect(token, { query: 'GSI', filterGroups: dates.length ? [{ filters: dates }] : undefined }, 'gsi', found, 3)
    for (const prop of ['hs_analytics_source_data_1', 'hs_analytics_source_data_2', 'hs_latest_source_data_1', 'hs_latest_source_data_2']) {
      await collect(token, {
        filterGroups: [{ filters: [{ propertyName: prop, operator: 'CONTAINS_TOKEN', value: 'GSI' }, ...dates] }],
      }, 'gsi', found)
    }

    const leads = [...found.values()].map(({ raw, via }) => {
      const p = raw.properties || {}
      return {
        id: raw.id,
        name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'Unknown',
        email: p.email || '',
        company: p.company || '',
        source: [p.hs_analytics_source, p.hs_analytics_source_data_1].filter(Boolean).join(' · ') || '',
        created: p.createdate || '',
        status: p.hs_lead_status || '',
        lifecycle: p.lifecyclestage || '',
        lastActivity: p.notes_last_updated || p.lastmodifieddate || '',
        owner: ownerNames[p.hubspot_owner_id] || '',
        via,
      }
    })
    leads.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    return new Response(JSON.stringify({ leads, count: leads.length }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
