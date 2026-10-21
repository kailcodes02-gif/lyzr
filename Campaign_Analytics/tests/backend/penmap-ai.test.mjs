// /api/ca/penmap-ai: Claude Sonnet plan for the penetration map, cached per input hash. Stubbed fetch only.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as pm from '../../../functions/api/ca/penmap-ai.js'
import * as insights from '../../../functions/api/ca/insights.js'

const SUPA = 'https://fake-ref.supabase.co'
const env = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', ANTHROPIC_API_KEY: 'sk-test' }
const jsonRes = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
const PLAN = {
  headlines: [{ title: 'Heat-map targeting works', body: 'It made 40 leads at $44 CPL — cheap.', tone: 'good' }],
  worked: [{ label: 'Heat-map native', adsets: ['Native Targeting(Heatmap)|GSI|Playbooks-2 Sept\'26'], mode: 'lead_gen', why: 'Lowest CPL.' }],
  did_not_work: [], do: ['Scale the heat-map set outside India.'], dont: ['Do not clone single countries.'],
  plan: { title: 'Non-India', rows: [{ key: 'L1', objective: 'Lead gen', name: 'Heat-map playbooks', targeting: 'x', benchmark: 'Heat-map set $44 CPL', share: 0.5, cpl_low: 35, cpl_high: 60 }, { key: 'T1', objective: 'Video views', name: 'US video', targeting: 'y', benchmark: 'ME video $11.5 CPM', share: 0.5, cpm_low: 11, cpm_high: 14 }, { key: 'X', objective: 'Lead gen', name: 'no range', targeting: '', benchmark: '', share: 0.1 }] },
  setup_steps: ['Pause the clones.'], day3_rules: ['CPL above $75: narrow.'], target_accounts: [{ account: 'EY', region: 'US', why: 'Biggest gap.' }], summary: 'Fine.',
}

function stub({ cached = null } = {}) {
  const calls = []; const store = { row: cached }
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, method: init.method || 'GET', body })
    if (url.startsWith('https://graph.microsoft.com/')) return jsonRes({ displayName: 'Subs', mail: 'subs@lyzr.com' })
    if (url.startsWith(SUPA)) {
      if ((init.method || 'GET') === 'GET') return jsonRes(store.row ? [store.row] : [])
      store.row = Array.isArray(body) ? body[0] : body; return jsonRes([store.row], 201)
    }
    if (url.startsWith('https://api.anthropic.com/')) return jsonRes({ model: 'claude-sonnet-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'penmap_plan', input: PLAN }], usage: { input_tokens: 10 } })
    throw new Error('unexpected fetch ' + url)
  }
  return { calls, store }
}
const req = (method, body, qs = '') => new Request('https://x.test/api/ca/penmap-ai' + qs, { method, headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

test('POST calls Claude Sonnet with the forced penmap_plan tool and caches the cleaned plan', async () => {
  const { calls, store } = stub()
  const res = await pm.onRequestPost({ request: req('POST', { input: { a: 1 } }), env })
  assert.equal(res.status, 200)
  const out = await res.json()
  const ai = calls.find((c) => c.url.startsWith('https://api.anthropic.com/'))
  assert.equal(ai.body.model, 'claude-sonnet-5')
  assert.deepEqual(ai.body.tool_choice, { type: 'tool', name: 'penmap_plan', disable_parallel_tool_use: true })
  assert.equal(out.cached, false)
  assert.equal(out.content.plan.rows.length, 2, 'rows without a CPL or CPM range are dropped')
  assert.ok(!out.content.headlines[0].body.includes('—'), 'em dashes are removed')
  assert.equal(store.row.scope, 'penmap:main')
  // same input again: served from the cache, no second model call
  const res2 = await pm.onRequestPost({ request: req('POST', { input: { a: 1 } }), env })
  const out2 = await res2.json()
  assert.equal(out2.cached, true)
  assert.equal(calls.filter((c) => c.url.startsWith('https://api.anthropic.com/')).length, 1)
})

test('scope must start with penmap:', async () => {
  stub()
  const res = await pm.onRequestPost({ request: req('POST', { scope: '_li_oauth', input: {} }), env })
  assert.equal(res.status, 400)
})

test('GET returns the cached plan or 404', async () => {
  stub()
  assert.equal((await pm.onRequestGet({ request: req('GET', null, '?scope=penmap:main'), env })).status, 404)
  stub({ cached: { scope: 'penmap:main', content: { plan: { rows: [] } }, created_at: '2026-10-21T00:00:00Z', model: 'claude-sonnet-5' } })
  const r = await pm.onRequestGet({ request: req('GET', null, '?scope=penmap:main'), env })
  assert.equal(r.status, 200)
})

test('insights never serves private "_" scopes and refuses reserved document scopes', async () => {
  stub({ cached: { scope: '_li_oauth', content: { access_token: 'secret' } } })
  const r = await insights.onRequestGet({ request: new Request('https://x.test/api/ca/insights?scope=_li_oauth', { headers: { Authorization: 'Bearer tok' } }), env })
  assert.equal(r.status, 404)
  assert.ok(!(await r.text()).includes('secret'))
  for (const scope of ['_li_oauth', 'leads:abc', 'screen:abc']) {
    const p = await insights.onRequestPost({ request: new Request('https://x.test/api/ca/insights', { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, kind: 'ads', input: {} }) }), env })
    assert.equal(p.status, 400, scope)
  }
})
