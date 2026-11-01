// POST /api/ocdemo/start { name, email, company, title, referrer, utm }
// Outside visitors: checks the work email (format, not a personal or throwaway provider, a domain
// that receives mail). With a mail provider configured it sends a 6-digit code and answers
//   { step: 'code', challenge, email }            -> then POST /api/ocdemo/verify
// otherwise it records the visitor straight away and answers
//   { step: 'done', lead: { id, email, name, audience }, stored }
import { json, handle, readJson, HttpError } from '../ca/_lib/http.js'
import { workEmailProblem, domainOf, domainReceivesMail, normEmail, clean, mailConfigured, newCode, makeChallenge, sendCode, captureLead } from './_lib.js'

export { corsPreflight as onRequestOptions } from '../ca/_lib/http.js'

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await readJson(request)
  const email = normEmail(b.email)
  if (!clean(b.name)) throw new HttpError(400, 'Enter your name.')
  if (!clean(b.company)) throw new HttpError(400, 'Enter your company.')
  const problem = workEmailProblem(email)
  if (problem) throw new HttpError(400, problem)
  if ((await domainReceivesMail(domainOf(email))) === false) throw new HttpError(400, `${domainOf(email)} does not receive email. Check the address.`)

  if (mailConfigured(env)) {
    const code = newCode()
    await sendCode(env, email, code, b.name)
    return json({ step: 'code', challenge: await makeChallenge(env, email, code), email })
  }
  const r = await captureLead(env, { ...b, email, audience: 'external', auth_method: 'email_domain' }, request)
  return json({ step: 'done', lead: { id: r.id, email, name: clean(b.name, 120), audience: 'external' }, stored: r.stored })
})
