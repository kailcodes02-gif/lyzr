// GET /api/ca/hubspot/deals?from=YYYY-MM-DD&to=YYYY-MM-DD
// -> { deals:[...], history:[...], last_sync:{...}|null, kpis:{...} }
// Reads the read-only mirror in ca_hs_deals / ca_hs_deal_history. Deals are
// always the whole pipeline (the widget shows all of it); the range only
// filters history by `at`, which is how "what changed in this period" is
// computed. Range boundaries are IST calendar days. Any signed-in user.

import { json, handle, isoDay } from '../_lib/http.js'
import { requireUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'
import { cachedGet, cacheResponse } from '../_lib/cache.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

const OPEN = new Set(['conversation', 'demo'])

// Headline numbers over the whole pipeline (same definitions as js/lib/pipeline-agg.mjs).
export function kpisOf(deals) {
  const k = { total: deals.length, ongoing: 0, demos: 0, wins: 0, losses: 0, customers: 0, closed_acv: 0, open_acv: 0 }
  const customers = new Set()
  for (const d of deals) {
    const amount = Number(d.amount) || 0
    if (OPEN.has(d.bucket)) { k.ongoing++; k.open_acv += amount }
    if (d.bucket === 'demo') k.demos++
    if (d.bucket === 'won') { k.wins++; k.closed_acv += amount; if (d.partner) customers.add(d.partner) }
    if (d.bucket === 'lost') k.losses++
  }
  k.customers = customers.size
  return k
}

export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  if (from && !isoDay(from)) return json({ error: 'from must be YYYY-MM-DD' }, 400)
  if (to && !isoDay(to)) return json({ error: 'to must be YYYY-MM-DD' }, 400)

  // Shared 8-hour cache; the deals sync bumps the version when it finishes.
  return cacheResponse(await cachedGet(env, request, { path: 'hubspot/deals', params: { from, to }, waitUntil }, () => load(env, { from, to })))
})

export async function load(env, { from, to }) {
  const d = db(env)
  const at = []
  if (from) at.push(`gte.${from}T00:00:00+05:30`)
  if (to) at.push(`lte.${to}T23:59:59.999+05:30`)
  const [deals, history, syncs] = await Promise.all([
    d.selectAll('ca_hs_deals', { order: 'created_at.desc,hs_id.asc' }),
    d.selectAll('ca_hs_deal_history', { params: at.length ? { at } : {}, order: 'at.desc,id.desc' }),
    d.select('ca_hs_deals_sync', { order: 'started_at.desc', limit: 1 }),
  ])
  return { from: from || null, to: to || null, deals, history, last_sync: syncs[0] || null, kpis: kpisOf(deals) }
}
