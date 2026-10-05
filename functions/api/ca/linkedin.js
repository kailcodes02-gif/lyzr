// GET /api/ca/linkedin?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=linkedin
// platform defaults to linkedin; 'all' returns every ad platform (rows carry `platform`).
// -> { perf:[daily rows with day in range], demo:[{ upload, rows }] for
//      demographics uploads whose window overlaps the range, uploads:[all linkedin uploads] }

import { json, handle, isoDay } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db, inChunks } from './_lib/db.js'
import { activeWindows } from './_lib/windows.js'
import { cachedGet, cacheResponse } from './_lib/cache.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export function overlaps(u, from, to) {
  // Unknown window counts as overlapping so nothing silently disappears.
  if (!u.period_start && !u.period_end) return true
  const s = u.period_start || u.period_end
  const e = u.period_end || u.period_start
  if (from && e < from) return false
  if (to && s > to) return false
  return true
}

export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  if (from && !isoDay(from)) return json({ error: 'from must be YYYY-MM-DD' }, 400)
  if (to && !isoDay(to)) return json({ error: 'to must be YYYY-MM-DD' }, 400)

  const platform = (url.searchParams.get('platform') || 'linkedin').toLowerCase()
  // Shared 8-hour cache (same body for every user); uploads bump the version so `uploads` stays fresh.
  return cacheResponse(await cachedGet(env, request, { path: 'linkedin', params: { from, to, platform }, waitUntil }, () => load(env, { from, to, platform })))
})

export async function load(env, { from, to, platform }) {
  const platParam = platform === 'all' ? {} : { platform: `eq.${platform}` }
  const d = db(env)
  const dayFilter = []
  if (from) dayFilter.push(`gte.${from}`)
  if (to) dayFilter.push(`lte.${to}`)
  const [perf, uploads] = await Promise.all([
    d.selectAll('ca_li_perf', { params: { ...platParam, ...(dayFilter.length ? { day: dayFilter } : {}) }, order: 'day.asc,campaign_id.asc,ad_id.asc,platform.asc' }),
    d.select('ca_uploads', {
      params: { channel: 'eq.linkedin', ...platParam },
      select: 'id,channel,kind,platform,file_name,uploaded_by,uploaded_at,period_start,period_end,row_count,notes',
      order: 'uploaded_at.desc',
      limit: 500,
    }),
  ])

  // Every demographics upload overlapping the range, rows loaded, then newest-wins de-duplication:
  // a file uploaded twice (or an older window inside a newer one) counts once. Uploads made before the
  // segments were recorded (notes null) get their notes from their rows so they group correctly.
  const candidates = uploads.filter((u) => u.kind === 'demographics' && overlaps(u, from, to))
  const demo = []
  if (candidates.length) {
    const rowsByUpload = new Map(candidates.map((u) => [u.id, []]))
    for (const filter of inChunks(candidates.map((u) => u.id), 50)) {
      const rows = await d.selectAll('ca_li_demo', { params: { upload_id: filter }, order: 'id.asc' })
      for (const r of rows) {
        const list = rowsByUpload.get(r.upload_id)
        if (list) list.push(r)
      }
    }
    for (const u of candidates) {
      const rows = rowsByUpload.get(u.id) || []
      if (!u.notes && rows.length) { const segs = [...new Set(rows.map((r) => r.segment).filter(Boolean))].sort(); const tags = [...new Set(rows.map((r) => r.campaign).filter(Boolean))]; u.notes = segs.join(', ') + (tags.length === 1 ? ` (${tags[0]})` : '') }
      if (!rows.length) u.row_count = 0
    }
    const keep = new Set(activeWindows(candidates).map((u) => u.id))
    for (const u of candidates) if (keep.has(u.id)) demo.push({ upload: u, rows: rowsByUpload.get(u.id) || [] })
  }
  return { from: from || null, to: to || null, platform, perf, demo, uploads }
}
