// POST /api/ca/instantly/sync { cursor? }   editors, or the daily job (X-CA-Cron)
// -> { done, cursor?, campaigns, workspace_campaigns, days, warnings:[], progress:{ phase, done, total } }
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

import { json, handle, readJson, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

const API = 'https://api.instantly.ai/api/v2'
export const GSI_TAG_ID = '95da42d3-db60-4b3e-a1a9-6e85cda4e35d'
export const DAILY_BUDGET = 20
export const FIRST_DAY = '2026-01-01'

async function ig(token, path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new HttpError(502, `Instantly ${res.status} on ${path.split('?')[0]}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
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
        queue: mapped.map((c) => { const start = (c.created_at || FIRST_DAY).slice(0, 10); return { id: c.id, from: start < FIRST_DAY ? FIRST_DAY : start } }),
        index: 0,
        campaigns: mapped.length,
        workspace_campaigns: all.length,
        days: 0,
      }
      await mark(d, syncId, { campaigns: mapped.length })
      return json({ done: !mapped.length, cursor: mapped.length ? cursor : undefined, campaigns: mapped.length, workspace_campaigns: all.length, days: 0, warnings, progress: { phase: 'daily', done: 0, total: mapped.length } })
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
    const done = index >= queue.length
    await mark(d, cursor.sync_id, done ? { status: 'done', finished_at: new Date().toISOString(), days: cursor.days } : { days: cursor.days })
    return json({ done, cursor: done ? undefined : cursor, campaigns: cursor.campaigns, workspace_campaigns: cursor.workspace_campaigns, days: cursor.days, warnings, progress: { phase: done ? 'done' : 'daily', done: index, total: queue.length } })
  } catch (e) {
    if (syncId) await mark(d, syncId, { status: 'error', finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) })
    throw e
  }
})
