// POST /api/ca/instantly/sync { cursor? }   editors, or the daily job (X-CA-Cron)
// -> { done, cursor?, campaigns, workspace_campaigns, days, leads, warnings:[], progress:{ phase, done, total } }
//
// READ-ONLY against Instantly: nothing is ever written there. Pulls every
// campaign tagged GSI in Instantly (tag id verified 2026-08-11, same as
// functions/api/instantly-report.js; falls back to the tag labelled "GSI", then
// to campaign names containing "GSI"), their all-time totals, and the daily
// breakdown per campaign over each campaign's whole life, every time (57
// campaigns is a handful of calls, and a full pull also picks up late opens).
// Every other campaign in the workspace is stored too (gsi:false, totals only,
// no daily rows) so the dashboard can show the GSI share of workspace sends.
// Resumable like hubspot/refresh.js: keep calling with `cursor` until done.
//
// Phases: start (campaign list + totals) -> 'daily' (one call per GSI campaign)
// -> 'leads' (every lead of every GSI campaign into ca_em_leads, so each HubSpot
// contact can be checked against the GSI sequences). The leads phase re-reads
// every GSI campaign in full on each run (a "stop when nothing is new" shortcut
// would miss reply and status changes on older leads), LEADS_BUDGET pages per
// call, at most MAX_LEAD_PAGES pages per run (a warning says when that cap cut
// the run short). Leads list is POST /leads/list: a read, not a write.

import { json, handle, readJson, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'
import { bumpCacheVersion } from '../_lib/cache.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

const API = 'https://api.instantly.ai/api/v2'
export const GSI_TAG_ID = '95da42d3-db60-4b3e-a1a9-6e85cda4e35d'
export const DAILY_BUDGET = 20
export const FIRST_DAY = '2026-01-01'
// Leads phase: one Instantly call per page plus one upsert per 500 rows, so 30
// pages (3000 rows, 6 upserts) stays under ~40 subrequests per invocation.
export const LEADS_BUDGET = 30
export const LEADS_PAGE_SIZE = 100
export const MAX_LEAD_PAGES = 1000

async function ig(token, path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new HttpError(502, `Instantly ${res.status} on ${path.split('?')[0]}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.json()
}

async function igPost(token, path, body) {
  const res = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new HttpError(502, `Instantly ${res.status} on ${path}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.json()
}

async function listTagged(token, tagId) {
  const out = []
  let after = null
  for (let guard = 0; guard < 10; guard++) {
    const data = await ig(token, `/campaigns?tag_ids=${encodeURIComponent(tagId)}&limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`)
    out.push(...(data.items || []))
    after = data.next_starting_after
    if (!after || !(data.items || []).length) break
  }
  return out
}

export async function resolveGsiCampaigns(token, warnings = []) {
  let list = await listTagged(token, GSI_TAG_ID).catch(() => [])
  if (list.length) return list
  const tags = (await ig(token, '/custom-tags?limit=200').catch(() => ({ items: [] }))).items || []
  const tag = tags.find((t) => String(t.label || '').trim().toLowerCase() === 'gsi')
  if (tag) list = await listTagged(token, tag.id).catch(() => [])
  if (list.length) { warnings.push('The saved GSI tag id is stale; matched the tag labelled "GSI" instead.'); return list }
  warnings.push('No campaign carries the GSI tag in Instantly; used campaigns whose name contains "GSI".')
  const all = []
  let after = null
  for (let guard = 0; guard < 10; guard++) {
    const data = await ig(token, `/campaigns?limit=100&search=GSI${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`)
    all.push(...(data.items || []))
    after = data.next_starting_after
    if (!after || !(data.items || []).length) break
  }
  return all.filter((c) => /gsi/i.test(c.name || ''))
}

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

export function mapCampaign(c, a, syncedAt, gsi = true) {
  a = a || {}
  return {
    id: String(c.id),
    name: c.name || a.campaign_name || 'Untitled campaign',
    status: c.status ?? a.campaign_status ?? null,
    gsi: gsi !== false,
    leads_count: n(a.leads_count),
    contacted: n(a.contacted_count),
    sent: n(a.emails_sent_count),
    new_leads_contacted: n(a.new_leads_contacted_count),
    opened_unique: n(a.open_count_unique),
    clicked_unique: n(a.link_click_count_unique),
    replied_unique: n(a.reply_count_unique),
    replies_automatic: n(a.reply_count_automatic_unique),
    bounced: n(a.bounced_count),
    unsubscribed: n(a.unsubscribed_count),
    completed: n(a.completed_count),
    opportunities: n(a.total_opportunities),
    created_at: c.timestamp_created || null,
    synced_at: syncedAt,
    raw: a && Object.keys(a).length ? a : null,
  }
}

export function mapDaily(campaignId, r, syncedAt) {
  return {
    campaign_id: campaignId,
    day: String(r.date).slice(0, 10),
    sent: n(r.sent),
    contacted: n(r.contacted),
    new_leads_contacted: n(r.new_leads_contacted),
    opened: n(r.opened),
    unique_opened: n(r.unique_opened),
    replies: n(r.replies),
    unique_replies: n(r.unique_replies),
    replies_automatic: n(r.unique_replies_automatic ?? r.replies_automatic),
    clicks: n(r.clicks),
    unique_clicks: n(r.unique_clicks),
    opportunities: n(r.unique_opportunities ?? r.opportunities),
    synced_at: syncedAt,
  }
}

const intOrNull = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? Math.trunc(x) : null }

// One Instantly lead (POST /leads/list item) -> one ca_em_leads row, or null without an email.
export function mapLead(l, campaign, syncedAt) {
  const email = String((l && l.email) || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  return {
    email,
    campaign_id: String(campaign.id),
    campaign_name: campaign.name || null,
    gsi: true,
    status: intOrNull(l.status),
    interest_status: intOrNull(l.lt_interest_status),
    open_count: n(l.email_open_count),
    reply_count: n(l.email_reply_count),
    click_count: n(l.email_click_count),
    created_at: l.timestamp_created || null,
    last_reply_at: l.timestamp_last_reply || null,
    synced_at: syncedAt,
  }
}

// One call's worth of the leads phase. Mutates and returns the cursor.
async function leadsStep(token, d, cursor, warnings) {
  const queue = Array.isArray(cursor.leadQueue) ? cursor.leadQueue : []
  let ci = Number(cursor.campaignIndex) || 0
  let after = cursor.starting_after || null
  let pages = Number(cursor.leadPages) || 0
  const syncedAt = new Date().toISOString()
  const rows = new Map() // campaign_id|email -> row; Instantly can hold the same email twice in a campaign
  let calls = 0
  let capped = false
  while (ci < queue.length && calls < LEADS_BUDGET) {
    if (pages >= MAX_LEAD_PAGES) { capped = true; break }
    const camp = queue[ci]
    const body = { campaign: camp.id, limit: LEADS_PAGE_SIZE }
    if (after) body.starting_after = after
    const data = await igPost(token, '/leads/list', body)
    calls++; pages++
    const items = Array.isArray(data && data.items) ? data.items : []
    for (const l of items) { const r = mapLead(l, camp, syncedAt); if (r) rows.set(r.campaign_id + '|' + r.email, r) }
    const next = data && data.next_starting_after
    if (next && items.length && next !== after) after = next
    else { ci++; after = null }
  }
  const out = [...rows.values()]
  try {
    for (let i = 0; i < out.length; i += 500) await d.upsert('ca_em_leads', out.slice(i, i + 500), 'campaign_id,email')
  } catch (e) {
    // migration 009 not run yet: keep the campaign and daily numbers, skip the leads
    if (!/PGRST205|42P01|could not find the table|relation .*ca_em_leads.* does not exist/i.test(String(e.message || e))) throw e
    warnings.push('The ca_em_leads table is missing, so Instantly leads were not saved. Run Campaign_Analytics/supabase/009_em_leads.sql in Supabase.')
    cursor.campaignIndex = queue.length
    cursor.starting_after = null
    cursor.leadPages = pages
    return cursor
  }
  cursor.campaignIndex = ci
  cursor.starting_after = after
  cursor.leadPages = pages
  cursor.leads = (Number(cursor.leads) || 0) + out.length
  if (capped) {
    warnings.push(`Stopped reading Instantly leads after ${MAX_LEAD_PAGES} pages today; ${queue.length - ci} GSI campaign(s) were not fully refreshed this run.`)
    cursor.campaignIndex = queue.length
    cursor.starting_after = null
  }
  return cursor
}

async function mark(d, id, patch) {
  if (!id) return
  try { await d.update('ca_em_sync', { id: `eq.${id}` }, patch) } catch { /* best effort */ }
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = cronUser(request, env) || (await requireUser(request, env))
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can sync Instantly' }, 403)
  const token = env.INSTANTLY_API_KEY
  if (!token) return json({ error: 'Instantly not configured (INSTANTLY_API_KEY)' }, 503)
  const d = db(env)
  const body = await readJson(request)
  const warnings = []
  let cursor = body.cursor && typeof body.cursor === 'object' ? { ...body.cursor } : null
  let syncId = cursor ? cursor.sync_id : null

  try {
    if (!cursor) {
      const started_at = new Date().toISOString()
      const rows = await d.insert('ca_em_sync', { started_by: user.email, started_at, status: 'running' }, { returning: true })
      syncId = rows[0] && rows[0].id
      const list = await resolveGsiCampaigns(token, warnings)
      // all-time totals: one call for the workspace, joined by id
      const totals = await ig(token, '/campaigns/analytics')
      const byId = new Map((Array.isArray(totals) ? totals : []).map((a) => [String(a.campaign_id), a]))
      const syncedAt = new Date().toISOString()
      const mapped = list.map((c) => mapCampaign(c, byId.get(String(c.id)), syncedAt))
      const gsiIds = new Set(mapped.map((c) => c.id))
      // the rest of the workspace: totals only, so the GSI share of sends can be shown
      const others = [...byId.values()].filter((a) => a && a.campaign_id != null && !gsiIds.has(String(a.campaign_id))).map((a) => mapCampaign({ id: a.campaign_id, name: a.campaign_name, status: a.campaign_status, timestamp_created: a.campaign_created_at || null }, a, syncedAt, false))
      const all = [...mapped, ...others]
      for (let i = 0; i < all.length; i += 200) await d.upsert('ca_em_campaigns', all.slice(i, i + 200), 'id')
      const today = iso(Date.now())
      cursor = {
        sync_id: syncId,
        today,
        queue: mapped.map((c) => { const start = (c.created_at || FIRST_DAY).slice(0, 10); return { id: c.id, name: c.name, from: start < FIRST_DAY ? FIRST_DAY : start } }),
        index: 0,
        campaigns: mapped.length,
        workspace_campaigns: all.length,
        days: 0,
        leads: 0,
      }
      await mark(d, syncId, mapped.length ? { campaigns: mapped.length } : { campaigns: 0, status: 'done', finished_at: new Date().toISOString(), days: 0 })
      if (!mapped.length) await bumpCacheVersion(d)
      return json({ done: !mapped.length, cursor: mapped.length ? cursor : undefined, campaigns: mapped.length, workspace_campaigns: all.length, days: 0, leads: 0, warnings, progress: { phase: 'daily', done: 0, total: mapped.length } })
    }

    const summary = (c) => ({ campaigns: c.campaigns, workspace_campaigns: c.workspace_campaigns, days: Number(c.days) || 0, leads: Number(c.leads) || 0 })

    if (cursor.phase === 'leads') {
      await leadsStep(token, d, cursor, warnings)
      const total = (cursor.leadQueue || []).length
      const done = cursor.campaignIndex >= total
      if (done) await mark(d, cursor.sync_id, { status: 'done', finished_at: new Date().toISOString(), days: Number(cursor.days) || 0 })
      if (done) await bumpCacheVersion(d) // campaigns, daily rows and leads changed: the shared GET cache must recompute
      return json({ done, cursor: done ? undefined : cursor, ...summary(cursor), warnings, progress: { phase: done ? 'done' : 'leads', done: Math.min(cursor.campaignIndex, total), total } })
    }

    const queue = Array.isArray(cursor.queue) ? cursor.queue : []
    let index = Number(cursor.index) || 0
    const stop = Math.min(queue.length, index + DAILY_BUDGET)
    const syncedAt = new Date().toISOString()
    const out = []
    for (; index < stop; index++) {
      const q = queue[index]
      const rows = await ig(token, `/campaigns/analytics/daily?campaign_id=${encodeURIComponent(q.id)}&start_date=${q.from}&end_date=${cursor.today}`)
      for (const r of Array.isArray(rows) ? rows : []) if (r && r.date) out.push(mapDaily(q.id, r, syncedAt))
    }
    for (let i = 0; i < out.length; i += 500) await d.upsert('ca_em_daily', out.slice(i, i + 500), 'campaign_id,day')
    cursor.index = index
    cursor.days = (Number(cursor.days) || 0) + out.length
    await mark(d, cursor.sync_id, { days: cursor.days })
    if (index < queue.length) return json({ done: false, cursor, ...summary(cursor), warnings, progress: { phase: 'daily', done: index, total: queue.length } })
    // daily phase finished: hand over to the leads phase (GSI campaigns only), starting on the next call
    cursor.phase = 'leads'
    cursor.leadQueue = queue.map((q) => ({ id: q.id, name: q.name || null }))
    cursor.campaignIndex = 0
    cursor.starting_after = null
    cursor.leadPages = 0
    cursor.leads = Number(cursor.leads) || 0
    delete cursor.queue
    delete cursor.index
    return json({ done: false, cursor, ...summary(cursor), warnings, progress: { phase: 'leads', done: 0, total: cursor.leadQueue.length } })
  } catch (e) {
    if (syncId) await mark(d, syncId, { status: 'error', finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) })
    throw e
  }
})
