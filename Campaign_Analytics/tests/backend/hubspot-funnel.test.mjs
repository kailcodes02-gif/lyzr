// Leads funnel: scope pruning on full syncs, human vs automatic replies, and the
// GET contract (in_scope filter, ?all=1, Instantly campaigns per contact).
// Stubbed fetch only: no real Graph, Supabase or HubSpot calls.
import test from 'node:test'
import assert from 'node:assert/strict'

import * as refresh from '../../../functions/api/ca/hubspot/refresh.js'
import * as hubspot from '../../../functions/api/ca/hubspot/index.js'

const SUPA = 'https://fake-ref.supabase.co'
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ---- fake world ------------------------------------------------------------
function world(opts = {}) {
  const calls = []
  const tables = opts.tables || {}
  const users = { 'tok-editor': { displayName: 'Subs', mail: 'subs@lyzr.com' }, 'tok-viewer': { displayName: 'Viewer', userPrincipalName: 'viewer@lyzr.ai' } }

  function match(rows, u) {
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
      else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''))); rows = rows.filter((r) => set.has(String(r[k]))) }
      else if (v === 'not.is.false') rows = rows.filter((r) => r[k] !== false)
      else if (v.startsWith('lt.')) rows = rows.filter((r) => String(r[k]) < v.slice(3))
      else if (v.startsWith('gte.')) rows = rows.filter((r) => String(r[k]) >= v.slice(4))
    }
    return rows
  }

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
      if (opts.postgrest) { const r = opts.postgrest({ table, method, u, body, headers, tables }); if (r) return r }
      if (method === 'GET') {
        let rows = match(tables[table] || [], u)
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
      if (method === 'PATCH') {
        const rows = match(tables[table] || [], u)
        for (const r of rows) Object.assign(r, body)
        const sel = u.searchParams.get('select')
        const out = sel ? rows.map((r) => Object.fromEntries(sel.split(',').map((k) => [k, r[k]]))) : rows
        return String(headers.Prefer || '').includes('return=representation') ? jsonRes(out) : new Response(null, { status: 204 })
      }
      if (method === 'DELETE') return new Response(null, { status: 204 })
    }
    if (url.startsWith('https://api.hubapi.com/')) {
      if (opts.hubspot) return opts.hubspot({ url, method, body })
      return jsonRes({ results: [] })
    }
    throw new Error('unexpected fetch ' + url)
  }

  const env = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', HUBSPOT_ACCESS_TOKEN: 'hs-token', ...(opts.env || {}) }
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
    return { status: res.status, body: text ? JSON.parse(text) : null }
  } finally {
    globalThis.fetch = saved
  }
}

// ---- isAutoReply -------------------------------------------------------------
test('isAutoReply: out of office, bounces, left the company, headers, other languages', () => {
  const yes = [
    { subject: 'Automatic reply: Lyzr x Accenture', text: 'I am out of the office until Monday.' },
    { subject: 'Out of Office', text: '' },
    { subject: 'Re: GSI agents', text: 'Thanks for your email. I am currently on annual leave with limited access.' },
    { subject: 'Auto-Reply: hello', text: '' },
    { subject: 'Autoreply', text: 'x' },
    { subject: 'Re: demo', text: 'I am away from the office this week.' },
    { subject: 'Re: demo', text: 'I am on leave until 12 Oct.' },
    { subject: 'Re: demo', text: 'I am on maternity leave.' },
    { subject: 'Re: demo', text: 'Priya is no longer with Infosys. Please contact sales@infosys.com.' },
    { subject: 'Re: demo', text: 'This person has left the company.' },
    { subject: 'Undeliverable: Lyzr', text: '' },
    { subject: 'Delivery Status Notification (Failure)', text: '' },
    { subject: 'Mail delivery failed: returning message to sender', text: '' },
    { subject: 'Returned mail', text: 'This message was created automatically by mailer-daemon' },
    { subject: 'Re: x', text: 'This mailbox is not monitored.' },
    { subject: 'Abwesenheitsnotiz: Lyzr', text: '' },
    { subject: 'Re: demo', text: 'Estoy fuera de la oficina hasta el lunes.' },
    { subject: 'Absence du bureau', text: '' },
    { subject: 'Re: demo', text: 'hi', headers: { 'auto-submitted': 'auto-replied' } },
    { subject: 'Re: demo', text: 'hi', headers: 'X-Autoreply: yes' },
    { subject: 'Re: demo', text: 'hi', headers: '{"from":{"email":"MAILER-DAEMON@mx.example.com"}}' },
  ]
  for (const e of yes) assert.equal(refresh.isAutoReply(e), true, JSON.stringify(e))
  const no = [
    { subject: 'Re: Lyzr x Accenture', text: 'Sounds good, can we talk Thursday at 3pm?' },
    { subject: 'Re: demo', text: 'Yes please send the deck.\n\nOn Mon, 1 Sep 2026, Anju wrote:\n> I will be out of office next week' },
    { subject: 'Re: pilot', text: 'Interested. Loop in my colleague.', headers: { 'auto-submitted': 'no' } },
    {},
  ]
  for (const e of no) assert.equal(refresh.isAutoReply(e), false, JSON.stringify(e))
})

test('emailNoteBody and splitReads', () => {
  assert.equal(refresh.emailNoteBody('Re: demo', 'Yes,   let us talk.\n> quoted', false), 'Re: demo - Yes, let us talk.')
  assert.equal(refresh.emailNoteBody('Out of office', 'Back Monday', true), '[auto] Out of office - Back Monday')
  assert.equal(refresh.emailNoteBody('S', 'x'.repeat(1000), false).length, 'S — '.length + 400)
  assert.deepEqual(refresh.splitReads(250, 120), { notes: 3, emails: 2 })
  assert.deepEqual(refresh.splitReads(2000, 2000), { notes: 5, emails: 5 })
  assert.deepEqual(refresh.splitReads(150, 5000), { notes: 2, emails: 8 })
  assert.deepEqual(refresh.splitReads(5000, 0), { notes: 10, emails: 0 })
})

// ---- refresh: notes phase replies + pruning ----------------------------------
const STARTED = '2026-10-01T00:00:00.000Z'

function refreshWorld() {
  return world({
    tables: {
      ca_hs_sync: [{ id: 's1', status: 'running', started_at: STARTED }],
      ca_settings: [],
      ca_hs_contacts: [
        { hs_id: '100', email: 'ann@accenture.com', synced_at: '2026-10-01T00:01:00.000Z', last_activity_at: null, last_activity_type: null },
        { hs_id: '101', email: 'bob@infosys.com', synced_at: '2026-10-01T00:01:00.000Z', last_activity_at: null, last_activity_type: null },
        { hs_id: '900', email: 'old@nowhere.com', synced_at: '2026-08-01T00:00:00.000Z', in_scope: true },
        { hs_id: '901', email: 'old2@nowhere.com', synced_at: '2026-08-01T00:00:00.000Z', in_scope: null },
      ],
      ca_hs_notes: [],
    },
    hubspot: ({ url, method, body }) => {
      assert.equal(method, 'POST')
      if (url.includes('/crm/v4/associations/contacts/')) {
        const type = url.split('/crm/v4/associations/contacts/')[1].split('/')[0]
        if (type === 'emails') return jsonRes({ results: [
          { from: { id: '100' }, to: [{ toObjectId: 7001 }, { toObjectId: 7002 }, { toObjectId: 7003 }, { toObjectId: 7004 }] },
          { from: { id: '101' }, to: [{ toObjectId: 7005 }] },
        ] })
        return jsonRes({ results: [] })
      }
      if (url.endsWith('/crm/v3/objects/emails/batch/read')) {
        assert.deepEqual(body.properties, refresh.EMAIL_PROPS)
        return jsonRes({ results: [
          { id: '7001', properties: { hs_email_direction: 'EMAIL', hs_email_subject: 'Lyzr for GSIs', hs_email_text: 'Hi Ann', hs_timestamp: '2026-09-01T10:00:00.000Z' } },
          { id: '7002', properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Re: Lyzr for GSIs', hs_email_text: 'Keen to see a demo.', hs_timestamp: '2026-09-02T10:00:00.000Z' } },
          { id: '7003', properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Re: follow up', hs_email_text: 'Thursday works.', hs_timestamp: '2026-09-09T10:00:00.000Z' } },
          { id: '7004', properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Automatic reply: Lyzr', hs_email_text: 'Out of office until Monday', hs_timestamp: '2026-09-05T10:00:00.000Z' } },
          { id: '7005', properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Undeliverable: Lyzr', hs_email_text: '', hs_timestamp: '2026-09-03T10:00:00.000Z' } },
        ] })
      }
      throw new Error('unexpected hubspot ' + url)
    },
  })
}

test('refresh notes phase: incoming emails become human / automatic replies per contact and email_in notes', async () => {
  const w = refreshWorld()
  const cursor = { sync_id: 's1', started_at: STARTED, phase: 'notes', offset: 0, contacts: 2, notes: 0, from: '2026-09-01', to: '2026-09-30' }
  const r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.done, true)
  assert.deepEqual(r.body.replies, { human: 2, auto: 2 })
  assert.equal(r.body.notes, 4, 'four incoming emails stored, the outgoing one is not')

  const noteUp = w.calls.find((c) => c.method === 'POST' && c.url.includes('ca_hs_notes'))
  const e2 = noteUp.body.find((n) => n.id === 'email-7002')
  assert.equal(e2.kind, 'email_in')
  assert.equal(e2.contact_id, '100')
  assert.equal(e2.body, 'Re: Lyzr for GSIs - Keen to see a demo.')
  assert.equal(noteUp.body.find((n) => n.id === 'email-7004').body, '[auto] Automatic reply: Lyzr - Out of office until Monday')
  assert.ok(!noteUp.body.some((n) => n.id === 'email-7001'))

  const patch = w.calls.filter((c) => c.method === 'POST' && c.url.includes('ca_hs_contacts')).at(-1)
  const ann = patch.body.find((x) => x.hs_id === '100')
  assert.equal(ann.replies_human, 2)
  assert.equal(ann.replies_auto, 1)
  assert.equal(ann.first_human_reply_at, '2026-09-02T10:00:00.000Z')
  assert.equal(ann.last_human_reply_at, '2026-09-09T10:00:00.000Z')
  assert.equal(ann.last_auto_reply_at, '2026-09-05T10:00:00.000Z')
  assert.equal(ann.notes_count, 4)
  const bob = patch.body.find((x) => x.hs_id === '101')
  assert.deepEqual([bob.replies_human, bob.replies_auto, bob.first_human_reply_at], [0, 1, null])

  // dated sync: never prunes
  assert.equal(r.body.pruned, undefined)
  assert.ok(!w.calls.some((c) => c.method === 'PATCH' && c.url.includes('ca_hs_contacts')), 'no scope update on a dated sync')
  assert.equal(w.tables.ca_hs_contacts.find((c) => c.hs_id === '900').in_scope, true)
  // read-only against HubSpot
  for (const c of w.calls.filter((x) => x.url.startsWith('https://api.hubapi.com/'))) assert.ok(/\/(batch\/read|search)$/.test(c.url), c.url)
  assert.ok(w.calls.length <= 40, `used ${w.calls.length} subrequests`)
})

test('refresh: a full sync marks untouched contacts out of scope and touched ones in scope', async () => {
  const w = refreshWorld()
  const cursor = { sync_id: 's1', started_at: STARTED, phase: 'notes', offset: 0, contacts: 2, notes: 0, from: null, to: null }
  const r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.done, true)
  assert.equal(r.body.pruned, 2)
  const byId = Object.fromEntries(w.tables.ca_hs_contacts.map((c) => [c.hs_id, c]))
  assert.equal(byId['900'].in_scope, false)
  assert.equal(byId['901'].in_scope, false)
  assert.ok(byId['900'].scope_checked_at)
  assert.equal(byId['100'].in_scope, true)
  assert.equal(byId['101'].in_scope, true)
  const patches = w.calls.filter((c) => c.method === 'PATCH' && c.url.includes('ca_hs_contacts'))
  assert.equal(patches.length, 2)
  assert.ok(decodeURIComponent(patches[0].url).includes(`synced_at=lt.${STARTED}`))
  assert.ok(!w.calls.some((c) => c.method === 'DELETE'), 'nothing is deleted')
  assert.ok(w.calls.length <= 40, `used ${w.calls.length} subrequests`)
})

test('refresh: a full sync that found nothing does not prune; a missing in_scope column is a warning', async () => {
  let w = refreshWorld()
  let r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor: { sync_id: 's1', started_at: '2027-01-01T00:00:00.000Z', phase: 'notes', offset: 0, contacts: 0, notes: 0 } } }), w)
  assert.equal(r.body.done, true)
  assert.equal(r.body.pruned, undefined)
  assert.ok(r.body.warnings.some((x) => /nothing was marked out of scope/.test(x)))
  assert.ok(!w.calls.some((c) => c.method === 'PATCH' && c.url.includes('ca_hs_contacts')))

  w = world({
    tables: { ca_hs_contacts: [], ca_hs_sync: [{ id: 's1' }] },
    postgrest: ({ table, method }) => table === 'ca_hs_contacts' && method === 'PATCH'
      ? jsonRes({ message: 'column ca_hs_contacts.in_scope does not exist' }, 400) : null,
  })
  r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor: { sync_id: 's1', started_at: STARTED, phase: 'notes', offset: 0, contacts: 5, notes: 0 } } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.done, true)
  assert.ok(r.body.warnings.some((x) => /008_funnel\.sql/.test(x)))
})

test('refresh: reply columns missing (008 not run) still saves notes_count', async () => {
  const w = refreshWorld()
  let first = true
  w.fetchStub = ((orig) => async (input, init = {}) => {
    const url = String(input)
    if (url.includes('/rest/v1/ca_hs_contacts') && (init.method || 'GET') === 'POST' && first && String(init.body).includes('replies_human')) {
      first = false
      return jsonRes({ message: "Could not find the 'replies_auto' column of 'ca_hs_contacts' in the schema cache" }, 400)
    }
    return orig(input, init)
  })(w.fetchStub)
  const cursor = { sync_id: 's1', started_at: STARTED, phase: 'notes', offset: 0, contacts: 2, notes: 0, from: '2026-09-01', to: null }
  const r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor } }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.ok(r.body.warnings.some((x) => /Reply counts were not saved/.test(x)))
  const saved = w.tables.ca_hs_contacts.filter((c) => c.notes_count !== undefined)
  assert.ok(saved.some((c) => c.hs_id === '100' && c.notes_count === 4 && !('replies_human' in c)))
})

// ---- GET ---------------------------------------------------------------------
test('hubspot GET: hides out-of-scope contacts unless ?all=1 and attaches Instantly campaigns', async () => {
  const tables = {
    ca_hs_contacts: [
      { hs_id: '1', email: 'Ann@Accenture.com', in_scope: true, props: { first_conversion_date: '2026-09-01T00:00:00Z' } },
      { hs_id: '2', email: 'bob@infosys.com', in_scope: null },
      { hs_id: '3', email: 'old@nowhere.com', in_scope: false, props: { first_conversion_date: '2026-09-01T00:00:00Z' } },
      { hs_id: '4', email: null, in_scope: true },
    ],
    ca_hs_notes: [{ id: 'n1', contact_id: '3', body: 'old' }, { id: 'n2', contact_id: '1', body: 'hi' }],
    ca_hs_sync: [{ id: 's1', status: 'done' }],
    ca_em_leads: [
      { email: 'ann@accenture.com', campaign_id: 'c1', campaign_name: 'GSI Q3', gsi: true, status: 1, interest_status: 1, open_count: 3, reply_count: 1, click_count: 0, last_reply_at: '2026-09-02T10:00:00Z' },
      { email: 'ann@accenture.com', campaign_id: 'c2', campaign_name: 'Other', gsi: false, status: 3, interest_status: null, reply_count: 0, last_reply_at: null },
      { email: 'old@nowhere.com', campaign_id: 'c1', campaign_name: 'GSI Q3', gsi: true, status: 1, reply_count: 0 },
    ],
  }
  let w = world({ tables })
  let r = await run(hubspot.onRequestGet, req('GET', 'hubspot', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.contacts.map((c) => c.hs_id), ['1', '2', '4'])
  assert.equal(r.body.all, false)
  const get = w.calls.find((c) => c.url.includes('/ca_hs_contacts'))
  assert.ok(decodeURIComponent(get.url).includes('in_scope=not.is.false'))
  const ann = r.body.contacts.find((c) => c.hs_id === '1')
  assert.deepEqual(ann.instantly, [
    { campaign_id: 'c1', campaign_name: 'GSI Q3', gsi: true, status: 1, interest_status: 1, reply_count: 1, last_reply_at: '2026-09-02T10:00:00Z' },
    { campaign_id: 'c2', campaign_name: 'Other', gsi: false, status: 3, interest_status: null, reply_count: 0, last_reply_at: null },
  ])
  assert.deepEqual(r.body.contacts.find((c) => c.hs_id === '2').instantly, [])
  assert.deepEqual(r.body.contacts.find((c) => c.hs_id === '4').instantly, [])
  assert.deepEqual(Object.keys(r.body.notes_by_contact), ['1'])
  const em = w.calls.find((c) => c.url.includes('/ca_em_leads'))
  assert.ok(decodeURIComponent(em.url).includes('email=in.("ann@accenture.com")'))  // only form leads are looked up

  // ?all=1 brings the out-of-scope ones back
  w = world({ tables })
  r = await run(hubspot.onRequestGet, req('GET', 'hubspot?all=1', { token: 'tok-viewer' }), w)
  assert.deepEqual(r.body.contacts.map((c) => c.hs_id), ['1', '2', '3', '4'])
  assert.equal(r.body.all, true)
  assert.equal(r.body.contacts.find((c) => c.hs_id === '3').instantly.length, 1)
  assert.ok(!decodeURIComponent(w.calls.find((c) => c.url.includes('/ca_hs_contacts')).url).includes('in_scope'))
})

test('hubspot GET: works before ca_em_leads and in_scope exist', async () => {
  const w = world({
    tables: { ca_hs_contacts: [{ hs_id: '1', email: 'a@x.com' }], ca_hs_notes: [], ca_hs_sync: [] },
    postgrest: ({ table, u }) => {
      if (table === 'ca_em_leads') return jsonRes({ message: 'relation "ca_em_leads" does not exist' }, 404)
      if (table === 'ca_hs_contacts' && u.searchParams.has('in_scope')) return jsonRes({ message: 'column ca_hs_contacts.in_scope does not exist' }, 400)
      return null
    },
  })
  const r = await run(hubspot.onRequestGet, req('GET', 'hubspot', { token: 'tok-viewer' }), w)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.contacts.length, 1)
  assert.deepEqual(r.body.contacts[0].instantly, [])
  assert.ok(r.body.warnings.some((x) => /008_funnel\.sql/.test(x)))
})

test('isAutoReply: everyday words in a human reply are not auto replies; a forged cursor cannot prune', async () => {
  assert.equal(refresh.isAutoReply({ subject: 'Re: demo', text: "Thanks, I'm on leave next week but let's talk after." }), false)
  assert.equal(refresh.isAutoReply({ subject: 'Re: demo', text: 'Please do not reply-all to the group thread, just me.' }), false)
  assert.equal(refresh.isAutoReply({ subject: 'On leave until 14 Oct', text: 'I will reply when back.' }), true)
  assert.equal(refresh.isAutoReply({ subject: 'Re: demo', text: 'Automatic reply: I am out of the office.' }), true)
  const w = refreshWorld()
  const cursor = { sync_id: 's1', started_at: '2099-01-01T00:00:00.000Z', phase: 'notes', offset: 0, contacts: 2, notes: 0, from: null, to: null }
  const r = await run(refresh.onRequestPost, req('POST', 'hubspot/refresh', { body: { cursor } }), w)
  assert.equal(r.body.pruned, undefined)
  assert.ok(r.body.warnings.some((x) => /does not match/.test(x)))
})
