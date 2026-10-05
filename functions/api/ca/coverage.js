// GET /api/ca/coverage -> what the database holds per source, so the Admin page can show
// which dates are covered, where the gaps are and when each pull last ran.
// {
//   ads: { [platform]: { performance:{ from, to, days_covered, days_missing, gaps:[{from,to}], uploads }, demographics:[{from,to,rows,uploaded_at}] } },
//   email: { events:{from,to}, daily:{from,to}, campaigns, gsi_campaigns, last_sync },
//   hubspot: { contacts:{from,to}, last_sync }, deals: { count, last_sync }, phantom: { daily:{from,to}, last_sync },
//   actions: { open, in_progress, blocked, done, dropped }
// }
// Every block is independent: a table that does not exist yet (migration not run) reports { error }.
import { json, handle } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db } from './_lib/db.js'
import { cachedGet, cacheResponse } from './_lib/cache.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

const DAY = 864e5
const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * DAY).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) + 1

/** Union of [from,to] day ranges -> { from, to, days_covered, days_missing, gaps }. Pure, exported for tests. */
export function coverageOf(ranges) {
  const rs = ranges.filter(r => r && r.from && r.to && r.from <= r.to).map(r => ({ from: r.from, to: r.to })).sort((a, b) => a.from < b.from ? -1 : 1)
  if (!rs.length) return { from: null, to: null, days_covered: 0, days_missing: 0, gaps: [] }
  const merged = []
  for (const r of rs) {
    const last = merged[merged.length - 1]
    if (last && r.from <= addDays(last.to, 1)) { if (r.to > last.to) last.to = r.to } else merged.push({ ...r })
  }
  const gaps = []
  for (let i = 1; i < merged.length; i++) gaps.push({ from: addDays(merged[i - 1].to, 1), to: addDays(merged[i].from, -1) })
  const covered = merged.reduce((s, m) => s + daysBetween(m.from, m.to), 0)
  return { from: merged[0].from, to: merged[merged.length - 1].to, days_covered: covered, days_missing: daysBetween(merged[0].from, merged[merged.length - 1].to) - covered, gaps }
}

async function edge(d, table, col, dir, extra = {}) {
  const rows = await d.select(table, { select: col, order: `${col}.${dir}`, limit: 1, params: extra })
  return rows[0] ? rows[0][col] : null
}
async function lastSync(d, table) {
  const rows = await d.select(table, { order: 'started_at.desc', limit: 1 })
  return rows[0] || null
}
const guard = async fn => { try { return await fn() } catch (e) { return { error: String(e.message || e).slice(0, 160) } } }

export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  // Shared 8-hour cache; every write (upload, sync, settings) bumps the version so the grid stays right.
  return cacheResponse(await cachedGet(env, request, { path: 'coverage', waitUntil }, () => load(env)))
})

export async function load(env) {
  const d = db(env)

  const ads = await guard(async () => {
    const uploads = await d.select('ca_uploads', { params: { channel: 'eq.linkedin' }, select: 'id,kind,platform,file_name,period_start,period_end,row_count,uploaded_at', order: 'uploaded_at.desc', limit: 1000 })
    const out = {}
    for (const u of uploads) {
      const p = u.platform || 'linkedin'
      if (!out[p]) out[p] = { performance: null, demographics: [], _perf: [], uploads: 0 }
      out[p].uploads++
      if (u.kind === 'performance') out[p]._perf.push({ from: u.period_start, to: u.period_end })
      else out[p].demographics.push({ from: u.period_start, to: u.period_end, rows: u.row_count, uploaded_at: u.uploaded_at, file: u.file_name })
    }
    for (const p of Object.keys(out)) {
      const perf = coverageOf(out[p]._perf)
      // Rows in the table can start before the first upload's recorded period (older imports); trust the table for the edges.
      try {
        const lo = await edge(d, 'ca_li_perf', 'day', 'asc', { platform: `eq.${p}` }), hi = await edge(d, 'ca_li_perf', 'day', 'desc', { platform: `eq.${p}` })
        if (lo && (!perf.from || lo < perf.from)) perf.from = lo
        if (hi && (!perf.to || hi > perf.to)) perf.to = hi
      } catch { /* platform column missing until 007 runs; the upload periods still tell the story */ }
      out[p].performance = { ...perf, uploads: out[p]._perf.length }
      out[p].demographics.sort((a, b) => a.from < b.from ? -1 : 1)
      delete out[p]._perf
    }
    return out
  })

  const email = await guard(async () => {
    const [evFrom, evTo, dFrom, dTo, camps, sync] = await Promise.all([
      edge(d, 'ca_em_events', 'ts', 'asc'), edge(d, 'ca_em_events', 'ts', 'desc'),
      edge(d, 'ca_em_daily', 'day', 'asc'), edge(d, 'ca_em_daily', 'day', 'desc'),
      d.select('ca_em_campaigns', { select: 'id,gsi', limit: 1000 }), lastSync(d, 'ca_em_sync'),
    ])
    return { events: { from: evFrom ? String(evFrom).slice(0, 10) : null, to: evTo ? String(evTo).slice(0, 10) : null }, daily: { from: dFrom, to: dTo }, campaigns: camps.length, gsi_campaigns: camps.filter(c => c.gsi !== false).length, last_sync: sync }
  })

  const hubspot = await guard(async () => {
    const [from, to, sync] = await Promise.all([edge(d, 'ca_hs_contacts', 'created_at', 'asc'), edge(d, 'ca_hs_contacts', 'created_at', 'desc'), lastSync(d, 'ca_hs_sync')])
    return { contacts: { from: from ? String(from).slice(0, 10) : null, to: to ? String(to).slice(0, 10) : null }, last_sync: sync }
  })

  const deals = await guard(async () => {
    const [rows, sync] = await Promise.all([d.select('ca_hs_deals', { select: 'hs_id', limit: 1000 }), lastSync(d, 'ca_hs_deals_sync')])
    return { count: rows.length, last_sync: sync }
  })

  const phantom = await guard(async () => {
    const [from, to, sync] = await Promise.all([edge(d, 'ca_pb_daily', 'day', 'asc'), edge(d, 'ca_pb_daily', 'day', 'desc'), lastSync(d, 'ca_pb_sync')])
    return { daily: { from, to }, last_sync: sync }
  })

  const actions = await guard(async () => {
    const rows = await d.select('ca_actions', { select: 'status', limit: 1000 })
    const out = { open: 0, in_progress: 0, blocked: 0, done: 0, dropped: 0 }
    for (const r of rows) out[r.status] = (out[r.status] || 0) + 1
    return out
  })

  return { ads, email, hubspot, deals, phantom, actions, generated_at: new Date().toISOString() }
}
