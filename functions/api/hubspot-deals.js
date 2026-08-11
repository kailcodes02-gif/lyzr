// GSI Tracker: READ-ONLY HubSpot Deals pull for the "GSI / SI Conversations
// Pipeline" widget on the Weekly Report. Nothing is ever written to HubSpot.
// Callers must hold a valid Supabase session (any signed-in tracker user).
//
// TWO match rules, unioned (a deal can match both — `via` shows which):
//   1. gsi_property — the deal's `gsi` property is set (verified 2026-08-11:
//      44 deals, all in the "Studio Deals" pipeline). This IS the partner
//      name directly.
//   2. company_match — the deal's primary associated company's name matches
//      the same ~600-company target list used by the leads pull (shared via
//      ./_lib/target-companies.js). Verified live: a 5-company test batch
//      alone surfaced 62 MORE deals than the gsi property caught, spanning
//      pipelines other than Studio Deals — so stage buckets are resolved
//      PER PIPELINE, not a single hardcoded one.
//
// Rule 2 needs ~120 company-name search batches (5 names per HubSpot search
// request) plus a deals-by-company-id lookup, well beyond one invocation's
// Cloudflare subrequest budget — so this pull is resumable exactly like
// hubspot-leads.js: POST { cursor } in, { rows, nextCursor, progress } out,
// call again with the returned cursor until nextCursor is null. `rows` in
// each response are only the NEWLY found deals that round; the caller
// merges by `id` across rounds (via arrays union, same pattern as leads).
//
// There is no separate custom "motion"/"transaction type" field in this
// portal, so the widget's Motion tab is driven by the real `dealtype`
// property (New Business / Expansion / Partnership / POC).

import { DEFAULT_COMPANIES } from './_lib/target-companies.js'

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'
const HS_SEARCH = 'https://api.hubapi.com/crm/v3/objects/deals/search'
const HS_COMPANY_SEARCH = 'https://api.hubapi.com/crm/v3/objects/companies/search'

const PROPS = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'closedate', 'createdate',
  'gsi', 'hs_manual_forecast_category', 'dealtype', 'hs_primary_associated_company',
]

const COMPANY_BATCH_SIZE = 5
const COMPANY_ID_CHUNK_SIZE = 100 // HubSpot's IN operator caps at 100 values per filter (verified live)
const MAX_PAGES_PER_COMPANY_BATCH = 3 // some batches genuinely match 70+ companies; cap defensively
const BUDGET = 40 // Cloudflare allows 50 subrequests/invocation; leave headroom

// Value->label maps (properties/deals, fetched 2026-08-11) — HubSpot returns
// internal enum VALUES from the objects API, not the labels shown in the UI.
const FORECAST_LABELS = {
  OMIT: 'Not forecasted', PIPELINE: 'Pipeline', BEST_CASE: 'Best case',
  Upside: 'Upside', COMMIT: 'Commit', CLOSED: 'Closed won',
  'Stalled/Lost': 'Stalled/Lost', Nurture: 'Nurture',
}
const DEALTYPE_LABELS = {
  newbusiness: 'New Business', 'Land & Expand': 'Expansion',
  Partnership: 'Partnership', POC: 'POC',
}

// Open-stage name -> coarse bucket, mirroring the original hand-built
// report's own substage->stage grouping. Any stage name not listed here
// falls back to a position-based split so the pull never silently drops a
// deal just because its pipeline uses different stage names.
const OPEN_STAGE_BUCKET = {
  'Discovery Call': 'In-conversation', Qualification: 'In-conversation', Stalled: 'In-conversation',
  'Solution Validation': 'Demo', Proposal: 'Demo', Negotiation: 'Demo', 'Legal & Contracts': 'Demo',
}

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

async function hsSearch(token, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function fetchStageMap(token, pipelineId) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/pipelines/deals/${pipelineId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HubSpot pipeline lookup ${res.status}`)
  const data = await res.json()
  // HubSpot returns metadata.isClosed as the STRING "true"/"false", not a
  // boolean — compare against the string explicitly (verified 2026-08-11).
  const stages = data.stages || []
  const isClosed = s => s.metadata?.isClosed === 'true'
  const openStages = stages.filter(s => !isClosed(s)).sort((a, b) => a.displayOrder - b.displayOrder)
  const map = {}
  openStages.forEach((s, i) => {
    map[s.id] = {
      label: s.label,
      bucket: OPEN_STAGE_BUCKET[s.label] || (i < openStages.length / 2 ? 'In-conversation' : 'Demo'),
    }
  })
  for (const s of stages) {
    if (!isClosed(s)) continue
    const prob = Number(s.metadata?.probability)
    map[s.id] = { label: s.label, bucket: prob >= 1 ? 'Win' : 'Lost' }
  }
  return map
}

function quarterOf(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
}

// Search one batch of company names, paginated defensively. Returns the
// matched company ids and how many subrequests it spent.
async function searchCompanyBatch(token, names) {
  const ids = new Set()
  let after, pages = 0, used = 0
  do {
    const data = await hsSearch(token, HS_COMPANY_SEARCH, {
      filterGroups: names.map(n => ({ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: n }] })),
      properties: ['name'],
      limit: 100,
      ...(after ? { after } : {}),
    })
    used++
    for (const c of data.results || []) ids.add(c.id)
    after = data.paging?.next?.after
    pages++
  } while (after && pages < MAX_PAGES_PER_COMPANY_BATCH)
  return { ids: [...ids], used }
}

// Search deals whose primary associated company is one of `ids`, paginated.
// Appends matched deals into `into` (Map<dealId, properties>). Returns
// subrequests spent.
async function searchDealsByCompanyIds(token, ids, into) {
  if (!ids.length) return 0
  let after, pages = 0, used = 0
  do {
    const data = await hsSearch(token, HS_SEARCH, {
      filterGroups: [{ filters: [{ propertyName: 'hs_primary_associated_company', operator: 'IN', values: ids }] }],
      properties: PROPS,
      limit: 100,
      ...(after ? { after } : {}),
    })
    used++
    for (const d of data.results || []) into.set(d.id, d.properties || {})
    after = data.paging?.next?.after
    pages++
  } while (after && pages < 5)
  return used
}

function buildRows(dealMap, viaMap, stageMaps) {
  const out = []
  for (const [id, p] of dealMap) {
    const stageMap = stageMaps[p.pipeline] || {}
    const st = stageMap[p.dealstage]
    out.push({
      id,
      p: p.gsi || 'Unknown',
      o: p.dealname || 'Untitled',
      s: st?.bucket || 'In-conversation',
      ss: st?.label || p.dealstage || 'Unknown stage',
      fc: FORECAST_LABELS[p.hs_manual_forecast_category] || p.hs_manual_forecast_category || null,
      m: DEALTYPE_LABELS[p.dealtype] || p.dealtype || 'New Business',
      q: quarterOf(p.closedate) || quarterOf(p.createdate),
      a: Number(p.amount) || 0,
      created: p.createdate || null,
      via: [...(viaMap.get(id) || ['company_match'])],
    })
  }
  return out
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
    const cursor = body.cursor || null
    let used = 0

    const found = new Map()   // dealId -> properties (this round only)
    const via = new Map()     // dealId -> Set('gsi_property' | 'company_match')
    const addFound = (id, props, tag) => {
      found.set(id, props)
      if (!via.has(id)) via.set(id, new Set())
      via.get(id).add(tag)
    }

    // First call (no cursor): run the cheap gsi-property rule in full — it
    // only ever returns a few dozen deals, so it never needs to resume.
    if (!cursor) {
      let after, pages = 0
      do {
        const data = await hsSearch(token, HS_SEARCH, {
          filterGroups: [{ filters: [{ propertyName: 'gsi', operator: 'HAS_PROPERTY' }] }],
          properties: PROPS,
          limit: 100,
          ...(after ? { after } : {}),
        })
        used++
        for (const d of data.results || []) addFound(d.id, d.properties || {}, 'gsi_property')
        after = data.paging?.next?.after
        pages++
      } while (after && pages < 10)
    }

    const companyBatches = []
    for (let i = 0; i < DEFAULT_COMPANIES.length; i += COMPANY_BATCH_SIZE) {
      companyBatches.push(DEFAULT_COMPANIES.slice(i, i + COMPANY_BATCH_SIZE))
    }

    let stage = cursor?.stage || 'companies'
    let taskIndex = cursor?.taskIndex || 0
    const companyIds = new Set(cursor?.companyIds || [])

    if (stage === 'companies') {
      while (taskIndex < companyBatches.length && used < BUDGET) {
        const { ids, used: u } = await searchCompanyBatch(token, companyBatches[taskIndex])
        used += u
        for (const id of ids) companyIds.add(id)
        taskIndex++
      }
      if (taskIndex >= companyBatches.length) { stage = 'companyDeals'; taskIndex = 0 }
    }

    let companyDealsDone = false
    if (stage === 'companyDeals') {
      const idsArr = [...companyIds]
      const chunks = []
      for (let i = 0; i < idsArr.length; i += COMPANY_ID_CHUNK_SIZE) chunks.push(idsArr.slice(i, i + COMPANY_ID_CHUNK_SIZE))
      while (taskIndex < chunks.length && used < BUDGET) {
        const matched = new Map()
        used += await searchDealsByCompanyIds(token, chunks[taskIndex], matched)
        for (const [id, props] of matched) addFound(id, props, 'company_match')
        taskIndex++
      }
      companyDealsDone = taskIndex >= chunks.length
    }

    const done = stage === 'companyDeals' && companyDealsDone
    const nextCursor = done ? null : { stage, taskIndex, companyIds: [...companyIds] }

    // Resolve stage metadata for every pipeline touched THIS round (deals
    // matched via company can span pipelines other than Studio Deals).
    const pipelineIds = [...new Set([...found.values()].map(p => p.pipeline).filter(Boolean))]
    const stageMaps = {}
    for (const pid of pipelineIds) {
      try { stageMaps[pid] = await fetchStageMap(token, pid) } catch { /* falls back to default bucket below */ }
    }

    const rows = buildRows(found, via, stageMaps)

    return new Response(JSON.stringify({
      rows,
      nextCursor,
      progress: { stage, taskIndex, companiesMatched: companyIds.size },
    }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
