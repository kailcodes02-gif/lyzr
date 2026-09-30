// HubSpot deals sync and read handlers with a stubbed fetch: no real Graph,
// Supabase or HubSpot calls. node --test 'Campaign_Analytics/tests/backend/*.test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import * as sync from '../../../functions/api/ca/hubspot/deals-sync.js'
import * as dealsApi from '../../../functions/api/ca/hubspot/deals.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const seedDir = path.join(here, '..', '..', 'seed')
const SUPA = 'https://fake-ref.supabase.co'

// ---- fake world (same shape as handlers.test.mjs) ---------------------------
function world(opts = {}) {
  const calls = []
  const tables = opts.tables || {}
  const users = { 'tok-editor': { displayName: 'Subs', mail: 'subs@lyzr.com' }, 'tok-viewer': { displayName: 'Viewer', userPrincipalName: 'viewer@lyzr.ai' } }
  const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  async function fetchStub(input, init = {}) {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    const headers = init.headers || {}
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, headers, body })

    if (url.startsWith('https://graph.microsoft.com/')) {
      const tok = String(headers.Authorization || '').replace('Bearer ', '')
      return users[tok] ? jsonRes(users[tok]) : jsonRes({ error: 'bad' }, 401)
    }
    if (url.startsWith(SUPA + '/rest/v1/')) {
      const u = new URL(url)
      const table = u.pathname.split('/').pop()
      if (method === 'GET') {
        let rows = tables[table] || []
        for (const [k, v] of u.searchParams) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue
          if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
          else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''))); rows = rows.filter((r) => set.has(String(r[k]))) }
        }
        const limit = u.searchParams.get('limit')
        if (limit) rows = rows.slice(0, Number(limit))
        return jsonRes(rows)
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]
        const withIds = rows.map((r, i) => ({ id: `id-${table}-${(tables[table] || []).length + i + 1}`, ...r }))
        tables[table] = [...(tables[table] || []), ...withIds]
        return String(headers.Prefer || '').includes('return=representation') ? jsonRes(withIds, 201) : new Response(null, { status: 201 })
      }
      if (method === 'PATCH' || method === 'DELETE') return new Response(null, { status: 204 })
    }
    if (url.startsWith('https://api.hubapi.com/')) {
      if (opts.hubspot) return opts.hubspot({ url, method, body })
      return jsonRes({ results: [] })
    }
    throw new Error('unexpected fetch ' + url)
  }

  const env = {
    CA_SUPABASE_URL: SUPA,
    CA_SUPABASE_KEY: 'service-key',
    HUBSPOT_ACCESS_TOKEN: opts.hubspotToken === undefined ? 'hs-token' : opts.hubspotToken,
    ASSETS: { fetch: async (u) => { const f = new URL(String(u)).pathname.split('/').pop(); return new Response(readFileSync(path.join(seedDir, f)), { headers: { 'content-type': 'application/json' } }) } },
    ...(opts.env || {}),
  }
  return { calls, env, tables, fetchStub }
}

function req(method, pathAndQuery, { token = 'tok-editor', body, cron } = {}) {
  const headers = {}
  if (token) headers.Authorization = 'Bearer ' + token
  if (cron) headers['X-CA-Cron'] = cron
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return new Request('https://lyzr.kailash-gm.com/api/ca/' + pathAndQuery, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function run(handler, request, w) {
  const saved = globalThis.fetch
  globalThis.fetch = w.fetchStub
  try {
    const res = await handler({ request, env: w.env })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
  } finally {
    globalThis.fetch = saved
  }
}

// A small GSI account list (Settings row) so the search task list stays short.
const ACCOUNTS = [
  { name: 'Accenture', source: ['accounts'], bands: { md: 'Managing Director', md1: '', md2: '' }, aliases: ['Accenture Song'], domain: 'accenture.com', domains: ['accenture.com'] },
  { name: 'Deloitte', source: ['accounts'], domain: 'deloitte.com', domains: ['deloitte.com'] },
  { name: 'Tiny Co', source: ['abm'], domain: 'tiny.example', domains: ['tiny.example'] },
]
const PIPELINES = { results: [
  { id: 'p1', label: 'Studio Deals', stages: [
    { id: 'st1', label: 'Discovery Call', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } },
    { id: 'st2', label: 'Proposal', displayOrder: 1, metadata: { isClosed: 'false', probability: '0.6' } },
    { id: 'st3', label: 'Closed Won', displayOrder: 2, metadata: { isClosed: 'true', probability: '1.0' } },
    { id: 'st4', label: 'Closed Lost', displayOrder: 3, metadata: { isClosed: 'true', probability: '0.0' } },
  ] },
  { id: 'p2', label: 'Partner Deals', stages: [
    { id: 'x1', label: 'Intro', displayOrder: 0, metadata: { isClosed: 'false' } },
    { id: 'x2', label: 'Scoping', displayOrder: 1, metadata: { isClosed: 'false' } },
    { id: 'x3', label: 'Signed', displayOrder: 2, metadata: { isClosed: 'true', probability: '1.0' } },
  ] },
] }
const DEALS = {
  d1: { id: 'd1', properties: { dealname: 'Agentic commerce', dealstage: 'st3', pipeline: 'p1', amount: '250000', closedate: '2026-09-15T00:00:00.000Z', createdate: '2026-08-01T10:00:00.000Z', gsi: 'Accenture Song', dealtype: 'newbusiness', hs_manual_forecast_category: 'CLOSED' } },
  d2: { id: 'd2', properties: { dealname: 'Claims agents', dealstage: 'st2', pipeline: 'p1', amount: '100000', createdate: '2026-09-10T10:00:00.000Z', dealtype: 'Land & Expand', hs_manual_forecast_category: 'BEST_CASE' } },
  d3: { id: 'd3', properties: { dealname: 'Partner intro', dealstage: 'x2', pipeline: 'p2', amount: '', createdate: '2026-07-01T10:00:00.000Z' } },
  d4: { id: 'd4', properties: { dealname: 'Signed pilot', dealstage: 'x3', pipeline: 'p2', amount: '40000', createdate: '2026-06-01T10:00:00.000Z' } },
}

// Stub HubSpot: records every search so the tests can inspect the filters.
function hubspotStub(searches) {
  const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  return ({ url, method, body }) => {
    if (url.endsWith('/crm/v3/pipelines/deals')) { assert.equal(method, 'GET'); return j(PIPELINES) }
    if (url.endsWith('/crm/v3/objects/deals/search')) {
      searches.push({ kind: 'deals', body })
      const f = body.filterGroups[0].filters[0]
      if (f.propertyName === 'gsi') return body.after ? j({ results: [DEALS.d1] }) : j({ results: [], paging: { next: { after: 'g2' } } })
      assert.equal(f.propertyName, 'associations.company')
      assert.equal(f.operator, 'IN')
      assert.ok(f.values.length <= 100, 'IN cap of 100')
      return j({ results: [DEALS.d1, DEALS.d2, DEALS.d3, DEALS.d4] })
    }
    if (url.endsWith('/crm/v3/objects/companies/search')) {
      searches.push({ kind: 'companies', body })
      const f = body.filterGroups[0].filters[0]
      if (f.propertyName === 'name') return j({ results: [
        { id: 'c1', properties: { name: 'Accenture Strategy', domain: 'accenture.com' } },
        { id: 'c9', properties: { name: 'Deloitte Digital', domain: 'deloitte.com' } },
        { id: 'c7', properties: { name: 'Accentureless Ltd', domain: 'nothing.example' } },
      ] })
      assert.equal(f.propertyName, 'domain')
      return j({ results: [{ id: 'c2', properties: { name: 'Tiny Co Pte', domain: 'tiny.example' } }] })
    }
    if (url.endsWith('/crm/v4/associations/deals/companies/batch/read')) {
      assert.equal(method, 'POST')
      return j({ results: [
        { from: { id: 'd1' }, to: [{ toObjectId: 'c1', associationTypes: [{ label: 'Primary' }] }] },
        { from: { id: 'd2' }, to: [{ toObjectId: 'c7', associationTypes: [] }, { toObjectId: 'c9', associationTypes: [{ label: 'Primary' }] }] },
        { from: { id: 'd3' }, to: [{ toObjectId: 'c2', associationTypes: [] }] },
        { from: { id: 'd4' }, to: [{ toObjectId: 'c2', associationTypes: [] }] },
      ] })
    }
    throw new Error('unexpected hubspot ' + method + ' ' + url)
  }
}

test('deals-sync: 401 without a token, 403 for viewers, 503 without the HubSpot token', async () => {
  const w = world({ tables: { ca_settings: [] } })
  assert.equal((await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { token: null, body: {} }), w)).status, 401)
  assert.equal((await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { token: 'tok-viewer', body: {} }), w)).status, 403)
  const w2 = world({ hubspotToken: '' })
  assert.equal((await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { body: {} }), w2)).status, 503)
  assert.equal((await run(dealsApi.onRequestGet, req('GET', 'hubspot/deals', { token: null }), w)).status, 401)
})

test('deals-sync: both match rules, per-pipeline buckets, history rows, never writes to HubSpot', async () => {
  const searches = []
  const w = world({
    tables: {
      ca_settings: [{ key: 'accounts', value: ACCOUNTS }],
      ca_hs_deals_sync: [],
      ca_hs_deal_history: [],
      // d2 was Discovery Call at $80K; d4 was open in Scoping. Both change this sync.
      ca_hs_deals: [
        { hs_id: 'd2', stage: 'st1', stage_label: 'Discovery Call', bucket: 'conversation', amount: 80000, via: ['company_match'], synced_at: '2026-09-20T00:00:00.000Z', prev_stage: null, last_stage_change_at: null },
        { hs_id: 'd4', stage: 'x2', stage_label: 'Scoping', bucket: 'demo', amount: 40000, via: ['company_match'], synced_at: '2026-09-20T00:00:00.000Z', prev_stage: 'Intro', last_stage_change_at: '2026-09-01T00:00:00.000Z' },
      ],
    },
    hubspot: hubspotStub(searches),
  })
  const r = await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { body: {} }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.done, true, 'a short account list finishes in one call')
  assert.equal(r.body.deals, 4)
  assert.equal(r.body.changes, 6)
  assert.equal(r.body.progress.phase, 'done')
  assert.ok(w.calls.length <= 40, `used ${w.calls.length} subrequests`)

  // the pipelines were read once, the gsi rule paged, the company searches use CONTAINS_TOKEN by name and IN by domain
  assert.equal(w.calls.filter((c) => c.url.endsWith('/crm/v3/pipelines/deals')).length, 1)
  const gsi = searches.filter((s) => s.kind === 'deals' && s.body.filterGroups[0].filters[0].propertyName === 'gsi')
  assert.equal(gsi.length, 2)
  assert.equal(gsi[1].body.after, 'g2')
  assert.deepEqual(gsi[0].body.filterGroups[0].filters[0], { propertyName: 'gsi', operator: 'HAS_PROPERTY' })
  const comp = searches.filter((s) => s.kind === 'companies')
  assert.equal(comp.length, 2)
  assert.deepEqual(comp[0].body.filterGroups.map((g) => g.filters[0].value), ['Accenture', 'Accenture Song', 'Deloitte'])
  assert.equal(comp[0].body.filterGroups[0].filters[0].operator, 'CONTAINS_TOKEN')
  assert.deepEqual(comp[1].body.filterGroups[0].filters[0].values, ['accenture.com', 'deloitte.com', 'tiny.example'])
  const byCompany = searches.filter((s) => s.kind === 'deals' && s.body.filterGroups[0].filters[0].propertyName === 'associations.company')
  assert.equal(byCompany.length, 1)
  assert.deepEqual(byCompany[0].body.filterGroups[0].filters[0].values.sort(), ['c1', 'c2', 'c9'], 'the over-matched company (c7) is not on the list')
  assert.ok(byCompany[0].body.properties.includes('gsi') && byCompany[0].body.properties.includes('dealtype'))

  // read-only against HubSpot
  for (const c of w.calls.filter((x) => x.url.startsWith('https://api.hubapi.com/'))) {
    assert.ok(c.method === 'GET' || c.url.endsWith('/search') || c.url.endsWith('/batch/read'), 'read-only: ' + c.method + ' ' + c.url)
    assert.ok(!['PUT', 'PATCH', 'DELETE'].includes(c.method), 'no write verb to HubSpot')
  }

  // upsert on hs_id with partner, bucket, motion and forecast resolved
  const up = w.calls.find((c) => c.method === 'POST' && c.url.includes('/ca_hs_deals?'))
  assert.ok(up.url.includes('on_conflict=hs_id'))
  const rows = Object.fromEntries(up.body.map((x) => [x.hs_id, x]))
  assert.deepEqual(Object.keys(rows).sort(), ['d1', 'd2', 'd3', 'd4'])
  assert.equal(rows.d1.partner, 'Accenture', 'gsi property canonicalised through the alias')
  assert.deepEqual(rows.d1.via.sort(), ['company_match', 'gsi_property'])
  assert.equal(rows.d1.bucket, 'won')
  assert.equal(rows.d1.substage, 'Closed Won')
  assert.equal(rows.d1.pipeline_label, 'Studio Deals')
  assert.equal(rows.d1.motion_label, 'New Business')
  assert.equal(rows.d1.forecast, 'Closed won')
  assert.equal(rows.d1.close_date, '2026-09-15')
  assert.equal(rows.d1.amount, 250000)
  assert.equal(rows.d2.partner, 'Deloitte', 'primary association wins over the unlisted company')
  assert.equal(rows.d2.company_raw, 'Deloitte Digital')
  assert.equal(rows.d2.bucket, 'demo', 'Proposal is a demo stage')
  assert.equal(rows.d2.motion_label, 'Expansion')
  assert.equal(rows.d2.prev_stage, 'Discovery Call')
  assert.ok(rows.d2.last_stage_change_at)
  assert.equal(rows.d3.partner, 'Tiny Co', 'matched by website domain')
  assert.equal(rows.d3.bucket, 'demo', 'unknown open stage in the second half of its pipeline')
  assert.equal(rows.d3.amount, null)
  assert.equal(rows.d4.bucket, 'won', 'closed stage with probability 1 in another pipeline')
  assert.equal(rows.d4.prev_stage, 'Scoping')
  assert.ok(!('first_seen_at' in rows.d1), 'first_seen_at is left to the insert default')

  // history: new rows dated by HubSpot create date, stage and amount changes, closes
  const hist = w.calls.find((c) => c.method === 'POST' && c.url.includes('/ca_hs_deal_history')).body
  const kinds = (id) => hist.filter((h) => h.hs_id === id).map((h) => h.kind).sort()
  assert.deepEqual(kinds('d1'), ['new'])
  assert.equal(hist.find((h) => h.hs_id === 'd1').at, '2026-08-01T10:00:00.000Z')
  assert.deepEqual(kinds('d2'), ['amount', 'stage'])
  const move = hist.find((h) => h.hs_id === 'd2' && h.kind === 'stage')
  assert.deepEqual([move.from_value, move.to_value, move.amount], ['Discovery Call', 'Proposal', 100000])
  const amt = hist.find((h) => h.hs_id === 'd2' && h.kind === 'amount')
  assert.deepEqual([amt.from_value, amt.to_value], ['80000', '100000'])
  assert.deepEqual(kinds('d3'), ['new'])
  assert.deepEqual(kinds('d4'), ['closed', 'stage'])
  assert.deepEqual(hist.find((h) => h.hs_id === 'd4' && h.kind === 'closed').to_value, 'won')
  const s = w.calls.filter((c) => c.method === 'PATCH' && c.url.includes('ca_hs_deals_sync')).at(-1)
  assert.deepEqual([s.body.status, s.body.deals, s.body.changes], ['done', 4, 6])
})

test('deals-sync: resumable cursor across invocations, cron secret accepted, wrong secret refused', async () => {
  // 70 named accounts = 18 name searches: more than one invocation's HubSpot budget.
  const many = Array.from({ length: 70 }, (_, i) => ({ name: `Firm ${i} Consulting`, source: ['accounts'] }))
  const searches = []
  const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  const w = world({
    tables: { ca_settings: [{ key: 'accounts', value: many }], ca_hs_deals_sync: [], ca_hs_deal_history: [], ca_hs_deals: [] },
    hubspot: ({ url, body }) => {
      if (url.endsWith('/crm/v3/pipelines/deals')) return j(PIPELINES)
      if (url.endsWith('/crm/v3/objects/companies/search')) { searches.push(body); const n = searches.length; return j({ results: [{ id: 'k' + n, properties: { name: body.filterGroups[0].filters[0].value + ' Ltd', domain: '' } }] }) }
      if (url.endsWith('/crm/v3/objects/deals/search')) { const f = body.filterGroups[0].filters[0]; return f.propertyName === 'gsi' ? j({ results: [] }) : j({ results: [{ id: 'q1', properties: { dealname: 'Firm 3 pilot', dealstage: 'st1', pipeline: 'p1', amount: '5000', createdate: '2026-09-01T00:00:00.000Z' } }] }) }
      if (url.endsWith('/batch/read')) return j({ results: [{ from: { id: 'q1' }, to: [{ toObjectId: 'k2', associationTypes: [] }] }] })
      throw new Error('unexpected ' + url)
    },
  })
  w.env.CA_CRON_SECRET = 'cron-secret-123'
  assert.equal((await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { token: null, cron: 'wrong-secret-12', body: {} }), w)).status, 401)

  const a = await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { token: null, cron: 'cron-secret-123', body: {} }), w)
  assert.equal(a.status, 200, JSON.stringify(a.body))
  assert.equal(a.body.done, false)
  assert.equal(a.body.cursor.phase, 'companies')
  assert.equal(a.body.progress.phase, 'companies')
  assert.equal(a.body.progress.total, 18)
  assert.equal(searches.length, sync.HS_BUDGET - 1, 'the gsi search took one call of the budget')
  assert.equal(a.body.cursor.taskIndex, sync.HS_BUDGET - 1)
  assert.ok(a.body.cursor.stageMaps.p1, 'stage maps travel in the cursor')
  assert.equal(Object.keys(a.body.cursor.companies).length, sync.HS_BUDGET - 1)
  assert.ok(w.calls.length <= 40, `first call used ${w.calls.length} subrequests`)
  const sinceSync = w.calls.filter((c) => c.url.includes('ca_hs_deals_sync') && c.method === 'POST').length
  assert.equal(sinceSync, 1, 'one sync row per run')

  w.calls.length = 0
  const b = await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { token: null, cron: 'cron-secret-123', body: { cursor: a.body.cursor } }), w)
  assert.equal(b.status, 200, JSON.stringify(b.body))
  assert.equal(b.body.done, true)
  assert.equal(searches.length, 18, 'remaining company searches ran, none repeated')
  assert.equal(w.calls.filter((c) => c.url.endsWith('/crm/v3/pipelines/deals')).length, 0, 'pipelines are not fetched again')
  assert.equal(w.calls.filter((c) => c.url.includes('ca_hs_deals_sync') && c.method === 'POST').length, 0, 'no second sync row')
  assert.equal(b.body.deals, 1)
  const up = w.calls.find((c) => c.method === 'POST' && c.url.includes('/ca_hs_deals?'))
  assert.equal(up.body[0].partner, searches[1].filterGroups[0].filters[0].value, 'partner is the account whose search found company k2')
  assert.equal(up.body[0].bucket, 'conversation')
  assert.ok(w.calls.length <= 40, `second call used ${w.calls.length} subrequests`)
})

test('deals-sync: an upstream failure marks the sync row as error', async () => {
  const w = world({ tables: { ca_settings: [{ key: 'accounts', value: ACCOUNTS }], ca_hs_deals_sync: [] }, hubspot: () => new Response('nope', { status: 500 }) })
  const r = await run(sync.onRequestPost, req('POST', 'hubspot/deals-sync', { body: {} }), w)
  assert.equal(r.status, 500)
  assert.match(r.body.error, /HubSpot 500/)
  const s = w.calls.filter((c) => c.method === 'PATCH' && c.url.includes('ca_hs_deals_sync')).at(-1)
  assert.equal(s.body.status, 'error')
})

test('stageMapsFrom and diffDeals', () => {
  const maps = sync.stageMapsFrom(PIPELINES)
  assert.deepEqual(maps.p1.stages.st2, { label: 'Proposal', bucket: 'demo' })
  assert.deepEqual(maps.p1.stages.st4, { label: 'Closed Lost', bucket: 'lost' })
  assert.deepEqual(maps.p2.stages.x1, { label: 'Intro', bucket: 'conversation' })
  assert.equal(maps.p2.label, 'Partner Deals')
  const now = '2026-10-01T00:00:00.000Z'
  const fresh = { hs_id: 'n1', stage: 'st1', stage_label: 'Discovery Call', bucket: 'conversation', amount: null, created_at: '2026-09-29T00:00:00.000Z', via: ['gsi_property'] }
  const same = { hs_id: 's1', stage: 'st1', stage_label: 'Discovery Call', bucket: 'conversation', amount: 10, via: ['gsi_property'] }
  const lost = { hs_id: 'l1', stage: 'st4', stage_label: 'Closed Lost', bucket: 'lost', amount: 10, via: ['company_match'] }
  const { rows, history } = sync.diffDeals([fresh, same, lost], [
    { hs_id: 's1', stage: 'st1', stage_label: 'Discovery Call', bucket: 'conversation', amount: 10, via: ['company_match'], prev_stage: 'Intro', last_stage_change_at: '2026-09-01T00:00:00.000Z' },
    { hs_id: 'l1', stage: 'st2', stage_label: 'Proposal', bucket: 'demo', amount: 10, via: [] },
  ], now)
  assert.deepEqual(history.map((h) => [h.hs_id, h.kind, h.at]), [['n1', 'new', '2026-09-29T00:00:00.000Z'], ['l1', 'stage', now], ['l1', 'closed', now]])
  const s1 = rows.find((r) => r.hs_id === 's1')
  assert.deepEqual(s1.via.sort(), ['company_match', 'gsi_property'], 'via tags are unioned')
  assert.deepEqual([s1.prev_stage, s1.last_stage_change_at], ['Intro', '2026-09-01T00:00:00.000Z'], 'unchanged rows carry their history columns')
  const l1 = rows.find((r) => r.hs_id === 'l1')
  assert.deepEqual([l1.prev_stage, l1.last_stage_change_at], ['Proposal', now])
  assert.equal(history.find((h) => h.hs_id === 'l1' && h.kind === 'closed').to_value, 'lost')
})

test('deals GET: whole pipeline, history filtered by the range, last sync and kpis', async () => {
  const w = world({ tables: {
    ca_settings: [],
    ca_hs_deals: [
      { hs_id: 'a', partner: 'Accenture', bucket: 'won', amount: 100 },
      { hs_id: 'b', partner: 'Accenture', bucket: 'demo', amount: 50 },
      { hs_id: 'c', partner: 'EY', bucket: 'conversation', amount: null },
      { hs_id: 'd', partner: 'EY', bucket: 'lost', amount: 70 },
      { hs_id: 'e', partner: 'KPMG', bucket: 'won', amount: null },
    ],
    ca_hs_deal_history: [{ id: 1, hs_id: 'a', at: '2026-09-05T00:00:00.000Z', kind: 'new' }],
    ca_hs_deals_sync: [{ id: 's1', status: 'done', deals: 5 }],
  } })
  const r = await run(dealsApi.onRequestGet, req('GET', 'hubspot/deals?from=2026-09-01&to=2026-09-30', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.deals.length, 5)
  assert.equal(r.body.history.length, 1)
  assert.equal(r.body.last_sync.id, 's1')
  assert.deepEqual(r.body.kpis, { total: 5, ongoing: 2, demos: 1, wins: 2, losses: 1, customers: 2, closed_acv: 100, open_acv: 50 })
  const histCall = w.calls.find((c) => c.url.includes('/ca_hs_deal_history'))
  assert.deepEqual(new URL(histCall.url).searchParams.getAll('at'), ['gte.2026-09-01T00:00:00+05:30', 'lte.2026-09-30T23:59:59.999+05:30'])
  const dealCall = w.calls.find((c) => c.url.includes('/ca_hs_deals?'))
  assert.equal(new URL(dealCall.url).searchParams.get('at'), null, 'deals are never range-filtered')
  assert.equal((await run(dealsApi.onRequestGet, req('GET', 'hubspot/deals?from=bad'), w)).status, 400)
})

test('deals handlers answer OPTIONS with CORS headers', async () => {
  for (const h of [sync, dealsApi]) {
    const res = await h.onRequestOptions()
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  }
})
