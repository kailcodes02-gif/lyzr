// GSI Tracker: READ-ONLY HubSpot Deals pull for the "GSI / SI Conversations
// Pipeline" widget on the Weekly Report. Nothing is ever written to HubSpot.
// Callers must hold a valid Supabase session (any signed-in tracker user).
//
// SCOPE (verified against the live portal 2026-08-11): every deal with the
// `gsi` property set (Accenture, TCS, PwC, KPMG, EY, Infosys, Wipro, HCL,
// Tech Mahindra, Movate, Persistent Systems, First Source) lives in the
// "Studio Deals" pipeline. That property IS the partner name — there is no
// separate custom "motion"/"transaction type" field in this portal, so the
// widget's Motion tab is driven by the real `dealtype` property (New
// Business / Expansion / Partnership / POC) instead of inventing categories.
//
// Stage bucketing (open/Demo/Win/Lost) uses the pipeline's OWN stage
// metadata (isClosed + probability), fetched live each call rather than
// hardcoded, so a stage rename/add in HubSpot never goes silently stale.
//
// GET (no body) -> { rows: [{ p, o, s, ss, fc, m, q, a, created }], count }
//   p = partner (gsi property) · o = opportunity (dealname)
//   s = In-conversation | Demo | Win | Lost (bucketed) · ss = real dealstage label
//   fc = forecast category label · m = dealtype label · q = close quarter · a = amount

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'

const PROPS = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'closedate', 'createdate',
  'gsi', 'hs_manual_forecast_category', 'dealtype',
]

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
// (e.g. a future new stage) falls back to a position-based split so the
// pull never silently drops a deal.
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

async function fetchStageMap(token, pipelineId) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/pipelines/deals/${pipelineId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HubSpot pipeline lookup ${res.status}`)
  const data = await res.json()
  // HubSpot returns metadata.isClosed as the STRING "true"/"false", not a
  // boolean — compare against the string explicitly.
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

export async function onRequestGet({ request, env }) {
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

    // Every deal with `gsi` set — this IS the "is this a GSI/SI partner
    // conversation" flag on this portal (verified: all 44 live in one
    // pipeline). Pipeline id is read from the first page's results, not
    // hardcoded, in case deals ever span more than one pipeline.
    const rows = []
    let after
    let pages = 0
    let pipelineId = null
    do {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'gsi', operator: 'HAS_PROPERTY' }] }],
          properties: PROPS,
          limit: 100,
          ...(after ? { after } : {}),
        }),
      })
      if (!res.ok) throw new Error(`HubSpot deals search ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json()
      for (const d of data.results || []) {
        const p = d.properties || {}
        if (p.pipeline) pipelineId = pipelineId || p.pipeline
        rows.push(p)
      }
      after = data.paging?.next?.after
      pages++
    } while (after && pages < 10) // 44 known deals today; ample headroom before this ever caps out

    let stageMap = {}
    if (pipelineId) {
      try { stageMap = await fetchStageMap(token, pipelineId) } catch { /* fall through with unbucketed stages below */ }
    }

    const out = rows.map(p => {
      const st = stageMap[p.dealstage]
      return {
        p: p.gsi || 'Unknown',
        o: p.dealname || 'Untitled',
        s: st?.bucket || 'In-conversation',
        ss: st?.label || p.dealstage || 'Unknown stage',
        fc: FORECAST_LABELS[p.hs_manual_forecast_category] || p.hs_manual_forecast_category || null,
        m: DEALTYPE_LABELS[p.dealtype] || p.dealtype || 'New Business',
        q: quarterOf(p.closedate) || quarterOf(p.createdate),
        a: Number(p.amount) || 0,
        created: p.createdate || null,
      }
    })

    return new Response(JSON.stringify({ rows: out, count: out.length, pipelineId }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
