// LinkedIn Marketing API connection: OAuth state, callback, refresh, sync (perf, demographics, leads),
// the no-double-count rule and the status never leaking a token. Stubbed fetch: no real Graph,
// Supabase or LinkedIn calls. node --test 'Campaign_Analytics/tests/backend/*.test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'

import * as L from '../../../functions/api/ca/_lib/linkedin-api.js'
import * as route from '../../../functions/api/ca/linkedin-api/[[path]].js'
import { activeWindows } from '../../../functions/api/ca/_lib/windows.js'
import { activeWindows as activeWindowsFront } from '../../js/lib/linkedin-agg.mjs'
import { parseLinkedInCsv } from '../../js/csv.mjs'

const SUPA = 'https://fake-ref.supabase.co'
const ORIGIN = 'https://lyzr.kailash-gm.com'
const SECRET = 'test-client-secret-never-real'
const ACCESS = 'AQX-access-token-should-never-leak'
const REFRESH = 'AQR-refresh-token-should-never-leak'
const ENV = { CA_SUPABASE_URL: SUPA, CA_SUPABASE_KEY: 'service-key', CA_EDITORS: 'subs@lyzr.com', CA_CRON_SECRET: 'cron-secret', LINKEDIN_CLIENT_SECRET: SECRET }
const GROUP = '1012206054', CAMP = '583307414', CREATIVE = '1244004214', ACC = '511'

// ---- fake Supabase + Graph + LinkedIn ------------------------------------------------
const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict'])
function matches(row, k, v) {
  const val = row[k] == null ? '' : String(row[k])
  if (v.startsWith('eq.')) return val === v.slice(3)
  if (v.startsWith('neq.')) return val !== v.slice(4)
  if (v.startsWith('gte.')) return val >= v.slice(4)
  if (v.startsWith('lte.')) return val <= v.slice(4)
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(val)
  if (v.startsWith('like.')) return val.startsWith(v.slice(5).replace(/%$/, '').replace(/\\/g, ''))
  return true
}
function filterRows(rows, sp) { for (const [k, v] of sp) if (!reserved.has(k)) rows = rows.filter((r) => matches(r, k, v)); return rows }

function world({ tables = {}, li = () => null, token } = {}) {
  const calls = []
  let seq = 0
  const users = { 'tok-editor': { displayName: 'Subs', mail: 'subs@lyzr.com' }, 'tok-viewer': { displayName: 'Viewer', userPrincipalName: 'viewer@lyzr.ai' } }
  const jsonRes = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const cascade = (ids) => { for (const t of ['ca_li_perf', 'ca_li_demo']) tables[t] = (tables[t] || []).filter((r) => !ids.includes(r.upload_id)) }
  async function fetchStub(input, init = {}) {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    const headers = init.headers || {}
    calls.push({ url, method, headers, body: init.body })
    if (url.startsWith('https://graph.microsoft.com/')) {
      const tok = String(headers.Authorization || '').replace('Bearer ', '')
      return users[tok] ? jsonRes(users[tok]) : jsonRes({ error: 'bad' }, 401)
    }
    if (url.startsWith(SUPA + '/rest/v1/')) {
      const u = new URL(url)
      const table = u.pathname.split('/').pop()
      const list = tables[table] || []
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${filterRows(list, u.searchParams).length}` } })
      if (method === 'GET') {
        let rows = filterRows(list, u.searchParams)
        const order = u.searchParams.get('order')
        if (order) { const [k, dir] = order.split(',')[0].split('.'); rows = [...rows].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (dir === 'desc' ? -1 : 1)) }
        const range = headers.Range
        if (range) { const [a, b] = range.split('-').map(Number); rows = rows.slice(a, b + 1) }
        const limit = u.searchParams.get('limit')
        if (limit) rows = rows.slice(0, Number(limit))
        return jsonRes(rows)
      }
      if (method === 'POST') {
        const body = JSON.parse(init.body)
        const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ ...r }))
        const key = u.searchParams.get('on_conflict')
        for (const r of rows) if (r.id === undefined && table !== 'ca_insights' && table !== 'ca_cache' && table !== 'ca_li_perf') r.id = `${table}-${++seq}`
        if (key) { const ks = key.split(','); tables[table] = [...list.filter((r) => !rows.some((w) => ks.every((k) => String(w[k]) === String(r[k])))), ...rows] }
        else tables[table] = [...list, ...rows]
        return String(headers.Prefer || '').includes('return=representation') ? jsonRes(rows, 201) : new Response(null, { status: 201 })
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(init.body)
        for (const r of filterRows(list, u.searchParams)) Object.assign(r, patch)
        return new Response(null, { status: 204 })
      }
      if (method === 'DELETE') {
        const gone = filterRows(list, u.searchParams)
        tables[table] = list.filter((r) => !gone.includes(r))
        if (table === 'ca_uploads') cascade(gone.map((r) => r.id))
        return new Response(null, { status: 204 })
      }
    }
    if (url === 'https://www.linkedin.com/oauth/v2/accessToken') {
      const p = Object.fromEntries(new URLSearchParams(init.body))
      if (p.client_secret !== SECRET) return jsonRes({ error: 'invalid_client' }, 401)
      if (p.grant_type === 'authorization_code' && p.code === 'good-code') return jsonRes({ access_token: ACCESS, expires_in: 5184000, refresh_token: REFRESH, refresh_token_expires_in: 31536000, scope: token && token.scope ? token.scope : 'r_ads,r_ads_reporting' })
      if (p.grant_type === 'refresh_token' && p.refresh_token === REFRESH) return jsonRes({ access_token: 'AQX-new-access', expires_in: 5184000, refresh_token: REFRESH, refresh_token_expires_in: 30000000 })
      return jsonRes({ error: 'invalid_grant', error_description: 'bad code' }, 400)
    }
    if (url.startsWith('https://api.linkedin.com/')) {
      assert.ok(headers['LinkedIn-Version'], 'LinkedIn-Version header')
      assert.equal(headers['X-Restli-Protocol-Version'], '2.0.0')
      const u = new URL(url)
      const out = li(u, url, headers) || defaultLi(u, url)
      if (!out) return jsonRes({ message: 'not found in fake' }, 404)
      return jsonRes(out.body, out.status || 200)
    }
    throw new Error('unexpected fetch ' + url)
  }
  return { calls, tables, fetchStub }
}

// a LinkedIn account with one group, one campaign (ad set) and one creative
function parseRange(raw) {
  const m = raw.match(/dateRange=\(start:\(year:(\d+),month:(\d+),day:(\d+)\),end:\(year:(\d+),month:(\d+),day:(\d+)\)\)/)
  const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { from: iso(m[1], m[2], m[3]), to: iso(m[4], m[5], m[6]) }
}
const dr = (day) => { const [y, m, d] = day.split('-').map(Number); return { start: { year: y, month: m, day: d }, end: { year: y, month: m, day: d } } }
const PERF_DAYS = ['2026-09-10', '2026-09-11', '2026-10-20']
function defaultLi(u, raw) {
  const p = u.pathname.replace(/^\/(rest|v2)/, '')
  if (p === '/adAccountUsers') return { body: { elements: [{ account: `urn:li:sponsoredAccount:${ACC}`, role: 'CAMPAIGN_MANAGER' }] } }
  if (p === `/adAccounts/${ACC}`) return { body: { id: Number(ACC), name: 'Lyzr Ad Account', currency: 'USD', status: 'ACTIVE' } }
  if (p === `/adAccounts/${ACC}/adCampaignGroups`) return { body: { elements: [{ id: Number(GROUP), name: 'Nvidia & AWS Post Amplification' }], metadata: {} } }
  if (p === `/adAccounts/${ACC}/adCampaigns`) return { body: { elements: [{ id: Number(CAMP), name: 'WP | GSI & Si Post | Brand awareness - Apr 9, 2026', campaignGroup: `urn:li:sponsoredCampaignGroup:${GROUP}`, objectiveType: 'BRAND_AWARENESS', type: 'SPONSORED_UPDATES', status: 'ACTIVE' }] } }
  if (p === `/adAccounts/${ACC}/creatives`) return { body: { elements: [{ id: `urn:li:sponsoredCreative:${CREATIVE}`, name: 'GTC 2026 creative', campaign: `urn:li:sponsoredCampaign:${CAMP}` }] } }
  if (p === '/adAnalytics') {
    const pivot = u.searchParams.get('pivot')
    const { from, to } = parseRange(raw)
    if (pivot === 'CREATIVE') return { body: { elements: PERF_DAYS.filter((d) => d >= from && d <= to).map((d) => ({ pivotValues: [`urn:li:sponsoredCreative:${CREATIVE}`], dateRange: dr(d), impressions: 69, clicks: 2, costInLocalCurrency: '4.14', oneClickLeads: 1, oneClickLeadFormOpens: 3, approximateMemberReach: 60, landingPageClicks: 1 })) } }
    const els = {
      MEMBER_COMPANY: [{ pivotValues: ['urn:li:organization:1033'], impressions: 2010, clicks: 28, costInLocalCurrency: '50.5' }, { pivotValues: ['urn:li:organization:9999'], impressions: 5, clicks: 0 }],
      MEMBER_COUNTRY_V2: [{ pivotValues: ['urn:li:geo:103644278'], impressions: 900 }],
      MEMBER_SENIORITY: [{ pivotValues: ['urn:li:seniority:6'], impressions: 400 }],
      MEMBER_JOB_TITLE: [{ pivotValues: ['urn:li:title:25'], impressions: 120 }],
      MEMBER_JOB_FUNCTION: [{ pivotValues: ['urn:li:function:13'], impressions: 300 }],
      MEMBER_INDUSTRY: [{ pivotValues: ['urn:li:industry:96'], impressions: 500 }],
      MEMBER_COMPANY_SIZE: [{ pivotValues: ['SIZE_10001_OR_MORE'], impressions: 700 }],
    }[pivot]
    return { body: { elements: els || [] } }
  }
  if (p === '/adTargetingEntities') {
    const NAMES = { 'urn:li:organization:1033': 'Accenture', 'urn:li:geo:103644278': 'United States', 'urn:li:title:25': 'Managing Director', 'urn:li:industry:96': 'IT Services and IT Consulting' }
    const urns = decodeURIComponent((raw.match(/urns=List\(([^)]*)\)/) || [])[1] || '').split(',')
    return { body: { elements: urns.filter((x) => NAMES[x]).map((x) => ({ urn: x, name: NAMES[x], facetUrn: 'urn:li:adTargetingFacet:x' })) } }
  }
  if (p === '/organizationsLookup') return { body: { results: { 1033: { localizedName: 'Accenture' } }, statuses: { 1033: 200, 9999: 404 }, errors: {} } }
  if (p === '/geo') return { body: { results: { 103644278: { defaultLocalizedName: { value: 'United States' } } } } }
  if (p === '/titles') return { body: { results: { 25: { name: { localized: { en_US: 'Managing Director' } } } } } }
  if (p === '/industries') return { body: { results: { 96: { name: { localized: { en_US: 'IT Services and IT Consulting' } } } } } }
  if (p === '/leadForms') return { body: { elements: [{ id: 3162, name: 'Book a demo form', content: { questions: [
    { questionId: 1, name: 'firstName', predefinedField: 'FIRST_NAME', question: { localized: { en_US: 'First name' } } },
    { questionId: 2, name: 'lastName', predefinedField: 'LAST_NAME' },
    { questionId: 3, name: 'email', predefinedField: 'EMAIL' },
    { questionId: 4, name: 'company', predefinedField: 'COMPANY_NAME' },
    { questionId: 5, name: 'Custom question 0', question: { localized: { en_US: 'Are you interested' } }, questionDetails: { multipleChoiceQuestionDetails: { options: [{ id: 0, text: { localized: { en_US: 'Yes' } } }, { id: 1, text: { localized: { en_US: 'No' } } }] } } },
  ] } }] } }
  if (p === '/leadFormResponses') return { body: { elements: [LEAD, { ...LEAD, id: 'test-1', testLead: true }] } }
  return null
}
const LEAD = {
  id: 'aaaabbbb-5', submittedAt: Date.parse('2026-10-02T09:30:00Z'), testLead: false,
  versionedLeadGenFormUrn: 'urn:li:versionedLeadGenForm:(urn:li:leadGenForm:3162,1)',
  leadMetadata: { sponsoredLeadMetadata: { campaign: `urn:li:sponsoredCampaign:${CAMP}` } },
  associatedEntity: { associatedCreative: `urn:li:sponsoredCreative:${CREATIVE}` },
  formResponse: { answers: [
    { questionId: 1, answerDetails: { textQuestionAnswer: { answer: 'Asha' } } },
    { questionId: 2, answerDetails: { textQuestionAnswer: { answer: 'Rao' } } },
    { questionId: 3, answerDetails: { textQuestionAnswer: { answer: 'asha@accenture.com' } } },
    { questionId: 4, answerDetails: { textQuestionAnswer: { answer: 'Accenture' } } },
    { questionId: 5, answerDetails: { multipleChoiceAnswer: { options: [0] } } },
  ] },
}

async function withFetch(w, fn) {
  const real = globalThis.fetch
  globalThis.fetch = w.fetchStub
  try { return await fn() } finally { globalThis.fetch = real }
}
const req = (path, { method = 'GET', token, body, headers = {} } = {}) => new Request(`${ORIGIN}/api/ca/linkedin-api/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
const connectedDoc = (o = {}) => ({ scope: '_li_oauth', model: 'doc', created_at: '2026-10-01T00:00:00Z', created_by: 'subs@lyzr.com', content: { access_token: ACCESS, refresh_token: REFRESH, expires_at: new Date(Date.now() + 40 * 864e5).toISOString(), refresh_expires_at: new Date(Date.now() + 300 * 864e5).toISOString(), scope: 'r_ads,r_ads_reporting', connected_by: 'subs@lyzr.com', connected_at: '2026-10-01T00:00:00Z', ad_accounts: [{ id: ACC, name: 'Lyzr Ad Account', currency: 'USD', status: 'ACTIVE' }], selected_accounts: [ACC], last_sync: null, ...o } })
async function syncAll(w, body = {}, max = 30) {
  const replies = []
  let cursor = null
  for (let i = 0; i < max; i++) {
    const before = w.calls.length
    const res = await route.onRequestPost({ request: req('sync', { method: 'POST', headers: { 'X-CA-Cron': 'cron-secret' }, body: cursor ? { cursor } : body }), env: ENV })
    const r = await res.json()
    r._status = res.status
    r._calls = w.calls.length - before
    replies.push(r)
    if (r.done || res.status !== 200) break
    cursor = r.cursor
  }
  return replies
}

// ---- state --------------------------------------------------------------------------------
test('OAuth state: signed, verified, refused when tampered, expired or signed with another secret', async () => {
  const s = await L.signState(SECRET, { email: 'subs@lyzr.com', leads: true, ts: 1_000_000 })
  const p = await L.verifyState(SECRET, s, 1_000_000 + 60_000)
  assert.equal(p.email, 'subs@lyzr.com'); assert.equal(p.leads, true); assert.ok(p.nonce)
  assert.equal(await L.verifyState(SECRET, s, 1_000_000 + 15 * 60_000 + 1), null, 'older than 15 minutes')
  assert.equal(await L.verifyState('another-secret', s, 1_000_000), null)
  const [payload, sig] = s.split('.')
  const forged = Buffer.from(JSON.stringify({ email: 'evil@x.com', ts: 1_000_000, leads: false, nonce: 'n' })).toString('base64url')
  assert.equal(await L.verifyState(SECRET, `${forged}.${sig}`, 1_000_000), null)
  assert.equal(await L.verifyState(SECRET, payload, 1_000_000), null)
  assert.equal(await L.verifyState(SECRET, '', 1_000_000), null)
})

test('POST connect: editors get the LinkedIn sign-in URL; leads scope only when asked; viewers and a missing secret are refused', async () => {
  const w = world()
  await withFetch(w, async () => {
    let r = await route.onRequestPost({ request: req('connect', { method: 'POST', token: 'tok-editor', body: {} }), env: ENV })
    let b = await r.json()
    const u = new URL(b.url)
    assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/oauth/v2/authorization')
    assert.equal(u.searchParams.get('client_id'), '77yi254c3ocdlb')
    assert.equal(u.searchParams.get('redirect_uri'), `${ORIGIN}/api/ca/linkedin-api/callback`)
    assert.equal(u.searchParams.get('scope'), 'r_ads r_ads_reporting')
    assert.ok(await L.verifyState(SECRET, u.searchParams.get('state')))
    assert.ok(!b.url.includes(SECRET))
    r = await route.onRequestPost({ request: req('connect', { method: 'POST', token: 'tok-editor', body: { leads: true } }), env: ENV })
    b = await r.json()
    assert.equal(new URL(b.url).searchParams.get('scope'), 'r_ads r_ads_reporting r_marketing_leadgen_automation')
    r = await route.onRequestPost({ request: req('connect', { method: 'POST', token: 'tok-viewer', body: {} }), env: ENV })
    assert.equal(r.status, 403)
    r = await route.onRequestPost({ request: req('connect', { method: 'POST', token: 'tok-editor', body: {} }), env: { ...ENV, LINKEDIN_CLIENT_SECRET: '' } })
    assert.equal(r.status, 503)
  })
})

test('GET callback: exchanges the code, lists ad accounts, saves _li_oauth, redirects to Admin; errors redirect with a message', async () => {
  const w = world()
  await withFetch(w, async () => {
    const state = await L.signState(SECRET, { email: 'subs@lyzr.com', leads: false })
    const res = await route.onRequestGet({ request: req(`callback?code=good-code&state=${encodeURIComponent(state)}`), env: ENV })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('Location'), `${ORIGIN}/Campaign_Analytics/#/admin?linkedin=connected`)
    const tokenCall = w.calls.find((c) => c.url.endsWith('/oauth/v2/accessToken'))
    const form = Object.fromEntries(new URLSearchParams(tokenCall.body))
    assert.equal(form.grant_type, 'authorization_code'); assert.equal(form.client_id, '77yi254c3ocdlb'); assert.equal(form.redirect_uri, `${ORIGIN}/api/ca/linkedin-api/callback`)
    const doc = w.tables.ca_insights.find((r) => r.scope === '_li_oauth').content
    assert.equal(doc.access_token, ACCESS); assert.equal(doc.refresh_token, REFRESH); assert.equal(doc.connected_by, 'subs@lyzr.com')
    assert.deepEqual(doc.ad_accounts, [{ id: ACC, name: 'Lyzr Ad Account', currency: 'USD', status: 'ACTIVE' }])
    assert.deepEqual(doc.selected_accounts, [ACC])
    assert.ok(Date.parse(doc.expires_at) > Date.now() + 59 * 864e5); assert.ok(Date.parse(doc.refresh_expires_at) > Date.now() + 360 * 864e5)

    let r = await route.onRequestGet({ request: req('callback?error=user_cancelled_authorize&error_description=The+member+cancelled'), env: ENV })
    assert.match(r.headers.get('Location'), /linkedin=error&msg=.*cancelled/)
    r = await route.onRequestGet({ request: req('callback?code=good-code&state=forged.sig'), env: ENV })
    assert.match(decodeURIComponent(r.headers.get('Location')), /linkedin=error&msg=The sign-in link expired/)
  })
})

test('GET status and POST accounts never return a token; accounts keep only known ids', async () => {
  const w = world({ tables: { ca_insights: [connectedDoc()] } })
  await withFetch(w, async () => {
    let res = await route.onRequestGet({ request: req('status', { token: 'tok-viewer' }), env: ENV })
    let text = await res.text()
    const s = JSON.parse(text)
    assert.equal(s.configured, true); assert.equal(s.connected, true); assert.equal(s.connected_by, 'subs@lyzr.com')
    assert.equal(s.redirect_uri, `${ORIGIN}/api/ca/linkedin-api/callback`)
    for (const secret of [ACCESS, REFRESH, SECRET]) assert.ok(!text.includes(secret), 'status leaks ' + secret)
    assert.ok(!('access_token' in s) && !('refresh_token' in s))
    res = await route.onRequestPost({ request: req('accounts', { method: 'POST', token: 'tok-editor', body: { selected_accounts: [ACC, '999'] } }), env: ENV })
    text = await res.text()
    assert.deepEqual(JSON.parse(text).selected_accounts, [ACC])
    for (const secret of [ACCESS, REFRESH]) assert.ok(!text.includes(secret))
    assert.equal((await route.onRequestGet({ request: req('status'), env: ENV })).status, 401)
    res = await route.onRequestPost({ request: req('disconnect', { method: 'POST', token: 'tok-editor', body: {} }), env: ENV })
    assert.deepEqual(await res.json(), { ok: true })
    assert.ok(!w.tables.ca_insights.some((r) => r.scope === '_li_oauth'))
  })
})

test('POST sync: not connected answers 200 { done, skipped } so the daily job moves on', async () => {
  const w = world()
  await withFetch(w, async () => {
    const res = await route.onRequestPost({ request: req('sync', { method: 'POST', headers: { 'X-CA-Cron': 'cron-secret' }, body: {} }), env: ENV })
    assert.equal(res.status, 200)
    const b = await res.json()
    assert.equal(b.done, true); assert.equal(b.skipped, 'not connected')
    const v = await route.onRequestPost({ request: req('sync', { method: 'POST', token: 'tok-viewer', body: {} }), env: ENV })
    assert.equal(v.status, 403)
  })
})

test('token refresh: within 7 days of expiry the sync refreshes first; far from expiry it does not', async () => {
  const w = world({ tables: { ca_insights: [connectedDoc({ expires_at: new Date(Date.now() + 3 * 864e5).toISOString() })] } })
  await withFetch(w, async () => {
    await syncAll(w, { from: '2026-10-20', to: '2026-10-20' })
    const call = w.calls.find((c) => c.url.endsWith('/oauth/v2/accessToken'))
    assert.ok(call, 'refresh called')
    assert.equal(Object.fromEntries(new URLSearchParams(call.body)).grant_type, 'refresh_token')
    const doc = w.tables.ca_insights.find((r) => r.scope === '_li_oauth').content
    assert.equal(doc.access_token, 'AQX-new-access')
    assert.ok(Date.parse(doc.expires_at) > Date.now() + 59 * 864e5)
    assert.ok(w.calls.filter((c) => c.url.startsWith('https://api.linkedin.com/')).every((c) => c.headers.Authorization === 'Bearer AQX-new-access'))
  })
  const w2 = world({ tables: { ca_insights: [connectedDoc()] } })
  await withFetch(w2, async () => {
    await syncAll(w2, { from: '2026-10-20', to: '2026-10-20' })
    assert.ok(!w2.calls.some((c) => c.url.endsWith('/oauth/v2/accessToken')))
  })
  // expired and no way to refresh: a clear error, not a silent skip
  const w3 = world({ tables: { ca_insights: [connectedDoc({ expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token: null })] } })
  await withFetch(w3, async () => {
    const r = await syncAll(w3, {})
    assert.equal(r[0]._status, 409); assert.match(r[0].error, /Connect LinkedIn/)
  })
})

test('perf rows use the CSV keys: campaign_id = campaign group id (the export\'s "Campaign ID"), ad_id = creative id', () => {
  // the 2026 export: csv.mjs maps "Campaign ID" (the group) to campaign_id and keeps "Ad Set ID" in extra
  const csv = parseLinkedInCsv([
    'Start Date (in UTC)\tCampaign ID\tCampaign Name\tAd Set ID\tAd Set Name\tAd Set Objective\tAd Set Type\tAd Name\tAd ID\tTotal Spent\tImpressions\tClicks',
    `4/9/2026\t${GROUP}\tNvidia & AWS Post Amplification\t${CAMP}\tWP | GSI & Si Post | Brand awareness - Apr 9, 2026\tBrand awareness\tSponsored Update\t\t${CREATIVE}\t4.14\t69\t0`,
  ].join('\n'), 'x.csv').rows[0]
  const meta = { groups: { [GROUP]: 'Nvidia & AWS Post Amplification' }, campaigns: { [CAMP]: { n: 'WP | GSI & Si Post | Brand awareness - Apr 9, 2026', g: GROUP, o: L.objectiveLabel('BRAND_AWARENESS'), t: L.typeLabel('SPONSORED_UPDATES') } }, creatives: { [CREATIVE]: { n: 'GTC creative', c: CAMP } } }
  const api = L.perfRow({ pivotValues: [`urn:li:sponsoredCreative:${CREATIVE}`], dateRange: dr('2026-04-09'), impressions: 69, clicks: 0, costInLocalCurrency: '4.14', oneClickLeads: 2, oneClickLeadFormOpens: 5, sends: 3, opens: 1, totalEngagements: 7, approximateMemberReach: 60 }, meta)
  for (const k of ['day', 'campaign_id', 'ad_id', 'campaign_group', 'campaign', 'objective', 'format']) assert.equal(api[k], csv[k], k)
  assert.equal(api.spend, 4.14); assert.equal(api.leads, 2); assert.equal(api.lead_forms_opened, 5); assert.equal(api.engagements, 7); assert.equal(api.reach, 60)
  assert.equal(api['Ad Set ID'], Number(CAMP)); assert.equal(csv.extra['Ad Set ID'], Number(CAMP))
})

test('sync perf: an API row and a CSV row for the same ad and day overwrite each other; campaign-level rows of those days go', async () => {
  const csvUpload = { id: 'csv-up', channel: 'linkedin', kind: 'performance', platform: 'linkedin', file_name: 'Sept.csv', period_start: '2026-09-01', period_end: '2026-09-30', row_count: 2, uploaded_at: '2026-10-01T00:00:00Z' }
  const csvRow = { platform: 'linkedin', day: '2026-09-10', campaign_id: GROUP, ad_id: CREATIVE, upload_id: 'csv-up', campaign_group: 'Nvidia & AWS Post Amplification', campaign: 'WP | GSI & Si Post | Brand awareness - Apr 9, 2026', ad_name: 'What #GTC2026 taught us', impressions: 70, clicks: 1, spend: 4 }
  const campLevel = { platform: 'linkedin', day: '2026-09-11', campaign_id: GROUP, ad_id: '', upload_id: 'csv-up', impressions: 500 }
  const w = world({ tables: { ca_insights: [connectedDoc()], ca_uploads: [csvUpload], ca_li_perf: [csvRow, campLevel] } })
  await withFetch(w, async () => {
    const r = await syncAll(w, { from: '2026-09-01', to: '2026-09-30' })
    const last = r[r.length - 1]
    assert.equal(last.done, true); assert.equal(last.perf_rows, 2)
    const rows = w.tables.ca_li_perf.filter((x) => x.ad_id === CREATIVE)
    assert.equal(rows.length, 2, 'one row per ad per day, no duplicate')
    const sep10 = rows.find((x) => x.day === '2026-09-10')
    assert.equal(sep10.impressions, 69); assert.equal(sep10.spend, 4.14); assert.equal(sep10.campaign_id, GROUP)
    assert.equal(sep10.ad_name, 'GTC 2026 creative'); assert.equal(sep10.campaign_group, 'Nvidia & AWS Post Amplification')
    assert.equal(sep10.objective, 'Brand awareness'); assert.equal(sep10.format, 'Sponsored Update'); assert.equal(sep10.extra.source, 'api')
    assert.ok(!w.tables.ca_li_perf.some((x) => x.ad_id === '' && x.day === '2026-09-11'), 'campaign-level CSV row of an ad-level API day removed')
    const apiUp = w.tables.ca_uploads.find((u) => u.file_name === 'LinkedIn API' && u.kind === 'performance')
    assert.equal(apiUp.notes, 'api'); assert.equal(apiUp.platform, 'linkedin'); assert.equal(sep10.upload_id, apiUp.id); assert.equal(apiUp.row_count, 2)
    // a second sync of the same days keeps one row per ad and day and reuses the API upload
    await syncAll(w, { from: '2026-09-01', to: '2026-09-30' })
    assert.equal(w.tables.ca_li_perf.filter((x) => x.ad_id === CREATIVE).length, 2)
    assert.equal(w.tables.ca_uploads.filter((u) => u.file_name === 'LinkedIn API' && u.kind === 'performance').length, 1)
    // last_sync recorded, cache bumped
    assert.equal(w.tables.ca_insights.find((x) => x.scope === '_li_oauth').content.last_sync.perf_rows, 2)
    assert.ok((w.tables.ca_cache || []).some((x) => x.key === '_version'))
  })
})

test('sync demographics: CSV segment names, one window per month, a month a CSV export covers is not pulled', async () => {
  const csvDemo = { id: 'csv-demo', channel: 'linkedin', kind: 'demographics', platform: 'linkedin', file_name: 'Sept demographics.csv', notes: 'Company, Company Size, Country, County, DMA, Industry, Job Function, Job Seniority, Job Title, Location', period_start: '2026-09-01', period_end: '2026-09-30', row_count: 40, uploaded_at: '2026-10-01T00:00:00Z' }
  const w = world({ tables: { ca_insights: [connectedDoc()], ca_uploads: [csvDemo] } })
  await withFetch(w, async () => {
    const r = await syncAll(w, { from: '2026-09-01', to: '2026-10-21' })
    const last = r[r.length - 1]
    assert.equal(last.done, true)
    assert.equal(last.demo_windows, 1, 'only October: September comes from the CSV')
    assert.ok(last.warnings.some((x) => /2026-09/.test(x) && /CSV/.test(x)))
    const apiWins = w.tables.ca_uploads.filter((u) => u.kind === 'demographics' && u.file_name === 'LinkedIn API')
    assert.deepEqual(apiWins.map((u) => [u.period_start, u.period_end]), [['2026-10-01', '2026-10-21']])
    assert.equal(apiWins[0].notes, 'Company, Company Size, Country, Industry, Job Function, Job Seniority, Job Title')
    const rows = w.tables.ca_li_demo.filter((x) => x.upload_id === apiWins[0].id)
    const val = (seg) => rows.filter((x) => x.segment === seg).map((x) => x.value)
    assert.deepEqual(val('Company').sort(), ['Accenture', 'urn:li:organization:9999'])
    assert.deepEqual(val('Country'), ['United States']); assert.deepEqual(val('Job Seniority'), ['Director']); assert.deepEqual(val('Job Title'), ['Managing Director'])
    assert.deepEqual(val('Job Function'), ['Information Technology']); assert.deepEqual(val('Industry'), ['IT Services and IT Consulting']); assert.deepEqual(val('Company Size'), ['10001+ employees'])
    const acc = rows.find((x) => x.value === 'Accenture')
    assert.equal(acc.impressions, 2010); assert.equal(acc.spend, 50.5); assert.equal(acc.campaign, '')
    assert.equal(apiWins[0].row_count, rows.length)
    assert.ok(!w.tables.ca_uploads.some((u) => u.kind === 'demographics' && u.file_name === 'LinkedIn API' && u.period_start === '2026-09-01'))
    // re-sync replaces the October API window instead of adding another
    await syncAll(w, { from: '2026-10-05', to: '2026-10-21' })
    assert.equal(w.tables.ca_uploads.filter((u) => u.kind === 'demographics' && u.file_name === 'LinkedIn API').length, 1)
  })
})

test('names: Ad Targeting API first, batch-get endpoints next; when nothing answers the URN text is kept with a warning', async () => {
  // targeting refused, organizationsLookup answers
  const w = world({ tables: { ca_insights: [connectedDoc()] }, li: (u) => (u.pathname.endsWith('/adTargetingEntities') ? { status: 403, body: { message: 'Not enough permissions' } } : null) })
  await withFetch(w, async () => {
    const r = await syncAll(w, { from: '2026-10-01', to: '2026-10-21' })
    assert.equal(r[r.length - 1].done, true)
    const vals = w.tables.ca_li_demo.filter((x) => x.segment === 'Company').map((x) => x.value).sort()
    assert.deepEqual(vals, ['Accenture', 'urn:li:organization:9999'])
    assert.equal(w.tables.ca_li_demo.find((x) => x.segment === 'Job Title').value, 'Managing Director', 'titles via /titles')
    assert.ok(w.tables.ca_insights.find((x) => x.scope === '_li_names').content.org['1033'] === 'Accenture', 'names cached for the next sync')
  })
  // every company endpoint refused: URN text and a warning, other segments unaffected
  const w2 = world({ tables: { ca_insights: [connectedDoc()] }, li: (u) => (/\/(adTargetingEntities|organizationsLookup)$/.test(u.pathname) ? { status: 403, body: { message: 'Not enough permissions' } } : null) })
  await withFetch(w2, async () => {
    const r = await syncAll(w2, { from: '2026-10-01', to: '2026-10-21' })
    const last = r[r.length - 1]
    assert.equal(last.done, true)
    assert.deepEqual(w2.tables.ca_li_demo.filter((x) => x.segment === 'Company').map((x) => x.value).sort(), ['urn:li:organization:1033', 'urn:li:organization:9999'])
    assert.ok(last.warnings.some((x) => /company names/.test(x)))
    assert.equal(w2.tables.ca_li_demo.find((x) => x.segment === 'Country').value, 'United States')
  })
})

test('no double count: a CSV window beats any API window it overlaps, whichever is newer; segments match csv.mjs names', () => {
  const u = (id, file, start, end, at, notes) => ({ id, kind: 'demographics', platform: 'linkedin', file_name: file, period_start: start, period_end: end, uploaded_at: at, notes, row_count: 10 })
  const list = [
    u('csv-sep', 'Sept.csv', '2026-09-01', '2026-09-30', '2026-10-01T00:00:00Z', 'Company'),
    u('api-sep', 'LinkedIn API', '2026-09-01', '2026-09-30', '2026-10-21T00:00:00Z', L.API_DEMO_NOTES),  // newer, still dropped
    u('api-oct', 'LinkedIn API', '2026-10-01', '2026-10-21', '2026-10-21T00:00:00Z', L.API_DEMO_NOTES),
    u('anju', 'Anju.csv', '2026-10-01', '2026-10-15', '2026-10-16T00:00:00Z', 'Company (Anju)'),          // tagged subset does not hide the API window
  ]
  assert.deepEqual(activeWindows(list).map((x) => x.id).sort(), ['anju', 'api-oct', 'csv-sep'])
  const wins = list.map((x) => ({ upload: x, rows: [{ segment: 'Company', value: 'EY', impressions: 1 }] }))
  assert.deepEqual(activeWindowsFront(wins).map((x) => x.upload.id).sort(), ['anju', 'api-oct', 'csv-sep'])
  // pure helpers behind the gap fill
  assert.deepEqual(L.subtractRanges('2026-09-01', '2026-09-30', [{ period_start: '2026-09-01', period_end: '2026-09-14' }]), [{ from: '2026-09-15', to: '2026-09-30' }])
  assert.deepEqual(L.subtractRanges('2026-09-01', '2026-09-30', [{ period_start: '2026-08-01', period_end: '2026-10-31' }]), [])
  assert.deepEqual(L.monthWindows('2026-09-17', '2026-10-21').map((m) => [m.from, m.to]), [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-21']])
  // segment names are the ones js/csv.mjs gives the CSV tables
  const csvSegments = ['Company', 'Country', 'Job Seniority', 'Job Title', 'Job Function', 'Industry', 'Company Size']
  assert.deepEqual(L.DEMO_PIVOTS.map((p) => p[1]), csvSegments)
  assert.equal(L.companySizeLabel('SIZE_1001_TO_5000'), '1001-5000 employees'); assert.equal(L.companySizeLabel('SIZE_1'), '1 employee'); assert.equal(L.companySizeLabel('G'), '1001-5000 employees')
  assert.deepEqual(L.demoRows([{ pivotValues: ['urn:li:seniority:8'], impressions: 3 }, { pivotValues: ['urn:li:seniority:8'], impressions: 2 }], 'Job Seniority', 'seniority', {}).map((r) => [r.value, r.impressions]), [['CXO', 5]])
})

test('sync leads: lead-form responses mapped to the lead shape and written to leads:li-api (only with the leads scope)', async () => {
  const w = world({ tables: { ca_insights: [connectedDoc({ scope: 'r_ads,r_ads_reporting,r_marketing_leadgen_automation' })] } })
  await withFetch(w, async () => {
    const r = await syncAll(w, { from: '2026-10-20', to: '2026-10-20' })
    assert.equal(r[r.length - 1].leads, 1, 'the test lead is left out')
    const doc = w.tables.ca_insights.find((x) => x.scope === 'leads:li-api').content
    assert.equal(doc.source, 'api'); assert.equal(doc.file_name, 'LinkedIn API'); assert.equal(doc.uploaded_by, 'linkedin-api'); assert.ok(doc.uploaded_at)
    const lead = doc.rows[0]
    assert.equal(lead.submitted_at, '2026-10-02T09:30:00.000Z')
    assert.equal(lead.first_name, 'Asha'); assert.equal(lead.last_name, 'Rao'); assert.equal(lead.email, 'asha@accenture.com'); assert.equal(lead.company, 'Accenture')
    assert.equal(lead.form, 'Book a demo form'); assert.equal(lead.campaign, 'WP | GSI & Si Post | Brand awareness - Apr 9, 2026'); assert.equal(lead.campaign_group, 'Nvidia & AWS Post Amplification'); assert.equal(lead.ad, 'GTC 2026 creative')
    assert.equal(lead.source, 'api'); assert.equal(lead.lead_type, ''); assert.equal(lead.extra['Are you interested'], 'Yes')
    for (const k of ['title', 'seniority', 'country', 'city', 'industry', 'company_size', 'phone', 'linkedin_url']) assert.equal(lead[k], '', k)
    assert.ok(!w.tables.ca_insights.some((x) => x.scope === '_li_leads_stage'), 'staging doc removed')
  })
  // without the scope no lead endpoint is called
  const w2 = world({ tables: { ca_insights: [connectedDoc()] } })
  await withFetch(w2, async () => {
    await syncAll(w2, { from: '2026-10-20', to: '2026-10-20' })
    assert.ok(!w2.calls.some((c) => /leadForm/.test(c.url)))
  })
})

test('cursor: a long range resumes over several calls, each under the subrequest budget, and ends with the same totals', async () => {
  const w = world({ tables: { ca_insights: [connectedDoc()] } })
  await withFetch(w, async () => {
    const r = await syncAll(w, {}, 60)   // first sync: 2026-04-01 to today
    const last = r[r.length - 1]
    assert.equal(last.done, true)
    assert.ok(r.length > 1, `resumed over ${r.length} calls`)
    for (const x of r) assert.ok(x._calls <= 45, `one call used ${x._calls} subrequests`)
    assert.equal(r[0].from, '2026-04-01')
    assert.ok(r.slice(0, -1).every((x) => x.cursor && x.cursor.v === 1 && x.progress && x.progress.phase))
    assert.equal(last.perf_rows, PERF_DAYS.length)
    assert.equal(last.demo_windows, L.monthWindows('2026-04-01', L.todayUtc()).length)
    for (const x of r) assert.ok(!JSON.stringify(x).includes(ACCESS) && !JSON.stringify(x).includes(REFRESH), 'sync reply leaks a token')
    // the next daily run re-pulls from 14 days before the newest API day
    const again = await syncAll(w, {})
    assert.equal(again[0].from, L.addDays('2026-10-20', -13))
  })
})
