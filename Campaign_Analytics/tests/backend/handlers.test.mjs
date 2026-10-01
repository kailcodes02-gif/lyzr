// Handler tests with a stubbed fetch: no real Graph, Supabase, HubSpot or
// Anthropic calls. node --test Campaign_Analytics/tests/backend/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import * as health from '../../../functions/api/ca/health.js'
import * as settings from '../../../functions/api/ca/settings.js'
import * as uploads from '../../../functions/api/ca/uploads.js'
import * as linkedin from '../../../functions/api/ca/linkedin.js'
import * as insights from '../../../functions/api/ca/insights.js'
import * as hubspot from '../../../functions/api/ca/hubspot/index.js'
import * as refresh from '../../../functions/api/ca/hubspot/refresh.js'
import * as email from '../../../functions/api/ca/email.js'
import * as actions from '../../../functions/api/ca/actions.js'
import * as isync from '../../../functions/api/ca/instantly/sync.js'
import * as classifyApi from '../../../functions/api/ca/hubspot/classify.js'
import { requireUser, DEFAULT_EDITORS } from '../../../functions/api/ca/_lib/auth.js'
import { db } from '../../../functions/api/ca/_lib/db.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const seedDir = path.join(here, '..', '..', 'seed')
const SUPA = 'https://fake-ref.supabase.co'

// ---- fake world ------------------------------------------------------------
function world(opts = {}) {
  const calls = []
  const tables = opts.tables || {}
  const users = { 'tok-editor': { displayName: 'Subs', mail: 'subs@lyzr.com' }, 'tok-viewer': { displayName: 'Viewer', userPrincipalName: 'viewer@lyzr.ai' }, 'tok-outsider': { displayName: 'X', mail: 'x@gmail.com' } }
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
      assert.equal(headers.apikey, 'service-key', 'PostgREST calls send apikey')
      assert.equal(headers.Authorization, 'Bearer service-key', 'PostgREST calls send bearer')
      if (opts.postgrest) { const r = opts.postgrest({ table, method, u, body, headers, tables }); if (r) return r }
      if (method === 'GET') {
        let rows = tables[table] || []
        // very small filter support: key=eq.x and key=in.(...)
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
    if (url.startsWith('https://api.instantly.ai/')) {
      if (opts.instantly) return opts.instantly({ url, method, headers })
      return jsonRes({ items: [] })
    }
    if (url.startsWith('https://api.anthropic.com/v1/messages')) {
      if (opts.anthropic) return opts.anthropic({ body, headers })
      return jsonRes({ model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', name: 'report', input: { headline: 'H', findings: [{ title: 'A', evidence: '1', so_what: 's', action: 'a', owner: 'SDR', severity: 'win' }, { title: 'B', evidence: '2', so_what: 's', action: 'a', owner: 'AE', severity: 'bogus' }, { title: 'C', evidence: '3', so_what: 's', action: 'a', owner: 'content', severity: 'risk' }], summary: 'S' } }] })
    }
    throw new Error('unexpected fetch ' + url)
  }

  const env = {
    CA_SUPABASE_URL: SUPA,
    CA_SUPABASE_KEY: 'service-key',
    HUBSPOT_ACCESS_TOKEN: opts.hubspotToken === undefined ? 'hs-token' : opts.hubspotToken,
    ANTHROPIC_API_KEY: opts.anthropicKey === undefined ? 'sk-ant-test' : opts.anthropicKey,
    ASSETS: { fetch: async (u) => { const f = new URL(String(u)).pathname.split('/').pop(); return new Response(readFileSync(path.join(seedDir, f)), { headers: { 'content-type': 'application/json' } }) } },
    ...(opts.env || {}),
  }
  return { calls, env, tables, fetchStub }
}

function req(method, pathAndQuery, { token = 'tok-editor', body } = {}) {
  const headers = {}
  if (token) headers.Authorization = 'Bearer ' + token
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

// ---- auth ------------------------------------------------------------------
test('requireUser: token, domain and editor resolution', async () => {
  const w = world({ tables: { ca_settings: [] } })
  const saved = globalThis.fetch
  globalThis.fetch = w.fetchStub
  try {
    assert.equal(await requireUser(req('GET', 'health', { token: null }), w.env), null)
    assert.equal(await requireUser(req('GET', 'health', { token: 'nope' }), w.env), null)
    assert.equal(await requireUser(req('GET', 'health', { token: 'tok-outsider' }), w.env), null, 'gmail is not served')
    const ed = await requireUser(req('GET', 'health'), w.env)
    assert.deepEqual(ed, { name: 'Subs', email: 'subs@lyzr.com', isEditor: true })
    const v = await requireUser(req('GET', 'health', { token: 'tok-viewer' }), w.env)
    assert.equal(v.isEditor, false)
    // ca_settings editors row wins over the defaults
    w.tables.ca_settings = [{ key: 'editors', value: ['viewer@lyzr.ai'] }]
    assert.equal((await requireUser(req('GET', 'health', { token: 'tok-viewer' }), w.env)).isEditor, true)
    assert.equal((await requireUser(req('GET', 'health'), w.env)).isEditor, false)
    // env.CA_EDITORS wins over everything
    w.env.CA_EDITORS = 'subs@lyzr.com, someone@lyzr.ai'
    assert.equal((await requireUser(req('GET', 'health'), w.env)).isEditor, true)
    assert.ok(DEFAULT_EDITORS.includes('kailash.gm@lyzr.ai'))
  } finally { globalThis.fetch = saved }
})

test('db: 503-shaped error when env is missing', () => {
  assert.throws(() => db({}), (e) => e.status === 503 && /Database not configured \(CA_SUPABASE_URL \/ CA_SUPABASE_KEY\)/.test(e.message))
})

test('db: selectAll pages with Range headers and upsert sends merge-duplicates', async () => {
  const pages = []
  const w = world({ postgrest: ({ table, method, headers }) => {
    if (table === 'ca_li_perf' && method === 'GET') {
      pages.push(headers.Range)
      const [from] = headers.Range.split('-').map(Number)
      const n = from === 0 ? 1000 : 3
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ i: from + i }))), { status: 206 })
    }
    return null
  } })
  const saved = globalThis.fetch
  globalThis.fetch = w.fetchStub
  try {
    const rows = await db(w.env).selectAll('ca_li_perf', { params: { day: ['gte.2026-09-01', 'lte.2026-09-30'] }, order: 'day.asc' })
    assert.equal(rows.length, 1003)
    assert.deepEqual(pages, ['0-999', '1000-1999'])
    const get = w.calls.find((c) => c.url.includes('ca_li_perf'))
    assert.ok(get.url.includes('day=gte.2026-09-01') && get.url.includes('day=lte.2026-09-30'))
    await db(w.env).upsert('ca_settings', [{ key: 'x', value: 1 }], 'key')
    const up = w.calls.at(-1)
    assert.ok(up.url.includes('on_conflict=key'))
    assert.equal(up.headers.Prefer, 'resolution=merge-duplicates,return=minimal')
  } finally { globalThis.fetch = saved }
})

// ---- health ----------------------------------------------------------------
test('health: reports db, hubspot, claude and user', async () => {
  const w = world({ tables: { ca_settings: [] } })
  let r = await run(health.onRequestGet, req('GET', 'health', { token: null }), w)
  assert.equal(r.status, 401)
  r = await run(health.onRequestGet, req('GET', 'health'), w)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.deepEqual([r.body.db, r.body.hubspot, r.body.claude], [true, true, true])
  assert.equal(r.body.user.email, 'subs@lyzr.com')
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
  const w2 = world({ anthropicKey: '', env: { CA_SUPABASE_KEY: '' } })
  r = await run(health.onRequestGet, req('GET', 'health'), w2)
  assert.deepEqual([r.body.ok, r.body.db, r.body.claude], [false, false, false])
})

// ---- settings --------------------------------------------------------------
test('settings GET: seeds merged under ca_settings rows', async () => {
  const w = world({ tables: { ca_settings: [{ key: 'targets', value: { leads_per_month: 250 }, updated_at: '2026-09-20T00:00:00Z' }] } })
  const r = await run(settings.onRequestGet, req('GET', 'settings', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200)
  const b = r.body
  assert.deepEqual(Object.keys(b).sort(), ['accounts', 'bands', 'contact_lists', 'db', 'editors', 'email_rules', 'gsi_companies', 'icp_pool', 'lead_rules', 'regions', 'source', 'targets', 'updated_at'])
  assert.deepEqual(b.targets, { leads_per_month: 250, demo_mqls_per_month: 30, frequency: 3.5, reach_frequency: 3 })
  assert.equal(b.source.targets, 'db')
  assert.equal(b.source.accounts, 'seed')
  assert.ok(b.accounts.some((a) => a.name === 'Accenture'))
  assert.ok(Array.isArray(b.bands.global.MD) && b.bands.accounts.EY)
  assert.ok(Array.isArray(b.regions.India))
  assert.ok(b.icp_pool.length > 100)
  assert.deepEqual(b.editors, DEFAULT_EDITORS)
  assert.equal(b.updated_at, '2026-09-20T00:00:00Z')
})

test('settings PUT: editors only, validates key, upserts with updated_by', async () => {
  const w = world({ tables: { ca_settings: [] } })
  let r = await run(settings.onRequestPut, req('PUT', 'settings', { token: 'tok-viewer', body: { key: 'targets', value: {} } }), w)
  assert.equal(r.status, 403)
  r = await run(settings.onRequestPut, req('PUT', 'settings', { body: { key: 'nope', value: 1 } }), w)
  assert.equal(r.status, 400)
  r = await run(settings.onRequestPut, req('PUT', 'settings', { body: { key: 'targets', value: { leads_per_month: 'abc' } } }), w)
  assert.equal(r.status, 400)
  r = await run(settings.onRequestPut, req('PUT', 'settings', { body: { key: 'targets', value: { leads_per_month: '300' } } }), w)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true, key: 'targets' })
  const up = w.calls.find((c) => c.method === 'POST' && c.url.includes('ca_settings'))
  assert.ok(up.url.includes('on_conflict=key'))
  assert.equal(up.body[0].updated_by, 'subs@lyzr.com')
  assert.deepEqual(up.body[0].value, { leads_per_month: 300 })
})

// ---- uploads ---------------------------------------------------------------
test('uploads POST: creates the upload, coerces rows, upserts in batches of 500, updates row_count', async () => {
  const w = world({ tables: { ca_uploads: [] } })
  const rows = Array.from({ length: 1203 }, (_, i) => ({ day: '2026-09-' + String((i % 28) + 1).padStart(2, '0'), campaign_id: 'c' + (i % 40), ad_id: 'a' + i, campaign: 'GSI', impressions: String(i), clicks: '1,000', spend: '$12.5', weird: 'x' }))
  rows.push({ day: 'not a day', campaign_id: 'c', ad_id: 'bad' })
  rows.push({ day: '2026-09-01', campaign_id: 'c0', ad_id: 'a0', impressions: 999 }) // duplicate key: last one wins in the batch
  let r = await run(uploads.onRequestPost, req('POST', 'uploads', { token: 'tok-viewer', body: { kind: 'performance', rows } }), w)
  assert.equal(r.status, 403)
  r = await run(uploads.onRequestPost, req('POST', 'uploads', { body: { channel: 'linkedin', kind: 'performance', file_name: 'perf.csv', period_start: '2026-09-01', period_end: '2026-09-28', columns: { Impressions: 'impressions' }, rows } }), w)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.upload_id, 'id-ca_uploads-1')
  assert.equal(r.body.inserted, 1203)
  assert.equal(r.body.skipped, 2)
  const perfPosts = w.calls.filter((c) => c.method === 'POST' && c.url.includes('ca_li_perf'))
  assert.deepEqual(perfPosts.map((c) => c.body.length), [500, 500, 203])
  assert.ok(perfPosts[0].url.includes('on_conflict=platform%2Cday%2Ccampaign_id%2Cad_id'))
  assert.equal(perfPosts[0].body[0].platform, 'linkedin')
  const first = perfPosts[0].body.find((x) => x.ad_id === 'a0')
  assert.equal(first.impressions, 999)
  assert.equal(first.clicks, 0)
  const second = perfPosts[0].body.find((x) => x.ad_id === 'a1')
  assert.equal(second.clicks, 1000)
  assert.equal(second.spend, 12.5)
  assert.deepEqual(second.extra, { weird: 'x' })
  assert.equal(second.upload_id, 'id-ca_uploads-1')
  const created = w.calls.find((c) => c.method === 'POST' && c.url.endsWith('/ca_uploads'))
  assert.equal(created.body[0].uploaded_by, 'subs@lyzr.com')
  assert.equal(created.headers.Prefer, 'return=representation')
  const patch = w.calls.find((c) => c.method === 'PATCH' && c.url.includes('ca_uploads'))
  assert.deepEqual(patch.body, { row_count: 1203 })

  // continuation call with upload_id
  r = await run(uploads.onRequestPost, req('POST', 'uploads', { body: { kind: 'performance', upload_id: 'id-ca_uploads-1', rows: [{ day: '2026-09-29', campaign_id: 'c', ad_id: 'z' }], final: true } }), w)
  assert.equal(r.status, 200)
  assert.equal(r.body.created, false)
  assert.equal(r.body.final, true)
  r = await run(uploads.onRequestPost, req('POST', 'uploads', { body: { kind: 'performance', rows: Array.from({ length: 2001 }, () => ({})) } }), w)
  assert.equal(r.status, 413)
})

test('uploads POST demographics: replaces an upload with the same window, and validates rows', async () => {
  const w = world({ tables: { ca_uploads: [{ id: 'old-1', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', period_start: '2026-09-01', period_end: '2026-09-14' }] } })
  const rows = [
    { segment: 'Company', value: 'Accenture', campaign: 'GSI', impressions: '120', clicks: '4' },
    { segment: 'Company', value: 'Accenture', campaign: 'GSI', impressions: '130', clicks: '5' },
    { segment: '', value: 'x' },
    { segment: 'Job Title', value: 'Partner', impressions: 10 },
  ]
  const r = await run(uploads.onRequestPost, req('POST', 'uploads', { body: { kind: 'demographics', period_start: '2026-09-01', period_end: '2026-09-14', rows } }), w)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.inserted, 2)
  assert.equal(r.body.skipped, 2)
  const del = w.calls.find((c) => c.method === 'DELETE')
  assert.ok(del && del.url.includes('ca_uploads') && del.url.includes('old-1'))
  const post = w.calls.find((c) => c.method === 'POST' && c.url.includes('ca_li_demo'))
  assert.ok(post.url.includes('on_conflict=upload_id%2Csegment%2Cvalue%2Ccampaign'))
  assert.equal(post.body[0].impressions, 130)
  assert.equal(post.body[1].campaign, '')
})

test('uploads GET and DELETE', async () => {
  const w = world({ tables: { ca_uploads: [{ id: 'u1', channel: 'linkedin', kind: 'performance' }, { id: 'u2', channel: 'email', kind: 'performance' }] } })
  let r = await run(uploads.onRequestGet, req('GET', 'uploads?channel=linkedin', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.uploads.map((u) => u.id), ['u1'])
  r = await run(uploads.onRequestDelete, req('DELETE', 'uploads?id=u1', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 403)
  r = await run(uploads.onRequestDelete, req('DELETE', 'uploads?id=u1'), w)
  assert.equal(r.status, 400, 'id must look like a uuid')
  r = await run(uploads.onRequestDelete, req('DELETE', 'uploads?id=2f1c7a1e-1111-4222-8333-444455556666'), w)
  assert.equal(r.status, 200)
  assert.ok(w.calls.at(-1).url.includes('id=eq.2f1c7a1e-1111-4222-8333-444455556666'))
})

// ---- linkedin --------------------------------------------------------------
test('linkedin GET: perf in range, demo uploads that overlap, all uploads', async () => {
  const w = world({ tables: {
    ca_uploads: [
      { id: 'd1', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', period_start: '2026-09-01', period_end: '2026-09-14' },
      { id: 'd2', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', period_start: '2026-09-15', period_end: '2026-09-28' },
      { id: 'd3', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', period_start: '2026-08-01', period_end: '2026-08-14' },
      { id: 'p1', channel: 'linkedin', kind: 'performance', platform: 'linkedin', period_start: '2026-09-01', period_end: '2026-09-28' },
    ],
    ca_li_perf: [{ platform: 'linkedin', day: '2026-09-10', campaign_id: 'c', ad_id: 'a', impressions: 5 }],
    ca_li_demo: [{ id: 1, upload_id: 'd1', segment: 'Company', value: 'EY' }, { id: 2, upload_id: 'd2', segment: 'Company', value: 'PwC' }, { id: 3, upload_id: 'd3', segment: 'Company', value: 'Old' }],
  } })
  let r = await run(linkedin.onRequestGet, req('GET', 'linkedin?from=2026-09-10&to=2026-09-20', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.perf.length, 1)
  assert.deepEqual(r.body.demo.map((d) => d.upload.id), ['d1', 'd2'])
  assert.deepEqual(r.body.demo.map((d) => d.rows.length), [1, 1])
  assert.equal(r.body.uploads.length, 4)
  const perfCall = w.calls.find((c) => c.url.includes('ca_li_perf'))
  assert.ok(perfCall.url.includes('day=gte.2026-09-10') && perfCall.url.includes('day=lte.2026-09-20'))
  assert.equal(perfCall.headers.Range, '0-999')
  r = await run(linkedin.onRequestGet, req('GET', 'linkedin?from=bad'), w)
  assert.equal(r.status, 400)
  assert.equal(linkedin.overlaps({ period_start: null, period_end: null }, '2026-01-01', '2026-01-02'), true)
})

// ---- hubspot GET -----------------------------------------------------------
test('hubspot GET: contacts in range, notes grouped, last sync', async () => {
  const w = world({ tables: {
    ca_hs_contacts: [{ hs_id: '1', email: 'a@x.com' }, { hs_id: '2', email: 'b@x.com' }],
    ca_hs_notes: [{ id: 'n1', contact_id: '1', body: 'hi' }, { id: 'n2', contact_id: '9', body: 'orphan' }],
    ca_hs_sync: [{ id: 's1', status: 'done' }],
  } })
  const r = await run(hubspot.onRequestGet, req('GET', 'hubspot?from=2026-09-01&to=2026-09-30', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.contacts.length, 2)
  assert.deepEqual(Object.keys(r.body.notes_by_contact), ['1'])
  assert.equal(r.body.last_sync.id, 's1')
  const c = w.calls.find((x) => x.url.includes('ca_hs_contacts'))
  assert.ok(decodeURIComponent(c.url).includes('created_at=gte.2026-09-01T00:00:00+05:30'))
  assert.ok(decodeURIComponent(c.url).includes('created_at=lte.2026-09-30T23:59:59.999+05:30'))
})

// ---- hubspot refresh ---------------------------------------------------------
test('refresh: search phase pulls with GSI rules, classifies, upserts, returns a cursor; then notes phase; never writes to HubSpot', async () => {
  const searches = []
  const w = world({
    tables: { ca_settings: [], ca_hs_sync: [], ca_hs_contacts: [] },
    hubspot: ({ url, method, body }) => {
      const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/crm/v3/owners?limit=500')) return j({ results: [{ id: '77', firstName: 'Anju', lastName: 'K', email: 'anju@lyzr.ai' }] })
      if (url.endsWith('/crm/v3/objects/contacts/search')) {
        searches.push(body)
        const n = searches.length
        // first search returns two pages, everything else one page with one contact
        if (n === 1) return j({ results: [{ id: '100', properties: { firstname: 'Ann', lastname: 'A', email: 'ann@accenture.com', company: 'Accenture Strategy', jobtitle: 'Managing Director', country: 'IN', hubspot_owner_id: '77', createdate: '2026-09-02T10:00:00.000Z', lsa_message: 'Want a demo', hs_analytics_source: 'PAID_SOCIAL' } }], paging: { next: { after: 'p2' } } })
        if (n === 2) return j({ results: [{ id: '101', properties: { firstname: 'Bob', company: 'Beyond Ltd', jobtitle: 'Engineer', country: 'Narnia', createdate: '2026-09-03T10:00:00.000Z' } }] })
        return j({ results: [{ id: '100', properties: { firstname: 'Ann', company: 'Accenture Strategy', jobtitle: 'Managing Director', country: 'IN' } }] })
      }
      if (url.includes('/crm/v4/associations/contacts/')) {
        const type = url.split('/crm/v4/associations/contacts/')[1].split('/')[0]
        assert.equal(method, 'POST')
        if (type === 'notes') return j({ results: [{ from: { id: '100' }, to: [{ toObjectId: 5001 }, { toObjectId: 5002 }] }] })
        if (type === 'calls') return j({ results: [{ from: { id: '100' }, to: [{ toObjectId: 9001 }] }] })
        return j({ results: [] })
      }
      if (url.endsWith('/crm/v3/objects/notes/batch/read')) {
        assert.deepEqual(body.properties, ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'])
        return j({ results: [
          { id: '5001', properties: { hs_note_body: '<p>Spoke to <b>Ann</b>.<br>Wants pilot &amp; pricing</p>', hs_timestamp: '2026-09-05T09:00:00.000Z', hubspot_owner_id: '77' } },
          { id: '5002', properties: { hs_note_body: 'Follow up', hs_timestamp: '1757500000000' } },
        ] })
      }
      throw new Error('unexpected hubspot ' + url)
    },
  })

  // viewer cannot refresh
  let r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { token: 'tok-viewer', body: {} }), w)
  assert.equal(r.status, 403)

  // invocation 1: search phase, budget-limited
  r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: {} }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.done, false)
  assert.equal(r.body.cursor.phase, 'search')
  assert.equal(r.body.cursor.sync_id, 'id-ca_hs_sync-1')
  assert.equal(r.body.progress.phase, 'search')
  assert.equal(searches.length, refresh.SEARCH_BUDGET)
  // the first task is four company filterGroups with CONTAINS_TOKEN, each limited to form submitters
  assert.equal(searches[0].filterGroups.length, refresh.NAMES_PER_SEARCH)
  assert.deepEqual(searches[0].filterGroups[0].filters[1], { propertyName: 'first_conversion_date', operator: 'HAS_PROPERTY' })
  for (const s of searches) for (const g of s.filterGroups || []) assert.ok(!g.filters.some((f) => f.propertyName === 'hubspot_owner_id'), 'no owner rule any more')
  assert.equal(searches[0].filterGroups[0].filters[0].operator, 'CONTAINS_TOKEN')
  assert.equal(searches[0].filterGroups[0].filters[0].propertyName, 'company')
  assert.ok(searches[0].properties.includes('lsa_message') && searches[0].properties.includes('jobtitle') && searches[0].properties.includes('hs_analytics_source'))
  assert.equal(searches[1].after, 'p2', 'second call continues the first task page')
  // subrequest budget: everything this invocation did, well under 45
  const total = w.calls.length
  assert.ok(total <= 40, `used ${total} subrequests`)
  // no HubSpot writes ever
  for (const c of w.calls.filter((x) => x.url.startsWith('https://api.hubapi.com/'))) {
    assert.ok(!/\/(objects|associations)\/[^/]+\/?$/.test(new URL(c.url).pathname) || c.method === 'GET' || c.url.endsWith('/search'), 'read-only: ' + c.url)
    assert.ok(!['PUT', 'PATCH', 'DELETE'].includes(c.method), 'no write verb to HubSpot')
  }
  // contacts were classified and upserted
  const up = w.calls.find((c) => c.method === 'POST' && c.url.includes('ca_hs_contacts'))
  assert.ok(up.url.includes('on_conflict=hs_id'))
  const ann = up.body.find((x) => x.hs_id === '100')
  assert.equal(ann.account, 'Accenture')
  assert.equal(ann.band, 'MD')
  assert.equal(ann.region, 'India')
  assert.equal(ann.owner_name, 'Anju K')
  assert.equal(ann.lsa_message, 'Want a demo')
  assert.equal(ann.source, 'PAID_SOCIAL')
  assert.equal(ann.created_at, '2026-09-02T10:00:00.000Z')
  assert.deepEqual(ann.via.sort(), ['company'])
  const bob = up.body.find((x) => x.hs_id === '101')
  assert.equal(bob.account, null)
  assert.equal(bob.band, 'Other')
  assert.equal(bob.region, 'Other')
  assert.ok(!('notes_count' in ann), 'search phase leaves notes_count alone')

  // jump to the notes phase by handing back a cursor that says the searches are done
  w.calls.length = 0
  w.tables.ca_hs_contacts = [{ hs_id: '100', last_activity_at: null, last_activity_type: null }, { hs_id: '101', last_activity_at: null, last_activity_type: null }]
  const cursor = { ...r.body.cursor, phase: 'notes', offset: 0 }
  r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.done, true)
  assert.equal(r.body.notes, 2)
  assert.equal(r.body.progress.phase, 'done')
  const noteUp = w.calls.find((c) => c.method === 'POST' && c.url.includes('ca_hs_notes'))
  assert.ok(noteUp.url.includes('on_conflict=id'))
  const n1 = noteUp.body.find((n) => n.id === '5001')
  assert.equal(n1.body, 'Spoke to Ann.\nWants pilot & pricing')
  assert.equal(n1.kind, 'note')
  assert.equal(n1.contact_id, '100')
  assert.equal(n1.owner_id, '77')
  const n2 = noteUp.body.find((n) => n.id === '5002')
  assert.equal(n2.created_at, new Date(1757500000000).toISOString())
  const patch = w.calls.filter((c) => c.method === 'POST' && c.url.includes('ca_hs_contacts')).at(-1)
  const p100 = patch.body.find((x) => x.hs_id === '100')
  assert.equal(p100.notes_count, 3, 'notes + calls + meetings + emails')
  assert.equal(p100.last_activity_at, '2026-09-05T09:00:00.000Z')
  assert.equal(p100.last_activity_type, 'note')
  const sync = w.calls.filter((c) => c.method === 'PATCH' && c.url.includes('ca_hs_sync')).at(-1)
  assert.equal(sync.body.status, 'done')
  assert.ok(w.calls.length <= 40, `notes phase used ${w.calls.length} subrequests`)
})

test('refresh: 503 without the HubSpot token, error marks the sync row', async () => {
  let w = world({ hubspotToken: '' })
  let r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: {} }), w)
  assert.equal(r.status, 503)
  w = world({ tables: { ca_settings: [], ca_hs_sync: [] }, hubspot: ({ url }) => url.includes('/owners') ? new Response('{"results":[]}', { status: 200 }) : new Response('nope', { status: 500 }) })
  r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: {} }), w)
  assert.equal(r.status, 500, "upstream errors are reported as 500: Cloudflare masks 502")
  assert.match(r.body.error, /HubSpot 500/)
  const sync = w.calls.filter((c) => c.method === 'PATCH' && c.url.includes('ca_hs_sync')).at(-1)
  assert.equal(sync.body.status, 'error')
})

test('stripHtml and buildTasks', () => {
  assert.equal(refresh.stripHtml('<div>a&nbsp;b</div><div>c &lt;d&gt;</div>'), 'a b\nc <d>')
  const tasks = refresh.buildTasks(['A', 'B', 'C', 'D', 'E'], ['a.com', 'b.com'], [])
  assert.equal(tasks.length, 3)
  assert.deepEqual(tasks.map((t) => t.tag), ['company', 'company', 'domain'])
  assert.equal(tasks[0].body.filterGroups.length, 4)
  assert.deepEqual(tasks[2].body.filterGroups[0].filters[0], { propertyName: 'hs_email_domain', operator: 'IN', values: ['a.com', 'b.com'] })
  const terms = refresh.searchTerms([{ name: 'Acme', domain: 'acme.com', source: ['abm'] }, { name: 'Big SI', aliases: ['BSI'], bands: { md: 'Partner' } }, { name: 'Sub', domains: ['sub.io', 'sub.de'] }], ['Extra Co'])
  assert.deepEqual(terms, { names: ['BSI', 'Big SI', 'Extra Co'], domains: ['acme.com', 'sub.de', 'sub.io'] })
  assert.equal(refresh.domainAccount('x@eu.sub.de', [{ name: 'Sub', domains: ['sub.io', 'sub.de'] }]), 'Sub')
})

// ---- insights --------------------------------------------------------------
test('insights POST: calls Claude with a forced report tool and cached system prompt, stores and returns; cache hit on same input', async () => {
  const w = world({ tables: { ca_insights: [] } })
  const input = { totals: { spend: 1200, leads: 14 }, rows: [{ a: 1 }] }
  let r = await run(insights.onRequestPost, req('POST', 'insights', { token: 'tok-viewer', body: { scope: 'ads:all', kind: 'ads', input } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.cached, false)
  assert.equal(r.body.model, 'claude-sonnet-5', 'every read-out uses Sonnet 5')
  assert.equal(r.body.content.findings.length, 3)
  assert.equal(r.body.content.findings[1].severity, 'info', 'unknown severity is normalised')
  assert.equal(r.body.content.headline, 'H')
  const call = w.calls.find((c) => c.url.startsWith('https://api.anthropic.com'))
  assert.equal(call.headers['x-api-key'], 'sk-ant-test')
  assert.equal(call.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(call.body.tool_choice, { type: 'tool', name: 'report', disable_parallel_tool_use: true })
  assert.equal(call.body.tools[0].name, 'report')
  assert.deepEqual(call.body.tools[0].input_schema.required, ['headline', 'findings', 'summary'])
  assert.deepEqual(call.body.system[0].cache_control, { type: 'ephemeral' })
  assert.match(call.body.system[0].text, /MD-1/)
  assert.match(call.body.system[1].text, /Kind: ads/)
  assert.match(call.body.messages[0].content, /"spend":1200/)
  assert.ok(!/\u2014/.test(call.body.system[0].text + call.body.system[1].text), 'no em dashes in prompts')
  const stored = w.calls.find((c) => c.method === 'POST' && c.url.includes('ca_insights'))
  assert.ok(stored.url.includes('on_conflict=scope'))
  assert.equal(stored.body[0].created_by, 'viewer@lyzr.ai')
  assert.equal(stored.body[0].model, 'claude-sonnet-5')
  assert.match(stored.body[0].input_hash, /^[0-9a-f]{64}$/)

  // same input: served from cache, no model call
  w.tables.ca_insights = [{ scope: 'ads:all', input_hash: stored.body[0].input_hash, model: 'm', content: { headline: 'cached' }, created_at: 'x' }]
  w.calls.length = 0
  r = await run(insights.onRequestPost, req('POST', 'insights', { token: 'tok-viewer', body: { scope: 'ads:all', kind: 'ads', input } }), w)
  assert.equal(r.body.cached, true)
  assert.equal(r.body.content.headline, 'cached')
  assert.ok(!w.calls.some((c) => c.url.startsWith('https://api.anthropic.com')))
  // force: viewer forbidden, editor regenerates
  r = await run(insights.onRequestPost, req('POST', 'insights', { token: 'tok-viewer', body: { scope: 'ads:all', kind: 'ads', input, force: true } }), w)
  assert.equal(r.status, 403)
  r = await run(insights.onRequestPost, req('POST', 'insights', { body: { scope: 'ads:all', kind: 'ads', input, force: true } }), w)
  assert.equal(r.body.cached, false)
  // big input picks sonnet and is capped
  const big = { totals: { leads: 99 }, rows: Array.from({ length: 5000 }, (_, i) => ({ i, text: 'x'.repeat(40) })) }
  r = await run(insights.onRequestPost, req('POST', 'insights', { body: { scope: 'msg:all', kind: 'messaging', input: big } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.model, 'claude-sonnet-5')
  assert.equal(r.body.truncated, true)
  const bigCall = w.calls.filter((c) => c.url.startsWith('https://api.anthropic.com')).at(-1)
  assert.ok(bigCall.body.messages[0].content.length < 62 * 1024)
  assert.match(bigCall.body.messages[0].content, /"leads":99/)
  assert.match(bigCall.body.messages[0].content, /rows_truncated/)
})

test('insights: validation, 503 without key, model errors, GET cache', async () => {
  let w = world({ tables: { ca_insights: [] } })
  let r = await run(insights.onRequestPost, req('POST', 'insights', { body: { scope: 's', kind: 'nope', input: {} } }), w)
  assert.equal(r.status, 400)
  w = world({ tables: { ca_insights: [] }, anthropicKey: '' })
  r = await run(insights.onRequestPost, req('POST', 'insights', { body: { scope: 's', kind: 'leads', input: {} } }), w)
  assert.equal(r.status, 503)
  w = world({ tables: { ca_insights: [] }, anthropic: () => new Response('{"error":"overloaded"}', { status: 529 }) })
  r = await run(insights.onRequestPost, req('POST', 'insights', { body: { scope: 's', kind: 'leads', input: {} } }), w)
  assert.equal(r.status, 500)
  assert.match(r.body.error, /Model error 529/)
  w = world({ tables: { ca_insights: [{ scope: 'x', content: { headline: 'c' }, created_at: 't', model: 'm' }] } })
  r = await run(insights.onRequestGet, req('GET', 'insights?scope=x', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.content, { headline: 'c' })
  assert.equal(r.body.cached, true)
  r = await run(insights.onRequestGet, req('GET', 'insights?scope=none', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 404)
  assert.equal(insights.capInput({ a: 1 }).truncated, false)
})

test('every handler answers OPTIONS with CORS headers', async () => {
  for (const m of [health, settings, uploads, linkedin, insights, hubspot, refresh, email, actions, isync]) {
    const res = await m.onRequestOptions()
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.match(res.headers.get('access-control-allow-headers'), /Authorization/)
  }
})

test('handlers return a 503 JSON error when the database env is missing', async () => {
  const w = world({ env: { CA_SUPABASE_URL: '', CA_SUPABASE_KEY: '' } })
  const r = await run(uploads.onRequestGet, req('GET', 'uploads'), w)
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'Database not configured (CA_SUPABASE_URL / CA_SUPABASE_KEY)')
  assert.equal((await run(email.onRequestGet, req('GET', 'email'), w)).status, 503)
  assert.equal((await run(actions.onRequestGet, req('GET', 'actions'), w)).status, 503)
  const s = await run(settings.onRequestGet, req('GET', 'settings'), w)
  assert.equal(s.status, 200, 'settings still serves seed defaults so the shell can boot')
  assert.equal(s.body.db, false)
})

// ---- email channel -------------------------------------------------------------
test('uploads POST events: email channel, normalised rows, idempotent key', async () => {
  const w = world({ tables: { ca_settings: [], ca_uploads: [] } })
  const rows = [
    { campaign: 'GSI_Sep_X', contact: 'A@X.example', step: 1, event: 'sent', ts: '2026-09-01T04:00:00.000Z', sender: 'Box@S.example', link: 'ignored', lag_s: 5 },
    { campaign: 'GSI_Sep_X', contact: 'a@x.example', step: 1, event: 'clicked', ts: '2026-09-01T04:01:00.000Z', sender: 'box@s.example', link: 'https://www.lyzr.ai/gsi-si/', lag_s: 60 },
    { campaign: 'GSI_Sep_X', contact: 'a@x.example', step: 1, event: 'clicked', ts: '2026-09-01T04:01:00.000Z', sender: 'box@s.example', link: 'https://www.lyzr.ai/gsi-si/', lag_s: 60 },
    { campaign: 'GSI_Sep_X', contact: '', step: 1, event: 'sent', ts: '2026-09-01T04:00:00Z' },
    { campaign: 'GSI_Sep_X', contact: 'b@x.example', step: 'x', event: 'weird', ts: 'not a date' },
  ]
  const r = await run(uploads.onRequestPost, req('POST', 'uploads', { body: { channel: 'email', kind: 'events', file_name: 'GSI_Sep_X_analytics.csv', rows, notes: 'GSI_Sep_X' } }), w)
  assert.equal(r.status, 201)
  assert.equal(r.body.inserted, 2)
  assert.equal(r.body.skipped, 3)
  const up = w.calls.find((c) => c.url.includes('/ca_em_events') && c.method === 'POST')
  assert.match(up.url, /on_conflict=campaign%2Ccontact%2Cstep%2Cevent%2Cts%2Clink/)
  assert.deepEqual(up.body.map((x) => [x.contact, x.event, x.link, x.lag_s, x.sender]), [['a@x.example', 'sent', '', null, 'box@s.example'], ['a@x.example', 'clicked', 'https://www.lyzr.ai/gsi-si/', 60, 'box@s.example']])
  const bad = await run(uploads.onRequestPost, req('POST', 'uploads', { body: { channel: 'email', kind: 'performance', rows: [] } }), w)
  assert.equal(bad.status, 400)
})

test('email GET: compact pages, first page carries uploads and the API mirror', async () => {
  const ev = (i) => ({ campaign: i % 2 ? 'A' : 'B', contact: `p${i}@x.example`, step: 1, event: 'sent', ts: `2026-09-01T04:00:${String(i % 60).padStart(2, '0')}Z`, sender: 's@x.example', link: '', lag_s: null })
  const all = Array.from({ length: 1500 }, (_, i) => ev(i))
  const w = world({ tables: { ca_settings: [], ca_uploads: [{ id: 'u1', channel: 'email' }], ca_em_campaigns: [{ id: 'c1', name: 'A', gsi: true, sent: 120, contacted: 40 }, { id: 'w1', name: 'Other workspace campaign', gsi: false, sent: 880, contacted: 300 }], ca_em_daily: [{ campaign_id: 'c1', day: '2026-09-01', sent: 3 }], ca_em_sync: [] },
    postgrest: ({ table, method, u }) => {
      if (table === 'ca_em_events' && method === 'GET') { const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit')); return new Response(JSON.stringify(all.slice(off, off + lim)), { headers: { 'content-type': 'application/json' } }) }
    } })
  w.env.INSTANTLY_API_KEY = 'ik'
  const r = await run(email.onRequestGet, req('GET', 'email'), w)
  assert.equal(r.status, 200)
  assert.equal(r.body.events.length, 1500)
  assert.equal(r.body.next, null)
  assert.deepEqual(r.body.campaigns.sort(), ['A', 'B'])
  assert.equal(r.body.events[0].length, 8)
  assert.equal(r.body.api.campaigns.length, 2, 'every workspace campaign is returned, with its gsi flag')
  assert.deepEqual(r.body.api.campaigns.map((c) => c.gsi), [true, false])
  assert.deepEqual(r.body.api.workspace, { sent: 1000, contacted: 340, campaigns: 2, gsi_campaigns: 1 })
  assert.equal(r.body.api.configured, true)
  const r2 = await run(email.onRequestGet, req('GET', 'email?offset=1000'), w)
  assert.equal(r2.body.events.length, 500)
  assert.equal(r2.body.api, undefined)
})

test('actions: anyone signed in can add and tick off, only editors delete', async () => {
  const w = world({ tables: { ca_settings: [], ca_actions: [] }, postgrest: ({ table, method, body, tables }) => {
    if (table === 'ca_actions' && method === 'PATCH') { const a = tables.ca_actions[0]; Object.assign(a, body); return new Response(JSON.stringify([a]), { headers: { 'content-type': 'application/json' } }) }
  } })
  const c = await run(actions.onRequestPost, req('POST', 'actions', { token: 'tok-viewer', body: { channel: 'email', title: 'Chase the demo list', owner: 'SDR', source: 'ai' } }), w)
  assert.equal(c.status, 201)
  assert.equal(c.body.action.status, 'open')
  assert.equal(c.body.action.created_by, 'viewer@lyzr.ai')
  const id = '00000000-0000-4000-8000-000000000001'
  w.tables.ca_actions[0].id = id
  const u = await run(actions.onRequestPut, req('PUT', 'actions', { token: 'tok-viewer', body: { id, status: 'done', note: 'sent' } }), w)
  assert.equal(u.status, 200)
  assert.equal(u.body.action.status, 'done')
  assert.ok(u.body.action.done_at)
  assert.equal((await run(actions.onRequestPut, req('PUT', 'actions', { body: { id, status: 'maybe' } }), w)).status, 400)
  assert.equal((await run(actions.onRequestPost, req('POST', 'actions', { body: { channel: 'tv', title: 'x' } }), w)).status, 400)
  assert.equal((await run(actions.onRequestDelete, req('DELETE', 'actions?id=' + id, { token: 'tok-viewer' }), w)).status, 403)
  assert.equal((await run(actions.onRequestDelete, req('DELETE', 'actions?id=' + id), w)).status, 200)
})

test('instantly sync: GSI tag, totals joined by id, whole workspace stored with gsi flag, daily rows for GSI only, cron secret, read-only', async () => {
  const daily = (id) => [{ date: '2026-09-20', sent: 30, contacted: 30, new_leads_contacted: 10, unique_opened: 3, unique_replies: 1, unique_clicks: 2, unique_opportunities: 0 }]
  const w = world({ tables: { ca_settings: [], ca_em_sync: [] }, instantly: ({ url, method }) => {
    assert.equal(method, 'GET', 'never writes to Instantly')
    const j = (b) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } })
    if (url.includes('/campaigns?tag_ids=')) return j({ items: Array.from({ length: 25 }, (_, i) => ({ id: 'c' + i, name: 'GSI_' + i, status: 1, timestamp_created: '2026-09-01T00:00:00Z' })) })
    if (url.endsWith('/campaigns/analytics')) return j([{ campaign_id: 'c0', emails_sent_count: 100, contacted_count: 50, reply_count_unique: 2, bounced_count: 1 }, { campaign_id: 'other', campaign_name: 'Not GSI', campaign_status: 2, emails_sent_count: 9, leads_count: 40, contacted_count: 9 }])
    if (url.includes('/campaigns/analytics/daily')) return j(daily())
    throw new Error('unexpected ' + url)
  } })
  w.env.INSTANTLY_API_KEY = 'ik'
  w.env.CA_CRON_SECRET = 'cron-secret-123'
  const cronReq = (body, secret = 'cron-secret-123') => new Request('https://lyzr.kailash-gm.com/api/ca/instantly/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CA-Cron': secret }, body: JSON.stringify(body) })
  assert.equal((await run(isync.onRequestPost, cronReq({}, 'wrong-secret-12'), w)).status, 401)
  const a = await run(isync.onRequestPost, cronReq({}), w)
  assert.equal(a.status, 200)
  assert.equal(a.body.campaigns, 25)
  assert.equal(a.body.workspace_campaigns, 26)
  const up = w.calls.find((c) => c.url.includes('/ca_em_campaigns') && c.method === 'POST')
  assert.equal(up.body.length, 26, 'GSI campaigns plus the rest of the workspace')
  assert.deepEqual([up.body[0].sent, up.body[0].contacted, up.body[0].replied_unique, up.body[1].sent], [100, 50, 2, 0])
  assert.ok(up.body.slice(0, 25).every((c) => c.gsi === true))
  assert.deepEqual([up.body[25].id, up.body[25].name, up.body[25].status, up.body[25].gsi, up.body[25].sent, up.body[25].leads_count], ['other', 'Not GSI', 2, false, 9, 40])
  assert.equal(a.body.cursor.queue.length, 25, 'only GSI campaigns get daily rows')
  assert.ok(!a.body.cursor.queue.some((q) => q.id === 'other'))
  const b = await run(isync.onRequestPost, cronReq({ cursor: a.body.cursor }), w)
  assert.equal(b.body.done, false)
  assert.equal(b.body.progress.done, isync.DAILY_BUDGET)
  const c = await run(isync.onRequestPost, cronReq({ cursor: b.body.cursor }), w)
  assert.equal(c.body.done, true)
  assert.equal(c.body.days, 25)
  const d = w.calls.filter((x) => x.url.includes('/ca_em_daily') && x.method === 'POST').flatMap((x) => x.body)
  assert.deepEqual(Object.keys(d[0]).sort(), ['campaign_id', 'clicks', 'contacted', 'day', 'new_leads_contacted', 'opened', 'opportunities', 'replies', 'replies_automatic', 'sent', 'synced_at', 'unique_clicks', 'unique_opened', 'unique_replies'])
  // viewers cannot trigger it
  assert.equal((await run(isync.onRequestPost, req('POST', 'instantly/sync', { token: 'tok-viewer', body: {} }), w)).status, 403)
})

test('hubspot classify: Sonnet 5 files unread messages once, marks skipped ones read, cron allowed', async () => {
  const leads = [
    { hs_id: '1', account: 'Accenture', company_raw: 'Accenture', jobtitle: 'Managing Director', country: 'India', lsa_message: 'We want AI SDRs for our clients, pilot in Q4' },
    { hs_id: '2', account: 'KPMG', jobtitle: 'Manager', country: 'UK', lsa_message: 'asdfgh' },
    { hs_id: '3', account: 'EY', jobtitle: 'Partner', country: 'US', lsa_message: 'Show me the product' },
  ]
  let sentBody = null
  const patches = []
  const w = world({ tables: { ca_settings: [] },
    postgrest: ({ table, method, u, body }) => {
      const j = (b) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } })
      if (table !== 'ca_hs_contacts') return
      if (method === 'GET') { assert.equal(u.searchParams.get('ai_at'), 'is.null'); return j(patches.length ? [] : leads) }
      if (method === 'PATCH') { patches.push({ id: u.searchParams.get('hs_id').replace('eq.', ''), body }); return new Response(null, { status: 204 }) }
    },
    anthropic: ({ body }) => {
      sentBody = body
      return new Response(JSON.stringify({ model: body.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'file_leads', input: { results: [
        { id: '1', cluster: 'sales', use_case: 'AI SDRs for clients', intent: 'high', summary: 'Wants AI SDRs for clients with a Q4 pilot.', spam: false },
        { id: '2', cluster: 'nonsense', use_case: '', intent: 'low', summary: 'Gibberish.', spam: true },
      ] } }] }), { headers: { 'content-type': 'application/json' } })
    } })
  w.env.CA_CRON_SECRET = 'cron-secret-123'
  const r = await run(classifyApi.onRequestPost, new Request('https://lyzr.kailash-gm.com/api/ca/hubspot/classify', { method: 'POST', headers: { 'X-CA-Cron': 'cron-secret-123' }, body: '{}' }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(sentBody.model, 'claude-sonnet-5')
  assert.equal(sentBody.tool_choice.name, 'file_leads')
  assert.equal(JSON.parse(sentBody.messages[0].content.split('<leads>\n')[1].split('\n</leads>')[0]).length, 3)
  assert.equal(r.body.classified, 1)
  assert.equal(r.body.done, true)
  const p = Object.fromEntries(patches.map((x) => [x.id, x.body]))
  assert.deepEqual([p['1'].ai_cluster, p['1'].ai_intent, p['1'].ai_spam], ['sales', 'high', false])
  assert.equal(p['2'].ai_cluster, null, 'unknown category is dropped')
  assert.equal(p['2'].ai_spam, true)
  assert.ok(p['3'].ai_at && !('ai_cluster' in p['3']), 'skipped lead is marked read so the loop ends')
  assert.equal((await run(classifyApi.onRequestPost, req('POST', 'hubspot/classify', { token: 'tok-viewer', body: {} }), w)).status, 403)
})
