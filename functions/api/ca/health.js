// GET /api/ca/health -> { ok, db, hubspot, claude, instantly, cron, user }
// db = env present and one cheap select works; hubspot / claude = env present only.

import { json, handle } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db, dbConfigured } from './_lib/db.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)

  let dbOk = false
  let dbError = null
  if (dbConfigured(env)) {
    try {
      await db(env).select('ca_settings', { select: 'key', limit: 1 })
      dbOk = true
    } catch (e) {
      dbError = String(e.message || e).slice(0, 200)
    }
  }
  const hubspot = Boolean(env.HUBSPOT_ACCESS_TOKEN)
  const claude = Boolean(env.ANTHROPIC_API_KEY)
  const instantly = Boolean(env.INSTANTLY_API_KEY)
  return json({
    ok: dbOk && hubspot && claude,
    db: dbOk,
    db_error: dbError,
    hubspot,
    claude,
    instantly,
    cron: Boolean(env.CA_CRON_SECRET),
    user,
  })
})
