// POST /api/ca/hubspot/refresh { cursor?, from?, to? }   editors only
// -> { done, cursor?, contacts, notes, replies:{ human, auto }, pruned?, warnings:[],
//      progress:{ phase, done, total } }
//
// READ-ONLY against HubSpot. Nothing is ever written to HubSpot. A GSI lead is
// a contact who submitted a form (first_conversion_date is set) AND whose company
// is on the GSI account list (Settings › accounts, seed/accounts.json):
//   1. company name matches an account name or alias (CONTAINS_TOKEN, 4 per search)
//   2. email domain is an account's website domain (hs_email_domain IN, 50 per search)
// Callable by editors or by the daily job (X-CA-Cron).
// A Pages Function gets 50 subrequests per invocation, so the work is cut into
// resumable steps: the browser calls back with the returned cursor until
// done:true. Phase "search" pulls contacts (upserted into ca_hs_contacts with
// account, band and region from classify.js); phase "notes" fetches the notes
// and counts calls, meetings and emails for the contacts touched by this sync.
// The notes phase also reads the logged emails: incoming ones are replies,
// split into human and automatic (isAutoReply) and stored per contact
// (replies_human, replies_auto, first/last_human_reply_at, last_auto_reply_at)
// and in ca_hs_notes as kind 'email_in'.
// When a FULL sync (no from/to) finishes, every contact it did not touch is
// marked in_scope=false (kept, not deleted) and every one it did touch
// in_scope=true. Dated syncs never prune. The count comes back as `pruned`.

import { json, handle, readJson, isoDay, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db, inChunks } from '../_lib/db.js'
import { loadSettings } from '../_lib/settings.js'
import { toAccount, toBand, toRegion, NO_TARGETS } from '../_lib/classify.js'
import { bumpCacheVersion } from '../_lib/cache.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const PROPS = [...new Set([
  // hubspot-leads.js PROPS
  'firstname', 'lastname', 'email', 'company', 'createdate',
  'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
  'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2',
  'hs_lead_status', 'lifecyclestage', 'notes_last_updated', 'lastmodifieddate',
  'hubspot_owner_id',
  'lsa_lead_score', 'lsa_lead_score_category', 'lsa_lead_source',
  'lyzr_lead_score', 'lyzr_lead_score_category', 'hubspotscore',
  'lead_source', 'lead_source_category',
  // Campaign Analytics extras
  'jobtitle', 'country', 'hs_country_region_code', 'lsa_country', 'lsa_job_title', 'lsa_company',
  'lsa_message', 'lsa_lead_type', 'lsa_book_demo_count',
  'hs_last_sales_activity_timestamp', 'hs_last_sales_activity_type', 'hs_notes_last_activity',
  'linkedin_profile_link', 'hs_linkedin_url', 'industry', 'hs_latest_source',
  // recent activity (what happened last, shown on the Leads view)
  'hs_email_last_email_name', 'hs_email_last_send_date', 'hs_email_last_open_date', 'hs_email_last_click_date',
  'hs_sales_email_last_replied', 'hs_last_booked_meeting_date', 'notes_last_contacted', 'hs_latest_meeting_activity',
  'num_contacted_notes', 'hs_lifecyclestage_marketingqualifiedlead_date', 'recent_conversion_event_name', 'recent_conversion_date',
  'first_conversion_event_name', 'hs_analytics_source_data_1',
  'first_conversion_date', 'num_conversion_events', 'hs_email_domain',
  // sales funnel (Leads view): when each lifecycle stage was entered, how many sales touches
  // and notes. All of these land in the `props` jsonb column; nothing new is written to HubSpot.
  'hs_lifecyclestage_lead_date', 'hs_lifecyclestage_salesqualifiedlead_date', 'hs_lifecyclestage_opportunity_date',
  'hs_lifecyclestage_customer_date', 'num_notes', 'hs_last_sales_activity_date',
  // origin (Leads view "Where the leads came from" and the lead drawer): the portal's own form, lead
  // source, campaign, UTM and record-source properties, so a lead says which form, which campaign, which visit.
  'lead_form_type', 'lead_campaign_name', 'lead_form_submission_date', 'ad_campaign_id', 'conversion_page',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'first_touch_utm_source', 'first_touch_utm_medium', 'first_touch_utm_campaign',
  'hs_analytics_first_touch_converting_campaign', 'hs_analytics_last_touch_converting_campaign', 'hs_latest_source_timestamp',
  'hs_object_source_label', 'num_unique_conversion_events', 'gad_source', 'li_fat_id', 'lyzr_product',
  // activity checklist: what sales did and when (sequences, LinkedIn via HeyReach, next activity, meetings tool, marketing replies)
  'last_outreach_activity', 'hs_is_unworked', 'hs_sequences_enrolled_count', 'hs_sequences_is_enrolled', 'hs_latest_sequence_enrolled', 'hs_latest_sequence_enrolled_date', 'hs_latest_sequence_ended_date',
  'notes_next_activity_date', 'hs_email_replied', 'hs_email_first_reply_date', 'hs_email_last_reply_date',
  'hs_sa_first_engagement_date', 'hs_sa_first_engagement_descr', 'hs_sa_first_engagement_object_type',
  'engagements_last_meeting_booked', 'engagements_last_meeting_booked_campaign', 'first_meeting_booked_by',
  'heyreach_last_activity_date', 'heyreach_reply_count', 'heyreach_first_reply_date', 'heyreach_last_reply_date', 'lead_sla_respond_by',
])]


// Subrequest plan per invocation (limit is 50): auth 2, sync row 1, settings
// up to 4, owners 1, searches SEARCH_BUDGET, via-merge up to 4, upserts up to 5.
export const SEARCH_BUDGET = 20
export const NOTES_CHUNK = 200
export const HS_BATCH = 100
export const NOTE_READ_CAP = 10 // batch reads of notes + emails per invocation (1000 objects)
export const EMAIL_PROPS = ['hs_email_direction', 'hs_email_subject', 'hs_email_text', 'hs_timestamp', 'hs_email_headers']
const ENGAGEMENT_TYPES = ['notes', 'calls', 'meetings', 'emails']

const HS = 'https://api.hubapi.com'

export function dateFilters(from, to, tzOffsetMinutes = 330) {
  const f = []
  if (from) f.push({ propertyName: 'createdate', operator: 'GTE', value: Date.parse(from + 'T00:00:00Z') - tzOffsetMinutes * 60000 })
  if (to) f.push({ propertyName: 'createdate', operator: 'LTE', value: Date.parse(to + 'T23:59:59.999Z') - tzOffsetMinutes * 60000 })
  return f
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// HubSpot allows about 4 search calls a second ("secondly limit"): every call is
// spaced out, and a 429 is retried after a pause. Waiting costs no CPU time.
export const SEARCH_GAP_MS = 280
async function hsPost(token, path, body, attempt = 0) {
  const res = await fetch(HS + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 429 && attempt < 3) {
    await res.text().catch(() => '')
    await sleep(1100 * (attempt + 1))
    return hsPost(token, path, body, attempt + 1)
  }
  if (!res.ok) throw new HttpError(502, `HubSpot ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.json()
}

async function hsSearch(token, body) {
  return hsPost(token, '/crm/v3/objects/contacts/search', {
    properties: PROPS,
    limit: 100,
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    ...body,
  })
}

async function fetchOwners(token) {
  const byId = {}
  const idByEmail = {}
  let error = null
  try {
    const res = await fetch(`${HS}/crm/v3/owners?limit=500`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data = await res.json()
      for (const o of data.results || []) {
        byId[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id
        if (o.email) idByEmail[o.email.toLowerCase()] = o.id
      }
    } else error = `owners lookup failed (HTTP ${res.status})`
  } catch {
    error = 'owners lookup failed (network)'
  }
  return { byId, idByEmail, error }
}

// The flat, resumable list of searches (same shape as hubspot-leads.js).
export const NAMES_PER_SEARCH = 4   // 4 groups x (name + form + 2 dates) = 16 filters, HubSpot allows 18
export const DOMAINS_PER_SEARCH = 50
const FORM_FILTER = { propertyName: 'first_conversion_date', operator: 'HAS_PROPERTY' }

// The flat, resumable list of searches.
export function buildTasks(names, domains, dates) {
  const tasks = []
  for (let i = 0; i < names.length; i += NAMES_PER_SEARCH) {
    tasks.push({ tag: 'company', body: {
      filterGroups: names.slice(i, i + NAMES_PER_SEARCH).map((name) => ({ filters: [{ propertyName: 'company', operator: 'CONTAINS_TOKEN', value: name }, FORM_FILTER, ...dates] })),
    } })
  }
  for (let i = 0; i < domains.length; i += DOMAINS_PER_SEARCH) {
    tasks.push({ tag: 'domain', body: { filterGroups: [{ filters: [{ propertyName: 'hs_email_domain', operator: 'IN', values: domains.slice(i, i + DOMAINS_PER_SEARCH) }, FORM_FILTER, ...dates] }] } })
  }
  return tasks
}

// Search terms from the account list: names and aliases for the named accounts
// (the ones with designations or no website), website domains for every account
// that has one. Extra names from the gsi_companies setting are added as names.
export function searchTerms(accounts = [], extraNames = []) {
  const names = new Set(), domains = new Set()
  for (const a of accounts) {
    if (!a || !a.name) continue
    const ds = [...(a.domains || []), ...(a.domain ? [a.domain] : [])]
    for (const d of ds) domains.add(String(d).toLowerCase())
    // Named accounts (owners and designations) always search by name. Other
    // accounts search by name only when they have no website, and only names of
    // at least 4 letters or digits: "TP" or "Sia" would match unrelated firms.
    const named = Boolean(a.bands || (a.source || []).includes('accounts'))
    if (named || !ds.length) {
      for (const n of [a.name, ...(a.aliases || [])]) {
        if (named || String(n).replace(/[^A-Za-z0-9]/g, '').length >= 4) names.add(n)
      }
    }
  }
  for (const n of extraNames) if (n) names.add(String(n))
  return { names: [...names].sort(), domains: [...domains].sort() }
}

// Email domain -> account, built once per accounts list (a Map lookup per
// contact instead of scanning every account's domains).
const DOMAIN_INDEX = new WeakMap()
export function domainAccount(email, accounts = []) {
  const d = String(email || '').toLowerCase().split('@')[1] || ''
  if (!d) return null
  let idx = DOMAIN_INDEX.get(accounts)
  if (!idx) {
    idx = new Map()
    for (const a of accounts) {
      for (const x of [...((a && a.domains) || []), ...(a && a.domain ? [a.domain] : [])]) if (!idx.has(x)) idx.set(x, a.name)
    }
    DOMAIN_INDEX.set(accounts, idx)
  }
  // exact domain first, then parent domains (eu.sub.de -> sub.de)
  const parts = d.split('.')
  for (let i = 0; i < parts.length - 1; i++) { const hit = idx.get(parts.slice(i).join('.')); if (hit) return hit }
  return null
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---- automatic replies --------------------------------------------------------
// Out of office, bounces and "no longer with the company" answers are incoming
// emails, but not a person replying. Checked on the subject, the first part of
// the text (quoted earlier messages cut off) and the headers when present.
// Strong signals count anywhere in the reply; weak ones ("on leave", "vacation", "do not reply") only in
// the subject, because people write them in normal replies too.
const AUTO_PATTERNS = [
  /out of (the )?office/, /automatic reply/, /auto[- ]?reply/, /autoreply/, /auto[- ]?response/, /automatic response/,
  /has left the company/, /is no longer employed/, /no longer (works|working) (at|for|with) /,
  /undeliverable/, /delivery status notification/, /delivery has failed/, /mail delivery (failed|subsystem)/, /could not be delivered/,
  /mailer-daemon/, /\bpostmaster\b/, /this mailbox is not monitored/,
  /abwesenheitsnotiz/, /automatische antwort/, /fuera de la oficina/, /respuesta autom[aá]tica/, /je suis absente? du bureau/,
  /r[ée]ponse automatique/, /fora do escrit[oó]rio/, /resposta autom[aá]tica/, /automatisch antwoord/, /risposta automatica/, /fuori ufficio/,
]
const WEAK_PATTERNS = [/\booo\b/, /away from (the |my )?office/, /\bon leave\b/, /\bvacation\b/, /annual leave/, /maternity/, /paternity/, /parental leave/, /no longer with/, /\babsence\b/, /abwesenheit/, /\bafwezig/]
const SUBJECT_ONLY = [/do not reply/, /do-not-reply/]

function headerText(headers) {
  if (!headers) return ''
  if (typeof headers === 'string') return headers
  try { return JSON.stringify(headers) } catch { return '' }
}

// Only the reply itself: drop quoted lines and everything after "On ... wrote:"
// or an "-----Original Message-----" / "From:" block.
export function replyPart(text) {
  const t = String(text || '')
  const cut = t.search(/(^|\n)\s*(>|on [^\n]{0,200}wrote:|-{2,}\s*original message|from:\s)/i)
  return (cut >= 0 ? t.slice(0, cut) : t).slice(0, 1500)
}

export function isAutoReply({ subject = '', text = '', headers = '' } = {}) {
  const h = headerText(headers).toLowerCase()
  if (h) {
    if (/auto-submitted"?\s*[:=]\s*"?(auto|yes)/.test(h)) return true
    if (/x-autorespond|x-autoreply|x-auto-response-suppress"?\s*[:=]\s*"?(all|oof)/.test(h)) return true
    if (/precedence"?\s*[:=]\s*"?(auto_reply|bulk|junk)/.test(h)) return true
    if (/mailer-daemon@|postmaster@/.test(h)) return true
  }
  const reply = replyPart(text).toLowerCase()
  const hay = (String(subject || '') + '\n' + reply).toLowerCase()
  if (AUTO_PATTERNS.some((re) => re.test(hay))) return true
  const subj = String(subject || '').toLowerCase()
  if (WEAK_PATTERNS.some((re) => re.test(subj)) || SUBJECT_ONLY.some((re) => re.test(subj))) return true
  // In the body, a weak phrase counts only in a short reply with no sign of a person talking back.
  const short = reply.replace(/\s+/g, ' ').trim()
  const conversational = /\b(let'?s|let us|talk|call|chat|happy to|interested|thanks for reaching|sounds good|yes|sure)\b|\?/.test(short)
  return short.length <= 220 && !conversational && WEAK_PATTERNS.some((re) => re.test(short))
}

const numOrNull = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n }
const tsOrNull = (v) => {
  if (!v) return null
  const n = Number(v)
  const d = Number.isFinite(n) && String(v).trim() === String(n) ? new Date(n) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// HubSpot contact -> ca_hs_contacts row (without notes_count, which the notes phase sets).
export function mapContact(raw, via, { ownerNames = {}, settings = {}, syncedAt }) {
  const p = raw.properties || {}
  const companyRaw = p.company || p.lsa_company || ''
  const account = toAccount(companyRaw, settings.accounts || [], NO_TARGETS) || domainAccount(p.email, settings.accounts || [])
  const jobtitle = p.jobtitle || p.lsa_job_title || ''
  const country = p.country || p.lsa_country || p.hs_country_region_code || ''
  const props = {}
  for (const k of PROPS) if (p[k] !== undefined && p[k] !== null && p[k] !== '') props[k] = p[k]
  return {
    hs_id: String(raw.id),
    email: p.email || null,
    first_name: p.firstname || null,
    last_name: p.lastname || null,
    company_raw: companyRaw || null,
    account,
    jobtitle: jobtitle || null,
    band: toBand(jobtitle, account, settings.bands || {}),
    country: country || null,
    region: toRegion(country, settings.regions || {}),
    source: p.hs_analytics_source || null,
    source_detail: [p.hs_analytics_source_data_1, p.hs_analytics_source_data_2].filter(Boolean).join(' / ') || null,
    lead_source: p.lead_source || p.lsa_lead_source || null,
    lsa_message: p.lsa_message || null,
    lsa_score: numOrNull(p.lsa_lead_score ?? p.lyzr_lead_score ?? p.hubspotscore),
    lsa_category: p.lsa_lead_score_category || p.lyzr_lead_score_category || null,
    lifecycle: p.lifecyclestage || null,
    lead_status: p.hs_lead_status || null,
    owner_id: p.hubspot_owner_id || null,
    owner_name: (p.hubspot_owner_id && ownerNames[p.hubspot_owner_id]) || null,
    created_at: tsOrNull(p.createdate || raw.createdAt),
    last_modified: tsOrNull(p.lastmodifieddate || raw.updatedAt),
    last_activity_at: tsOrNull(p.hs_last_sales_activity_timestamp || p.notes_last_updated),
    last_activity_type: p.hs_last_sales_activity_type || null,
    via,
    props,
    synced_at: syncedAt,
  }
}

async function markSync(d, syncId, patch) {
  if (!syncId) return
  try { await d.update('ca_hs_sync', { id: `eq.${syncId}` }, patch) } catch { /* best effort */ }
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = cronUser(request, env) || (await requireUser(request, env))
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can refresh HubSpot' }, 403)
  const token = env.HUBSPOT_ACCESS_TOKEN
  if (!token) return json({ error: 'HubSpot not configured (HUBSPOT_ACCESS_TOKEN)' }, 503)
  const d = db(env)
  const body = await readJson(request)
  const warnings = []

  let cursor = body.cursor && typeof body.cursor === 'object' ? { ...body.cursor } : null
  if (!cursor) {
    const from = isoDay(body.from) ? body.from : null
    const to = isoDay(body.to) ? body.to : null
    const started_at = new Date().toISOString()
    const rows = await d.insert('ca_hs_sync', { started_by: user.email, started_at, status: 'running', contacts: 0, notes: 0 }, { returning: true })
    cursor = { sync_id: rows[0] && rows[0].id, started_at, phase: 'search', taskIndex: 0, after: null, offset: 0, contacts: 0, notes: 0, from, to }
  }
  cursor.contacts = Number(cursor.contacts) || 0
  cursor.notes = Number(cursor.notes) || 0

  try {
    if (cursor.phase === 'search') return json(await searchPhase({ d, token, env, request, cursor, warnings }))
    return json(await notesPhase({ d, token, cursor, warnings }))
  } catch (e) {
    await markSync(d, cursor.sync_id, { status: 'error', finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) })
    throw e
  }
})

async function searchPhase({ d, token, env, request, cursor, warnings }) {
  const settings = await loadSettings(env, request, { keys: ['accounts', 'bands', 'regions', 'gsi_companies'] })
  const { byId: ownerNames, error: ownerError } = await fetchOwners(token)
  if (ownerError) warnings.push(`Owner names could not be read: ${ownerError}.`)

  const dates = dateFilters(cursor.from, cursor.to)
  // The GSI list is the account list; gsi_companies (Settings) adds extra names.
  const extra = Array.isArray(settings.gsi_companies) && settings.source && settings.source.gsi_companies === 'db' ? settings.gsi_companies : []
  const { names, domains } = searchTerms(settings.accounts || [], extra)
  const tasks = buildTasks(names, domains, dates)
  const found = new Map()
  let used = 0
  let taskIndex = Number.isInteger(cursor.taskIndex) ? cursor.taskIndex : 0
  let after = cursor.after || undefined
  while (taskIndex < tasks.length && used < SEARCH_BUDGET) {
    const task = tasks[taskIndex]
    if (used) await sleep(SEARCH_GAP_MS)
    const data = await hsSearch(token, after ? { ...task.body, after } : task.body)
    used++
    for (const r of data.results || []) {
      const ex = found.get(r.id)
      if (ex) { if (!ex.via.includes(task.tag)) ex.via.push(task.tag) } else found.set(r.id, { raw: r, via: [task.tag] })
    }
    after = data.paging?.next?.after
    if (!after) { taskIndex++; after = undefined }
  }

  // Keep `via` tags found by earlier invocations of this same sync.
  const ids = [...found.keys()]
  if (ids.length && ids.length <= 600) {
    for (const filter of inChunks(ids)) {
      const rows = await d.select('ca_hs_contacts', { params: { hs_id: filter, synced_at: `gte.${cursor.started_at}` }, select: 'hs_id,via' })
      for (const r of rows) {
        const f = found.get(r.hs_id)
        if (f) for (const t of r.via || []) if (!f.via.includes(t)) f.via.push(t)
      }
    }
  }

  const syncedAt = new Date().toISOString()
  const rows = [...found.values()].map(({ raw, via }) => mapContact(raw, via, { ownerNames, settings, syncedAt }))
  for (let i = 0; i < rows.length; i += 500) await d.upsert('ca_hs_contacts', rows.slice(i, i + 500), 'hs_id')
  // A contact that matches the rule again is in scope again, whatever an earlier full sync decided.
  if (rows.length) { try { for (const filter of inChunks(rows.map((r) => r.hs_id))) await d.update('ca_hs_contacts', { hs_id: filter, in_scope: 'is.false' }, { in_scope: true }) } catch { /* 008 not run yet */ } }
  cursor.contacts += rows.length

  const finished = taskIndex >= tasks.length
  if (finished) { cursor.phase = 'notes'; cursor.offset = 0; cursor.taskIndex = tasks.length; cursor.after = null }
  else { cursor.taskIndex = taskIndex; cursor.after = after ?? null }
  await markSync(d, cursor.sync_id, { contacts: cursor.contacts })
  return {
    done: false,
    cursor,
    contacts: cursor.contacts,
    notes: cursor.notes,
    replies: replies(cursor),
    warnings,
    progress: { phase: finished ? 'notes' : 'search', done: Math.min(taskIndex, tasks.length), total: tasks.length },
  }
}

async function hsAssociations(token, type, ids) {
  // v4 batch read: { results:[{ from:{id}, to:[{ toObjectId, associationTypes }] }] }
  const map = new Map()
  for (let i = 0; i < ids.length; i += HS_BATCH) {
    const data = await hsPost(token, `/crm/v4/associations/contacts/${type}/batch/read`, { inputs: ids.slice(i, i + HS_BATCH).map((id) => ({ id })) })
    for (const r of data.results || []) map.set(String(r.from?.id), (r.to || []).map((t) => String(t.toObjectId)))
  }
  return map
}

// Split the per-invocation batch-read cap between notes and emails: each gets
// what it needs when both fit, otherwise emails keep at least half the cap.
export function splitReads(noteCount, emailCount, cap = NOTE_READ_CAP) {
  const needN = Math.ceil(noteCount / HS_BATCH), needE = Math.ceil(emailCount / HS_BATCH)
  if (needN + needE <= cap) return { notes: needN, emails: needE }
  const emails = Math.min(needE, Math.max(cap - needN, Math.floor(cap / 2)))
  return { notes: Math.min(needN, cap - emails), emails }
}

async function batchRead(token, object, properties, ids, maxReads) {
  const out = []
  let reads = 0
  for (let i = 0; i < ids.length && reads < maxReads; i += HS_BATCH, reads++) {
    const data = await hsPost(token, `/crm/v3/objects/${object}/batch/read`, { properties, inputs: ids.slice(i, i + HS_BATCH).map((id) => ({ id })) })
    out.push(...(data.results || []))
  }
  return { results: out, unread: Math.max(0, ids.length - reads * HS_BATCH) }
}

// One incoming email -> the body kept in ca_hs_notes (kind 'email_in').
export function emailNoteBody(subject, text, auto) {
  const body = [String(subject || '').trim(), replyPart(text).replace(/\s+/g, ' ').trim().slice(0, 400)].filter(Boolean).join(' - ')
  return (auto ? '[auto] ' : '') + body
}

async function notesPhase({ d, token, cursor, warnings }) {
  const offset = Number(cursor.offset) || 0
  const contacts = await d.select('ca_hs_contacts', {
    params: { synced_at: `gte.${cursor.started_at}` },
    select: 'hs_id,last_activity_at,last_activity_type',
    order: 'hs_id.asc',
    limit: NOTES_CHUNK,
    offset,
  })
  if (!contacts.length) return finish({ d, cursor, warnings })
  const ids = contacts.map((c) => c.hs_id)

  const assoc = {}
  for (const type of ENGAGEMENT_TYPES) assoc[type] = await hsAssociations(token, type, ids)

  // Note and email bodies share one cap on batch reads per invocation; the rest is reported.
  const noteIds = [...new Set([...assoc.notes.values()].flat())]
  const emailIds = [...new Set([...assoc.emails.values()].flat())]
  const budget = splitReads(noteIds.length, emailIds.length)
  const notesRead = await batchRead(token, 'notes', ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'], noteIds, budget.notes)
  const noteRows = notesRead.results.map((n) => {
    const p = n.properties || {}
    return { id: String(n.id), body: stripHtml(p.hs_note_body).slice(0, 8000), owner_id: p.hubspot_owner_id || null, created_at: tsOrNull(p.hs_timestamp || n.createdAt) }
  })
  if (notesRead.unread) warnings.push(`${notesRead.unread} notes in this chunk were not read (per-call cap); run refresh again to pick them up.`)
  const noteById = new Map(noteRows.map((n) => [n.id, n]))

  const emailsRead = emailIds.length ? await batchRead(token, 'emails', EMAIL_PROPS, emailIds, budget.emails) : { results: [], unread: 0 }
  if (emailsRead.unread) warnings.push(`${emailsRead.unread} emails in this chunk were not read (per-call cap), so some reply counts may be low; run refresh again to pick them up.`)
  const replyById = new Map()
  const readIds = new Set(emailsRead.results.map((e) => String(e.id)))
  for (const e of emailsRead.results) {
    const p = e.properties || {}
    if (String(p.hs_email_direction || '').toUpperCase() !== 'INCOMING_EMAIL') continue
    const auto = isAutoReply({ subject: p.hs_email_subject, text: p.hs_email_text, headers: p.hs_email_headers })
    replyById.set(String(e.id), { id: String(e.id), auto, at: tsOrNull(p.hs_timestamp || e.createdAt), body: emailNoteBody(p.hs_email_subject, p.hs_email_text, auto) })
  }

  const syncedAt = new Date().toISOString()
  const notesOut = []
  const patches = []
  let human = 0, autoN = 0
  for (const c of contacts) {
    const nids = assoc.notes.get(c.hs_id) || []
    let latest = c.last_activity_at || null
    let latestType = c.last_activity_type || null
    for (const nid of nids) {
      const n = noteById.get(nid)
      if (!n) continue
      notesOut.push({ id: n.id, contact_id: c.hs_id, kind: 'note', body: n.body, owner_id: n.owner_id, created_at: n.created_at, synced_at: syncedAt })
      if (n.created_at && (!latest || n.created_at > latest)) { latest = n.created_at; latestType = latestType || 'note' }
    }
    const r = { replies_human: 0, replies_auto: 0, first_human_reply_at: null, last_human_reply_at: null, last_auto_reply_at: null }
    // Emails of this contact that were not read this time (read cap): keep the counts from the last sync.
    const emailIdsOf = assoc.emails.get(c.hs_id) || []
    const allRead = emailIdsOf.every((eid) => readIds.has(String(eid)))
    for (const eid of emailIdsOf) {
      const e = replyById.get(eid)
      if (!e) continue
      notesOut.push({ id: `email-${e.id}`, contact_id: c.hs_id, kind: 'email_in', body: e.body, owner_id: null, created_at: e.at, synced_at: syncedAt })
      if (e.auto) {
        r.replies_auto++
        if (e.at && (!r.last_auto_reply_at || e.at > r.last_auto_reply_at)) r.last_auto_reply_at = e.at
      } else {
        r.replies_human++
        if (e.at && (!r.first_human_reply_at || e.at < r.first_human_reply_at)) r.first_human_reply_at = e.at
        if (e.at && (!r.last_human_reply_at || e.at > r.last_human_reply_at)) r.last_human_reply_at = e.at
      }
    }
    human += r.replies_human
    autoN += r.replies_auto
    const count = ENGAGEMENT_TYPES.reduce((s, t) => s + ((assoc[t].get(c.hs_id) || []).length), 0)
    patches.push({ hs_id: c.hs_id, notes_count: count, last_activity_at: latest, last_activity_type: latestType, ...(allRead ? r : {}) })
  }
  for (let i = 0; i < notesOut.length; i += 500) await d.upsert('ca_hs_notes', notesOut.slice(i, i + 500), 'id')
  if (patches.length) {
    try {
      await d.upsert('ca_hs_contacts', patches, 'hs_id')
    } catch (e) {
      // The reply columns come with 008_funnel.sql; until it runs, keep the counts working.
      if (!/replies_|reply_at|column/i.test(String(e.message || e))) throw e
      warnings.push('Reply counts were not saved: run Campaign_Analytics/supabase/008_funnel.sql in Supabase.')
      await d.upsert('ca_hs_contacts', patches.map(({ hs_id, notes_count, last_activity_at, last_activity_type }) => ({ hs_id, notes_count, last_activity_at, last_activity_type })), 'hs_id')
    }
  }
  cursor.notes += notesOut.length
  cursor.replies_human = (Number(cursor.replies_human) || 0) + human
  cursor.replies_auto = (Number(cursor.replies_auto) || 0) + autoN
  cursor.offset = offset + contacts.length
  await markSync(d, cursor.sync_id, { notes: cursor.notes })

  if (contacts.length < NOTES_CHUNK) return finish({ d, cursor, warnings })
  return {
    done: false,
    cursor,
    contacts: cursor.contacts,
    notes: cursor.notes,
    replies: replies(cursor),
    warnings,
    progress: { phase: 'notes', done: cursor.offset, total: cursor.contacts },
  }
}

function replies(cursor) {
  return { human: Number(cursor.replies_human) || 0, auto: Number(cursor.replies_auto) || 0 }
}

// A full sync covers the whole GSI rule set: only then can "not seen this run"
// mean "no longer a GSI lead". Dated syncs (from/to) only see part of it.
export function isFullSync(cursor) {
  return Boolean(cursor && !cursor.from && !cursor.to)
}

// Mark contacts this full sync did not touch as out of scope (kept, not
// deleted) and the ones it touched as in scope. Returns how many are out.
export async function pruneScope(d, cursor) {
  const now = new Date().toISOString()
  const out = await d.update('ca_hs_contacts', { synced_at: `lt.${cursor.started_at}`, select: 'hs_id' }, { in_scope: false, scope_checked_at: now }, { returning: true })
  await d.update('ca_hs_contacts', { synced_at: `gte.${cursor.started_at}` }, { in_scope: true, scope_checked_at: now })
  return out.length
}

async function finish({ d, cursor, warnings }) {
  let pruned
  if (isFullSync(cursor)) {
    if (!cursor.contacts) {
      warnings.push('This sync found no contacts, so nothing was marked out of scope (check the GSI account list in Settings).')
    } else {
      try {
        // Only prune for a sync this server started: the cursor comes from the browser.
        const run = cursor.sync_id ? await d.select('ca_hs_sync', { params: { id: `eq.${cursor.sync_id}` }, select: 'started_at,status', limit: 1 }) : []
        if (!run.length || run[0].status !== 'running' || new Date(run[0].started_at).getTime() !== new Date(cursor.started_at).getTime()) throw new Error('sync record does not match this cursor')
        pruned = await pruneScope(d, cursor)
      } catch (e) {
        warnings.push(`Old contacts could not be marked out of scope (${String(e.message || e).slice(0, 160)}). If the message mentions in_scope, run Campaign_Analytics/supabase/008_funnel.sql in Supabase.`)
      }
    }
  }
  await markSync(d, cursor.sync_id, { status: 'done', finished_at: new Date().toISOString(), contacts: cursor.contacts, notes: cursor.notes })
  await bumpCacheVersion(d) // contacts and notes changed: the shared GET cache must recompute
  const out = { done: true, contacts: cursor.contacts, notes: cursor.notes, replies: replies(cursor), warnings, progress: { phase: 'done', done: cursor.contacts, total: cursor.contacts } }
  if (pruned !== undefined) out.pruned = pruned
  return out
}
