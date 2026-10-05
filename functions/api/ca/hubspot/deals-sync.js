// POST /api/ca/hubspot/deals-sync { cursor? }   editors or the daily job (X-CA-Cron)
// -> { done, cursor?, deals, changes, warnings:[], progress:{ phase, done, total } }
//
// READ-ONLY against HubSpot. Nothing is ever written to HubSpot. Mirrors the
// GSI/SI conversations pipeline (functions/api/hubspot-deals.js, the weekly
// report widget) into ca_hs_deals and records what changed in ca_hs_deal_history.
// A deal is a GSI/SI conversation when either rule matches (`via` says which):
//   1. gsi_property  : the deal's `gsi` property is set (the partner name itself)
//   2. company_match : an associated company is on the GSI account list
//                      (Settings › accounts): company name matches an account
//                      name or alias (CONTAINS_TOKEN, 4 per search), or the
//                      company domain is an account website (IN, 50 per search)
// Stage buckets are resolved per pipeline from /crm/v3/pipelines/deals (read
// once per sync, cached in the cursor), so deals outside "Studio Deals" bucket
// correctly. A Pages Function gets 50 subrequests per invocation, so the work
// is cut into resumable phases: call again with the returned cursor until
// done:true. Phase "companies" collects the matching company ids, phase "deals"
// searches deals by those ids (100 per filter, HubSpot's IN cap) and upserts.

import { json, handle, readJson, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db, inChunks } from '../_lib/db.js'
import { loadSettings } from '../_lib/settings.js'
import { toAccount, NO_TARGETS } from '../_lib/classify.js'
import { searchTerms, SEARCH_GAP_MS } from './refresh.js'
import { bumpCacheVersion } from '../_lib/cache.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const PROPS = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'closedate', 'createdate',
  'gsi', 'hs_manual_forecast_category', 'dealtype', 'hubspot_owner_id', 'hs_lastmodifieddate',
]

// Subrequest plan per invocation (limit is 50): auth 2, sync row 1, settings up
// to 3, pipelines 1 (first call), HubSpot calls up to HS_BUDGET plus one chunk's
// overrun, existing-row selects up to 7, upserts up to 4, history 1, sync patch 1.
export const HS_BUDGET = 16
export const NAMES_PER_SEARCH = 4
export const DOMAINS_PER_SEARCH = 50
export const COMPANY_ID_CHUNK = 100     // HubSpot's IN operator caps at 100 values per filter
export const PAGES_PER_CHUNK = 3        // 300 deals per 100 companies; a warning says when it was cut
export const GSI_PAGES = 5
export const HS_BATCH = 100

const HS = 'https://api.hubapi.com'

// Value -> label maps (HubSpot returns the internal enum values, not the labels).
export const FORECAST_LABELS = {
  OMIT: 'Not forecasted', PIPELINE: 'Pipeline', BEST_CASE: 'Best case',
  Upside: 'Upside', COMMIT: 'Commit', CLOSED: 'Closed won',
  'Stalled/Lost': 'Stalled/Lost', Nurture: 'Nurture',
}
export const DEALTYPE_LABELS = {
  newbusiness: 'New Business', 'Land & Expand': 'Expansion',
  Partnership: 'Partnership', POC: 'POC',
}

// Open-stage label -> bucket, the grouping the weekly report used. Any other
// open stage falls back to a position split so no deal is dropped.
const OPEN_STAGE_BUCKET = {
  'Discovery Call': 'conversation', Discovery: 'conversation', Qualification: 'conversation', Pipeline: 'conversation', Stalled: 'conversation',
  'Solution Validation': 'demo', Proposal: 'demo', Negotiation: 'demo', 'Legal & Contracts': 'demo', 'Best Case': 'demo', Commit: 'demo',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Same pacing as refresh.js: about 4 search calls a second, 429 retried after a pause.
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

async function hsGet(token, path) {
  const res = await fetch(HS + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new HttpError(502, `HubSpot ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.json()
}

// /crm/v3/pipelines/deals -> { pipelineId: { label, stages: { stageId: { label, bucket } } } }
// HubSpot returns metadata.isClosed as the STRING "true"/"false".
export function stageMapsFrom(data) {
  const out = {}
  for (const pl of (data && data.results) || []) {
    const stages = pl.stages || []
    const isClosed = (s) => s.metadata && String(s.metadata.isClosed) === 'true'
    const open = stages.filter((s) => !isClosed(s)).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    const map = {}
    open.forEach((s, i) => { map[s.id] = { label: s.label, bucket: OPEN_STAGE_BUCKET[s.label] || (i < open.length / 2 ? 'conversation' : 'demo') } })
    for (const s of stages) {
      if (!isClosed(s)) continue
      map[s.id] = { label: s.label, bucket: Number(s.metadata && s.metadata.probability) >= 1 ? 'won' : 'lost' }
    }
    out[pl.id] = { label: pl.label || pl.id, stages: map }
  }
  return out
}

// The flat, resumable list of company searches.
export function buildCompanyTasks(names, domains) {
  const tasks = []
  for (let i = 0; i < names.length; i += NAMES_PER_SEARCH) {
    tasks.push({ tag: 'name', body: { filterGroups: names.slice(i, i + NAMES_PER_SEARCH).map((name) => ({ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: name }] })) } })
  }
  for (let i = 0; i < domains.length; i += DOMAINS_PER_SEARCH) {
    tasks.push({ tag: 'domain', body: { filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'IN', values: domains.slice(i, i + DOMAINS_PER_SEARCH) }] }] } })
  }
  return tasks
}

// Company website domain -> account name, for the companies found by domain
// (and as a second try for name matches that toAccount cannot canonicalise).
function domainIndex(accounts) {
  const idx = new Map()
  for (const a of accounts) {
    for (const x of [...((a && a.domains) || []), ...(a && a.domain ? [a.domain] : [])]) { const d = String(x).toLowerCase(); if (!idx.has(d)) idx.set(d, a.name) }
  }
  return idx
}
function accountForDomain(domain, idx) {
  const d = String(domain || '').toLowerCase()
  if (!d) return null
  const parts = d.split('.')
  for (let i = 0; i < parts.length - 1; i++) { const hit = idx.get(parts.slice(i).join('.')); if (hit) return hit }
  return null
}

const numOrNull = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n }
const tsOrNull = (v) => {
  if (!v) return null
  const n = Number(v)
  const d = Number.isFinite(n) && String(v).trim() === String(n) ? new Date(n) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const dayOrNull = (v) => { const t = tsOrNull(v); return t ? t.slice(0, 10) : null }

// HubSpot deal -> ca_hs_deals row (without first_seen_at, which the insert default sets).
export function mapDeal(raw, { via, partner, companyRaw, stageMaps = {}, syncedAt }) {
  const p = raw.properties || {}
  const pl = stageMaps[p.pipeline] || {}
  const st = (pl.stages || {})[p.dealstage]
  const props = {}
  for (const k of PROPS) if (p[k] !== undefined && p[k] !== null && p[k] !== '') props[k] = p[k]
  const label = (st && st.label) || p.dealstage || 'Unknown stage'
  return {
    hs_id: String(raw.id),
    name: p.dealname || 'Untitled',
    pipeline: p.pipeline || null,
    pipeline_label: pl.label || null,
    stage: p.dealstage || null,
    stage_label: label,
    bucket: (st && st.bucket) || 'conversation',
    substage: label,
    amount: numOrNull(p.amount),
    close_date: dayOrNull(p.closedate),
    created_at: tsOrNull(p.createdate || raw.createdAt),
    partner: partner || null,
    company_raw: companyRaw || null,
    dealtype: p.dealtype || null,
    motion_label: DEALTYPE_LABELS[p.dealtype] || p.dealtype || 'New Business',
    forecast: FORECAST_LABELS[p.hs_manual_forecast_category] || p.hs_manual_forecast_category || null,
    via,
    props,
    synced_at: syncedAt,
  }
}

// Compare the freshly mapped rows with what the table holds: history rows for
// new deals, stage moves, amount changes and closes; prev_stage and
// last_stage_change_at carried or set. Pure, so it is unit-tested.
export function diffDeals(rows, existingList, now) {
  const existing = new Map(existingList.map((r) => [String(r.hs_id), r]))
  const history = []
  const out = []
  let fresh = 0
  for (const r of rows) {
    const ex = existing.get(r.hs_id)
    if (!ex) {
      fresh++
      history.push({ hs_id: r.hs_id, at: r.created_at || now, kind: 'new', from_value: null, to_value: r.stage_label, amount: r.amount })
      out.push({ ...r, prev_stage: null, last_stage_change_at: null })
      continue
    }
    const via = [...new Set([...(ex.via || []), ...(r.via || [])])]
    const row = { ...r, via, prev_stage: ex.prev_stage || null, last_stage_change_at: ex.last_stage_change_at || null }
    const stageChanged = (ex.stage || null) !== (r.stage || null)
    if (stageChanged) {
      history.push({ hs_id: r.hs_id, at: now, kind: 'stage', from_value: ex.stage_label || ex.stage || null, to_value: r.stage_label, amount: r.amount })
      row.prev_stage = ex.stage_label || ex.stage || null
      row.last_stage_change_at = now
      if ((r.bucket === 'won' || r.bucket === 'lost') && ex.bucket !== r.bucket) {
        history.push({ hs_id: r.hs_id, at: now, kind: 'closed', from_value: ex.bucket || null, to_value: r.bucket, amount: r.amount })
      }
    }
    if ((ex.amount === null || ex.amount === undefined ? null : Number(ex.amount)) !== r.amount) {
      history.push({ hs_id: r.hs_id, at: now, kind: 'amount', from_value: ex.amount === null || ex.amount === undefined ? null : String(ex.amount), to_value: r.amount === null ? null : String(r.amount), amount: r.amount })
    }
    out.push(row)
  }
  return { rows: out, history, fresh }
}

async function markSync(d, syncId, patch) {
  if (!syncId) return
  try { await d.update('ca_hs_deals_sync', { id: `eq.${syncId}` }, patch) } catch { /* best effort */ }
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = cronUser(request, env) || (await requireUser(request, env))
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can sync HubSpot deals' }, 403)
  const token = env.HUBSPOT_ACCESS_TOKEN
  if (!token) return json({ error: 'HubSpot not configured (HUBSPOT_ACCESS_TOKEN)' }, 503)
  const d = db(env)
  const body = await readJson(request)
  const warnings = []

  let cursor = body.cursor && typeof body.cursor === 'object' ? { ...body.cursor } : null
  if (!cursor) {
    const started_at = new Date().toISOString()
    const rows = await d.insert('ca_hs_deals_sync', { started_by: user.email, started_at, status: 'running', deals: 0, changes: 0 }, { returning: true })
    cursor = { sync_id: rows[0] && rows[0].id, started_at, phase: 'gsi', taskIndex: 0, after: null, companies: {}, stageMaps: null, deals: 0, changes: 0 }
  }
  cursor.deals = Number(cursor.deals) || 0
  cursor.changes = Number(cursor.changes) || 0
  cursor.companies = cursor.companies && typeof cursor.companies === 'object' ? cursor.companies : {}

  try {
    return json(await step({ d, token, env, request, cursor, warnings }))
  } catch (e) {
    await markSync(d, cursor.sync_id, { status: 'error', finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) })
    throw e
  }
})

async function step({ d, token, env, request, cursor, warnings }) {
  const settings = await loadSettings(env, request, { keys: ['accounts', 'gsi_companies'] })
  const accounts = settings.accounts || []
  const extra = Array.isArray(settings.gsi_companies) && settings.source && settings.source.gsi_companies === 'db' ? settings.gsi_companies : []
  const domains = domainIndex(accounts)
  const partnerOf = (name) => toAccount(name, accounts, NO_TARGETS)

  if (!cursor.stageMaps) cursor.stageMaps = stageMapsFrom(await hsGet(token, '/crm/v3/pipelines/deals'))
  const found = new Map()  // dealId -> { raw, via:Set, partner, companyRaw }
  const add = (raw, tag, partner, companyRaw) => {
    const id = String(raw.id)
    const f = found.get(id)
    if (f) { f.via.add(tag); if (!f.partner && partner) { f.partner = partner; f.companyRaw = companyRaw } } else found.set(id, { raw, via: new Set([tag]), partner, companyRaw })
  }
  let used = 0
  const paced = async (path, body) => { if (used) await sleep(SEARCH_GAP_MS); used++; return hsPost(token, path, body) }

  // Rule 1, first call only: the gsi property (a few dozen deals, one pass).
  if (cursor.phase === 'gsi') {
    let after, pages = 0
    do {
      const data = await paced('/crm/v3/objects/deals/search', { filterGroups: [{ filters: [{ propertyName: 'gsi', operator: 'HAS_PROPERTY' }] }], properties: PROPS, limit: 100, ...(after ? { after } : {}) })
      for (const r of data.results || []) { const g = (r.properties || {}).gsi || ''; add(r, 'gsi_property', partnerOf(g) || g || null, g || null) }
      after = data.paging && data.paging.next && data.paging.next.after
      pages++
    } while (after && pages < GSI_PAGES)
    if (after) warnings.push('More than 500 deals carry the gsi property; only the first 500 were read.')
    cursor.phase = 'companies'; cursor.taskIndex = 0; cursor.after = null
  }

  // Rule 2a: which HubSpot companies are on the GSI account list.
  const { names, domains: domainList } = searchTerms(accounts, extra)
  const tasks = buildCompanyTasks(names, domainList)
  if (cursor.phase === 'companies') {
    let taskIndex = Number.isInteger(cursor.taskIndex) ? cursor.taskIndex : 0
    let after = cursor.after || undefined
    while (taskIndex < tasks.length && used < HS_BUDGET) {
      const task = tasks[taskIndex]
      const data = await paced('/crm/v3/objects/companies/search', { ...task.body, properties: ['name', 'domain'], limit: 100, ...(after ? { after } : {}) })
      for (const c of data.results || []) {
        const p = c.properties || {}
        const account = task.tag === 'domain' ? (accountForDomain(p.domain, domains) || partnerOf(p.name)) : (partnerOf(p.name) || accountForDomain(p.domain, domains))
        if (account) cursor.companies[String(c.id)] = [p.name || '', account]
      }
      after = data.paging && data.paging.next && data.paging.next.after
      if (!after) { taskIndex++; after = undefined }
    }
    if (taskIndex >= tasks.length) { cursor.phase = 'deals'; cursor.taskIndex = 0; cursor.after = null }
    else { cursor.taskIndex = taskIndex; cursor.after = after || null }
  }

  // Rule 2b: deals associated with those companies, 100 company ids per filter.
  const ids = Object.keys(cursor.companies)
  const chunks = []
  for (let i = 0; i < ids.length; i += COMPANY_ID_CHUNK) chunks.push(ids.slice(i, i + COMPANY_ID_CHUNK))
  if (cursor.phase === 'deals') {
    let chunkIndex = Number.isInteger(cursor.taskIndex) ? cursor.taskIndex : 0
    while (chunkIndex < chunks.length && used < HS_BUDGET) {
      const chunk = chunks[chunkIndex]
      const got = []
      let after, pages = 0
      do {
        const data = await paced('/crm/v3/objects/deals/search', { filterGroups: [{ filters: [{ propertyName: 'associations.company', operator: 'IN', values: chunk }] }], properties: PROPS, limit: 100, ...(after ? { after } : {}) })
        got.push(...(data.results || []))
        after = data.paging && data.paging.next && data.paging.next.after
        pages++
      } while (after && pages < PAGES_PER_CHUNK)
      if (after) warnings.push(`Company batch ${chunkIndex + 1} has more than ${PAGES_PER_CHUNK * 100} deals; the rest were not read.`)
      // Which of the matched companies each deal belongs to (the primary one when labelled).
      const companyOf = new Map()
      for (let i = 0; i < got.length; i += HS_BATCH) {
        const data = await paced('/crm/v4/associations/deals/companies/batch/read', { inputs: got.slice(i, i + HS_BATCH).map((r) => ({ id: String(r.id) })) })
        for (const r of data.results || []) {
          const to = (r.to || []).map((t) => ({ id: String(t.toObjectId), primary: (t.associationTypes || []).some((a) => /primary/i.test(a.label || '')) })).filter((t) => cursor.companies[t.id])
          const pick = to.find((t) => t.primary) || to[0]
          if (pick) companyOf.set(String(r.from && r.from.id), pick.id)
        }
      }
      for (const r of got) {
        const cid = companyOf.get(String(r.id))
        const [companyRaw, account] = (cid && cursor.companies[cid]) || ['', null]
        add(r, 'company_match', account, companyRaw)
      }
      chunkIndex++
    }
    cursor.taskIndex = chunkIndex
  }

  // Persist what this invocation found, recording changes against the table.
  const now = new Date().toISOString()
  const dealIds = [...found.keys()]
  const existing = []
  for (const filter of inChunks(dealIds, 300)) {
    existing.push(...(await d.select('ca_hs_deals', { params: { hs_id: filter }, select: 'hs_id,stage,stage_label,bucket,amount,via,synced_at,prev_stage,last_stage_change_at' })))
  }
  const mapped = [...found.values()].map(({ raw, via, partner, companyRaw }) => mapDeal(raw, { via: [...via], partner, companyRaw, stageMaps: cursor.stageMaps, syncedAt: now }))
  const { rows, history } = diffDeals(mapped, existing, now)
  for (let i = 0; i < rows.length; i += 500) await d.upsert('ca_hs_deals', rows.slice(i, i + 500), 'hs_id')
  if (history.length) await d.insert('ca_hs_deal_history', history)
  // Deals first touched by this sync run (a deal both rules match is counted once).
  const seenThisRun = new Set(existing.filter((r) => r.synced_at && r.synced_at >= cursor.started_at).map((r) => String(r.hs_id)))
  cursor.deals += rows.filter((r) => !seenThisRun.has(r.hs_id)).length
  cursor.changes += history.length

  const done = cursor.phase === 'deals' && cursor.taskIndex >= chunks.length
  if (done) {
    await markSync(d, cursor.sync_id, { status: 'done', finished_at: now, deals: cursor.deals, changes: cursor.changes })
    await bumpCacheVersion(d) // deals and history changed: the shared GET cache must recompute
    return { done: true, deals: cursor.deals, changes: cursor.changes, warnings, progress: { phase: 'done', done: chunks.length, total: chunks.length } }
  }
  await markSync(d, cursor.sync_id, { deals: cursor.deals, changes: cursor.changes })
  const progress = cursor.phase === 'companies'
    ? { phase: 'companies', done: Math.min(cursor.taskIndex, tasks.length), total: tasks.length }
    : { phase: 'deals', done: Math.min(cursor.taskIndex, chunks.length), total: chunks.length }
  return { done: false, cursor, deals: cursor.deals, changes: cursor.changes, warnings, progress }
}
