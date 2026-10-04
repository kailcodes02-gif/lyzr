// node --test 'Campaign_Analytics/tests/backend/*.test.mjs'
// The 'leads' phase of POST /api/ca/instantly/sync: every lead of every GSI
// campaign into ca_em_leads. Stubbed fetch: no real Instantly or Supabase calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as isync from '../../../functions/api/ca/instantly/sync.js'
import { mapLead, LEADS_BUDGET, LEADS_PAGE_SIZE } from '../../../functions/api/ca/instantly/sync.js'
import { instantlyLeadsByEmail } from '../../js/mock/email.mjs'
import { hubspotMock } from '../../js/mock/hubspot.mjs'

const SUPA = 'https://fake-ref.supabase.co'
const j = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

// campaigns: [{ id, name, leads: n }] tagged GSI; `others` sit in the workspace untagged.
function world({ campaigns, others = [], leadsTable = true, pageSize = LEADS_PAGE_SIZE } = {}) {
  const calls = []
  const upserts = []
  const leadsFor = new Map(campaigns.map((c) => [c.id, Array.from({ length: c.leads }, (_, i) => ({
    id: `${c.id}-L${i}`,
    email: i % 3 === 0 ? `Person.${i}@${c.id.toUpperCase()}.Example` : `person.${i}@${c.id}.example`,
    status: i % 4 === 0 ? 3 : 1,
    lt_interest_status: i === 1 ? 1 : undefined,
    email_open_count: i % 2,
    email_reply_count: i === 1 ? 2 : 0,
    email_click_count: i === 2 ? 1 : 0,
    timestamp_created: '2026-09-01T10:00:00.000Z',
    timestamp_last_reply: i === 1 ? '2026-09-10T12:00:00.000Z' : undefined,
    campaign: c.id,
  }))]))
  async function fetchStub(input, init = {}) {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body })
    if (url.startsWith(SUPA + '/rest/v1/')) {
      const table = new URL(url).pathname.split('/').pop()
      if (method === 'POST' && table === 'ca_em_sync') return j([{ id: 'sync-1', ...body[0] }], 201)
      if (method === 'POST') {
        if (table === 'ca_em_leads' && !leadsTable) return j({ code: 'PGRST205', message: "Could not find the table 'public.ca_em_leads' in the schema cache" }, 404)
        upserts.push({ table, url, rows: body })
        return new Response(null, { status: 201 })
      }
      if (method === 'PATCH') return new Response(null, { status: 204 })
      return j([])
    }
    if (url.startsWith('https://api.instantly.ai/api/v2')) {
      const path = url.slice('https://api.instantly.ai/api/v2'.length)
      if (path === '/leads/list') {
        assert.equal(method, 'POST')
        assert.ok(!('campaign_id' in body), 'Instantly v2 takes `campaign`, not `campaign_id`')
        const all = leadsFor.get(body.campaign)
        assert.ok(all, 'only GSI campaigns are paged: ' + body.campaign)
        assert.equal(body.limit, LEADS_PAGE_SIZE)
        const start = body.starting_after ? all.findIndex((l) => l.id === body.starting_after) + 1 : 0
        const items = all.slice(start, start + pageSize)
        const last = items.at(-1)
        return j({ items, next_starting_after: items.length === pageSize && start + pageSize < all.length ? last.id : (items.length ? last.id : undefined) })
      }
      assert.equal(method, 'GET', 'never writes to Instantly')
      if (path.startsWith('/campaigns?tag_ids=')) return j({ items: campaigns.map((c) => ({ id: c.id, name: c.name, status: 1, timestamp_created: '2026-09-01T00:00:00Z' })) })
      if (path === '/campaigns/analytics') return j([...campaigns, ...others].map((c) => ({ campaign_id: c.id, campaign_name: c.name, emails_sent_count: 10 })))
      if (path.startsWith('/campaigns/analytics/daily')) return j([])
      throw new Error('unexpected Instantly call ' + path)
    }
    throw new Error('unexpected fetch ' + url)
  }
  const env = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', INSTANTLY_API_KEY: 'ik', CA_CRON_SECRET: 'cron-secret-123' }
  return { calls, upserts, env, fetchStub }
}

async function call(w, body) {
  const saved = globalThis.fetch
  globalThis.fetch = w.fetchStub
  try {
    const request = new Request('https://lyzr.kailash-gm.com/api/ca/instantly/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CA-Cron': 'cron-secret-123' }, body: JSON.stringify(body) })
    const res = await isync.onRequestPost({ request, env: w.env })
    return { status: res.status, body: JSON.parse(await res.text()) }
  } finally { globalThis.fetch = saved }
}

// run the whole sync to the end, returning every response
async function runAll(w, max = 100) {
  const out = []
  let body = {}
  for (let i = 0; i < max; i++) {
    const r = await call(w, body)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    out.push(r)
    if (r.body.done) return out
    body = { cursor: r.body.cursor }
  }
  throw new Error('sync did not finish')
}

const leadRows = (w) => w.upserts.filter((u) => u.table === 'ca_em_leads').flatMap((u) => u.rows)
const leadCalls = (w) => w.calls.filter((c) => c.url.endsWith('/leads/list'))

test('mapLead: contract shape, lower-cased email, Instantly field names mapped', () => {
  const r = mapLead({ email: '  Jane.Doe@Acme.Example ', status: 1, lt_interest_status: 2, email_open_count: 4, email_reply_count: '1', email_click_count: null, timestamp_created: '2026-09-01T00:00:00Z', timestamp_last_reply: '2026-09-03T00:00:00Z' }, { id: 'c1', name: 'GSI_A' }, 'now')
  assert.deepEqual(r, { email: 'jane.doe@acme.example', campaign_id: 'c1', campaign_name: 'GSI_A', gsi: true, status: 1, interest_status: 2, open_count: 4, reply_count: 1, click_count: 0, created_at: '2026-09-01T00:00:00Z', last_reply_at: '2026-09-03T00:00:00Z', synced_at: 'now' })
  const bare = mapLead({ email: 'x@y.example' }, { id: 7 }, 'now')
  assert.deepEqual([bare.campaign_id, bare.campaign_name, bare.status, bare.interest_status, bare.last_reply_at, bare.created_at], ['7', null, null, null, null, null])
  assert.equal(mapLead({ email: '' }, { id: 'c1' }, 'now'), null)
  assert.equal(mapLead({ email: 'not-an-email' }, { id: 'c1' }, 'now'), null)
  assert.equal(mapLead(null, { id: 'c1' }, 'now'), null)
})

test('leads phase: pages through every GSI campaign, only GSI campaigns, upsert keyed on campaign_id,email', async () => {
  const w = world({ campaigns: [{ id: 'g1', name: 'GSI_One', leads: 250 }, { id: 'g2', name: 'GSI_Two', leads: 0 }, { id: 'g3', name: 'GSI_Three', leads: 100 }], others: [{ id: 'w1', name: 'Fintech CFOs', leads: 500 }] })
  const all = await runAll(w)
  const last = all.at(-1).body
  assert.equal(last.done, true)
  assert.equal(last.leads, 350)
  assert.equal(last.progress.phase, 'done')
  // the response before the leads phase starts announces it
  const handover = all.find((r) => r.body.progress.phase === 'leads')
  assert.deepEqual(handover.body.progress, { phase: 'leads', done: 0, total: 3 })
  // the mock hands back a cursor until a page comes back empty, so every campaign ends on an empty page
  const byCamp = leadCalls(w).reduce((o, c) => { o[c.body.campaign] = (o[c.body.campaign] || 0) + 1; return o }, {})
  assert.deepEqual(Object.keys(byCamp).sort(), ['g1', 'g2', 'g3'])
  assert.equal(byCamp.g1, 4, '100 + 100 + 50, then one empty page: a short page alone does not end a campaign')
  assert.equal(byCamp.g2, 1)
  // second page of g1 resumes after the last id of the first page
  const g1 = leadCalls(w).filter((c) => c.body.campaign === 'g1')
  assert.equal(g1[0].body.starting_after, undefined)
  assert.equal(g1[1].body.starting_after, 'g1-L99')
  const rows = leadRows(w)
  assert.equal(rows.length, 350)
  assert.ok(rows.every((r) => r.email === r.email.toLowerCase()), 'emails are lower-cased')
  assert.ok(rows.every((r) => r.gsi === true))
  assert.ok(!rows.some((r) => r.campaign_id === 'w1'), 'untagged workspace campaigns are never read')
  assert.deepEqual(Object.keys(rows[0]).sort(), ['campaign_id', 'campaign_name', 'click_count', 'created_at', 'email', 'gsi', 'interest_status', 'last_reply_at', 'open_count', 'reply_count', 'status', 'synced_at'])
  const replied = rows.find((r) => r.campaign_id === 'g1' && r.email === 'person.1@g1.example')
  assert.deepEqual([replied.campaign_name, replied.interest_status, replied.reply_count, replied.last_reply_at], ['GSI_One', 1, 2, '2026-09-10T12:00:00.000Z'])
  assert.ok(w.upserts.filter((u) => u.table === 'ca_em_leads').every((u) => new URL(u.url).searchParams.get('on_conflict') === 'campaign_id,email'))
  assert.ok(w.upserts.filter((u) => u.table === 'ca_em_leads').every((u) => u.rows.length <= 500))
})

test('leads phase: respects the per-call page budget and resumes from the cursor mid-campaign', async () => {
  const w = world({ campaigns: [{ id: 'big', name: 'GSI_Big', leads: LEADS_BUDGET * LEADS_PAGE_SIZE + 150 }, { id: 'small', name: 'GSI_Small', leads: 5 }] })
  const all = await runAll(w)
  const perCall = []
  {
    // the same run again, counting subrequests per invocation
    const w2 = world({ campaigns: [{ id: 'big', name: 'GSI_Big', leads: LEADS_BUDGET * LEADS_PAGE_SIZE + 150 }, { id: 'small', name: 'GSI_Small', leads: 5 }] })
    let body = {}
    for (let i = 0; i < 20; i++) {
      const n0 = w2.calls.length
      const r = await call(w2, body)
      const slice = w2.calls.slice(n0)
      perCall.push({ leadCalls: slice.filter((c) => c.url.endsWith('/leads/list')).length, total: slice.length, cursor: r.body.cursor })
      if (r.body.done) break
      body = { cursor: r.body.cursor }
    }
  }
  assert.ok(perCall.filter((p) => p.leadCalls).length >= 2, 'needed more than one call')
  assert.ok(perCall.every((p) => p.leadCalls <= LEADS_BUDGET))
  assert.ok(perCall.every((p) => p.total <= 40), 'every invocation stays under ~40 subrequests: ' + perCall.map((p) => p.total).join(','))
  const firstLeads = perCall.find((p) => p.leadCalls > 0)
  assert.equal(firstLeads.leadCalls, LEADS_BUDGET)
  assert.equal(firstLeads.cursor.phase, 'leads')
  assert.equal(firstLeads.cursor.campaignIndex, 0, 'still on the big campaign')
  assert.equal(firstLeads.cursor.starting_after, `big-L${LEADS_BUDGET * LEADS_PAGE_SIZE - 1}`)
  assert.equal(all.at(-1).body.leads, LEADS_BUDGET * LEADS_PAGE_SIZE + 155)
  assert.equal(new Set(leadRows(w).map((r) => r.campaign_id + '|' + r.email)).size, LEADS_BUDGET * LEADS_PAGE_SIZE + 155, 'no lead lost or doubled across the resume')
})

test('leads phase: duplicate emails in one campaign are collapsed before the upsert', async () => {
  const w = world({ campaigns: [{ id: 'g1', name: 'GSI_One', leads: 3 }] })
  // make two leads share an address that differs only by case
  const orig = w.fetchStub
  w.fetchStub = async (input, init = {}) => {
    const res = await orig(input, init)
    if (String(input).endsWith('/leads/list')) {
      const b = await res.json()
      b.items = b.items.map((l, i) => i < 2 ? { ...l, email: i ? 'DUP@x.example' : 'dup@X.example' } : l)
      return j(b)
    }
    return res
  }
  const all = await runAll(w)
  const rows = leadRows(w)
  assert.equal(rows.filter((r) => r.email === 'dup@x.example').length, 1)
  assert.equal(all.at(-1).body.leads, 2)
})

test('leads phase: a missing ca_em_leads table warns and finishes instead of failing the daily job', async () => {
  const w = world({ campaigns: [{ id: 'g1', name: 'GSI_One', leads: 10 }], leadsTable: false })
  const all = await runAll(w)
  const last = all.at(-1).body
  assert.equal(last.done, true)
  assert.ok(last.warnings.some((m) => /009_em_leads\.sql/.test(m)))
  assert.ok(!last.warnings.some((m) => /—/.test(m)), 'no em dashes in copy')
})

test('leads phase: daily page cap stops the run with a warning', async () => {
  const w = world({ campaigns: [{ id: 'g1', name: 'GSI_One', leads: 50 }, { id: 'g2', name: 'GSI_Two', leads: 50 }] })
  // jump straight to the leads phase with the cap nearly used up
  const cursor = { sync_id: 'sync-1', today: '2026-10-01', phase: 'leads', leadQueue: [{ id: 'g1', name: 'GSI_One' }, { id: 'g2', name: 'GSI_Two' }], campaignIndex: 0, starting_after: null, leadPages: isync.MAX_LEAD_PAGES - 1, leads: 0, campaigns: 2, workspace_campaigns: 2, days: 0 }
  const r = await call(w, { cursor })
  assert.equal(r.body.done, true)
  assert.equal(leadCalls(w).length, 1)
  assert.equal(r.body.leads, 50)
  assert.ok(r.body.warnings.some((m) => m.includes(`${isync.MAX_LEAD_PAGES} pages`) && m.includes('2 GSI campaign')))
})

test('demo: instantlyLeadsByEmail covers about 40% of the HubSpot demo contacts, deterministically', () => {
  const contacts = hubspotMock.contacts
  const emails = new Set(contacts.map((c) => String(c.email).toLowerCase()))
  const keys = [...instantlyLeadsByEmail.keys()]
  assert.ok(keys.length > 0)
  assert.ok(keys.every((k) => k === k.toLowerCase() && emails.has(k)), 'keys are lower-cased demo contact emails')
  const share = keys.length / emails.size
  assert.ok(share > 0.3 && share < 0.5, 'share ' + share)
  for (const list of instantlyLeadsByEmail.values()) {
    assert.ok(list.length >= 1)
    for (const m of list) assert.deepEqual(Object.keys(m).sort(), ['campaign_id', 'campaign_name', 'gsi', 'interest_status', 'last_reply_at', 'reply_count', 'status'])
  }
})
