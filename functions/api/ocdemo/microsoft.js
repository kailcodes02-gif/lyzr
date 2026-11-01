// POST /api/ocdemo/microsoft { referrer, utm }   Authorization: Bearer <Microsoft Graph token>
// Lyzr people: the token from the Microsoft sign-in is checked against Graph /me, and only
// @lyzr.com / @lyzr.ai accounts are let in. -> { step: 'done', lead, stored }
import { json, handle, readJson, HttpError } from '../ca/_lib/http.js'
import { LYZR_DOMAINS, domainOf, captureLead } from './_lib.js'

export { corsPreflight as onRequestOptions } from '../ca/_lib/http.js'

export const onRequestPost = handle(async ({ request, env }) => {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Sign in with Microsoft first.')
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle', {
    headers: { Authorization: auth },
  })
  if (!res.ok) throw new HttpError(401, 'Microsoft did not accept the sign-in. Try again.')
  const p = await res.json()
  const email = String(p.mail || p.userPrincipalName || '').toLowerCase()
  if (!LYZR_DOMAINS.includes(domainOf(email))) throw new HttpError(403, 'This sign-in is for Lyzr accounts. Use "I am outside Lyzr" instead.')
  const b = await readJson(request).catch(() => ({}))
  const r = await captureLead(env, { ...b, email, name: p.displayName, title: p.jobTitle, company: 'Lyzr', audience: 'lyzr', auth_method: 'microsoft' }, request)
  return json({ step: 'done', lead: { id: r.id, email, name: p.displayName || email, audience: 'lyzr' }, stored: r.stored })
})
