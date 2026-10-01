// Lyzr Marketing Tracker — public REST API, v1.
// Cloudflare Pages Function serving every /api/v1/* route.
//
// Auth: `Authorization: Bearer lzt_…` — an API key an admin creates in
// Workspace settings › Integrations. The key is resolved (by its SHA-256 hash)
// to the admin who created it, and every request then runs as that person:
// the Function signs a short-lived Supabase token for them, so row-level
// security, triggers and History behave exactly as in the dashboard.
// Read keys may only GET; write keys may also create, update and delete.
//
// Needs one Pages secret: SUPABASE_JWT_SECRET (Supabase › Project Settings ›
// API › JWT secret). The URL and anon key are public (they ship in the app).

import { OPENAPI } from './_openapi.js'

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5ZWZic2xiaWhqZGN6bHpqYXR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NDI4OTIsImV4cCI6MjA5NTUxODg5Mn0.ijvLMdc2724fkHd6EpDt45YOU5AuvnPdccQXzA7BGOg'
const APP_URL = 'https://lyzr.kailash-gm.com/GSI_Tracker'

const PRIORITY = { critical: 'P0', high: 'P1', medium: 'P2', low: 'P3', backlog: 'P4' }
const PRIORITY_NAME = { P0: 'critical', P1: 'high', P2: 'medium', P3: 'low', P4: 'backlog' }
const STATUSES = ['not_started', 'in_progress', 'live', 'blocked', 'done', 'cancelled']
const OPEN = new Set(['not_started', 'in_progress', 'live', 'blocked'])
const ROLES = ['primary', 'secondary', 'tertiary', 'other']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------------------------------------------------------------- plumbing
class ApiError extends Error {
  constructor(status, code, message, headers) { super(message); this.status = status; this.code = code; this.headers = headers }
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Access-Control-Max-Age': '86400',
}
const json = (status, body, headers) => new Response(body === null ? null : JSON.stringify(body, null, 2), {
  status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
})
const fail = (status, code, message, headers) => json(status, { error: { code, message } }, headers)

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlStr = s => b64url(new TextEncoder().encode(s))
async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
async function signJwt(payload, secret) {
  const head = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64urlStr(JSON.stringify(payload))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(sig)}`
}

// A PostgREST client bound to one user token.
function makeDb(token) {
  return async function db(path, { method = 'GET', body, prefer, count } = {}) {
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const pref = [prefer, count && 'count=exact'].filter(Boolean).join(',')
    if (pref) headers.Prefer = pref
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
      const msg = data?.message || `Database error (${res.status})`
      if (res.status === 401 || res.status === 403 || /row-level security|permission denied/i.test(msg)) throw new ApiError(403, 'forbidden', 'The key’s owner is not allowed to do that.')
      throw new ApiError(res.status >= 500 ? 502 : 400, 'db_error', msg)
    }
    const range = res.headers.get('Content-Range')
    const total = range && range.includes('/') ? Number(range.split('/')[1]) : undefined
    return count ? { rows: data || [], total } : data
  }
}

const rpc = (fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
})

// Resolves the key (expiry, revocation, owner still an admin), enforces the
// per-key rate limit and logs the request — all inside api_resolve_key (030).
async function authenticate(request, env, url) {
  const auth = request.headers.get('Authorization') || ''
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!key) throw new ApiError(401, 'unauthorized', 'Send your API key as `Authorization: Bearer lzt_…`. Admins create keys in Workspace settings › Integrations.')
  if (!key.startsWith('lzt_')) throw new ApiError(401, 'unauthorized', 'That is not a tracker API key (they start with lzt_).')
  if (!env.SUPABASE_JWT_SECRET) throw new ApiError(503, 'not_configured', 'The API is not switched on yet: the SUPABASE_JWT_SECRET secret is missing on the server.')
  const hash = await sha256Hex(key)
  const res = await rpc('api_resolve_key', { p_hash: hash, p_method: request.method.toUpperCase(), p_path: url.pathname + url.search })
  if (res.status === 404) throw new ApiError(503, 'not_configured', 'The API is not switched on yet: database update 030 is missing.')
  const rows = res.ok ? await res.json() : []
  const who = Array.isArray(rows) ? rows[0] : null
  if (!who) throw new ApiError(401, 'unauthorized', 'This API key is not valid, or it has expired or been revoked.')
  if (who.retry_after > 0) throw new ApiError(429, 'rate_limited', `Too many requests: a key can make 60 a minute. Try again in ${who.retry_after}s.`, { 'Retry-After': String(who.retry_after) })
  const now = Math.floor(Date.now() / 1000)
  const token = await signJwt({ aud: 'authenticated', role: 'authenticated', sub: who.user_id, email: who.email, iat: now, exp: now + 120 }, env.SUPABASE_JWT_SECRET)
  return { userId: who.user_id, email: who.email, scope: who.scope, canDelete: !!who.can_delete, expiresAt: who.expires_at || null, hash, logId: who.log_id, db: makeDb(token) }
}

async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new ApiError(415, 'bad_request', 'Send a JSON body with `Content-Type: application/json`.')
  try { return await request.json() } catch { throw new ApiError(400, 'bad_request', 'The body is not valid JSON.') }
}
const inList = ids => `in.(${ids.map(i => `"${i}"`).join(',')})`
const need = (cond, message) => { if (!cond) throw new ApiError(400, 'bad_request', message) }
// A real calendar date in YYYY-MM-DD (rejects 2026-13-01, 2026-02-30).
const isDate = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; const d = new Date(`${s}T00:00:00Z`); return !isNaN(d) && d.toISOString().slice(0, 10) === s }
const todayIso = () => new Date().toISOString().slice(0, 10)
const normPriority = p => {
  if (p == null) return undefined
  const v = String(p).trim()
  if (/^P[0-4]$/i.test(v)) return v.toUpperCase()
  if (PRIORITY[v.toLowerCase()]) return PRIORITY[v.toLowerCase()]
  throw new ApiError(400, 'bad_request', 'priority must be critical, high, medium, low, backlog (or P0–P4).')
}
const normStatus = s => {
  if (s == null) return undefined
  const v = String(s).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!STATUSES.includes(v)) throw new ApiError(400, 'bad_request', `status must be one of: ${STATUSES.join(', ')}.`)
  return v
}

// ---------------------------------------------------------------- lookups
async function loadCatalog(db) {
  const [verticals, channels, users] = await Promise.all([
    db('verticals?select=id,name,slug,description,sort_order,is_active&order=sort_order,name'),
    db('channels?select=id,name,slug,vertical_id,parent_channel_id,category_id,function_id,is_active,sort_order&order=sort_order,name'),
    db('users?select=id,email,alt_email,display_name,role'),
  ])
  return { verticals, channels, users }
}
function findVertical(cat, ref) {
  if (!ref) return null
  const v = cat.verticals.find(x => x.id === ref || x.slug === String(ref).toLowerCase() || x.name.toLowerCase() === String(ref).toLowerCase())
  if (!v) throw new ApiError(404, 'not_found', `No vertical "${ref}".`)
  return v
}
function findUser(cat, email) {
  const e = String(email).trim().toLowerCase()
  return cat.users.find(u => u.email.toLowerCase() === e || (u.alt_email || '').toLowerCase() === e) || null
}
const TASK_SELECT = [
  '*',
  'assignments:task_assignments(role,user:users!user_id(id,email,display_name))',
  'pending_assignments(email,role,resolved_user_id)',
].join(',')
function shapeTask(t, cat) {
  const ch = cat.channels.find(c => c.id === t.channel_id)
  const parent = ch?.parent_channel_id ? cat.channels.find(c => c.id === ch.parent_channel_id) : null
  const tagIds = t.vertical_ids?.length ? t.vertical_ids : (ch?.vertical_id ? [ch.vertical_id] : [])
  const tags = tagIds.map(id => cat.verticals.find(x => x.id === id)).filter(Boolean).map(x => ({ id: x.id, slug: x.slug, name: x.name }))
  const v = tags[0] || null
  const owners = [
    ...(t.assignments || []).map(a => ({ email: a.user?.email, name: a.user?.display_name || null, role: a.role, signed_in: true })),
    ...(t.pending_assignments || []).filter(p => !p.resolved_user_id).map(p => ({ email: p.email, name: null, role: p.role, signed_in: false })),
  ].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role))
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: PRIORITY_NAME[t.priority] || t.priority,
    priority_code: t.priority,
    due_date: t.due_date,
    overdue: !!(t.due_date && OPEN.has(t.status) && t.due_date < todayIso()),
    vertical: v,
    verticals: tags,
    channel: ch && ch.slug !== 'no-channel' ? { id: ch.id, name: ch.name, parent: parent ? { id: parent.id, name: parent.name } : null } : null,
    owners,
    parent_task_id: t.parent_task_id,
    campaign_id: t.campaign_id,
    budget: t.budget_allocated,
    plan: t.planning_fields || {},
    results: t.tracker_fields || {},
    blocked_reason: t.blocked_reason,
    created_at: t.created_at,
    updated_at: t.updated_at,
    went_live_at: t.went_live_at,
    completed_at: t.completed_at,
    url: ch ? `${APP_URL}/projects/?p=${ch.id}` : null,
  }
}
async function getTaskRow(db, id) {
  const rows = await db(`tasks?select=${TASK_SELECT}&id=eq.${encodeURIComponent(id)}`)
  if (!rows?.length) throw new ApiError(404, 'not_found', `No task ${id}.`)
  return rows[0]
}
async function fullTask(db, cat, id) {
  const t = await getTaskRow(db, id)
  const [subs, checklist, comments, deps, blocks, history] = await Promise.all([
    db(`tasks?select=${TASK_SELECT}&parent_task_id=eq.${id}&order=created_at`),
    db(`checklist_items?select=id,body,is_done,sort_order&task_id=eq.${id}&order=sort_order`),
    db(`task_comments?select=id,body,created_at,user:users(email,display_name)&task_id=eq.${id}&order=created_at`),
    db(`task_dependencies?select=depends_on_task_id,task:tasks!depends_on_task_id(id,title,status)&task_id=eq.${id}`),
    db(`task_dependencies?select=task_id,task:tasks!task_id(id,title,status)&depends_on_task_id=eq.${id}`),
    db(`activity_log?select=action,from_value,to_value,created_at,actor:users!actor_id(email,display_name)&task_id=eq.${id}&order=created_at.desc&limit=50`),
  ])
  return {
    ...shapeTask(t, cat),
    subtasks: subs.map(s => shapeTask(s, cat)),
    checklist: checklist.map(c => ({ id: c.id, text: c.body, done: c.is_done })),
    comments: comments.map(c => ({ id: c.id, text: c.body, author: c.user?.email || null, author_name: c.user?.display_name || null, created_at: c.created_at })),
    depends_on: deps.map(d => d.task).filter(Boolean),
    blocks: blocks.map(d => d.task).filter(Boolean),
    history: history.map(h => ({ action: h.action, by: h.actor?.email || null, at: h.created_at, from: h.from_value, to: h.to_value })),
  }
}
async function channelScope(cat, { channel }) {
  if (!channel) return null
  const ch = cat.channels.find(c => c.id === channel)
  if (!ch) throw new ApiError(404, 'not_found', `No channel ${channel}.`)
  return [ch.id, ...cat.channels.filter(c => c.parent_channel_id === ch.id).map(c => c.id)]
}
// Verticals are tags on tasks (032): ?vertical= filters on the tag.
function verticalFilter(cat, vertical) {
  if (!vertical) return ''
  const v = findVertical(cat, vertical)
  return `&vertical_ids=cs.{${v.id}}`
}
async function tasksForScope(db, cat, q) {
  const ids = await channelScope(cat, q)
  let path = `tasks?select=id,status,priority,due_date,channel_id,parent_task_id&limit=5000${verticalFilter(cat, q.vertical)}`
  if (ids) path += `&channel_id=${inList(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}`
  if (q.top_level !== 'false') path += '&parent_task_id=is.null'
  return db(path)
}

// ---------------------------------------------------------------- task writes
async function writeOwners(db, cat, taskId, owners, actorId) {
  for (const o of owners) {
    const email = String(o.email || '').trim().toLowerCase()
    const role = o.role || 'primary'
    need(EMAIL.test(email), `"${o.email}" is not an email address.`)
    need(ROLES.includes(role), `owner role must be one of: ${ROLES.join(', ')}.`)
    const u = findUser(cat, email)
    if (u) await db('task_assignments?on_conflict=task_id,user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { task_id: taskId, user_id: u.id, role, assigned_by: actorId } })
    else await db('pending_assignments', { method: 'POST', body: { task_id: taskId, email, role } })
  }
}
function ownersFromBody(body, fallbackEmail) {
  const raw = body.owners ?? body.owner_emails ?? (body.owner ? [body.owner] : null)
  if (raw == null) return [{ email: fallbackEmail, role: 'primary' }]
  need(Array.isArray(raw), 'owners must be a list of emails or { email, role } objects.')
  return raw.map((o, i) => typeof o === 'string' ? { email: o, role: i === 0 ? 'primary' : 'secondary' } : { email: o.email, role: o.role || (i === 0 ? 'primary' : 'secondary') })
}
async function createTask(ctx, cat, body, parentId) {
  const { db, userId, email } = ctx
  need(typeof body.title === 'string' && body.title.trim(), '`title` is required.')
  let parent = null
  const parentRef = parentId || body.parent_task_id
  if (parentRef) parent = await getTaskRow(db, parentRef)
  let channelId = body.channel_id || parent?.channel_id || null
  if (channelId && !cat.channels.some(c => c.id === channelId)) throw new ApiError(404, 'not_found', `No channel ${channelId}.`)
  if (!channelId) {
    const bucket = cat.channels.find(c => c.slug === 'no-channel' && !c.parent_channel_id)
    if (!bucket) throw new ApiError(409, 'not_configured', 'There is no “No channel” bucket yet (database update 027).')
    channelId = bucket.id
  }
  // Tags: `verticals` (list) or `vertical`; omitted = parent's tags or Lyzr.
  const tagRefs = body.verticals != null ? body.verticals : (body.vertical != null ? [body.vertical] : null)
  need(tagRefs === null || Array.isArray(tagRefs), '`verticals` must be a list of vertical slugs, names or ids.')
  const vertical_ids = tagRefs === null ? undefined : tagRefs.map(r => findVertical(cat, r).id)
  if (body.due_date != null) need(isDate(body.due_date), 'due_date must be YYYY-MM-DD.')
  let priority = normPriority(body.priority) || 'P2'
  if (parent?.priority === 'P0') priority = 'P0'
  const owners = ownersFromBody(body, email)
  const [row] = await db('tasks', {
    method: 'POST', prefer: 'return=representation',
    body: {
      channel_id: channelId, title: body.title.trim(), description: body.description || null, priority,
      due_date: body.due_date || null, parent_task_id: parent?.id || null, nesting_level: parent ? (parent.nesting_level || 0) + 1 : 0,
      budget_allocated: body.budget ?? null, planning_fields: body.plan || body.fields || {}, campaign_id: body.campaign_id || null,
      ...(vertical_ids !== undefined ? { vertical_ids } : {}),
      created_by: userId,
    },
  })
  await writeOwners(db, cat, row.id, owners, userId)
  await db('activity_log', { method: 'POST', body: { task_id: row.id, actor_id: userId, action: 'created', to_value: { title: row.title, via: 'api' } } })
  return fullTask(db, cat, row.id)
}
async function updateTask(ctx, cat, id, body, force) {
  const { db, userId } = ctx
  const old = await getTaskRow(db, id)
  const patch = {}
  if (body.title !== undefined) { need(String(body.title).trim(), 'title cannot be empty.'); patch.title = String(body.title).trim() }
  if (body.description !== undefined) patch.description = body.description
  if (body.status !== undefined) patch.status = normStatus(body.status)
  if (body.priority !== undefined) patch.priority = normPriority(body.priority)
  if (body.due_date !== undefined) { need(body.due_date === null || isDate(body.due_date), 'due_date must be YYYY-MM-DD or null.'); patch.due_date = body.due_date }
  if (body.channel_id !== undefined) { need(cat.channels.some(c => c.id === body.channel_id), `No channel ${body.channel_id}.`); patch.channel_id = body.channel_id }
  if (body.campaign_id !== undefined) patch.campaign_id = body.campaign_id
  if (body.budget !== undefined) patch.budget_allocated = body.budget
  if (body.blocked_reason !== undefined) patch.blocked_reason = body.blocked_reason
  if (body.plan !== undefined) patch.planning_fields = { ...(old.planning_fields || {}), ...body.plan }
  if (body.results !== undefined) patch.tracker_fields = { ...(old.tracker_fields || {}), ...body.results }
  if (body.verticals !== undefined) {
    need(Array.isArray(body.verticals) && body.verticals.length, '`verticals` must be a non-empty list of vertical slugs, names or ids.')
    patch.vertical_ids = body.verticals.map(r => findVertical(cat, r).id)
  }
  need(Object.keys(patch).length, 'Nothing to update. Send any of: title, description, status, priority, due_date, channel_id, campaign_id, budget, blocked_reason, plan, results, verticals.')
  if (patch.status === 'done' && old.status !== 'done' && !force) {
    const deps = await db(`task_dependencies?select=task:tasks!depends_on_task_id(title,status)&task_id=eq.${id}`)
    const open = deps.map(d => d.task).filter(t => t && t.status !== 'done' && t.status !== 'cancelled')
    if (open.length) throw new ApiError(409, 'blocked', `Can't mark done: it depends on ${open.length} unfinished task(s) — ${open.map(t => `“${t.title}”`).join(', ')}. Finish them first, or add ?force=true.`)
  }
  await db(`tasks?id=eq.${id}`, { method: 'PATCH', body: patch })
  if (patch.priority === 'P0') await db(`tasks?parent_task_id=eq.${id}`, { method: 'PATCH', body: { priority: 'P0' } })
  if (patch.status && patch.status !== old.status) {
    await db('activity_log', { method: 'POST', body: { task_id: id, actor_id: userId, action: 'status_changed', from_value: { status: old.status }, to_value: { status: patch.status, via: 'api' } } })
  }
  return fullTask(db, cat, id)
}

// ---------------------------------------------------------------- routes
async function route(ctx, method, parts, url, request) {
  const { db } = ctx
  const q = Object.fromEntries(url.searchParams)
  const [res, id, sub, subId] = parts
  const cat = await loadCatalog(db)

  if (res === 'me' && method === 'GET') {
    const me = cat.users.find(u => u.id === ctx.userId)
    return json(200, { data: { email: ctx.email, name: me?.display_name || null, role: me?.role, key_scope: ctx.scope, can_delete_tasks: ctx.canDelete, key_expires_at: ctx.expiresAt } })
  }

  if (res === 'verticals' && method === 'GET') {
    return json(200, { data: cat.verticals.filter(v => v.is_active).map(v => ({
      id: v.id, slug: v.slug, name: v.name, description: v.description, primary: v.slug === 'lyzr',
      channels: cat.channels.filter(c => c.vertical_id === v.id && c.is_active && c.slug !== 'no-channel').length,
    })) })
  }

  if (res === 'channels' && method === 'GET') {
    const v = q.vertical ? findVertical(cat, q.vertical) : null
    const owners = await db('channel_owners?select=channel_id,email,sort_order&order=sort_order')
    const list = cat.channels.filter(c => c.is_active && c.slug !== 'no-channel' && (!v || c.vertical_id === v.id))
    return json(200, { data: list.map(c => ({
      id: c.id, name: c.name, slug: c.slug, vertical: cat.verticals.find(x => x.id === c.vertical_id)?.slug || null,
      parent_id: c.parent_channel_id, domain_id: c.function_id,
      owners: owners.filter(o => o.channel_id === c.id).map(o => o.email),
    })) })
  }

  if (res === 'domains' && method === 'GET') {
    const [fns, fo] = await Promise.all([db('functions?select=id,name,slug,description&order=sort_order'), db('function_owners?select=function_id,email&order=sort_order')])
    return json(200, { data: fns.map(f => ({
      id: f.id, name: f.name, slug: f.slug, description: f.description,
      owners: fo.filter(o => o.function_id === f.id).map(o => o.email),
      channels: cat.channels.filter(c => c.function_id === f.id && c.is_active).map(c => ({ id: c.id, name: c.name, vertical: cat.verticals.find(v => v.id === c.vertical_id)?.slug })),
    })) })
  }

  if (res === 'people' && method === 'GET') {
    const [lead, vo, co, fo] = await Promise.all([
      db('leadership_emails?select=email'), db('vertical_owners?select=vertical_id,email'),
      db('channel_owners?select=channel_id,email'), db('function_owners?select=function_id,email'),
    ])
    const same = u => e => [u.email, u.alt_email].filter(Boolean).map(x => x.toLowerCase()).includes(String(e).toLowerCase())
    return json(200, { data: cat.users.filter(u => u.email !== 'preview@lyzr.ai').map(u => ({
      email: u.email, name: u.display_name, admin: u.role === 'admin', leadership: u.role === 'admin' || lead.some(l => same(u)(l.email)),
      owns_verticals: vo.filter(r => same(u)(r.email)).map(r => cat.verticals.find(v => v.id === r.vertical_id)?.slug).filter(Boolean),
      owns_channels: co.filter(r => same(u)(r.email)).map(r => r.channel_id),
      owns_domains: fo.filter(r => same(u)(r.email)).map(r => r.function_id),
    })) })
  }

  if (res === 'campaigns' && method === 'GET') {
    const [camps, owners, tasks] = await Promise.all([
      db('campaigns?select=*&order=starts_on.desc.nullslast'), db('campaign_owners?select=campaign_id,email'),
      db('tasks?select=campaign_id,status&campaign_id=not.is.null'),
    ])
    return json(200, { data: camps.map(c => {
      const ts = tasks.filter(t => t.campaign_id === c.id)
      return {
        id: c.id, name: c.name, kind: c.kind, status: c.status, headline: c.headline, ask: c.ask,
        starts_on: c.starts_on, ends_on: c.ends_on, pinned: c.is_pinned,
        audience: c.vertical_id ? cat.verticals.find(v => v.id === c.vertical_id)?.slug : 'company',
        leads: owners.filter(o => o.campaign_id === c.id).map(o => o.email),
        tasks: { total: ts.length, done: ts.filter(t => t.status === 'done').length },
      }
    }) })
  }

  if (res === 'summary' && method === 'GET') {
    const rows = (await tasksForScope(db, cat, q)).filter(t => t.status !== 'cancelled')
    const today = todayIso()
    const open = rows.filter(t => OPEN.has(t.status))
    return json(200, { data: {
      total: rows.length,
      done: rows.filter(t => t.status === 'done').length,
      not_done: open.length,
      live: rows.filter(t => t.status === 'live').length,
      blocked: rows.filter(t => t.status === 'blocked').length,
      overdue: open.filter(t => t.due_date && t.due_date < today).length,
      critical_open: open.filter(t => t.priority === 'P0' || t.priority === 'P1').length,
      percent_done: rows.length ? Math.round(rows.filter(t => t.status === 'done').length / rows.length * 100) : 0,
    } })
  }

  if (res === 'weekly' && method === 'GET') {
    const d = new Date(); const dow = (d.getUTCDay() + 6) % 7
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow))
    const from = q.from || monday.toISOString().slice(0, 10)
    const to = q.to || new Date(monday.getTime() + 6 * 864e5).toISOString().slice(0, 10)
    need(isDate(from) && isDate(to), 'from and to must be YYYY-MM-DD.')
    const scope = await channelScope(cat, q)
    let path = `tasks?select=${TASK_SELECT}&due_date=not.is.null&limit=5000`
    if (scope) path += `&channel_id=${inList(scope.length ? scope : ['00000000-0000-0000-0000-000000000000'])}`
    if (q.top_level !== 'false') path += '&parent_task_id=is.null'
    const rows = await db(path)
    const b = { done: [], not_done: [], cancelled: [], overdue_carried_in: [] }
    for (const t of rows) {
      if (t.due_date >= from && t.due_date <= to) (t.status === 'done' ? b.done : t.status === 'cancelled' ? b.cancelled : b.not_done).push(t)
      else if (t.due_date < from && OPEN.has(t.status)) b.overdue_carried_in.push(t)
    }
    const shape = arr => arr.map(t => shapeTask(t, cat))
    return json(200, { data: { from, to, planned: b.done.length + b.not_done.length, done: shape(b.done), not_done: shape(b.not_done), cancelled: shape(b.cancelled), overdue_carried_in: shape(b.overdue_carried_in) } })
  }

  if (res === 'history' && method === 'GET') {
    const limit = Math.min(Number(q.limit) || 50, 500)
    let path = `activity_log?select=action,task_id,from_value,to_value,created_at,actor:users!actor_id(email,display_name),task:tasks(id,title,channel_id)&order=created_at.desc&limit=${limit}`
    if (q.since) path += `&created_at=gte.${encodeURIComponent(q.since)}`
    if (q.task) path += `&task_id=eq.${encodeURIComponent(q.task)}`
    let rows = await db(path)
    const scope = await channelScope(cat, q)
    if (scope) { const set = new Set(scope); rows = rows.filter(r => { const c = r.task?.channel_id || r.from_value?.channel_id; return !c || set.has(c) }) }
    return json(200, { data: rows.map(r => ({
      action: r.action, at: r.created_at, by: r.actor?.email || null, by_name: r.actor?.display_name || null,
      task: r.task ? { id: r.task.id, title: r.task.title } : r.action === 'deleted' ? { id: r.from_value?.task_id || null, title: r.from_value?.title || null, deleted: true } : null,
      from: r.from_value, to: r.to_value,
    })) })
  }

  if (res === 'tasks') {
    // collection
    if (!id && method === 'GET') {
      const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500)
      const offset = Math.max(Number(q.offset) || 0, 0)
      let path = `tasks?select=${TASK_SELECT}&limit=${limit}&offset=${offset}${verticalFilter(cat, q.vertical)}`
      const scope = await channelScope(cat, q)
      if (scope) path += `&channel_id=${inList(scope.length ? scope : ['00000000-0000-0000-0000-000000000000'])}`
      if (q.status) path += `&status=${inList(q.status.split(',').map(normStatus))}`
      else if (q.include_cancelled !== 'true') path += '&status=neq.cancelled'
      if (q.priority) path += `&priority=${inList(q.priority.split(',').map(normPriority))}`
      if (q.parent) path += `&parent_task_id=eq.${encodeURIComponent(q.parent)}`
      else if (q.top_level !== 'false') path += '&parent_task_id=is.null'
      if (q.campaign) path += `&campaign_id=eq.${encodeURIComponent(q.campaign)}`
      if (q.due_from) { need(isDate(q.due_from), 'due_from must be YYYY-MM-DD.'); path += `&due_date=gte.${q.due_from}` }
      if (q.due_to) { need(isDate(q.due_to), 'due_to must be YYYY-MM-DD.'); path += `&due_date=lte.${q.due_to}` }
      if (q.overdue === 'true') path += `&due_date=lt.${todayIso()}&status=${inList([...OPEN])}`
      if (q.q) path += `&title=ilike.${encodeURIComponent(`*${q.q.replace(/[*,()]/g, ' ')}*`)}`
      if (q.owner) {
        const u = findUser(cat, q.owner)
        const [a, p] = await Promise.all([
          u ? db(`task_assignments?select=task_id&user_id=eq.${u.id}`) : [],
          db(`pending_assignments?select=task_id&email=eq.${encodeURIComponent(String(q.owner).toLowerCase())}`),
        ])
        const ids = [...new Set([...a, ...p].map(r => r.task_id))]
        path += `&id=${inList(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}`
      }
      const sort = { due_date: 'due_date.asc.nullslast', created_at: 'created_at.desc', updated_at: 'updated_at.desc', priority: 'priority.asc' }[q.sort || 'due_date']
      need(sort, 'sort must be due_date, created_at, updated_at or priority.')
      path += `&order=${sort}`
      const { rows, total } = await db(path, { count: true })
      return json(200, { data: rows.map(t => shapeTask(t, cat)), total, limit, offset })
    }
    if (!id && method === 'POST') return json(201, { data: await createTask(ctx, cat, await readBody(request)) })

    // one task
    if (id && !sub && method === 'GET') return json(200, { data: await fullTask(db, cat, id) })
    if (id && !sub && method === 'PATCH') return json(200, { data: await updateTask(ctx, cat, id, await readBody(request), q.force === 'true') })
    if (id && !sub && method === 'DELETE') {
      if (!ctx.canDelete) throw new ApiError(403, 'delete_not_allowed', 'This key cannot delete tasks. An admin can create a key with “Can delete tasks” switched on.')
      await getTaskRow(db, id)
      await db(`tasks?id=eq.${id}`, { method: 'DELETE' })
      return json(204, null)
    }

    // task children
    if (sub === 'subtasks' && method === 'POST') return json(201, { data: await createTask(ctx, cat, await readBody(request), id) })
    if (sub === 'comments' && method === 'POST') {
      const body = await readBody(request)
      need(typeof body.text === 'string' && body.text.trim(), '`text` is required.')
      await getTaskRow(db, id)
      const [c] = await db('task_comments', { method: 'POST', prefer: 'return=representation', body: { task_id: id, user_id: ctx.userId, body: body.text.trim() } })
      await db('activity_log', { method: 'POST', body: { task_id: id, actor_id: ctx.userId, action: 'commented', to_value: { body: body.text.trim().slice(0, 100), via: 'api' } } })
      return json(201, { data: { id: c.id, text: c.body, author: ctx.email, created_at: c.created_at } })
    }
    if (sub === 'checklist' && !subId && method === 'POST') {
      const body = await readBody(request)
      need(typeof body.text === 'string' && body.text.trim(), '`text` is required.')
      const existing = await db(`checklist_items?select=sort_order&task_id=eq.${id}&order=sort_order.desc&limit=1`)
      const [c] = await db('checklist_items', { method: 'POST', prefer: 'return=representation', body: { task_id: id, body: body.text.trim(), is_done: !!body.done, sort_order: (existing[0]?.sort_order ?? -1) + 1 } })
      return json(201, { data: { id: c.id, text: c.body, done: c.is_done } })
    }
    if (sub === 'checklist' && subId && method === 'PATCH') {
      const body = await readBody(request)
      const patch = {}
      if (body.done !== undefined) patch.is_done = !!body.done
      if (body.text !== undefined) patch.body = String(body.text)
      need(Object.keys(patch).length, 'Send `done` and/or `text`.')
      const rows = await db(`checklist_items?id=eq.${subId}&task_id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: patch })
      if (!rows?.length) throw new ApiError(404, 'not_found', `No checklist item ${subId} on task ${id}.`)
      return json(200, { data: { id: rows[0].id, text: rows[0].body, done: rows[0].is_done } })
    }
    if (sub === 'checklist' && subId && method === 'DELETE') {
      await db(`checklist_items?id=eq.${subId}&task_id=eq.${id}`, { method: 'DELETE' })
      return json(204, null)
    }
    if (sub === 'owners' && !subId && method === 'POST') {
      const body = await readBody(request)
      await getTaskRow(db, id)
      await writeOwners(db, cat, id, [{ email: body.email, role: body.role || 'secondary' }], ctx.userId)
      return json(201, { data: (await fullTask(db, cat, id)).owners })
    }
    if (sub === 'owners' && subId && method === 'DELETE') {
      const email = decodeURIComponent(subId).toLowerCase()
      const u = findUser(cat, email)
      if (u) await db(`task_assignments?task_id=eq.${id}&user_id=eq.${u.id}`, { method: 'DELETE' })
      await db(`pending_assignments?task_id=eq.${id}&email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' })
      return json(204, null)
    }
    if (sub === 'dependencies' && !subId && method === 'POST') {
      const body = await readBody(request)
      need(body.depends_on_task_id, '`depends_on_task_id` is required.')
      need(body.depends_on_task_id !== id, 'A task cannot depend on itself.')
      await Promise.all([getTaskRow(db, id), getTaskRow(db, body.depends_on_task_id)])
      await db('task_dependencies', { method: 'POST', body: { task_id: id, depends_on_task_id: body.depends_on_task_id } })
      return json(201, { data: (await fullTask(db, cat, id)).depends_on })
    }
    if (sub === 'dependencies' && subId && method === 'DELETE') {
      await db(`task_dependencies?task_id=eq.${id}&depends_on_task_id=eq.${subId}`, { method: 'DELETE' })
      return json(204, null)
    }
  }

  throw new ApiError(404, 'not_found', `No route ${method} /api/v1/${parts.join('/')}. See /api/v1/openapi.json.`)
}

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const parts = url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean)
  let ctx = null
  let response
  try {
    // Public: the index and the OpenAPI description.
    if (!parts.length && method === 'GET') {
      return json(200, { name: 'Lyzr Marketing Tracker API', version: 'v1', docs: `${url.origin}/api/v1/openapi.json`, auth: 'Authorization: Bearer lzt_…' })
    }
    if (parts[0] === 'openapi.json' && method === 'GET') return json(200, { ...OPENAPI, servers: [{ url: `${url.origin}/api/v1` }] })

    ctx = await authenticate(request, env, url)
    if (ctx.scope !== 'write' && method !== 'GET') throw new ApiError(403, 'read_only_key', 'This key is read-only. Ask an admin for a write key to create, change or delete.')
    response = await route(ctx, method, parts, url, request)
  } catch (e) {
    if (e instanceof ApiError) response = fail(e.status, e.code, e.message, e.headers)
    else {
      console.error('api v1 error', e)
      response = fail(500, 'internal', 'Something went wrong on our side.')
    }
  }
  // Record the outcome in the key's activity log without delaying the reply.
  if (ctx?.logId) {
    const done = rpc('api_log_status', { p_hash: ctx.hash, p_log_id: ctx.logId, p_status: response.status }).catch(() => {})
    if (waitUntil) waitUntil(done); else await done
  }
  return response
}
