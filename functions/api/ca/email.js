// GET /api/ca/email?offset=0
// Email channel data for the dashboard. Events are paged because a campaign
// export can hold tens of thousands of rows and one invocation has a small
// subrequest budget: the browser calls again with `next` until it is null.
//
// -> {
//   events: [[ci, contact, step, event, ts, si, link, lag_s], ...]   compact rows
//   campaigns: [names]  senders: [mailboxes]   (ci / si index into these, per page)
//   next: offset | null,
//   // first page only (offset 0):
//   uploads:[...], api:{ campaigns:[...], daily:[...], workspace:{sent, contacted, campaigns}, last_sync, configured }
// }
// api.campaigns holds every campaign in the Instantly workspace with a `gsi`
// flag; daily rows exist for GSI campaigns only. api.workspace sums every
// campaign (GSI and not) so the view can show the GSI share of sends.
// Every event is returned (no date filter): the view needs the whole history
// for month-on-month and week-on-week comparisons and filters by range itself.

import { json, handle } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db, PAGE } from './_lib/db.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const PAGES_PER_CALL = 15

export function compact(rows) {
  const campaigns = [], senders = []
  const ci = new Map(), si = new Map()
  const idx = (m, list, v) => { const k = v || ''; if (!m.has(k)) { m.set(k, list.length); list.push(k) } return m.get(k) }
  const events = rows.map((r) => [idx(ci, campaigns, r.campaign), r.contact, r.step, r.event, r.ts, idx(si, senders, r.sender), r.link || '', r.lag_s == null ? null : Number(r.lag_s)])
  return { events, campaigns, senders }
}

/** All-time totals over every campaign row (GSI and not). */
export function workspaceTotals(campaigns) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  const list = Array.isArray(campaigns) ? campaigns : []
  return { sent: list.reduce((a, c) => a + n(c.sent), 0), contacted: list.reduce((a, c) => a + n(c.contacted), 0), campaigns: list.length, gsi_campaigns: list.filter((c) => c.gsi !== false).length }
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
  const d = db(env)

  const rows = []
  let next = offset
  let more = true
  for (let i = 0; i < PAGES_PER_CALL && more; i++) {
    const page = await d.select('ca_em_events', {
      select: 'campaign,contact,step,event,ts,sender,link,lag_s',
      order: 'ts.asc,campaign.asc,contact.asc,step.asc,event.asc,link.asc',
      limit: PAGE,
      offset: next,
    })
    rows.push(...page)
    next += page.length
    more = page.length === PAGE
  }
  const out = { ...compact(rows), next: more ? next : null }

  if (offset === 0) {
    const [uploads, campaigns, daily, syncs] = await Promise.all([
      d.select('ca_uploads', {
        params: { channel: 'eq.email' },
        select: 'id,channel,kind,file_name,uploaded_by,uploaded_at,period_start,period_end,row_count,notes',
        order: 'uploaded_at.desc',
        limit: 500,
      }),
      d.select('ca_em_campaigns', { select: 'id,name,status,gsi,leads_count,contacted,sent,new_leads_contacted,opened_unique,clicked_unique,replied_unique,replies_automatic,bounced,unsubscribed,completed,opportunities,created_at,synced_at', order: 'name.asc', limit: 1000 }).catch(() => []),
      d.selectAll('ca_em_daily', { select: 'campaign_id,day,sent,contacted,new_leads_contacted,unique_opened,unique_replies,replies_automatic,unique_clicks,opportunities', order: 'day.asc,campaign_id.asc', max: 20000 }).catch(() => []),
      d.select('ca_em_sync', { order: 'started_at.desc', limit: 1 }).catch(() => []),
    ])
    out.uploads = uploads
    out.api = { campaigns, daily, workspace: workspaceTotals(campaigns), last_sync: syncs[0] || null, configured: Boolean(env.INSTANTLY_API_KEY) }
  }
  return json(out)
})
