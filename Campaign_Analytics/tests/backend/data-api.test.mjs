// The data API (/api/ca/v1) and the MCP server (/api/ca/mcp): key auth, the index, sources over a fake
// Supabase, CSV output, the table passthrough guards, and the JSON-RPC surface.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import * as v1 from '../../../functions/api/ca/v1/[[path]].js'
import * as mcp from '../../../functions/api/ca/mcp/[[key]].js'
import { apiKeys, requireReader } from '../../../functions/api/ca/_lib/apikeys.js'
import { SOURCES, TABLES, toCsv, runSource, QueryError } from '../../../functions/api/ca/_lib/query.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SUPA = 'https://fake-ref.supabase.co'
const KEY = 'k_0123456789abcdef0123456789'

function world(tables = {}) {
  const calls = []
  const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } })
  async function fetchStub(input, init = {}) {
    const url = String(input); const u = new URL(url); calls.push({ url, method: (init.method || 'GET').toUpperCase() })
    if (url.startsWith('https://graph.microsoft.com/')) return jsonRes({ error: 'bad' }, 401)
    if (!url.startsWith(SUPA + '/rest/v1/')) return jsonRes({ error: 'unexpected ' + url }, 500)
    const table = u.pathname.split('/').pop()
    let rows = tables[table] || []
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
      else if (v.startsWith('gte.')) rows = rows.filter((r) => String(r[k]) >= v.slice(4))
      else if (v.startsWith('lte.')) rows = rows.filter((r) => String(r[k]) <= v.slice(4))
      else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''))); rows = rows.filter((r) => set.has(String(r[k]))) }
      else if (v === 'not.is.false') rows = rows.filter((r) => r[k] !== false)
    }
    const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, Number(lim))
    const range = (init.headers || {}).Range || (init.headers || {}).range
    if (range) { const [a, b] = String(range).split('-').map(Number); rows = rows.slice(a, b + 1) }   // selectAll pages with a Range header
    return jsonRes(rows)
  }
  const env = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', CA_API_KEYS: `claude:${KEY}, short:abc`, ASSETS: { fetch: async (u) => new Response(readFileSync(path.join(here, '../../seed', new URL(String(u)).pathname.split('/').pop())), { headers: { 'content-type': 'application/json' } }) } }
  return { env, calls, fetchStub }
}
async function run(handler, request, w) {
  const saved = globalThis.fetch; globalThis.fetch = w.fetchStub
  try { const res = await handler({ request, env: w.env }); const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null } catch { body = text } return { status: res.status, body, text, headers: res.headers } }
  finally { globalThis.fetch = saved }
}
const get = (p, headers = {}) => new Request('https://lyzr.kailash-gm.com/api/ca/' + p, { headers })
const post = (p, body, headers = {}) => new Request('https://lyzr.kailash-gm.com/api/ca/' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

const perf = [
  { day: '2026-09-01', campaign_id: 'c1', ad_id: 'a1', campaign: 'WP|Accenture|Anju|India|Lead Gen', campaign_group: 'GSI', ad_name: 'Playbook', platform: 'linkedin', impressions: 1000, clicks: 20, spend: 50, leads: 2, engagements: 30, reach: 800 },
  { day: '2026-09-02', campaign_id: 'c1', ad_id: 'a1', campaign: 'WP|Accenture|Anju|India|Lead Gen', campaign_group: 'GSI', ad_name: 'Playbook', platform: 'linkedin', impressions: 500, clicks: 5, spend: 25, leads: 0, engagements: 10, reach: 400 },
  { day: '2026-09-02', campaign_id: 'c2', ad_id: 'a2', campaign: 'Brand|Siva|US', campaign_group: 'Brand', ad_name: 'Video', platform: 'linkedin', impressions: 2000, clicks: 10, spend: 40, leads: 0, engagements: 100, reach: 1500 },
]
const uploads = [
  { id: 'u1', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', period_start: '2026-09-01', period_end: '2026-09-15', row_count: 3, notes: 'Company, Country, Job Title', uploaded_at: '2026-09-16T00:00:00Z' },
  { id: 'u2', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', period_start: '2026-09-01', period_end: '2026-09-15', row_count: 1, notes: 'Company (Anju)', uploaded_at: '2026-09-16T00:00:00Z' },
]
const demo = [
  { id: 1, upload_id: 'u1', segment: 'Company', value: 'EY', campaign: '', impressions: 7000, clicks: 70 },
  { id: 2, upload_id: 'u1', segment: 'Country', value: 'India', campaign: '', impressions: 800, clicks: 8 },
  { id: 3, upload_id: 'u1', segment: 'Job Title', value: 'Partner', campaign: '', impressions: 100, clicks: 2 },
  { id: 4, upload_id: 'u2', segment: 'Company', value: 'EY', campaign: 'Anju', impressions: 3000, clicks: 30 },
]

test('apiKeys: parses "label:key" pairs, ignores short keys; requireReader accepts bearer, header, query and path', async () => {
  const w = world()
  assert.deepEqual([...apiKeys(w.env).values()], ['claude'])
  const saved = globalThis.fetch; globalThis.fetch = w.fetchStub
  try {
    assert.equal((await requireReader(get('v1/x', { Authorization: 'Bearer ' + KEY }), w.env)).label, 'claude')
    assert.equal((await requireReader(get('v1/x', { 'x-api-key': KEY }), w.env)).label, 'claude')
    assert.equal((await requireReader(get('v1/x?key=' + KEY), w.env)).label, 'claude')
    assert.equal((await requireReader(get('mcp/' + KEY), w.env, { pathKey: KEY })).label, 'claude')
    assert.equal(await requireReader(get('v1/x', { Authorization: 'Bearer wrong' }), w.env), null)
    assert.equal(await requireReader(get('v1/x', { Authorization: 'Bearer abc' }), w.env), null, 'short keys are not accepted')
  } finally { globalThis.fetch = saved }
})

test('v1 index and openapi need no key; sources need one', async () => {
  const w = world()
  const idx = await run(v1.onRequestGet, get('v1'), w)
  assert.equal(idx.status, 200); assert.equal(idx.body.sources.length, SOURCES.length); assert.ok(idx.body.tables.ca_li_perf)
  const oa = await run(v1.onRequestGet, get('v1/openapi.json'), w)
  assert.equal(oa.status, 200); assert.equal(oa.body.openapi, '3.1.0'); assert.ok(oa.body.paths['/api/ca/v1/linkedin/penetration'])
  const no = await run(v1.onRequestGet, get('v1/linkedin/performance'), w)
  assert.equal(no.status, 401); assert.equal(no.body.error.code, 'unauthorized')
  const bad = await run(v1.onRequestGet, get('v1/nothing', { Authorization: 'Bearer ' + KEY }), w)
  assert.equal(bad.status, 404); assert.equal(bad.body.error.code, 'unknown_source')
})

test('linkedin/performance: totals, grouping, person filter, csv', async () => {
  const w = world({ ca_li_perf: perf, ca_uploads: [] })
  const tot = await run(v1.onRequestGet, get('v1/linkedin/performance?from=2026-09-01&to=2026-09-30', { 'x-api-key': KEY }), w)
  assert.equal(tot.status, 200); assert.equal(tot.body.total.impressions, 3500); assert.equal(tot.body.total.spend, 115); assert.equal(tot.body.total.leads, 2); assert.equal(tot.body.total.cpl, 57.5)
  assert.equal(tot.headers.get('x-ca-reader'), 'key:claude')
  const byDay = await run(v1.onRequestGet, get('v1/linkedin/performance?group=day&key=' + KEY), w)
  assert.deepEqual(byDay.body.rows.map((r) => r.day), ['2026-09-01', '2026-09-02']); assert.equal(byDay.body.rows[1].impressions, 2500)
  const anju = await run(v1.onRequestGet, get('v1/linkedin/performance?group=campaign&person=Anju&key=' + KEY), w)
  assert.equal(anju.body.rows.length, 1); assert.equal(anju.body.rows[0].impressions, 1500)
  const byPerson = await run(v1.onRequestGet, get('v1/linkedin/performance?group=person&key=' + KEY), w)
  assert.deepEqual(byPerson.body.rows.map((r) => r.person).sort(), ['Anju', 'Siva'])
  const badGroup = await run(v1.onRequestGet, get('v1/linkedin/performance?group=weird&key=' + KEY), w)
  assert.equal(badGroup.status, 400)
  const csv = await run(v1.onRequestGet, get('v1/linkedin/performance?group=day&format=csv&key=' + KEY), w)
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8'); assert.ok(csv.text.startsWith('day,days,impressions')); assert.equal(csv.text.split('\n').length, 3)
})

test('linkedin/demographics: windows summed, tagged exports left out unless asked, segment filter', async () => {
  const w = world({ ca_li_perf: [], ca_uploads: uploads, ca_li_demo: demo })
  const r = await run(v1.onRequestGet, get('v1/linkedin/demographics?from=2026-09-01&to=2026-09-30&key=' + KEY), w)
  assert.equal(r.status, 200); assert.equal(r.body.rows.length, 1); assert.equal(r.body.rows[0].impressions, 7000); assert.equal(r.body.windows.length, 1)
  assert.deepEqual(r.body.segments_present, ['Company', 'Country', 'Job Title'])
  const tagged = await run(v1.onRequestGet, get('v1/linkedin/demographics?tag=Anju&key=' + KEY), w)
  assert.equal(tagged.body.rows[0].impressions, 3000)
  const titles = await run(v1.onRequestGet, get('v1/linkedin/demographics?segment=Job%20Title&key=' + KEY), w)
  assert.equal(titles.body.rows[0].value, 'Partner')
  const all = await run(v1.onRequestGet, get('v1/linkedin/demographics?segment=all&key=' + KEY), w)
  assert.equal(all.body.rows.length, 3)
})

test('linkedin/penetration: same model as the dashboard, tier filter, actions', async () => {
  const w = world({ ca_li_perf: [], ca_uploads: uploads, ca_li_demo: demo, ca_settings: [] })
  const r = await run(v1.onRequestGet, get('v1/linkedin/penetration?from=2026-09-01&to=2026-09-30&key=' + KEY), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const ey = r.body.rows.find((x) => x.account === 'EY')
  assert.ok(ey, 'EY is a seeded account with an Apollo pool'); assert.equal(ey.tier, 'Big Four'); assert.equal(ey.tier_group, 'Tier 1')
  assert.ok(ey.total.All.pool > 0); assert.ok(ey.total.All.penetration_pct <= 100); assert.ok(ey.regions.India)
  assert.equal(r.body.frequency, 3.5); assert.ok(Array.isArray(r.body.actions)); assert.ok(r.body.method.includes('λ'))
  const t2 = await run(v1.onRequestGet, get('v1/linkedin/penetration?tier=Tier%202&key=' + KEY), w)
  assert.equal(t2.body.rows.length, 0)
  const md = await run(v1.onRequestGet, get('v1/linkedin/penetration?band=MD&region=India&key=' + KEY), w)
  assert.equal(typeof md.body.rows[0].total.penetration_pct, 'number'); assert.deepEqual(Object.keys(md.body.rows[0].regions), ['India'])
  const bad = await run(v1.onRequestGet, get('v1/linkedin/penetration?band=CEO&key=' + KEY), w)
  assert.equal(bad.status, 400)
})

test('hubspot/leads: form leads only, counts, funnel, field subset, offset', async () => {
  const c = (hs_id, extra) => ({ hs_id, email: hs_id + '@x.com', first_name: 'A', last_name: hs_id, company_raw: 'EY', account: 'EY', jobtitle: 'Partner', band: 'MD', country: 'India', region: 'India', lead_source: 'Book a Demo', created_at: '2026-09-05T10:00:00Z', props: { first_conversion_date: '2026-09-05' }, in_scope: true, ...extra })
  const w = world({ ca_hs_contacts: [c('1'), c('2', { band: 'MD-2', jobtitle: 'Senior Manager' }), c('3', { props: {} })], ca_settings: [] })
  const r = await run(v1.onRequestGet, get('v1/hubspot/leads?from=2026-09-01&to=2026-09-30&key=' + KEY), w)
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.total, 2, 'the contact without a form conversion is not a lead')
  assert.deepEqual(r.body.by_band, { MD: 1, 'MD-2': 1 }); assert.ok(r.body.funnel); assert.ok(r.body.rows[0].jobtitle)
  const sub = await run(v1.onRequestGet, get('v1/hubspot/leads?fields=hs_id,band&limit=1&offset=1&key=' + KEY), w)
  assert.deepEqual(Object.keys(sub.body.rows[0]).sort(), ['band', 'hs_id']); assert.equal(sub.body.rows.length, 1)
  const band = await run(v1.onRequestGet, get('v1/hubspot/leads?band=MD-2&key=' + KEY), w)
  assert.equal(band.body.total, 1)
})

test('table passthrough: whitelist, filter syntax, select and order guards', async () => {
  const w = world({ ca_actions: [{ id: 'a', title: 'T', status: 'open', channel: 'linkedin' }] })
  const ok = await run(v1.onRequestGet, get('v1/table?name=ca_actions&status=eq.open&select=id,title&order=title.asc&limit=10&key=' + KEY), w)
  assert.equal(ok.status, 200); assert.equal(ok.body.rows.length, 1); assert.equal(ok.body.table, 'ca_actions')
  const last = new URL(w.calls.at(-1).url); assert.equal(last.searchParams.get('select'), 'id,title'); assert.equal(last.searchParams.get('status'), 'eq.open'); assert.equal(last.searchParams.get('limit'), '10')
  for (const bad of ['name=ca_secret', 'name=ca_actions&status=open', 'name=ca_actions&select=id;drop', 'name=ca_actions&order=title;x', 'name=ca_actions&bad%20col=eq.1']) {
    const r = await run(v1.onRequestGet, get('v1/table?' + bad + '&key=' + KEY), w); assert.equal(r.status, 400, bad)
  }
  assert.ok(Object.keys(TABLES).every((t) => t.startsWith('ca_')))
  assert.equal(toCsv([{ a: 1, b: 'x,y' }, { a: 2, c: { z: 1 } }]), 'a,b,c\n1,"x,y",\n2,,"{""z"":1}"')
})

test('settings and actions sources; unknown setting is 404', async () => {
  const w = world({ ca_settings: [{ key: 'targets', value: { frequency: 4 } }], ca_actions: [{ id: 'a', title: 'T', status: 'open', channel: 'linkedin', created_at: '2026-09-01' }] })
  const s = await run(v1.onRequestGet, get('v1/settings?name=targets&key=' + KEY), w)
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.value.frequency, 4)
  const t = await run(v1.onRequestGet, get('v1/settings?key=' + KEY + '&name=regions'), w)
  assert.equal(t.status, 200, JSON.stringify(t.body)); assert.ok(t.body.value.India)
  const none = await run(v1.onRequestGet, get('v1/settings?name=nothing&key=' + KEY), w)
  assert.equal(none.status, 404)
  const a = await run(v1.onRequestGet, get('v1/actions?status=open', { Authorization: 'Bearer ' + KEY }), w)
  assert.equal(a.body.row_count, 1)
  await assert.rejects(() => runSource(w.env, get('v1/x'), 'settings', { name: '' }), (e) => e instanceof QueryError && e.status === 400)
})

test('MCP: initialize without a key, tools need one; tools/list mirrors the sources; tools/call returns text + structured', async () => {
  const w = world({ ca_li_perf: perf, ca_uploads: [] })
  const init = await run(mcp.onRequestPost, post('mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } }), w)
  assert.equal(init.status, 200); assert.equal(init.body.result.protocolVersion, '2025-06-18'); assert.equal(init.body.result.serverInfo.name, 'lyzr-campaign-analytics')
  const note = await run(mcp.onRequestPost, post('mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }), w)
  assert.equal(note.status, 202)
  const noKey = await run(mcp.onRequestPost, post('mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }), w)
  assert.equal(noKey.status, 401); assert.equal(noKey.body.error.code, -32001)
  const list = await run(mcp.onRequestPost, post('mcp/' + KEY, { jsonrpc: '2.0', id: 3, method: 'tools/list' }), w)
  assert.equal(list.status, 200); assert.deepEqual(list.body.result.tools.map((t) => t.name), SOURCES.map((s) => s.name.replace(/\//g, '_')))
  assert.ok(list.body.result.tools.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === 'object'))
  const call = await run(mcp.onRequestPost, post('mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'linkedin_performance', arguments: { group: 'day', from: '2026-09-01', to: '2026-09-30' } } }, { Authorization: 'Bearer ' + KEY }), w)
  assert.equal(call.status, 200); assert.equal(call.body.result.structuredContent.rows.length, 2); assert.ok(JSON.parse(call.body.result.content[0].text).total.impressions === 3500)
  const bad = await run(mcp.onRequestPost, post('mcp', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } }, { 'x-api-key': KEY }), w)
  assert.equal(bad.body.result.isError, true)
  const missing = await run(mcp.onRequestPost, post('mcp', { jsonrpc: '2.0', id: 6, method: 'resources/read' }, { 'x-api-key': KEY }), w)
  assert.equal(missing.body.error.code, -32601)
  const batch = await run(mcp.onRequestPost, post('mcp', [{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', id: 8, method: 'tools/list' }], { 'x-api-key': KEY }), w)
  assert.equal(batch.body.length, 2)
  const parse = await run(mcp.onRequestPost, new Request('https://lyzr.kailash-gm.com/api/ca/mcp', { method: 'POST', body: '{nope' }), w)
  assert.equal(parse.status, 400)
  const info = await run(mcp.onRequestGet, get('mcp'), w)
  assert.equal(info.status, 200); assert.ok(info.body.tools.includes('table'))
})

test('MCP: oversized tool results are cut to the biggest row prefix that fits', async () => {
  const big = Array.from({ length: 6000 }, (_, i) => ({ day: '2026-09-01', campaign_id: 'c' + i, ad_id: 'a', campaign: 'Camp ' + i + ' ' + 'x'.repeat(40), ad_name: 'Ad ' + i, platform: 'linkedin', impressions: 10, clicks: 1, spend: 1, leads: 0 }))
  const w = world({ ca_li_perf: big, ca_uploads: [] })
  const saved = globalThis.fetch; globalThis.fetch = w.fetchStub
  try {
    const r = await mcp.callTool(w.env, get('mcp'), 'linkedin_performance', { group: 'ad', limit: '5000' })
    assert.ok(r.content[0].text.length <= mcp.MAX_TEXT + 100)
    const parsed = JSON.parse(r.content[0].text); assert.equal(parsed.truncated, true); assert.ok(parsed.rows.length < 5000 && parsed.rows.length > 0)
  } finally { globalThis.fetch = saved }
})
