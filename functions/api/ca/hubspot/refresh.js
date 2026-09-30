// POST /api/ca/hubspot/refresh { cursor?, from?, to? }   editors only
// -> { done, cursor?, contacts, notes, warnings:[], progress:{ phase, done, total } }
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

import { json, handle, readJson, isoDay, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db, inChunks } from '../_lib/db.js'
import { loadSettings } from '../_lib/settings.js'
import { toAccount, toBand, toRegion, NO_TARGETS } from '../_lib/classify.js'

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
])]


// Subrequest plan per invocation (limit is 50): auth 2, sync row 1, settings
// up to 4, owners 1, searches SEARCH_BUDGET, via-merge up to 4, upserts up to 5.
export const SEARCH_BUDGET = 20
export const NOTES_CHUNK = 200
export const HS_BATCH = 100
export const NOTE_READ_CAP = 10 // batch reads of notes per invocation (1000 notes)
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

  // Notes bodies: cap the reads per invocation, the rest is reported.
  const noteIds = [...new Set([...assoc.notes.values()].flat())]
  const noteRows = []
  let reads = 0
  for (let i = 0; i < noteIds.length && reads < NOTE_READ_CAP; i += HS_BATCH, reads++) {
    const data = await hsPost(token, '/crm/v3/objects/notes/batch/read', {
      properties: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
      inputs: noteIds.slice(i, i + HS_BATCH).map((id) => ({ id })),
    })
    for (const n of data.results || []) {
      const p = n.properties || {}
      noteRows.push({ id: String(n.id), body: stripHtml(p.hs_note_body).slice(0, 8000), owner_id: p.hubspot_owner_id || null, created_at: tsOrNull(p.hs_timestamp || n.createdAt) })
    }
  }
  if (noteIds.length > reads * HS_BATCH) warnings.push(`${noteIds.length - reads * HS_BATCH} notes in this chunk were not read (per-call cap); run refresh again to pick them up.`)
  const noteById = new Map(noteRows.map((n) => [n.id, n]))

  const syncedAt = new Date().toISOString()
  const notesOut = []
  const patches = []
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
    const count = ENGAGEMENT_TYPES.reduce((s, t) => s + ((assoc[t].get(c.hs_id) || []).length), 0)
    patches.push({ hs_id: c.hs_id, notes_count: count, last_activity_at: latest, last_activity_type: latestType })
  }
  for (let i = 0; i < notesOut.length; i += 500) await d.upsert('ca_hs_notes', notesOut.slice(i, i + 500), 'id')
  if (patches.length) await d.upsert('ca_hs_contacts', patches, 'hs_id')
  cursor.notes += notesOut.length
  cursor.offset = offset + contacts.length
  await markSync(d, cursor.sync_id, { notes: cursor.notes })

  if (contacts.length < NOTES_CHUNK) return finish({ d, cursor, warnings })
  return {
    done: false,
    cursor,
    contacts: cursor.contacts,
    notes: cursor.notes,
    warnings,
    progress: { phase: 'notes', done: cursor.offset, total: cursor.contacts },
  }
}

async function finish({ d, cursor, warnings }) {
  await markSync(d, cursor.sync_id, { status: 'done', finished_at: new Date().toISOString(), contacts: cursor.contacts, notes: cursor.notes })
  return { done: true, contacts: cursor.contacts, notes: cursor.notes, warnings, progress: { phase: 'done', done: cursor.contacts, total: cursor.contacts } }
}
