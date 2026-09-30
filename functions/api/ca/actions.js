// /api/ca/actions: the tracked suggestion list (what was suggested, what is done).
//   GET    ?channel=email            -> { actions:[...] }  (all channels when omitted)
//   POST   { channel, title, detail?, owner?, source?, scope?, due? }   -> { action }
//   PUT    { id, status?, note?, owner?, due?, title?, detail? }        -> { action }
//   DELETE ?id=<uuid>                                                   -> { ok }
// Anyone signed in can add and tick off actions (the SDRs and AEs doing the
// work are not all editors); only editors can delete.

import { json, handle, readJson } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db } from './_lib/db.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const CHANNELS = ['overview', 'linkedin', 'email', 'leads', 'messaging']
export const STATUSES = ['open', 'done', 'dropped']
const str = (v, max = 2000) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max))
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''))
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null)

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const channel = new URL(request.url).searchParams.get('channel')
  const params = {}
  if (channel) {
    if (!CHANNELS.includes(channel)) return json({ error: `channel must be one of ${CHANNELS.join(', ')}` }, 400)
    params.channel = `eq.${channel}`
  }
  const actions = await db(env).select('ca_actions', { params, order: 'created_at.desc', limit: 500 })
  return json({ actions })
})

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const b = await readJson(request)
  const channel = str(b.channel || 'overview', 40)
  if (!CHANNELS.includes(channel)) return json({ error: `channel must be one of ${CHANNELS.join(', ')}` }, 400)
  const title = str(b.title, 300)
  if (!title) return json({ error: 'title is required' }, 400)
  const now = new Date().toISOString()
  const rows = await db(env).insert('ca_actions', {
    channel,
    title,
    detail: str(b.detail) || null,
    owner: str(b.owner, 200) || null,
    source: b.source === 'ai' ? 'ai' : 'manual',
    scope: str(b.scope, 200) || null,
    due: day(b.due),
    status: 'open',
    created_by: user.email,
    created_at: now,
    updated_by: user.email,
    updated_at: now,
  }, { returning: true })
  return json({ action: rows[0] || null }, 201)
})

export const onRequestPut = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const b = await readJson(request)
  if (!isUuid(b.id)) return json({ error: 'id is required' }, 400)
  const patch = { updated_by: user.email, updated_at: new Date().toISOString() }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return json({ error: `status must be one of ${STATUSES.join(', ')}` }, 400)
    patch.status = b.status
    patch.done_at = b.status === 'done' ? patch.updated_at : null
  }
  if (b.note !== undefined) patch.note = str(b.note) || null
  if (b.owner !== undefined) patch.owner = str(b.owner, 200) || null
  if (b.title !== undefined) { const t = str(b.title, 300); if (!t) return json({ error: 'title cannot be empty' }, 400); patch.title = t }
  if (b.detail !== undefined) patch.detail = str(b.detail) || null
  if (b.due !== undefined) patch.due = day(b.due)
  const rows = await db(env).update('ca_actions', { id: `eq.${b.id}` }, patch, { returning: true })
  if (!rows.length) return json({ error: 'Action not found' }, 404)
  return json({ action: rows[0] })
})

export const onRequestDelete = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can delete actions' }, 403)
  const id = new URL(request.url).searchParams.get('id')
  if (!isUuid(id)) return json({ error: 'Missing or invalid ?id=' }, 400)
  await db(env).del('ca_actions', { id: `eq.${id}` })
  return json({ ok: true, id })
})
