// /api/ca/uploads
//   GET    ?channel=linkedin            -> { uploads:[...] }
//   POST   { channel, kind, file_name, period_start, period_end, columns, rows, upload_id?, final? }
//          editors only. First call creates the ca_uploads row; every call
//          upserts its rows in batches of 500 and adds to row_count.
//          -> { upload_id, inserted, skipped }
//   DELETE ?id=<uuid>                   editors only -> { ok } (rows cascade)
//
// Row shapes (already normalised by js/csv.mjs):
//   performance : { day, campaign_id, ad_id, campaign_group, campaign, ad_name, objective, format, impressions, clicks, spend, ... }
//   demographics: { segment, value, campaign, impressions, clicks, spend, sends, opens, engagements, leads }
//   events (email): { campaign, contact, step, event, ts, sender, link, lag_s, raw_event }  (js/email-csv.mjs)
//          Instantly exports are cumulative; the event key makes re-uploads idempotent.
// A demographics upload with the same channel, kind, period_start and
// period_end as an existing one replaces it (old upload deleted first).

import { json, handle, readJson, isoDay, num } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db, inChunks } from './_lib/db.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const CHANNELS = ['linkedin', 'email']
export const KINDS = ['performance', 'demographics', 'events']
export const PLATFORMS = ['linkedin', 'google', 'meta', 'taboola', 'chatgpt', 'x', 'bing']
export const EVENTS = ['sent', 'opened', 'clicked', 'bounced', 'auto_reply', 'replied', 'unsubscribed', 'other']
export const MAX_ROWS = 2000
export const BATCH = 500

const PERF_NUM = ['impressions', 'clicks', 'spend', 'reach', 'leads', 'lead_forms_opened', 'video_views', 'sends', 'opens',
  'engagements', 'reactions', 'comments', 'shares', 'follows', 'viral_impressions', 'conversions']
const PERF_TEXT = ['campaign_group', 'campaign', 'ad_name', 'objective', 'format']
const DEMO_NUM = ['impressions', 'clicks', 'spend', 'sends', 'opens', 'engagements', 'leads']

const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

// Coerce one performance row; returns null when it cannot be stored.
export function normalisePerfRow(r, uploadId, platform = 'linkedin') {
  if (!r || typeof r !== 'object') return null
  const day = str(r.day).slice(0, 10)
  if (!isoDay(day)) return null
  const row = {
    platform,
    day,
    campaign_id: str(r.campaign_id),
    ad_id: str(r.ad_id),
    upload_id: uploadId,
    extra: null,
  }
  for (const k of PERF_TEXT) row[k] = str(r[k]) || null
  for (const k of PERF_NUM) row[k] = num(r[k], 0)
  const extra = {}
  for (const [k, v] of Object.entries(r)) {
    if (k === 'day' || k === 'campaign_id' || k === 'ad_id' || PERF_TEXT.includes(k) || PERF_NUM.includes(k)) continue
    if (v === '' || v === null || v === undefined) continue
    extra[k] = v
  }
  if (Object.keys(extra).length) row.extra = extra
  return row
}

// `tag` labels a demographics export that was filtered to one person's boosted posts or one ad set
// before export (LinkedIn puts no campaign column in the file): it lands in `campaign`.
export function normaliseDemoRow(r, uploadId, platform = 'linkedin', tag = null) {
  if (!r || typeof r !== 'object') return null
  const segment = str(r.segment)
  const value = str(r.value)
  if (!segment || !value) return null
  const row = { upload_id: uploadId, platform, segment, value, campaign: str(r.campaign) || (tag ? String(tag) : ''), extra: null }
  for (const k of DEMO_NUM) row[k] = num(r[k], 0)
  const extra = {}
  for (const [k, v] of Object.entries(r)) {
    if (k === 'segment' || k === 'value' || k === 'campaign' || DEMO_NUM.includes(k)) continue
    if (v === '' || v === null || v === undefined) continue
    extra[k] = v
  }
  if (Object.keys(extra).length) row.extra = extra
  return row
}

export function normaliseEventRow(r, uploadId) {
  if (!r || typeof r !== 'object') return null
  const campaign = str(r.campaign).slice(0, 300)
  const contact = str(r.contact).toLowerCase().slice(0, 320)
  const ts = str(r.ts)
  const t = Date.parse(ts)
  if (!campaign || !contact || !ts || Number.isNaN(t)) return null
  const event = EVENTS.includes(str(r.event)) ? str(r.event) : 'other'
  const step = Math.max(0, Math.trunc(num(r.step, 0)))
  const lag = r.lag_s === null || r.lag_s === undefined || r.lag_s === '' ? null : num(r.lag_s, null)
  return {
    campaign,
    contact,
    step,
    event,
    ts: new Date(t).toISOString(),
    upload_id: uploadId,
    sender: str(r.sender).toLowerCase().slice(0, 320) || null,
    link: event === 'clicked' ? str(r.link).slice(0, 2000) : '',
    lag_s: event === 'clicked' ? lag : null,
    raw_event: str(r.raw_event).slice(0, 80) || null,
  }
}

// Postgres rejects two rows for the same key in one upsert statement, so the
// batch is de-duplicated (last one wins) before it is sent.
function dedupe(rows, keyFn) {
  const m = new Map()
  for (const r of rows) m.set(keyFn(r), r)
  return [...m.values()]
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const channel = url.searchParams.get('channel')
  const platform = url.searchParams.get('platform')
  const params = {}
  if (channel) params.channel = `eq.${channel}`
  if (platform) params.platform = `eq.${platform}`
  const uploads = await db(env).select('ca_uploads', {
    params,
    select: 'id,channel,kind,platform,file_name,uploaded_by,uploaded_at,period_start,period_end,row_count,notes',
    order: 'uploaded_at.desc',
    limit: 500,
  })
  return json({ uploads })
})

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can upload data' }, 403)
  const b = await readJson(request)

  const channel = str(b.channel || 'linkedin').toLowerCase()
  const kind = str(b.kind).toLowerCase()
  if (!CHANNELS.includes(channel)) return json({ error: `channel must be one of ${CHANNELS.join(', ')}` }, 400)
  if (!KINDS.includes(kind)) return json({ error: `kind must be one of ${KINDS.join(', ')}` }, 400)
  if ((channel === 'email') !== (kind === 'events')) return json({ error: 'email uploads use kind "events"; LinkedIn uploads use performance or demographics' }, 400)
  const platform = channel === 'email' ? null : (str(b.platform || 'linkedin').toLowerCase() || 'linkedin')
  const tag = kind === 'demographics' ? (str(b.tag).slice(0, 80) || null) : null
  if (platform && !PLATFORMS.includes(platform)) return json({ error: `platform must be one of ${PLATFORMS.join(', ')}` }, 400)
  const rows = Array.isArray(b.rows) ? b.rows : []
  if (rows.length > MAX_ROWS) return json({ error: `Send at most ${MAX_ROWS} rows per call` }, 413)
  const periodStart = str(b.period_start) || null
  const periodEnd = str(b.period_end) || null
  if (periodStart && !isoDay(periodStart)) return json({ error: 'period_start must be YYYY-MM-DD' }, 400)
  if (periodEnd && !isoDay(periodEnd)) return json({ error: 'period_end must be YYYY-MM-DD' }, 400)

  const d = db(env)
  let uploadId = str(b.upload_id) || null
  let created = false
  if (uploadId) {
    const existing = await d.select('ca_uploads', { params: { id: `eq.${uploadId}` }, select: 'id,kind,channel', limit: 1 })
    if (!existing.length) return json({ error: 'upload_id not found' }, 404)
    if (existing[0].kind !== kind || existing[0].channel !== channel) return json({ error: 'upload_id belongs to a different channel or kind' }, 400)
  } else {
    if (kind === 'demographics' && periodStart && periodEnd) {
      // Re-upload replaces: same window, kind and segments (notes, e.g. "Company") means the old
      // upload goes. A Job Title export for the same window sits next to the Company one.
      const segs = str(b.notes).slice(0, 2000) || null
      const found = await d.select('ca_uploads', {
        params: { channel: `eq.${channel}`, kind: `eq.${kind}`, period_start: `eq.${periodStart}`, period_end: `eq.${periodEnd}`, platform: `eq.${platform}` },
        select: 'id,notes,row_count',
      })
      const dupes = found.filter((x) => (x.notes || '') === (segs || '') || !x.row_count)
      // Also drop older uploads of the same breakdown whose window sits inside the new one (e.g. 1-14 Sept after 1-30 Sept).
      const inside = segs ? await d.select('ca_uploads', { params: { channel: `eq.${channel}`, kind: `eq.${kind}`, platform: `eq.${platform}`, notes: `eq.${segs}`, period_start: `gte.${periodStart}`, period_end: `lte.${periodEnd}` }, select: 'id' }) : []
      for (const x of inside) if (!dupes.some((y) => y.id === x.id)) dupes.push(x)
      // A window that only partly overlaps an existing one of the same breakdown would hide days (newest wins
      // at read time), so it is refused with a clear message instead of silently losing data.
      const partial = segs ? (await d.select('ca_uploads', { params: { channel: `eq.${channel}`, kind: `eq.${kind}`, platform: `eq.${platform}`, notes: `eq.${segs}`, period_start: `lte.${periodEnd}`, period_end: `gte.${periodStart}` }, select: 'id,period_start,period_end,row_count' })).filter((x) => x.row_count > 0 && !dupes.some((y) => y.id === x.id) && !(x.period_start >= periodStart && x.period_end <= periodEnd)) : []
      if (partial.length) return json({ error: `This ${segs} export (${periodStart} to ${periodEnd}) partly overlaps one already stored (${partial[0].period_start} to ${partial[0].period_end}). Export the same window, or one that fully covers it, so no days are lost.` }, 409)
      if (dupes.length) {
        for (const filter of inChunks(dupes.map((x) => x.id))) await d.del('ca_uploads', { id: filter })
      }
    }
    const inserted = await d.insert('ca_uploads', {
      channel,
      kind,
      platform,
      file_name: str(b.file_name).slice(0, 300) || null,
      uploaded_by: user.email,
      uploaded_at: new Date().toISOString(),
      period_start: periodStart,
      period_end: periodEnd,
      row_count: 0,
      columns: b.columns && typeof b.columns === 'object' ? b.columns : null,
      notes: str(b.notes).slice(0, 2000) || null,
    }, { returning: true })
    uploadId = inserted[0] && inserted[0].id
    if (!uploadId) return json({ error: 'Could not create the upload record' }, 502)
    created = true
  }

  let clean
  let table
  let onConflict
  if (kind === 'performance') {
    clean = dedupe(rows.map((r) => normalisePerfRow(r, uploadId, platform)).filter(Boolean), (r) => `${r.day}|${r.campaign_id}|${r.ad_id}`)
    table = 'ca_li_perf'
    onConflict = 'platform,day,campaign_id,ad_id'
    // A campaign-level export (no Ad ID) and an ad-level export of the same days would both be stored and
    // summed. Keep one granularity per (day, campaign): the file being uploaded wins.
    if (clean.length) {
      const adLevel = clean.some((r) => r.ad_id)
      const camps = [...new Set(clean.map((r) => r.campaign_id))]
      for (const dayF of inChunks([...new Set(clean.map((r) => r.day))], 60)) for (const campF of inChunks(camps, 60)) await d.del('ca_li_perf', { platform: `eq.${platform}`, day: dayF, campaign_id: campF, ad_id: adLevel ? 'eq.' : 'neq.' })
    }
  } else if (kind === 'events') {
    clean = dedupe(rows.map((r) => normaliseEventRow(r, uploadId)).filter(Boolean), (r) => `${r.campaign}|${r.contact}|${r.step}|${r.event}|${r.ts}|${r.link}`)
    table = 'ca_em_events'
    onConflict = 'campaign,contact,step,event,ts,link'
  } else {
    clean = dedupe(rows.map((r) => normaliseDemoRow(r, uploadId, platform, tag)).filter(Boolean), (r) => `${r.upload_id}|${r.segment}|${r.value}|${r.campaign}`)
    table = 'ca_li_demo'
    onConflict = 'upload_id,segment,value,campaign'
  }
  const skipped = rows.length - clean.length
  let inserted = 0
  for (let i = 0; i < clean.length; i += BATCH) {
    const batch = clean.slice(i, i + BATCH)
    await d.upsert(table, batch, onConflict)
    inserted += batch.length
  }

  if (inserted) {
    const cur = await d.select('ca_uploads', { params: { id: `eq.${uploadId}` }, select: 'row_count', limit: 1 })
    const rowCount = num(cur[0] && cur[0].row_count, 0) + inserted
    await d.update('ca_uploads', { id: `eq.${uploadId}` }, { row_count: rowCount })
  }
  // Rows are keyed by their natural key (performance: platform, day, campaign, ad; events: campaign, contact,
  // step, event, time, link), so data uploaded twice is stored once and now belongs to this upload. Recount the
  // other uploads whose dates overlap; one left with no rows is fully replaced and says so (performance) or
  // is removed (events), instead of looking like a second copy of the same data. Never fails the upload.
  if (b.final && (kind === 'performance' || kind === 'events')) {
    try {
      const win = periodStart && periodEnd ? { period_start: `lte.${periodEnd}`, period_end: `gte.${periodStart}` } : {}
      const others = await d.select('ca_uploads', { params: { channel: `eq.${channel}`, kind: `eq.${kind}`, ...(kind === 'performance' ? { platform: `eq.${platform}` } : {}), id: `neq.${uploadId}`, ...win }, select: 'id,row_count,notes', order: 'uploaded_at.desc', limit: 12 })
      for (const u of others) {
        const left = await d.selectAll(kind === 'performance' ? 'ca_li_perf' : 'ca_em_events', { params: { upload_id: `eq.${u.id}` }, select: kind === 'performance' ? 'ad_id' : 'step', max: 20000 })
        const n = left.length
        if (kind === 'events') { if (!n) await d.del('ca_uploads', { id: `eq.${u.id}` }); else if (n !== num(u.row_count, 0)) await d.update('ca_uploads', { id: `eq.${u.id}` }, { row_count: n }) }
        else if (n !== num(u.row_count, 0) || (!n && !/^Replaced/.test(String(u.notes || '')))) await d.update('ca_uploads', { id: `eq.${u.id}` }, { row_count: n, notes: n ? (u.notes || null) : 'Replaced by a later upload covering the same days' })
      }
    } catch (e) { console.error('recount after upload failed', e && e.message) }
  }
  return json({ upload_id: uploadId, inserted, skipped, created, final: Boolean(b.final) }, created ? 201 : 200)
})

export const onRequestDelete = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can delete uploads' }, 403)
  const id = str(new URL(request.url).searchParams.get('id'))
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Missing or invalid ?id=' }, 400)
  await db(env).del('ca_uploads', { id: `eq.${id}` })
  return json({ ok: true, id })
})
