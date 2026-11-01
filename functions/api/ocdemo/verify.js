// POST /api/ocdemo/verify { challenge, code, name, email, company, title, referrer, utm }
// Second step of the outside-visitor sign-in when codes are sent (see start.js).
// -> { step: 'done', lead: { id, email, name, audience }, stored }
import { json, handle, readJson, HttpError } from '../ca/_lib/http.js'
import { mailConfigured, checkChallenge, captureLead, clean } from './_lib.js'

export { corsPreflight as onRequestOptions } from '../ca/_lib/http.js'

export const onRequestPost = handle(async ({ request, env }) => {
  if (!mailConfigured(env)) throw new HttpError(400, 'Codes are not in use. Start again.')
  const b = await readJson(request)
  if (!/^\d{6}$/.test(String(b.code || '').trim())) throw new HttpError(400, 'Enter the 6-digit code from the email.')
  const email = await checkChallenge(env, b.challenge, b.code)
  const r = await captureLead(env, { ...b, email, audience: 'external', auth_method: 'email_code' }, request)
  return json({ step: 'done', lead: { id: r.id, email, name: clean(b.name, 120), audience: 'external' }, stored: r.stored })
})
