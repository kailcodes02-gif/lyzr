// PhantomBuster handler tests with a stubbed fetch: no real Graph, Supabase or
// PhantomBuster calls. node --test 'Campaign_Analytics/tests/backend/*.test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'

import * as sync from '../../../functions/api/ca/phantom/sync.js'
import * as phantom from '../../../functions/api/ca/phantom/index.js'

const SUPA = 'https://fake-ref.supabase.co'
const PB = 'https://api.phantombuster.com/api/v2'
const S3 = 'https://phantombuster.s3.amazonaws.com/x/y/result.json'

// ---- fake world ------------------------------------------------------------
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
      assert.equal(headers.apikey, 'service-key')
      if (method === 'GET') {
        let rows = tables[table] || []
        for (const [k, v] of u.searchParams) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue
          if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
          else if (v.startsWith('gte.')) rows = rows.filter((r) => String(r[k]) >= v.slice(4))
          else if (v.startsWith('lte.')) rows = rows.filter((r) => String(r[k]) <= v.slice(4))
        }
        const limit = u.searchParams.get('limit')
        if (limit) rows = rows.slice(0, Number(limit))
        return jsonRes(rows)
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]
        const withIds = rows.map((r, i) => ({ id: `id-${table}-${(tables[table] || []).length + i + 1}`, ...r }))
        // upserts replace by primary key so the fake table looks like the real one
        const key = u.searchParams.get('on_conflict')
        const list = tables[table] || []
        if (key) { const ks = key.split(','); tables[table] = [...list.filter((r) => !withIds.some((w) => ks.every((k) => String(w[k]) === String(r[k])))), ...withIds] }
        else tables[table] = [...list, ...withIds]
        return String(headers.Prefer || '').includes('return=representation') ? jsonRes(withIds, 201) : new Response(null, { status: 201 })
      }
      if (method === 'PATCH') {
        const id = (u.searchParams.get('id') || '').replace('eq.', '')
        for (const r of tables[table] || []) if (String(r.id) === id) Object.assign(r, body)
        return new Response(null, { status: 204 })
      }
      if (method === 'DELETE') return new Response(null, { status: 204 })
    }
    if (url.startsWith(PB) || url.startsWith('https://phantombuster.s3.amazonaws.com/')) {
      assert.equal(method, 'GET', 'never writes to PhantomBuster')
      if (url.startsWith(PB)) assert.equal(headers['X-Phantombuster-Key'], 'pb-key', 'sends the key header')
      if (opts.phantom) return opts.phantom({ url, method, headers, jsonRes })
      return jsonRes([])
    }
    throw new Error('unexpected fetch ' + url)
  }

  const env = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', PHANTOMBUSTER_API_KEY: 'pb-key', CA_CRON_SECRET: 'cron-secret-123', ...(opts.env || {}) }
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
  } finally { globalThis.fetch = saved }
}

// A workspace: two outreach phantoms, one export phantom (pulled, never counted).
const AGENTS = [
  { id: '111', name: 'Agentic Roadmap Phantom', script: 'LinkedIn Outreach.js', scriptId: '4545709793535249', lastEndType: 'finished', lastEndedAt: 1790795951026, createdAt: 1780000000000, launchType: 'repeatedly', nbContainersRunning: 0, manifest: { huge: 'x'.repeat(50) } },
  { id: '222', name: 'LinkedIn Auto Connect', script: 'LinkedIn Auto Connect.js', scriptId: '2818', lastEndType: 'finished', lastEndedAt: 1790768104655, createdAt: 1780000000000, launchType: 'manually', nbContainersRunning: 1 },
  { id: '333', name: 'LinkedIn Connections Export', script: 'LinkedIn Connections Export.js', scriptId: '12670', lastEndType: 'finished', lastEndedAt: 1790000000000, createdAt: 1780000000000 },
]
const CONTAINERS = {
  111: [{ id: 'c1', status: 'finished', createdAt: 1790795850656, endedAt: 1790795951026, endType: 'finished', exitCode: 0, launchType: 'scheduled repeatedly' }, { id: 'c0', status: 'finished', createdAt: 1790700000000, endedAt: 1790700100000, endType: 'finished', exitCode: 0 }],
  222: [{ id: 'c2', status: 'finished', createdAt: 1790767842387, endedAt: 1790768104655, endType: 'finished', exitCode: 0 }, { id: 'c9', status: 'running', createdAt: 1790800000000 }],
}
const OUTREACH_ROWS = [
  { profileUrl: 'u1', status: 'Not invited yet' },
  { profileUrl: 'u2', status: 'Not invited yet', connectionDegree: '1st' },
  { profileUrl: 'u3', status: 'Invitation sent', invitationSent: 'YES', connectionDegree: '2nd' },
  { profileUrl: 'u4', status: 'Request accepted', invitationSent: 'YES', connectionDegree: '1st' },
  { profileUrl: 'u5', status: '1st follow-up sent', invitationSent: 'YES', connectionDegree: '1st' },
  { profileUrl: 'u6', status: "Couldn't invite", invitationSent: 'NO' },
]
const AUTOCONNECT_ROWS = [{ fullName: 'A', connectionDegree: '2nd', timestamp: '2026-09-30T11:32:07Z' }, { fullName: 'B', connectionDegree: '2nd' }, { fullName: 'C', connectionDegree: '1st' }]

function phantomApi({ url, jsonRes }) {
  if (url.endsWith('/agents/fetch-all')) return jsonRes(AGENTS)
  if (url.includes('/containers/fetch-all?')) { const id = new URL(url).searchParams.get('agentId'); assert.equal(new URL(url).searchParams.get('mode'), 'finalized'); return jsonRes({ containers: CONTAINERS[id] || [], maxLimitReached: false }) }
  if (url.includes('/containers/fetch-result-object?')) {
    const id = new URL(url).searchParams.get('id')
    if (id === 'c1') return jsonRes({ resultObject: JSON.stringify({ csvURL: 'https://phantombuster.s3.amazonaws.com/x/y/result.csv', jsonUrl: S3 }) })
    if (id === 'c2') return jsonRes({ resultObject: JSON.stringify(AUTOCONNECT_ROWS) })
    if (id === 'c0') return jsonRes({ resultObject: null })
    return jsonRes({ error: 'not found' }, 404)
  }
  if (url === S3) return jsonRes(OUTREACH_ROWS)
  throw new Error('unexpected phantom url ' + url)
}

// ---- tests -----------------------------------------------------------------
test('phantom sync: 401 without a token or with a wrong cron secret, 403 for viewers, 503 without the key', async () => {
  const w = world()
  assert.equal((await run(sync.onRequestPost, req('POST', 'phantom/sync', { token: null, body: {} }), w)).status, 401)
  assert.equal((await run(sync.onRequestPost, req('POST', 'phantom/sync', { token: null, cron: 'wrong-secret-12', body: {} }), w)).status, 401)
  assert.equal((await run(sync.onRequestPost, req('POST', 'phantom/sync', { token: 'tok-viewer', body: {} }), w)).status, 403)
  const noKey = world({ env: { PHANTOMBUSTER_API_KEY: '' } })
  const r = await run(sync.onRequestPost, req('POST', 'phantom/sync', { body: {} }), noKey)
  assert.equal(r.status, 503)
  assert.match(r.body.error, /PHANTOMBUSTER_API_KEY/)
  assert.equal(noKey.calls.filter((c) => c.url.startsWith(PB)).length, 0, 'no PhantomBuster call without the key')
})

test('phantom sync: agents upserted (manifest dropped), only outreach phantoms queued, runs counted from result object or S3 file, cron accepted, read-only', async () => {
  const w = world({ tables: { ca_settings: [], ca_pb_sync: [], ca_pb_runs: [] }, phantom: phantomApi })
  const a = await run(sync.onRequestPost, req('POST', 'phantom/sync', { token: null, cron: 'cron-secret-123', body: {} }), w)
  assert.equal(a.status, 200)
  assert.equal(a.body.done, false)
  assert.equal(a.body.agents, 3)
  assert.deepEqual(a.body.progress, { phase: 'runs', done: 0, total: 2 })
  const up = w.calls.find((c) => c.url.includes('/ca_pb_agents') && c.method === 'POST')
  assert.equal(up.body.length, 3)
  assert.deepEqual(Object.keys(up.body[0]).sort(), ['id', 'last_run_at', 'name', 'raw', 'script', 'status', 'synced_at'])
  assert.equal(up.body[0].raw.manifest, undefined, 'manifest is not stored')
  assert.equal(up.body[0].last_run_at, '2026-09-30T19:19:11.026Z', 'ms epoch becomes ISO')
  assert.equal(up.body[1].status, 'running', 'a live container shows as running')
  assert.equal(up.body[2].status, 'finished')
  assert.deepEqual(a.body.cursor.queue, [{ id: '111', assume: false }, { id: '222', assume: true }], 'export phantoms are not walked')
  assert.equal(w.tables.ca_pb_sync[0].agents, 3)

  const b = await run(sync.onRequestPost, req('POST', 'phantom/sync', { token: null, cron: 'cron-secret-123', body: { cursor: a.body.cursor } }), w)
  assert.equal(b.status, 200)
  assert.equal(b.body.done, true, 'three runs fit in one budget')
  assert.equal(b.body.runs, 3)
  const runs = w.tables.ca_pb_runs
  assert.deepEqual(Object.keys(runs[0]).sort(), ['accepted', 'agent_id', 'ended_at', 'id', 'invites_sent', 'launched_at', 'messages_sent', 'profiles', 'raw', 'replies', 'status', 'synced_at'])
  const byId = Object.fromEntries(runs.map((r) => [r.id, r]))
  assert.deepEqual([byId.c1.profiles, byId.c1.invites_sent, byId.c1.accepted, byId.c1.messages_sent, byId.c1.replies], [6, 3, 2, 1, 0], 'Outreach file: status text and 1st degree')
  assert.deepEqual([byId.c2.profiles, byId.c2.invites_sent, byId.c2.accepted], [3, 3, 1], 'Auto Connect: every row is an invite')
  assert.deepEqual([byId.c0.profiles, byId.c0.invites_sent], [0, 0], 'empty result object counts nothing')
  assert.equal(byId.c1.agent_id, '111'); assert.equal(byId.c1.launched_at, '2026-09-30T19:17:30.656Z'); assert.equal(byId.c1.status, 'finished')
  assert.equal(runs.some((r) => r.id === 'c9'), false, 'running containers are skipped until finalized')
  // daily rollup by IST launch day: c1 launched 19:17 UTC on 30 Sep = 00:47 IST on 1 Oct
  const daily = w.calls.filter((c) => c.url.includes('/ca_pb_daily') && c.method === 'POST').flatMap((c) => c.body)
  assert.deepEqual(daily.map((d) => [d.agent_id, d.day, d.invites_sent, d.accepted]).sort(), [['111', '2026-09-29', 0, 0], ['111', '2026-10-01', 3, 2], ['222', '2026-09-30', 3, 1]])
  assert.deepEqual(Object.keys(daily[0]).sort(), ['accepted', 'agent_id', 'day', 'invites_sent', 'messages_sent', 'profiles', 'replies', 'synced_at'])
  const s = w.tables.ca_pb_sync[0]
  assert.equal(s.status, 'done'); assert.equal(s.runs, 3); assert.ok(s.finished_at)
  // read-only: every upstream call was a GET, and only the documented endpoints
  const pbCalls = w.calls.filter((c) => c.url.startsWith(PB) || c.url === S3)
  assert.ok(pbCalls.length > 0 && pbCalls.every((c) => c.method === 'GET'))
  assert.deepEqual([...new Set(pbCalls.map((c) => c.url.startsWith(PB) ? new URL(c.url).pathname.replace('/api/v2', '') : 's3'))].sort(), ['/agents/fetch-all', '/containers/fetch-all', '/containers/fetch-result-object', 's3'])
  assert.ok(pbCalls.every((c) => c.url === S3 || c.headers['X-Phantombuster-Key'] === 'pb-key'))
  // a second sync skips the runs it already stored
  const c = await run(sync.onRequestPost, req('POST', 'phantom/sync', { body: {} }), w)
  const d = await run(sync.onRequestPost, req('POST', 'phantom/sync', { body: { cursor: c.body.cursor } }), w)
  assert.equal(d.body.done, true); assert.equal(d.body.runs, 0)
  assert.equal(w.calls.filter((x) => x.url.includes('/containers/fetch-result-object')).length, 3, 'no result object is fetched twice')
})

test('phantom sync: the call budget splits the run walk across invocations and the cursor resumes', async () => {
  // 30 outreach phantoms with one run each: step 2 lists phantoms and reads results until 20 calls are spent
  const agents = Array.from({ length: 30 }, (_, i) => ({ id: 'a' + i, name: 'Auto Connect ' + i, script: 'LinkedIn Auto Connect.js', lastEndType: 'finished', lastEndedAt: 1790700000000 + i }))
  const w = world({ tables: { ca_settings: [], ca_pb_sync: [], ca_pb_runs: [] }, phantom: ({ url, jsonRes }) => {
    if (url.endsWith('/agents/fetch-all')) return jsonRes({ data: agents })   // wrapped shape
    if (url.includes('/containers/fetch-all?')) { const id = new URL(url).searchParams.get('agentId'); return jsonRes({ containers: [{ id: 'run-' + id, status: 'finished', createdAt: 1790700000000, endedAt: 1790700100000, endType: 'finished' }] }) }
    if (url.includes('/containers/fetch-result-object?')) return jsonRes({ resultObject: JSON.stringify([{ fullName: 'x' }, { fullName: 'y' }]) })
    throw new Error('unexpected ' + url)
  } })
  const a = await run(sync.onRequestPost, req('POST', 'phantom/sync', { body: {} }), w)
  assert.equal(a.body.agents, 30); assert.equal(a.body.progress.total, 30)
  let cursor = a.body.cursor, res, guard = 0
  const perCall = []
  do {
    const before = w.calls.filter((c) => c.url.startsWith(PB)).length
    res = await run(sync.onRequestPost, req('POST', 'phantom/sync', { body: { cursor } }), w)
    assert.equal(res.status, 200)
    perCall.push(w.calls.filter((c) => c.url.startsWith(PB)).length - before)
    cursor = res.body.cursor
  } while (!res.body.done && ++guard < 20)
  assert.equal(res.body.done, true)
  assert.equal(res.body.runs, 30)
  assert.ok(perCall.every((n) => n <= sync.CALL_BUDGET), 'never more than the budget per invocation: ' + perCall)
  assert.ok(perCall.length >= 3, 'took several invocations: ' + perCall)
  assert.equal(w.tables.ca_pb_runs.length, 30)
  assert.ok(w.tables.ca_pb_runs.every((r) => r.profiles === 2 && r.invites_sent === 2))
  assert.equal(res.body.progress.phase, 'done')
})

test('phantom sync: an upstream failure marks the sync row as error', async () => {
  const w = world({ tables: { ca_settings: [], ca_pb_sync: [] }, phantom: ({ jsonRes }) => jsonRes({ error: 'nope' }, 500) })
  const r = await run(sync.onRequestPost, req('POST', 'phantom/sync', { body: {} }), w)
  assert.equal(r.status, 500)
  assert.match(r.body.error, /PhantomBuster 500/)
  assert.equal(w.tables.ca_pb_sync[0].status, 'error')
})

test('phantom sync helpers: parseResult, listOf, countRows, mapAgent, rollupDaily', () => {
  assert.deepEqual(sync.parseResult({ resultObject: '[{"a":1}]' }), { rows: [{ a: 1 }] })
  assert.deepEqual(sync.parseResult({ resultObject: JSON.stringify({ csvURL: 'x', jsonUrl: S3 }) }), { jsonUrl: S3 })
  assert.deepEqual(sync.parseResult({ resultObject: null }), { rows: [] })
  assert.deepEqual(sync.parseResult({ resultObject: 'not json' }), { rows: [] })
  assert.deepEqual(sync.parseResult([{ b: 2 }]), { rows: [{ b: 2 }] })
  assert.deepEqual(sync.parseResult({ resultObject: { data: [{ c: 3 }] } }), { rows: [{ c: 3 }] })
  assert.deepEqual(sync.listOf({ agents: [1] }, 'agents'), [1]); assert.deepEqual(sync.listOf(null), [])
  assert.deepEqual(sync.countRows(OUTREACH_ROWS), { profiles: 6, invites_sent: 3, accepted: 2, messages_sent: 1, replies: 0 })
  assert.deepEqual(sync.countRows(AUTOCONNECT_ROWS, { assumeInvite: true }), { profiles: 3, invites_sent: 3, accepted: 1, messages_sent: 0, replies: 0 })
  assert.deepEqual(sync.countRows([{ inviteSent: true, accepted: 'Success', messageSent: 'YES', replied: true }]), { profiles: 1, invites_sent: 1, accepted: 1, messages_sent: 1, replies: 1 })
  const m = sync.mapAgent(AGENTS[0], 'T')
  assert.equal(m.raw.manifest, undefined); assert.equal(m.script, 'LinkedIn Outreach.js'); assert.equal(m.status, 'finished')
  assert.equal(sync.dayIST('2026-09-29T19:00:00Z'), '2026-09-30')
  assert.deepEqual(sync.rollupDaily([{ agent_id: 'a', launched_at: '2026-09-29T04:00:00Z', profiles: 1, invites_sent: 1 }, { agent_id: 'a', launched_at: '2026-09-29T09:00:00Z', profiles: 2, invites_sent: 0, accepted: 1 }], 'T'), [{ agent_id: 'a', day: '2026-09-29', profiles: 3, invites_sent: 1, accepted: 1, messages_sent: 0, replies: 0, synced_at: 'T' }])
})

test('phantom GET: agents, runs in the IST range, all daily rows, last sync, configured flag; 401 without a token', async () => {
  const tables = {
    ca_settings: [],
    ca_pb_agents: [{ id: '111', name: 'Agentic Roadmap Phantom', script: 'LinkedIn Outreach.js', last_run_at: '2026-09-30T14:39:11Z', status: 'finished', synced_at: 'T' }],
    ca_pb_runs: [
      { id: 'c1', agent_id: '111', launched_at: '2026-09-30T14:37:30.656Z', status: 'finished', profiles: 6, invites_sent: 3, accepted: 2, messages_sent: 1, replies: 0 },
      { id: 'c0', agent_id: '111', launched_at: '2026-09-01T04:00:00.000Z', status: 'finished', profiles: 1, invites_sent: 1, accepted: 0, messages_sent: 0, replies: 0 },
    ],
    ca_pb_daily: [{ agent_id: '111', day: '2026-09-01', profiles: 1, invites_sent: 1, accepted: 0, messages_sent: 0, replies: 0 }, { agent_id: '111', day: '2026-09-30', profiles: 6, invites_sent: 3, accepted: 2, messages_sent: 1, replies: 0 }],
    ca_pb_sync: [{ id: 's1', status: 'done', started_at: '2026-09-30T01:30:00Z', finished_at: '2026-09-30T01:35:00Z', agents: 3, runs: 3 }],
  }
  const w = world({ tables })
  assert.equal((await run(phantom.onRequestGet, req('GET', 'phantom?from=2026-09-20&to=2026-09-30', { token: null }), w)).status, 401)
  const r = await run(phantom.onRequestGet, req('GET', 'phantom?from=2026-09-20&to=2026-09-30', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200)
  assert.deepEqual(Object.keys(r.body).sort(), ['agents', 'configured', 'daily', 'from', 'last_sync', 'runs', 'to'])
  assert.equal(r.body.agents.length, 1)
  assert.deepEqual(r.body.runs.map((x) => x.id), ['c1'], 'runs are filtered by launch day')
  assert.equal(r.body.daily.length, 2, 'daily is the whole history')
  assert.equal(r.body.last_sync.status, 'done')
  assert.equal(r.body.configured, true)
  assert.equal(r.body.from, '2026-09-20')
  const q = w.calls.find((c) => c.url.includes('/ca_pb_runs'))
  assert.ok(decodeURIComponent(q.url).includes('gte.2026-09-20T00:00:00+05:30'), 'range applied as IST days')
  const off = world({ tables, env: { PHANTOMBUSTER_API_KEY: '' } })
  assert.equal((await run(phantom.onRequestGet, req('GET', 'phantom?from=2026-09-20&to=2026-09-30'), off)).body.configured, false)
  assert.equal((await run(phantom.onRequestGet, req('GET', 'phantom?from=bad&to=2026-09-30'), w)).body.from, '2026-01-01', 'a bad date falls back')
})

test('phantom handlers answer OPTIONS with CORS headers', async () => {
  for (const h of [sync.onRequestOptions, phantom.onRequestOptions]) {
    const res = await h()
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  }
})
