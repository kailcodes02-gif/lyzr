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
export const EVENTS = ['sent', 'opened', 'clicked', 'bounced', 'auto_reply', 'replied', 'unsubscribed', 'other']
export const MAX_ROWS = 2000
export const BATCH = 500

const PERF_NUM = ['impressions', 'clicks', 'spend', 'reach', 'leads', 'lead_forms_opened', 'video_views', 'sends', 'opens',
  'engagements', 'reactions', 'comments', 'shares', 'follows', 'viral_impressions', 'conversions']
const PERF_TEXT = ['campaign_group', 'campaign', 'ad_name', 'objective', 'format']
const DEMO_NUM = ['impressions', 'clicks', 'spend', 'sends', 'opens', 'engagements', 'leads']

const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

// Coerce one performance row; returns null when it cannot be stored.
export function normalisePerfRow(r, uploadId) {
  if (!r || typeof r !== 'object') return null
  const day = str(r.day).slice(0, 10)
  if (!isoDay(day)) return null
  const row = {
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

export function normaliseDemoRow(r, uploadId) {
  if (!r || typeof r !== 'object') return null
  const segment = str(r.segment)
  const value = str(r.value)
  if (!segment || !value) return null
  const row = { upload_id: uploadId, segment, value, campaign: str(r.campaign), extra: null }
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
  const params = {}
  if (channel) params.channel = `eq.${channel}`
  const uploads = await db(env).select('ca_uploads', {
    params,
    select: 'id,channel,kind,file_name,uploaded_by,uploaded_at,period_start,period_end,row_count,notes',
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
      // Re-upload replaces: same window and kind means the old upload goes.
      const dupes = await d.select('ca_uploads', {
        params: { channel: `eq.${channel}`, kind: `eq.${kind}`, period_start: `eq.${periodStart}`, period_end: `eq.${periodEnd}` },
        select: 'id',
      })
      if (dupes.length) {
        for (const filter of inChunks(dupes.map((x) => x.id))) await d.del('ca_uploads', { id: filter })
      }
    }
    const inserted = await d.insert('ca_uploads', {
      channel,
      kind,
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
    clean = dedupe(rows.map((r) => normalisePerfRow(r, uploadId)).filter(Boolean), (r) => `${r.day}|${r.campaign_id}|${r.ad_id}`)
    table = 'ca_li_perf'
    onConflict = 'day,campaign_id,ad_id'
  } else if (kind === 'events') {
    clean = dedupe(rows.map((r) => normaliseEventRow(r, uploadId)).filter(Boolean), (r) => `${r.campaign}|${r.contact}|${r.step}|${r.event}|${r.ts}|${r.link}`)
    table = 'ca_em_events'
    onConflict = 'campaign,contact,step,event,ts,link'
  } else {
    clean = dedupe(rows.map((r) => normaliseDemoRow(r, uploadId)).filter(Boolean), (r) => `${r.upload_id}|${r.segment}|${r.value}|${r.campaign}`)
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
