// GSI Tracker: READ-ONLY HubSpot lead pull.
// Cloudflare Pages Function — the HubSpot token lives server-side only and
// nothing is ever written back to HubSpot. Callers must hold a valid Supabase
// session (any signed-in tracker user).
//
// POST { companies: string[], from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
// -> { leads: [{ id, name, email, company, source, created, status,
//                lastActivity, lifecycle, owner }] }

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'
const SUPABASE_ANON =
  'sb_publishable_placeholder' // overwritten below by env when present

const PROPS = [
  'firstname', 'lastname', 'email', 'company', 'createdate',
  'hs_analytics_source', 'hs_lead_status', 'lifecyclestage',
  'notes_last_updated', 'lastmodifieddate', 'hubspot_owner_id',
]

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const anon = env.SUPABASE_ANON_KEY || SUPABASE_ANON
  const res = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: anon },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.email ? user : null
}

async function searchCompanyBatch(token, companies, from, to, after) {
  // One filterGroup per company (OR semantics), each with the date window
  const filterGroups = companies.map(name => {
    const filters = [{ propertyName: 'company', operator: 'CONTAINS_TOKEN', value: name }]
    if (from) filters.push({ propertyName: 'createdate', operator: 'GTE', value: new Date(from).getTime() })
    if (to) filters.push({ propertyName: 'createdate', operator: 'LTE', value: new Date(to + 'T23:59:59').getTime() })
    return { filters }
  })
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterGroups,
      properties: PROPS,
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 100,
      ...(after ? { after } : {}),
    }),
  })
  if (!res.ok) throw new Error(`HubSpot search ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function fetchOwners(token) {
  const map = {}
  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/owners?limit=500', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      for (const o of data.results || []) {
        map[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id
      }
    }
  } catch { /* owner names are nice-to-have */ }
  return map
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

    const body = await request.json()
    const companies = (body.companies || []).map(c => String(c).trim()).filter(Boolean).slice(0, 100)
    if (!companies.length) return new Response(JSON.stringify({ error: 'No companies given' }), { status: 400, headers })
    const { from, to } = body

    const owners = await fetchOwners(token)
    const leads = []
    const seen = new Set()

    // HubSpot allows a limited number of filterGroups per search — batch by 3
    for (let i = 0; i < companies.length; i += 3) {
      const batch = companies.slice(i, i + 3)
      let after
      let pages = 0
      do {
        const data = await searchCompanyBatch(token, batch, from, to, after)
        for (const r of data.results || []) {
          if (seen.has(r.id)) continue
          seen.add(r.id)
          const p = r.properties || {}
          leads.push({
            id: r.id,
            name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'Unknown',
            email: p.email || '',
            company: p.company || '',
            source: p.hs_analytics_source || '',
            created: p.createdate || '',
            status: p.hs_lead_status || '',
            lifecycle: p.lifecyclestage || '',
            lastActivity: p.notes_last_updated || p.lastmodifieddate || '',
            owner: owners[p.hubspot_owner_id] || '',
          })
        }
        after = data.paging?.next?.after
        pages++
      } while (after && pages < 10) // cap: 1000 leads per 3-company batch
    }

    leads.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    return new Response(JSON.stringify({ leads, count: leads.length }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
