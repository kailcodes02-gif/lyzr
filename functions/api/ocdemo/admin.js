// GET /api/ocdemo/admin[?format=csv]   Authorization: Bearer <Microsoft token | ca1 local token>
// Who signed in to the opencontroller demo and what they opened. Same sign-in as Campaign
// Analytics (functions/api/ca/_lib/auth.js); only its editors may read.
// -> { leads: [...], recent: [...], screens: [{ screen, views }] }
import { json, handle } from '../ca/_lib/http.js'
import { requireUser } from '../ca/_lib/auth.js'
import { db, dbConfigured } from '../ca/_lib/db.js'

export { corsPreflight as onRequestOptions } from '../ca/_lib/http.js'

const COLS = ['email', 'name', 'company', 'title', 'audience', 'auth_method', 'country', 'visits', 'screens_viewed', 'first_seen', 'last_seen', 'referrer']

export function toCsv(leads) {
  const q = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [COLS.join(','), ...leads.map((l) => COLS.map((c) => q(l[c])).join(','))].join('\n')
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only Campaign Analytics editors can see demo sign-ins.' }, 403)
  if (!dbConfigured(env)) return json({ error: 'Database not configured (CA_SUPABASE_URL / CA_SUPABASE_KEY)' }, 503)
  const d = db(env)
  let leads, recent
  try {
    [leads, recent] = await Promise.all([
      d.selectAll('ocdemo_leads', { select: '*', order: 'last_seen.desc', max: 5000 }),
      d.select('ocdemo_events', { select: 'lead_id,kind,screen,detail,at', order: 'at.desc', limit: 1000 }),
    ])
  } catch (e) {
    if (/ocdemo_/.test(String(e && e.message))) return json({ error: 'The ocdemo tables are missing: run opencontroller_demo/supabase/001_ocdemo_leads.sql in the Supabase SQL editor.' }, 503)
    throw e
  }
  if (new URL(request.url).searchParams.get('format') === 'csv') {
    return new Response(toCsv(leads), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="opencontroller-demo-signins.csv"', 'Cache-Control': 'no-store' } })
  }
  const byLead = new Map(leads.map((l) => [l.id, l]))
  const screens = new Map()
  for (const e of recent) if (e.kind === 'view' && e.screen) screens.set(e.screen, (screens.get(e.screen) || 0) + 1)
  return json({
    me: user.email,
    leads,
    recent: recent.slice(0, 300).map((e) => ({ ...e, email: byLead.get(e.lead_id)?.email || null })),
    screens: [...screens].map(([screen, views]) => ({ screen, views })).sort((a, b) => b.views - a.views),
  })
})
