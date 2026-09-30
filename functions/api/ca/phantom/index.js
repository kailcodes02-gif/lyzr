// GET /api/ca/phantom?from&to
// PhantomBuster (LinkedIn automation) mirror for the dashboard.
// -> { agents:[...all phantoms], runs:[runs launched in the range, IST days], daily:[all days, every phantom],
//      last_sync, configured, from, to }
// `daily` is returned whole so the view can draw the week-on-week ramp over the full history
// and compare the range with the period before; the view filters by range itself.

import { json, handle, isoDay } from '../_lib/http.js'
import { requireUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const from = isoDay(url.searchParams.get('from')) ? url.searchParams.get('from') : '2026-01-01'
  const to = isoDay(url.searchParams.get('to')) ? url.searchParams.get('to') : new Date().toISOString().slice(0, 10)
  const d = db(env)
  const [agents, runs, daily, syncs] = await Promise.all([
    d.select('ca_pb_agents', { select: 'id,name,script,last_run_at,status,synced_at', order: 'name.asc', limit: 1000 }).catch(() => []),
    d.selectAll('ca_pb_runs', {
      params: { launched_at: [`gte.${from}T00:00:00+05:30`, `lte.${to}T23:59:59+05:30`] },
      select: 'id,agent_id,launched_at,ended_at,status,profiles,invites_sent,accepted,messages_sent,replies,synced_at',
      order: 'launched_at.desc,id.asc',
      max: 5000,
    }).catch(() => []),
    d.selectAll('ca_pb_daily', { select: 'agent_id,day,profiles,invites_sent,accepted,messages_sent,replies', order: 'day.asc,agent_id.asc', max: 20000 }).catch(() => []),
    d.select('ca_pb_sync', { order: 'started_at.desc', limit: 1 }).catch(() => []),
  ])
  return json({ agents, runs, daily, last_sync: syncs[0] || null, configured: Boolean(env.PHANTOMBUSTER_API_KEY), from, to })
})
