// LinkedIn Marketing API connection for Campaign Analytics (read-only against LinkedIn).
// Routes live in functions/api/ca/linkedin-api/[[path]].js; everything testable is here.
//
// Sign-in: 3-legged OAuth (client_credentials is refused for this app). An editor presses Connect in
// Admin, LinkedIn redirects the browser to /api/ca/linkedin-api/callback, the code is exchanged and the
// token is stored in the private document `_li_oauth` (ca_insights, never served by any GET). The
// refresh token (about a year) keeps it working; the access token is refreshed within 7 days of expiry.
//
// Sync (resumable, cursor): meta (campaign groups, campaigns, creatives) -> perf (adAnalytics CREATIVE x
// DAILY into ca_li_perf with the CSV keys) -> demo (one window per calendar month, MEMBER_* pivots into
// ca_li_demo, only for days no CSV demographics window covers) -> leads (lead-form responses, when the
// r_marketing_leadgen_automation scope was granted) -> finish (last_sync, cache version).
//
// Keys, verified against js/csv.mjs and the 2026 "Ad Performance Report" export (2026-10-21): the export's
// "Campaign ID" column is the campaign GROUP id (Campaign Name = the group) and csv.mjs maps it to
// campaign_id; "Ad Set ID" (the API's sponsoredCampaign) lands in extra; "Ad ID" = the creative id. API rows
// use exactly that: campaign_id = campaign group id, ad_id = creative id, campaign = campaign (ad set) name,
// campaign_group = group name, extra['Ad Set ID'] = campaign id. Same (platform, day, campaign_id, ad_id)
// key, so an API row and a CSV row for the same ad and day overwrite each other.

import { HttpError, isoDay, num } from './http.js'
import { db, inChunks } from './db.js'
import { getDoc, putDoc, delDoc } from './docs.js'
import { bumpCacheVersion } from './cache.js'
import { API_FILE, isApiUpload, isTagged } from './windows.js'
import { normalisePerfRow, normaliseDemoRow } from '../uploads.js'

export { API_FILE }
export const LI_REST = 'https://api.linkedin.com/rest'
export const LI_V2 = 'https://api.linkedin.com/v2'
export const LI_OAUTH = 'https://www.linkedin.com/oauth/v2'
export const DEFAULT_CLIENT_ID = '774euwn4y0mlz5'   // public: a client id is not a secret
export const DEFAULT_VERSION = '202609'             // LinkedIn-Version YYYYMM; override with LINKEDIN_API_VERSION
export const DOC = '_li_oauth'
export const META_DOC = '_li_meta'
export const NAMES_DOC = '_li_names'
export const STAGE_DOC = '_li_leads_stage'
export const LEADS_DOC = 'leads:li-api'
export const FIRST_DAY = '2026-04-01'
export const REPULL_DAYS = 14
export const BASE_SCOPES = ['r_ads', 'r_ads_reporting']
export const LEADS_SCOPE = 'r_marketing_leadgen_automation'
export const STATE_TTL_MS = 15 * 60 * 1000
export const REFRESH_WITHIN_MS = 7 * 864e5
export const CALL_BUDGET = 40           // Cloudflare allows 50 subrequests per invocation
export const TIME_BUDGET_MS = 22000     // stop starting new work after this, answer well under 25 s
export const PERF_CHUNK_DAYS = 31
export const BATCH = 500
export const DAILY_RETENTION_DAYS = 180 // timeGranularity=ALL rounds partial months older than this to whole months
export const PERF_FIELDS = ['dateRange', 'pivotValues', 'impressions', 'clicks', 'costInLocalCurrency', 'oneClickLeads', 'oneClickLeadFormOpens',
  'videoViews', 'sends', 'opens', 'totalEngagements', 'reactions', 'comments', 'shares', 'follows', 'viralImpressions',
  'externalWebsiteConversions', 'landingPageClicks', 'approximateMemberReach']
export const DEMO_FIELDS = ['pivotValues', 'impressions', 'clicks', 'costInLocalCurrency', 'oneClickLeads', 'sends', 'opens', 'totalEngagements']
// pivot, segment name exactly as js/csv.mjs names the CSV tables, name resolver kind
export const DEMO_PIVOTS = [
  ['MEMBER_COMPANY', 'Company', 'org'],
  ['MEMBER_COUNTRY_V2', 'Country', 'geo'],
  ['MEMBER_SENIORITY', 'Job Seniority', 'seniority'],
  ['MEMBER_JOB_TITLE', 'Job Title', 'title'],
  ['MEMBER_JOB_FUNCTION', 'Job Function', 'function'],
  ['MEMBER_INDUSTRY', 'Industry', 'industry'],
  ['MEMBER_COMPANY_SIZE', 'Company Size', 'size'],
]
// notes of an API demographics upload: its segments, sorted and joined like the uploader does for a CSV
export const API_DEMO_NOTES = DEMO_PIVOTS.map((p) => p[1]).sort().join(', ')

// ---- labels that match the CSV exports ----------------------------------------
export const SENIORITIES = { 1: 'Unpaid', 2: 'Training', 3: 'Entry', 4: 'Senior', 5: 'Manager', 6: 'Director', 7: 'VP', 8: 'CXO', 9: 'Partner', 10: 'Owner' }
export const FUNCTIONS = { 1: 'Accounting', 2: 'Administrative', 3: 'Arts and Design', 4: 'Business Development', 5: 'Community and Social Services', 6: 'Consulting', 7: 'Education', 8: 'Engineering', 9: 'Entrepreneurship', 10: 'Finance', 11: 'Healthcare Services', 12: 'Human Resources', 13: 'Information Technology', 14: 'Legal', 15: 'Marketing', 16: 'Media and Communication', 17: 'Military and Protective Services', 18: 'Operations', 19: 'Product Management', 20: 'Program and Project Management', 21: 'Purchasing', 22: 'Quality Assurance', 23: 'Real Estate', 24: 'Research', 25: 'Sales', 26: 'Customer Success and Support' }
const SIZE_LETTERS = { A: 'SIZE_1', B: 'SIZE_2_TO_10', C: 'SIZE_11_TO_50', D: 'SIZE_51_TO_200', E: 'SIZE_201_TO_500', F: 'SIZE_501_TO_1000', G: 'SIZE_1001_TO_5000', H: 'SIZE_5001_TO_10000', I: 'SIZE_10001_OR_MORE' }
/** 'SIZE_1001_TO_5000' -> '1001-5000 employees' (the CSV label); also accepts letter codes and URNs. */
export function companySizeLabel(v) {
  let s = String(v || '').trim()
  const tail = s.split(':').pop().replace(/[()]/g, '')
  if (SIZE_LETTERS[tail]) s = SIZE_LETTERS[tail]
  let m
  if ((m = s.match(/(\d+)_TO_(\d+)/i))) return `${m[1]}-${m[2]} employees`
  if ((m = s.match(/(\d+)_OR_MORE/i)) || (m = s.match(/(\d+)\+/))) return `${m[1]}+ employees`
  if (/SIZE_1$/i.test(s) || s === '1') return '1 employee'
  return s
}
const OBJECTIVES = { BRAND_AWARENESS: 'Brand awareness', WEBSITE_VISIT: 'Website visits', WEBSITE_TRAFFIC: 'Website visits', ENGAGEMENT: 'Engagement', CREATIVE_ENGAGEMENT: 'Engagement', VIDEO_VIEW: 'Video views', LEAD_GENERATION: 'Lead generation', WEBSITE_CONVERSION: 'Website conversions', JOB_APPLICANT: 'Job applicants', TALENT_LEAD: 'Talent leads' }
const TYPES = { SPONSORED_UPDATES: 'Sponsored Update', SPONSORED_INMAILS: 'Sponsored Messaging', TEXT_AD: 'Text Ad', DYNAMIC: 'Dynamic' }
const titleCase = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
export const objectiveLabel = (v) => (v ? OBJECTIVES[v] || titleCase(v) : null)
export const typeLabel = (v) => (v ? TYPES[v] || titleCase(v) : null)

// ---- small helpers ------------------------------------------------------------
export const idOf = (urn) => (urn == null ? '' : String(urn).split(':').pop().replace(/[()]/g, ''))
const DAY = 864e5
export const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * DAY).toISOString().slice(0, 10)
export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
const ymd = (d) => (d && d.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : '')
export const restliDate = (s) => { const [y, m, d] = s.split('-').map(Number); return `(year:${y},month:${m},day:${d})` }
export const dateRange = (a, b) => `(start:${restliDate(a)},end:${restliDate(b)})`
const enc = encodeURIComponent
export const accountsList = (ids) => `List(${ids.map((id) => enc(`urn:li:sponsoredAccount:${id}`)).join(',')})`
const accountOwner = (id) => `(sponsoredAccount:${enc(`urn:li:sponsoredAccount:${id}`)})`
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

/** [from,to] split into pieces of at most `days` days. */
export function splitRange(from, to, days = PERF_CHUNK_DAYS) {
  const out = []
  for (let a = from; a <= to; a = addDays(a, days)) { const b = addDays(a, days - 1); out.push([a, b < to ? b : to]) }
  return out
}
/** One window per calendar month touched by [from,to]; the last one stops at `to`. */
export function monthWindows(from, to) {
  const out = []
  let a = from.slice(0, 8) + '01'
  while (a <= to) {
    const next = new Date(Date.UTC(+a.slice(0, 4), +a.slice(5, 7), 1)).toISOString().slice(0, 10)
    const end = addDays(next, -1)
    out.push({ from: a, to: end < to ? end : to, month: a.slice(0, 7) })
    a = next
  }
  return out
}
/** Parts of [from,to] not covered by any of `ranges` ({period_start, period_end}). */
export function subtractRanges(from, to, ranges) {
  let parts = [{ from, to }]
  for (const r of ranges || []) {
    const s = r.period_start, e = r.period_end
    if (!s || !e) continue
    const next = []
    for (const p of parts) {
      if (e < p.from || s > p.to) { next.push(p); continue }
      if (s > p.from) next.push({ from: p.from, to: addDays(s, -1) })
      if (e < p.to) next.push({ from: addDays(e, 1), to: p.to })
    }
    parts = next
  }
  return parts
}

// ---- config -----------------------------------------------------------------
export const clientId = (env) => String((env && env.LINKEDIN_CLIENT_ID) || DEFAULT_CLIENT_ID).trim()
export const configured = (env) => Boolean(env && env.LINKEDIN_CLIENT_SECRET)
export const apiVersion = (env) => String((env && env.LINKEDIN_API_VERSION) || DEFAULT_VERSION).trim()
export const redirectUri = (env, origin) => String((env && env.LINKEDIN_REDIRECT_URI) || `${origin}/api/ca/linkedin-api/callback`)
export const hasLeadsScope = (o) => String((o && o.scope) || '').split(/[\s,]+/).includes(LEADS_SCOPE)
function needSecret(env) {
  if (!configured(env)) throw new HttpError(503, 'LinkedIn is not configured (set the Pages secret LINKEDIN_CLIENT_SECRET)')
  return env.LINKEDIN_CLIENT_SECRET
}

// ---- OAuth state: base64url(JSON) + "." + HMAC-SHA256(secret), valid 15 minutes ----
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
}
export async function signState(secret, { email, leads, ts = Date.now(), nonce } = {}) {
  const n = nonce || b64u(crypto.getRandomValues(new Uint8Array(12)))
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ email, ts, leads: !!leads, nonce: n })))
  return `${payload}.${await hmac(secret, payload)}`
}
/** -> { email, ts, leads, nonce } or null (bad signature, malformed, expired or from the future). */
export async function verifyState(secret, state, now = Date.now()) {
  try {
    const [payload, sig] = String(state || '').split('.')
    if (!payload || !sig || !secret) return null
    if (!same(sig, await hmac(secret, payload))) return null
    const p = JSON.parse(new TextDecoder().decode(fromB64u(payload)))
    if (!p || !p.email || !Number.isFinite(p.ts)) return null
    if (now - p.ts > STATE_TTL_MS || p.ts - now > 60000) return null
    return p
  } catch { return null }
}
export async function authorizeUrl(env, origin, { email, leads }) {
  const secret = needSecret(env)
  const scope = [...BASE_SCOPES, ...(leads ? [LEADS_SCOPE] : [])].join(' ')
  const state = await signState(secret, { email, leads })
  const url = `${LI_OAUTH}/authorization?` + new URLSearchParams({ response_type: 'code', client_id: clientId(env), redirect_uri: redirectUri(env, origin), state, scope })
  return { url, scope, redirect_uri: redirectUri(env, origin) }
}

// ---- token exchange and refresh ------------------------------------------------
async function tokenCall(params) {
  const res = await fetch(`${LI_OAUTH}/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new HttpError(502, `LinkedIn token ${res.status}: ${String(body.error_description || body.error || 'no access token').slice(0, 200)}`)
  return body
}
export function tokenFields(tok, now = Date.now(), prev = {}) {
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || prev.refresh_token || null,
    expires_at: new Date(now + num(tok.expires_in, 0) * 1000).toISOString(),
    refresh_expires_at: tok.refresh_token_expires_in ? new Date(now + num(tok.refresh_token_expires_in, 0) * 1000).toISOString() : (prev.refresh_expires_at || null),
    scope: tok.scope || prev.scope || '',
  }
}
export async function exchangeCode(env, code, redirect) {
  return tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId(env), client_secret: needSecret(env) })
}
/** Refresh when the access token ends within 7 days. Saves the doc. -> the (possibly new) doc content. */
export async function ensureFresh(env, o, now = Date.now(), t = null) {
  const exp = Date.parse(o.expires_at || '') || 0
  if (exp - now > REFRESH_WITHIN_MS) return o
  const refreshOk = o.refresh_token && (!o.refresh_expires_at || Date.parse(o.refresh_expires_at) > now)
  if (!refreshOk) {
    if (exp > now) return o
    throw new HttpError(409, 'The LinkedIn sign-in has expired. An editor needs to press Connect LinkedIn in Admin again.')
  }
  if (t) t.calls += 2
  const tok = await tokenCall({ grant_type: 'refresh_token', refresh_token: o.refresh_token, client_id: clientId(env), client_secret: needSecret(env) })
  const next = { ...o, ...tokenFields(tok, now, o), refreshed_at: new Date(now).toISOString() }
  await putDoc(env, DOC, next, { by: o.connected_by || null })
  return next
}

// ---- LinkedIn REST -------------------------------------------------------------
export class LiError extends HttpError {}
export async function liGet(token, version, path, t = null) {
  if (t) t.calls++
  const url = /^https:/.test(path) ? path : LI_REST + path
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0', Accept: 'application/json' } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new LiError(res.status >= 500 ? 502 : res.status === 401 ? 409 : 502, `LinkedIn ${res.status} on ${url.replace(/^https:\/\/api\.linkedin\.com/, '').split('?')[0]}: ${String(body.message || body.error_description || '').slice(0, 200)}`)
    e.liStatus = res.status
    throw e
  }
  return body
}

export async function listAdAccounts(token, version, t = null) {
  const users = await liGet(token, version, '/adAccountUsers?q=authenticatedUser', t)
  const ids = [...new Set((users.elements || []).map((e) => idOf(e.account)).filter(Boolean))]
  const out = []
  for (const id of ids.slice(0, 20)) {
    try {
      const a = await liGet(token, version, `/adAccounts/${id}`, t)
      out.push({ id: String(id), name: a.name || `Account ${id}`, currency: a.currency || null, status: a.status || null })
    } catch { out.push({ id: String(id), name: `Account ${id}`, currency: null, status: null }) }
  }
  return out
}

/** What GET status answers: never a token. */
export function publicStatus(env, doc, origin) {
  const o = (doc && doc.content) || null
  return {
    configured: configured(env),
    connected: !!(o && o.access_token),
    connected_by: o ? o.connected_by || null : null,
    connected_at: o ? o.connected_at || null : null,
    expires_at: o ? o.expires_at || null : null,
    refresh_expires_at: o ? o.refresh_expires_at || null : null,
    has_refresh_token: !!(o && o.refresh_token),
    scope: o ? o.scope || '' : '',
    leads_enabled: hasLeadsScope(o),
    member_name: o ? o.member_name || null : null,
    ad_accounts: o ? o.ad_accounts || [] : [],
    selected_accounts: o ? o.selected_accounts || [] : [],
    last_sync: o ? o.last_sync || null : null,
    redirect_uri: redirectUri(env, origin),
    client_id: clientId(env),
  }
}

/** Callback: verify state, exchange the code, list ad accounts, store `_li_oauth`. -> { ok, accounts, warnings } */
export async function completeCallback(env, origin, params, now = Date.now()) {
  const secret = needSecret(env)
  if (params.error) throw new HttpError(400, `LinkedIn said: ${String(params.error_description || params.error).slice(0, 200)}`)
  const st = await verifyState(secret, params.state, now)
  if (!st) throw new HttpError(400, 'The sign-in link expired or was not started here. Press Connect LinkedIn again.')
  if (!params.code) throw new HttpError(400, 'LinkedIn did not send a code.')
  const tok = await exchangeCode(env, params.code, redirectUri(env, origin))
  const fields = tokenFields(tok, now)
  const warnings = []
  let accounts = []
  try { accounts = await listAdAccounts(fields.access_token, apiVersion(env)) } catch (e) { warnings.push('Could not list ad accounts: ' + e.message) }
  const prev = await getDoc(env, DOC).catch(() => null)
  const p = (prev && prev.content) || {}
  const ids = accounts.map((a) => a.id)
  const kept = (p.selected_accounts || []).filter((id) => ids.includes(String(id)))
  const active = accounts.filter((a) => !a.status || a.status === 'ACTIVE').map((a) => a.id)
  const content = {
    ...fields,
    connected_by: st.email,
    connected_at: new Date(now).toISOString(),
    ad_accounts: accounts,
    selected_accounts: kept.length ? kept : (active.length ? active : ids),
    last_sync: p.last_sync || null,
    asked_leads: !!st.leads,
  }
  await putDoc(env, DOC, content, { by: st.email })
  return { ok: true, accounts, warnings, leads: hasLeadsScope(content) }
}

// ---- budget-aware db --------------------------------------------------------------
function tracked(d, t) {
  const wrap = (fn) => (...a) => { t.calls++; return fn(...a) }
  return { select: wrap(d.select), selectAll: wrap(d.selectAll), insert: wrap(d.insert), upsert: wrap(d.upsert), update: wrap(d.update), del: wrap(d.del) }
}
/** Exact row count with PostgREST's Content-Range (one HEAD request). */
export async function countRows(env, table, params) {
  const base = String(env.CA_SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/'
  const u = new URL(base + table)
  for (const [k, v] of Object.entries(params)) u.searchParams.append(k, v)
  u.searchParams.set('select', 'day')
  const headers = { apikey: env.CA_SUPABASE_KEY, Prefer: 'count=exact', Range: '0-0' }
  if (!String(env.CA_SUPABASE_KEY).startsWith('sb_')) headers.Authorization = `Bearer ${env.CA_SUPABASE_KEY}`
  const res = await fetch(u.toString(), { method: 'HEAD', headers })
  const m = String(res.headers.get('content-range') || '').match(/\/(\d+)$/)
  return m ? Number(m[1]) : null
}

// ---- mapping ------------------------------------------------------------------------
/** One adAnalytics CREATIVE x DAILY element -> a row shaped like a js/csv.mjs performance row. */
export function perfRow(e, meta) {
  const creativeId = idOf((e.pivotValues || [])[0])
  const cr = meta.creatives[creativeId] || {}
  const campId = cr.c || ''
  const camp = meta.campaigns[campId] || {}
  const groupId = camp.g || ''
  const row = {
    day: ymd(e.dateRange && e.dateRange.start),
    campaign_id: groupId,
    ad_id: creativeId,
    campaign_group: meta.groups[groupId] || '',
    campaign: camp.n || '',
    ad_name: cr.n || '',
    objective: camp.o || '',
    format: camp.t || '',
    impressions: num(e.impressions), clicks: num(e.clicks), spend: num(e.costInLocalCurrency),
    reach: num(e.approximateMemberReach), leads: num(e.oneClickLeads), lead_forms_opened: num(e.oneClickLeadFormOpens),
    video_views: num(e.videoViews), sends: num(e.sends), opens: num(e.opens), engagements: num(e.totalEngagements),
    reactions: num(e.reactions), comments: num(e.comments), shares: num(e.shares), follows: num(e.follows),
    viral_impressions: num(e.viralImpressions), conversions: num(e.externalWebsiteConversions),
    source: 'api',
  }
  if (campId) row['Ad Set ID'] = Number(campId) || campId
  if (e.landingPageClicks != null) row['Clicks to Landing Page'] = num(e.landingPageClicks)
  return row
}

export function nameOf(x) {
  if (!x || typeof x !== 'object') return ''
  if (x.localizedName) return String(x.localizedName)
  if (x.defaultLocalizedName && x.defaultLocalizedName.value) return String(x.defaultLocalizedName.value)
  const n = x.name
  if (typeof n === 'string') return n
  if (n && n.localized) return String(n.localized.en_US || Object.values(n.localized)[0] || '')
  if (n && n.value) return String(n.value)
  return ''
}

/** Label for one demographic pivot value. names = { org:{id:name}, geo:{}, title:{}, industry:{} }. */
export function demoLabel(kind, urn, names) {
  const id = idOf(urn)
  if (kind === 'size') return companySizeLabel(urn)
  if (kind === 'seniority') return SENIORITIES[id] || (names.seniority && names.seniority[id]) || String(urn)
  if (kind === 'function') return FUNCTIONS[id] || (names.function && names.function[id]) || String(urn)
  const n = names[kind] && names[kind][id]
  return n || String(urn)
}

/** adAnalytics MEMBER_* elements -> ca_li_demo rows (CSV shape), duplicates of one label summed. */
export function demoRows(elements, segment, kind, names) {
  const m = new Map()
  for (const e of elements || []) {
    const urn = (e.pivotValues || [])[0]
    if (urn == null) continue
    const value = demoLabel(kind, urn, names)
    if (!m.has(value)) m.set(value, { segment, value, campaign: '', impressions: 0, clicks: 0, spend: 0, sends: 0, opens: 0, engagements: 0, leads: 0, source: 'api' })
    const r = m.get(value)
    r.impressions += num(e.impressions); r.clicks += num(e.clicks); r.spend += num(e.costInLocalCurrency)
    r.sends += num(e.sends); r.opens += num(e.opens); r.engagements += num(e.totalEngagements); r.leads += num(e.oneClickLeads)
  }
  return [...m.values()]
}

const LEAD_FIELDS = { FIRST_NAME: 'first_name', LAST_NAME: 'last_name', EMAIL: 'email', WORK_EMAIL: 'email', COMPANY_NAME: 'company', JOB_TITLE: 'title', SENIORITY: 'seniority', COUNTRY: 'country', CITY: 'city', INDUSTRY: 'industry', COMPANY_SIZE: 'company_size', PHONE_NUMBER: 'phone', WORK_PHONE_NUMBER: 'phone', LINKEDIN_PROFILE_LINK: 'linkedin_url' }
const loc = (t) => (t && t.localized ? String(t.localized.en_US || Object.values(t.localized)[0] || '') : typeof t === 'string' ? t : '')
/** A lead form -> { n: name, q: { questionId: { f: predefinedField, n: label, o: { optionId: text } } } } */
export function compactForm(f) {
  const q = {}
  for (const x of (f && f.content && f.content.questions) || []) {
    const opts = {}
    const mc = x.questionDetails && x.questionDetails.multipleChoiceQuestionDetails
    for (const o of (mc && mc.options) || []) opts[o.id] = loc(o.text)
    q[x.questionId] = { f: x.predefinedField || null, n: loc(x.question) || x.name || `Question ${x.questionId}`, o: opts }
  }
  return { n: f.name || `Form ${f.id}`, q }
}
/** One leadFormResponse -> the lead shape the Lead pages read. */
export function mapLead(e, forms, meta) {
  const formId = (String(e.versionedLeadGenFormUrn || '').match(/leadGenForm:(\d+)/) || [])[1] || ''
  const form = forms[formId] || { n: '', q: {} }
  const lead = { submitted_at: e.submittedAt ? new Date(Number(e.submittedAt)).toISOString() : '', first_name: '', last_name: '', email: '', company: '', title: '', seniority: '', country: '', city: '', industry: '', company_size: '', campaign: '', campaign_group: '', ad: '', form: form.n || '', lead_type: '', phone: '', linkedin_url: '', source: 'api', extra: {} }
  for (const a of (e.formResponse && e.formResponse.answers) || []) {
    const q = form.q[a.questionId] || null
    const d = a.answerDetails || {}
    let text = d.textQuestionAnswer ? String(d.textQuestionAnswer.answer ?? '') : ''
    if (!text && d.multipleChoiceAnswer) text = (d.multipleChoiceAnswer.options || []).map((id) => (q && q.o && q.o[id]) || String(id)).join(', ')
    const key = q && q.f ? LEAD_FIELDS[q.f] : null
    if (key && !lead[key]) lead[key] = text
    else lead.extra[(q && (q.f ? q.f.toLowerCase() : q.n)) || `question ${a.questionId}`] = text
  }
  const campId = idOf(e.leadMetadata && e.leadMetadata.sponsoredLeadMetadata && e.leadMetadata.sponsoredLeadMetadata.campaign)
  const info = e.leadMetadataInfo && e.leadMetadataInfo.sponsoredLeadMetadataInfo && e.leadMetadataInfo.sponsoredLeadMetadataInfo.campaign
  const camp = meta.campaigns[campId] || {}
  lead.campaign = (info && info.name) || camp.n || ''
  lead.campaign_group = meta.groups[camp.g] || ''
  const crId = idOf(e.associatedEntity && e.associatedEntity.associatedCreative)
  lead.ad = (meta.creatives[crId] && meta.creatives[crId].n) || ''
  lead.extra.lead_id = e.id || null
  if (campId) lead.extra.campaign_id = campId
  if (crId) lead.extra.ad_id = crId
  return lead
}

// ---- name resolution for demographic URNs ------------------------------------------
// Each kind has candidate endpoints tried in order. First the Ad Targeting API (q=urns), which any
// Marketing API 3-legged token may call and which names organizations, titles, industries and geos;
// then the batch-get endpoints ({ results:{ id: entity } }), e.g. organizationsLookup (needs
// rw_organization_admin, so usually refused for this app).
const byResults = (body) => { const out = {}; for (const [id, x] of Object.entries((body && body.results) || {})) out[id] = nameOf(x); return out }
const byTargeting = (body) => { const out = {}; for (const e of (body && body.elements) || []) if (e && e.urn) out[idOf(e.urn)] = String(e.name || ''); return out }
const targeting = (prefix) => ({ url: (ids) => `/adTargetingEntities?q=urns&queryVersion=QUERY_USES_URNS&urns=List(${ids.map((i) => enc(`urn:li:${prefix}:${i}`)).join(',')})&locale=(language:en,country:US)`, parse: byTargeting })
const batch = (url) => ({ url, parse: byResults })
export const RESOLVERS = {
  org: { size: 50, paths: [targeting('organization'), batch((ids) => `/organizationsLookup?ids=List(${ids.join(',')})`)] },
  geo: { size: 50, paths: [targeting('geo'), batch((ids) => `/geo?ids=List(${ids.join(',')})`), batch((ids) => `${LI_V2}/geo?ids=List(${ids.join(',')})`)] },
  title: { size: 50, paths: [targeting('title'), batch((ids) => `/titles?ids=List(${ids.join(',')})`), batch((ids) => `${LI_V2}/titles?ids=List(${ids.join(',')})`)] },
  industry: { size: 50, paths: [targeting('industry'), batch((ids) => `/industries?ids=List(${ids.join(',')})`), batch((ids) => `${LI_V2}/industries?${ids.map((i) => `ids=${i}`).join('&')}`)] },
}
const RESOLVE_LABEL = { org: 'company', geo: 'country', title: 'job title', industry: 'industry' }

// ---- the sync ------------------------------------------------------------------------
const MAX_WARNINGS = 30
function warn(cursor, msg) { if (!cursor.warnings.includes(msg) && cursor.warnings.length < MAX_WARNINGS) cursor.warnings.push(msg) }

function progressOf(c, accounts) {
  if (c.phase === 'meta') return { phase: 'meta', done: c.ai, total: accounts.length }
  if (c.phase === 'perf') return { phase: 'perf', done: c.perf_i, total: splitRange(c.from, c.to).length }
  if (c.phase === 'demo') return { phase: 'demo', done: c.demo ? c.demo.di : 0, total: c.demo ? c.demo.wins.length : monthWindows(c.from, c.to).length }
  if (c.phase === 'leads') return { phase: 'leads', done: c.li.ai, total: accounts.length }
  return { phase: 'done', done: 1, total: 1 }
}
const reply = (c, accounts, done) => ({ done, cursor: done ? undefined : c, progress: progressOf(c, accounts), from: c.from, to: c.to, perf_rows: c.perf_rows, demo_windows: c.demo_windows, leads: c.leads, warnings: c.warnings })

/**
 * One invocation of POST /api/ca/linkedin-api/sync. body = { cursor?, from?, to? }.
 * -> { done, cursor?, progress, perf_rows, demo_windows, leads, warnings } or { done:true, skipped }.
 */
export async function runSync(env, user, body = {}, { now = Date.now() } = {}) {
  const t = { calls: 0, start: Date.now() }
  const room = (n) => t.calls + n <= CALL_BUDGET && Date.now() - t.start < TIME_BUDGET_MS
  t.calls++
  const doc = await getDoc(env, DOC)
  let o = doc && doc.content
  if (!o || !o.access_token) return { done: true, skipped: 'not connected', perf_rows: 0, demo_windows: 0, leads: 0, warnings: [] }
  o = await ensureFresh(env, o, now, t)
  const token = o.access_token
  const version = apiVersion(env)
  const accounts = (o.selected_accounts || []).map(String).filter(Boolean)
  if (!accounts.length) return { done: true, skipped: 'no ad account selected', perf_rows: 0, demo_windows: 0, leads: 0, warnings: ['Choose at least one ad account in Admin › Connections and pulls.'] }
  const d = tracked(db(env), t)
  const today = todayUtc(now)

  let c = body.cursor && typeof body.cursor === 'object' && body.cursor.v === 1 ? body.cursor : null
  if (!c) {
    let from = isoDay(body.from) ? body.from : null
    const to = isoDay(body.to) ? (body.to > today ? today : body.to) : today
    const up = await d.select('ca_uploads', { params: { platform: 'eq.linkedin', kind: 'eq.performance', file_name: `eq.${API_FILE}` }, select: 'id,period_start,period_end', order: 'uploaded_at.desc', limit: 1 })
    if (!from) {
      let newest = null
      if (up[0]) { const r = await d.select('ca_li_perf', { params: { platform: 'eq.linkedin', upload_id: `eq.${up[0].id}` }, select: 'day', order: 'day.desc', limit: 1 }); newest = r[0] ? String(r[0].day).slice(0, 10) : null }
      if (!newest && o.last_sync && isoDay(o.last_sync.to)) newest = o.last_sync.to
      from = newest ? addDays(newest, 1 - REPULL_DAYS) : FIRST_DAY
    }
    if (from > to) from = to
    c = { v: 1, from, to, phase: 'meta', ai: 0, mk: 'groups', page: null, perf_i: 0, perf_upload: up[0] ? up[0].id : null, no_reach: false, demo: null, li: { ai: 0, stage: 'forms', start: 0 }, unresolved: {}, perf_rows: 0, demo_windows: 0, leads: 0, warnings: [], started_at: new Date(now).toISOString() }
  }

  // documents shared across invocations
  let meta = null, metaDirty = false
  let names = null, namesDirty = false
  const loadMeta = async () => { if (meta) return meta; t.calls++; const m = await getDoc(env, META_DOC); meta = (m && m.content) || { groups: {}, campaigns: {}, creatives: {} }; return meta }
  const loadNames = async () => { if (names) return names; t.calls++; const m = await getDoc(env, NAMES_DOC); names = (m && m.content) || {}; for (const k of ['org', 'geo', 'title', 'industry', 'seniority', 'function']) names[k] = names[k] || {}; return names }

  try {
    // ---- a. campaigns, campaign groups and creatives -> lookup maps ----
    if (c.phase === 'meta') {
      if (c.ai === 0 && c.mk === 'groups' && !c.page) { meta = { groups: {}, campaigns: {}, creatives: {} }; metaDirty = true } else await loadMeta()
      while (room(4)) {
        const acc = accounts[c.ai]
        if (!acc) { c.phase = 'perf'; break }
        const page = c.page ? `&pageToken=${enc(c.page)}` : ''
        let res
        if (c.mk === 'groups') res = await liGet(token, version, `/adAccounts/${acc}/adCampaignGroups?q=search&pageSize=1000${page}`, t)
        else if (c.mk === 'campaigns') res = await liGet(token, version, `/adAccounts/${acc}/adCampaigns?q=search&pageSize=1000${page}`, t)
        else res = await liGet(token, version, `/adAccounts/${acc}/creatives?q=criteria&pageSize=100${page}`, t)
        const els = res.elements || []
        for (const e of els) {
          if (c.mk === 'groups') meta.groups[idOf(e.id)] = e.name || ''
          else if (c.mk === 'campaigns') meta.campaigns[idOf(e.id)] = { n: e.name || '', g: idOf(e.campaignGroup), o: objectiveLabel(e.objectiveType), t: typeLabel(e.type), s: e.status || null, a: acc }
          else meta.creatives[idOf(e.id)] = { n: e.name || '', c: idOf(e.campaign), a: acc }
        }
        metaDirty = true
        const next = res.metadata && res.metadata.nextPageToken
        if (next && els.length) { c.page = next; continue }
        c.page = null
        if (c.mk === 'groups') c.mk = 'campaigns'
        else if (c.mk === 'campaigns') c.mk = 'creatives'
        else { c.mk = 'groups'; c.ai++ }
      }
    }

    // ---- b. performance: CREATIVE x DAILY into ca_li_perf with the CSV keys ----
    if (c.phase === 'perf') {
      await loadMeta()
      const chunks = splitRange(c.from, c.to)
      let fetchedSingles = 0
      while (c.perf_i < chunks.length && room(12)) {
        const [a, b] = chunks[c.perf_i]
        const fields = PERF_FIELDS.filter((f) => !(c.no_reach && f === 'approximateMemberReach')).join(',')
        const q = (f) => `/adAnalytics?q=analytics&pivot=CREATIVE&timeGranularity=DAILY&dateRange=${dateRange(a, b)}&accounts=${accountsList(accounts)}&fields=${f}`
        let res
        try { res = await liGet(token, version, q(fields), t) } catch (e) {
          if (e.liStatus !== 400 || c.no_reach) throw e
          c.no_reach = true
          warn(c, 'LinkedIn refused daily reach per ad, so reach is left at 0 for API rows (impressions, clicks and spend are complete).')
          res = await liGet(token, version, q(PERF_FIELDS.filter((f) => f !== 'approximateMemberReach').join(',')), t)
        }
        const els = res.elements || []
        // creatives the account lists did not return (archived, other account): look them up one by one, a few per call
        const unknown = [...new Set(els.map((e) => idOf((e.pivotValues || [])[0])).filter((id) => id && !meta.creatives[id]))]
        for (const id of unknown) {
          if (fetchedSingles >= 6 || !room(14)) break
          for (const acc of accounts) {
            try {
              const cr = await liGet(token, version, `/adAccounts/${acc}/creatives/${enc(`urn:li:sponsoredCreative:${id}`)}`, t); fetchedSingles++
              meta.creatives[id] = { n: cr.name || '', c: idOf(cr.campaign), a: acc }; metaDirty = true
              const campId = idOf(cr.campaign)
              if (campId && !meta.campaigns[campId]) {
                const cp = await liGet(token, version, `/adAccounts/${acc}/adCampaigns/${campId}`, t); fetchedSingles++
                meta.campaigns[campId] = { n: cp.name || '', g: idOf(cp.campaignGroup), o: objectiveLabel(cp.objectiveType), t: typeLabel(cp.type), s: cp.status || null, a: acc }
                const gId = idOf(cp.campaignGroup)
                if (gId && meta.groups[gId] == null) { const g = await liGet(token, version, `/adAccounts/${acc}/adCampaignGroups/${gId}`, t); fetchedSingles++; meta.groups[gId] = g.name || '' }
              }
              break
            } catch { /* not in this account, try the next */ }
          }
        }
        let rows = els.map((e) => perfRow(e, meta)).filter((r) => isoDay(r.day) && r.ad_id)
        // borrow names and the group id from rows already stored for the same ad (CSV exports name ads by headline)
        const gaps = [...new Set(rows.filter((r) => !r.ad_name || !r.campaign_id || !r.campaign).map((r) => r.ad_id))]
        if (gaps.length) {
          const known = await d.select('ca_li_perf', { params: { platform: 'eq.linkedin', ad_id: inChunks(gaps, 150)[0] }, select: 'ad_id,ad_name,campaign_id,campaign,campaign_group,objective,format', order: 'day.desc', limit: 3000 })
          const by = new Map()
          for (const k of known) { const x = by.get(k.ad_id) || {}; for (const f of ['ad_name', 'campaign_id', 'campaign', 'campaign_group', 'objective', 'format']) if (!x[f] && k[f]) x[f] = k[f]; by.set(k.ad_id, x) }
          for (const r of rows) { const x = by.get(r.ad_id); if (!x) continue; for (const f of ['ad_name', 'campaign_id', 'campaign', 'campaign_group', 'objective', 'format']) if (!r[f] && x[f]) r[f] = x[f] }
        }
        const lost = rows.filter((r) => !r.campaign_id)
        if (lost.length) {
          warn(c, `${new Set(lost.map((r) => r.ad_id)).size} ads could not be tied to their LinkedIn campaign, so their ${lost.length} day rows were left out (a CSV export of those days fills them).`)
          rows = rows.filter((r) => r.campaign_id)
        }
        const unnamed = new Set(rows.filter((r) => !r.ad_name).map((r) => r.ad_id))
        if (unnamed.size) warn(c, `${unnamed.size} ads have no name in LinkedIn and show by id until a CSV export names them.`)
        if (rows.length) {
          if (!c.perf_upload) {
            const ins = await d.insert('ca_uploads', { channel: 'linkedin', kind: 'performance', platform: 'linkedin', file_name: API_FILE, uploaded_by: user.email, uploaded_at: new Date(now).toISOString(), period_start: c.from, period_end: c.to, row_count: 0, columns: { source: 'linkedin-api' }, notes: 'api' }, { returning: true })
            c.perf_upload = ins[0] && ins[0].id
            if (!c.perf_upload) throw new HttpError(500, 'Could not create the LinkedIn API upload record')
          }
          const clean = [...new Map(rows.map((r) => normalisePerfRow(r, c.perf_upload, 'linkedin')).filter(Boolean).map((r) => [`${r.day}|${r.campaign_id}|${r.ad_id}`, r])).values()]
          // one granularity per (day, campaign), as uploads.js does: ad-level API rows replace campaign-level CSV rows
          const camps = [...new Set(clean.map((r) => r.campaign_id))]
          for (const campF of inChunks(camps, 100)) await d.del('ca_li_perf', { platform: 'eq.linkedin', day: [`gte.${a}`, `lte.${b}`], campaign_id: campF, ad_id: 'eq.' })
          for (let i = 0; i < clean.length; i += BATCH) await d.upsert('ca_li_perf', clean.slice(i, i + BATCH), 'platform,day,campaign_id,ad_id')
          c.perf_rows += clean.length
        }
        c.perf_i++
      }
      if (c.perf_i >= chunks.length && room(4)) {
        if (c.perf_upload) {
          const cur = await d.select('ca_uploads', { params: { id: `eq.${c.perf_upload}` }, select: 'period_start,period_end', limit: 1 })
          const ps = cur[0] && cur[0].period_start && cur[0].period_start < c.from ? cur[0].period_start : c.from
          const pe = cur[0] && cur[0].period_end && cur[0].period_end > c.to ? cur[0].period_end : c.to
          t.calls++
          const n = await countRows(env, 'ca_li_perf', { upload_id: `eq.${c.perf_upload}` }).catch(() => null)
          await d.update('ca_uploads', { id: `eq.${c.perf_upload}` }, { period_start: ps, period_end: pe, uploaded_at: new Date(now).toISOString(), uploaded_by: user.email, ...(n != null ? { row_count: n } : {}) })
        }
        c.phase = 'demo'
      }
    }

    // ---- c. demographics: one window per calendar month, only days no CSV window covers ----
    if (c.phase === 'demo' && room(4)) {
      if (!c.demo) {
        const ups = await d.select('ca_uploads', { params: { channel: 'eq.linkedin', kind: 'eq.demographics', platform: 'eq.linkedin' }, select: 'id,file_name,notes,period_start,period_end,row_count', limit: 1000 })
        const months = monthWindows(c.from, c.to)
        const lo = months[0].from, hi = months[months.length - 1].to
        // a CSV window (untagged, with rows) always wins: those days are not pulled
        const csv = ups.filter((u) => !isApiUpload(u) && !isTagged(u) && (u.row_count == null || u.row_count > 0) && u.period_start && u.period_end)
        const wins = []
        for (const m of months) {
          const pieces = subtractRanges(m.from, m.to, csv)
          const covered = csv.filter((u) => u.period_start <= m.to && m.from <= u.period_end)
          if (covered.length) warn(c, `Demographics ${m.month}: ${pieces.length ? 'part of the month comes' : 'the month comes'} from a CSV export, so the API only pulled the days it does not cover.`)
          for (const p of pieces) {
            const whole = p.from === m.from && p.to === addDays(new Date(Date.UTC(+m.from.slice(0, 4), +m.from.slice(5, 7), 1)).toISOString().slice(0, 10), -1)
            if (!whole && p.from < addDays(today, -DAILY_RETENTION_DAYS)) { warn(c, `Demographics ${p.from} to ${p.to} skipped: LinkedIn only reports whole months that far back, which would overlap the CSV export.`); continue }
            wins.push({ from: p.from, to: p.to, upload: null, rows: 0 })
          }
        }
        // the API windows of these months are replaced
        const old = ups.filter((u) => isApiUpload(u) && u.period_start && u.period_end && u.period_start <= hi && lo <= u.period_end)
        for (const f of inChunks(old.map((u) => u.id), 100)) await d.del('ca_uploads', { id: f })
        c.demo = { wins, di: 0, pi: 0 }
      }
      const N = await loadNames()
      while (c.demo.di < c.demo.wins.length && room(6)) {
        const w = c.demo.wins[c.demo.di]
        if (!w.upload) {
          const ins = await d.insert('ca_uploads', { channel: 'linkedin', kind: 'demographics', platform: 'linkedin', file_name: API_FILE, uploaded_by: user.email, uploaded_at: new Date(now).toISOString(), period_start: w.from, period_end: w.to, row_count: 0, columns: { source: 'linkedin-api' }, notes: API_DEMO_NOTES }, { returning: true })
          w.upload = ins[0] && ins[0].id
          if (!w.upload) throw new HttpError(500, 'Could not create the LinkedIn API demographics record')
        }
        let stalled = false
        while (c.demo.pi < DEMO_PIVOTS.length && room(5)) {
          const [pivot, segment, kind] = DEMO_PIVOTS[c.demo.pi]
          const res = await liGet(token, version, `/adAnalytics?q=analytics&pivot=${pivot}&timeGranularity=ALL&dateRange=${dateRange(w.from, w.to)}&accounts=${accountsList(accounts)}&fields=${DEMO_FIELDS.join(',')}`, t)
          const els = res.elements || []
          if (RESOLVERS[kind] && !c.unresolved[kind]) {
            const r = RESOLVERS[kind]
            const need = [...new Set(els.map((e) => idOf((e.pivotValues || [])[0])).filter((id) => id && N[kind][id] == null))]
            for (let i = 0; i < need.length; i += r.size) {
              if (!room(4)) break
              const ids = need.slice(i, i + r.size)
              // the endpoint that answered last time is tried first
              const order = [...r.paths.keys()].sort((x, y) => (x === (c.resolver_ok || {})[kind] ? -1 : y === (c.resolver_ok || {})[kind] ? 1 : x - y))
              let got = null, empty = null, lastErr = null, tried = 0
              for (const pi of order) {
                if (!room(4)) break
                tried++
                try {
                  const found = r.paths[pi].parse(await liGet(token, version, r.paths[pi].url(ids), t))
                  if (!Object.values(found).some(Boolean)) { empty = empty || found; continue }   // answered but named nothing: try the next endpoint
                  got = found; c.resolver_ok = { ...(c.resolver_ok || {}), [kind]: pi }; break
                } catch (e) { lastErr = e }
              }
              if (!got && tried === order.length && empty) got = empty   // every endpoint tried; these ids simply have no name
              if (!got) {
                if (tried < order.length) break   // out of budget: the next call carries on
                c.unresolved[kind] = true
                warn(c, `Could not read ${RESOLVE_LABEL[kind]} names from LinkedIn (${lastErr ? lastErr.message : 'no names returned'}). Those values are stored as LinkedIn ids (urn:li:${kind === 'org' ? 'organization' : kind}:...).`)
                break
              }
              for (const id of ids) N[kind][id] = got[id] || ''
              namesDirty = true
            }
            if (!c.unresolved[kind] && need.some((id) => N[kind][id] == null)) { stalled = true; break } // finish the names next call
          }
          const rows = demoRows(els, segment, kind, N).map((r) => normaliseDemoRow(r, w.upload, 'linkedin')).filter(Boolean)
          for (let i = 0; i < rows.length; i += BATCH) await d.upsert('ca_li_demo', rows.slice(i, i + BATCH), 'upload_id,segment,value,campaign')
          w.rows += rows.length
          c.demo.pi++
        }
        if (stalled || c.demo.pi < DEMO_PIVOTS.length) break
        await d.update('ca_uploads', { id: `eq.${w.upload}` }, { row_count: w.rows })
        c.demo_windows++
        c.demo.di++
        c.demo.pi = 0
      }
      if (c.demo.di >= c.demo.wins.length) c.phase = hasLeadsScope(o) ? 'leads' : 'finish'
    }

    // ---- d. lead-form leads (needs r_marketing_leadgen_automation) ----
    if (c.phase === 'leads' && room(4)) {
      let stage
      if (c.li.ai === 0 && c.li.stage === 'forms' && c.li.start === 0) stage = { forms: {}, rows: [] }
      else { t.calls++; const s = await getDoc(env, STAGE_DOC); stage = (s && s.content) || { forms: {}, rows: [] } }
      await loadMeta()
      while (room(4)) {
        const acc = accounts[c.li.ai]
        if (!acc) break
        try {
          if (c.li.stage === 'forms') {
            const res = await liGet(token, version, `/leadForms?q=owner&owner=${accountOwner(acc)}&count=100&start=${c.li.start}`, t)
            const els = res.elements || []
            for (const f of els) stage.forms[String(f.id)] = compactForm(f)
            if (els.length < 100) { c.li.stage = 'responses'; c.li.start = 0 } else c.li.start += 100
          } else {
            const res = await liGet(token, version, `/leadFormResponses?q=owner&owner=${accountOwner(acc)}&leadType=(leadType:SPONSORED)&limitedToTestLeads=false&count=100&start=${c.li.start}`, t)
            const els = res.elements || []
            for (const e of els) if (!e.testLead) stage.rows.push(mapLead(e, stage.forms, meta))
            if (els.length < 100) { c.li.ai++; c.li.stage = 'forms'; c.li.start = 0 } else c.li.start += 100
          }
        } catch (e) {
          if (e.liStatus !== 403 && e.liStatus !== 401) throw e
          warn(c, `Lead forms of ad account ${acc} could not be read (${e.message}). The Lead Sync API product must be on the LinkedIn app and the person who connected needs a manager role on the account.`)
          c.li.ai++; c.li.stage = 'forms'; c.li.start = 0
        }
      }
      if (c.li.ai >= accounts.length) {
        stage.rows.sort((x, y) => (x.submitted_at < y.submitted_at ? 1 : -1))
        t.calls++
        await putDoc(env, LEADS_DOC, { source: 'api', file_name: 'LinkedIn API', uploaded_by: 'linkedin-api', uploaded_at: new Date(now).toISOString(), rows: stage.rows }, { by: 'linkedin-api' })
        c.leads = stage.rows.length
        t.calls++
        await delDoc(env, STAGE_DOC).catch(() => {})
        c.phase = 'finish'
      } else { t.calls++; await putDoc(env, STAGE_DOC, stage, { by: 'linkedin-api' }) }
    }

    // ---- finish ----
    if (metaDirty) { t.calls++; await putDoc(env, META_DOC, meta, { by: 'linkedin-api' }); metaDirty = false }
    if (namesDirty) { t.calls++; await putDoc(env, NAMES_DOC, names, { by: 'linkedin-api' }); namesDirty = false }
    if (c.phase === 'finish') {
      const fresh = await getDoc(env, DOC).catch(() => null)   // keep account choices made while the sync ran
      const base = (fresh && fresh.content && fresh.content.access_token) ? fresh.content : o
      await putDoc(env, DOC, { ...base, last_sync: { at: new Date(now).toISOString(), by: user.email, from: c.from, to: c.to, perf_rows: c.perf_rows, demo_windows: c.demo_windows, leads: hasLeadsScope(o) ? c.leads : null, warnings: c.warnings } }, { by: base.connected_by || null })
      await bumpCacheVersion(env)
      c.phase = 'done'
      return reply(c, accounts, true)
    }
    return reply(c, accounts, false)
  } catch (e) {
    // save what this call learnt so a retry does not start over
    try { if (metaDirty) await putDoc(env, META_DOC, meta, { by: 'linkedin-api' }); if (namesDirty) await putDoc(env, NAMES_DOC, names, { by: 'linkedin-api' }) } catch { /* best effort */ }
    throw e
  }
}
