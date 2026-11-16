// GET /api/ca/health -> { ok, db, hubspot, claude, instantly, phantom, cron, linkedin_api:{configured, connected}, user }
// db = env present and one cheap select works; hubspot / claude = env present only.
// GET /api/ca/health?check=keys (signed in, or the daily job) also calls each service once with its key and
// reports ok / the HTTP status, so a dead or wrong key shows up. Free calls only: Claude is asked for the
// model's details (GET /v1/models/<id>, no tokens), the others for one small list. No key is ever returned.

import { json, handle } from './_lib/http.js'
import { apiKeys } from './_lib/apikeys.js'
import { requireUser, cronUser } from './_lib/auth.js'
import { db, dbConfigured } from './_lib/db.js'
import { getDoc } from './_lib/docs.js'
import { DOC as LI_DOC, configured as liConfigured, apiVersion as liVersion } from './_lib/linkedin-api.js'
import { MODEL_MAIN } from './insights.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const onRequestGet = handle(async ({ request, env }) => {
  const user = cronUser(request, env) || (await requireUser(request, env))
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
  const phantom = Boolean(env.PHANTOMBUSTER_API_KEY)
  // LinkedIn API: configured = the client secret is set; connected = someone signed in (token stored, never returned)
  let liConnected = false
  if (dbOk) { try { const d = await getDoc(env, LI_DOC); liConnected = !!(d && d.content && d.content.access_token) } catch { /* table or row missing */ } }
  const checks = new URL(request.url).searchParams.get('check') === 'keys' ? await checkKeys(env, dbOk) : undefined
  return json({
    checks,
    ok: dbOk && hubspot && claude,
    db: dbOk,
    db_error: dbError,
    hubspot,
    claude,
    instantly,
    phantom,
    cron: Boolean(env.CA_CRON_SECRET),
    linkedin_api: { configured: liConfigured(env), connected: liConnected },
    api_keys: apiKeys(env).size,   // data API / MCP keys in CA_API_KEYS (count only)
    user,
  })
})

async function probe(url, headers) {
  try {
    const r = await fetch(url, { headers })
    if (r.ok) return { ok: true, status: r.status }
    const b = await r.text().catch(() => '')
    let msg = ''; try { const j = JSON.parse(b); msg = (j.error && (j.error.message || j.error)) || j.message || '' } catch { msg = b }
    return { ok: false, status: r.status, error: String(msg).slice(0, 160) }
  } catch (e) { return { ok: false, status: 0, error: String(e.message || e).slice(0, 160) } }
}

/** One live, free call per configured service. */
export async function checkKeys(env, dbOk) {
  const out = {}
  const none = { ok: false, status: null, error: 'not set' }
  out.claude = env.ANTHROPIC_API_KEY
    ? { model: MODEL_MAIN, ...(await probe(`https://api.anthropic.com/v1/models/${MODEL_MAIN}`, { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' })) }
    : none
  out.hubspot = env.HUBSPOT_ACCESS_TOKEN ? await probe('https://api.hubapi.com/account-info/v3/details', { Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}` }) : none
  out.instantly = env.INSTANTLY_API_KEY ? await probe('https://api.instantly.ai/api/v2/campaigns?limit=1', { Authorization: `Bearer ${env.INSTANTLY_API_KEY}` }) : none
  out.phantombuster = env.PHANTOMBUSTER_API_KEY ? await probe('https://api.phantombuster.com/api/v2/orgs/fetch', { 'X-Phantombuster-Key': env.PHANTOMBUSTER_API_KEY }) : none
  out.linkedin = none
  if (dbOk) {
    try {
      const d = await getDoc(env, LI_DOC)
      const tok = d && d.content && d.content.access_token
      out.linkedin = tok
        ? await probe('https://api.linkedin.com/rest/adAccountUsers?q=authenticatedUser', { Authorization: `Bearer ${tok}`, 'LinkedIn-Version': liVersion(env), 'X-Restli-Protocol-Version': '2.0.0' })
        : { ok: false, status: null, error: 'not connected' }
    } catch (e) { out.linkedin = { ok: false, status: null, error: String(e.message || e).slice(0, 160) } }
  }
  return out
}
