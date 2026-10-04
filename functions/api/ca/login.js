// POST /api/ca/login { email, password } -> { token, email, name, expires_at, isEditor }
// Email + password sign-in for the few named accounts in the CA_LOCAL_USERS secret (see _lib/auth.js).
// The token goes in the Authorization header like a Microsoft token. Wrong details answer 401 after
// a short delay; nothing says whether the email or the password was wrong.
import { json, handle, readJson } from './_lib/http.js'
import { localLogin, verifyLocalToken, resolveEditors } from './_lib/auth.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await readJson(request)
  const r = await localLogin(env, b.email, b.password)
  if (!r) { await new Promise((res) => setTimeout(res, 600)); return json({ error: 'Email or password is wrong' }, 401) }
  const u = await verifyLocalToken(env, r.token)
  const editors = await resolveEditors(env)
  return json({ ...r, name: u.name, isEditor: editors.includes(r.email) })
})
