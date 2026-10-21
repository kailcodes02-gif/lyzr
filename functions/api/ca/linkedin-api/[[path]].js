// /api/ca/linkedin-api/*  LinkedIn Marketing API connection (read-only against LinkedIn).
//   GET  status      signed in  -> { configured, connected, connected_by, connected_at, expires_at, refresh_expires_at,
//                                    has_refresh_token, scope, leads_enabled, ad_accounts, selected_accounts, last_sync,
//                                    redirect_uri, client_id }   never a token
//   POST connect     editors    { leads?:boolean } -> { url, scope, redirect_uri }   the LinkedIn sign-in page
//   GET  callback    no bearer  LinkedIn sends the browser here: verify state, exchange the code, list ad
//                               accounts, save `_li_oauth`, 302 to /Campaign_Analytics/#/admin?linkedin=connected|error
//   POST accounts    editors    { selected_accounts:[ids] } or { refresh:true } -> status
//   POST disconnect  editors    deletes the stored token (pulled data stays) -> { ok }
//   POST sync        editors or X-CA-Cron  { cursor?, from?, to? } -> { done, cursor?, progress, perf_rows, demo_windows,
//                               leads, warnings }; { done:true, skipped:'not connected' } (200) when nobody connected
// Logic in ../_lib/linkedin-api.js. Secrets: LINKEDIN_CLIENT_SECRET (and LINKEDIN_CLIENT_ID, default 774euwn4y0mlz5).

import { json, handle, readJson } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { getDoc, putDoc, delDoc } from '../_lib/docs.js'
import { DOC, META_DOC, STAGE_DOC, publicStatus, authorizeUrl, completeCallback, runSync, listAdAccounts, ensureFresh, apiVersion } from '../_lib/linkedin-api.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

const action = (request) => new URL(request.url).pathname.replace(/^\/api\/ca\/linkedin-api\/?/, '').replace(/\/+$/, '')
const back = (origin, q) => new Response(null, { status: 302, headers: { Location: `${origin}/Campaign_Analytics/#/admin?${q}`, 'Cache-Control': 'no-store' } })

export const onRequestGet = handle(async ({ request, env }) => {
  const url = new URL(request.url)
  const what = action(request)
  if (what === 'callback') {
    const p = Object.fromEntries(url.searchParams.entries())
    try {
      await completeCallback(env, url.origin, p)
      return back(url.origin, 'linkedin=connected')
    } catch (e) {
      return back(url.origin, 'linkedin=error&msg=' + encodeURIComponent(String((e && e.message) || e).slice(0, 300)))
    }
  }
  if (what === 'status' || what === '') {
    const user = await requireUser(request, env)
    if (!user) return json({ error: 'Sign in required' }, 401)
    const doc = await getDoc(env, DOC).catch(() => null)
    return json(publicStatus(env, doc, url.origin))
  }
  return json({ error: `Unknown path linkedin-api/${what}` }, 404)
})

export const onRequestPost = handle(async ({ request, env }) => {
  const url = new URL(request.url)
  const what = action(request)
  if (what === 'sync') {
    const user = cronUser(request, env) || (await requireUser(request, env))
    if (!user) return json({ error: 'Sign in required' }, 401)
    if (!user.isEditor) return json({ error: 'Only editors can pull from LinkedIn' }, 403)
    const body = await readJson(request)
    return json(await runSync(env, user, body))
  }
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can change the LinkedIn connection' }, 403)
  const body = await readJson(request)
  if (what === 'connect') return json(await authorizeUrl(env, url.origin, { email: user.email, leads: !!body.leads }))
  if (what === 'disconnect') {
    for (const id of [DOC, META_DOC, STAGE_DOC]) await delDoc(env, id).catch(() => {})
    return json({ ok: true })
  }
  if (what === 'accounts') {
    const doc = await getDoc(env, DOC)
    let o = doc && doc.content
    if (!o || !o.access_token) return json({ error: 'LinkedIn is not connected' }, 409)
    if (body.refresh) {
      o = await ensureFresh(env, o)
      o = { ...o, ad_accounts: await listAdAccounts(o.access_token, apiVersion(env)) }
    }
    if (Array.isArray(body.selected_accounts)) {
      const known = new Set((o.ad_accounts || []).map((a) => String(a.id)))
      const sel = [...new Set(body.selected_accounts.map(String))].filter((id) => known.has(id))
      o = { ...o, selected_accounts: sel }
    } else o = { ...o, selected_accounts: (o.selected_accounts || []).filter((id) => (o.ad_accounts || []).some((a) => String(a.id) === String(id))) }
    await putDoc(env, DOC, o, { by: o.connected_by || user.email })
    return json(publicStatus(env, { content: o }, url.origin))
  }
  return json({ error: `Unknown path linkedin-api/${what}` }, 404)
})
