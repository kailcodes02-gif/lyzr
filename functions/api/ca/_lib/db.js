// Tiny Supabase PostgREST client for the ca_* tables. Server-side only: it
// uses the service-role key (CA_SUPABASE_KEY), which never reaches the browser.
//
//   const d = db(env)                      // throws a 503-shaped error if env is missing
//   await d.select('ca_uploads', { params: { channel: 'eq.linkedin' }, order: 'uploaded_at.desc', limit: 50 })
//   await d.selectAll('ca_li_perf', { params: { day: ['gte.2026-09-01', 'lte.2026-09-30'] } })  // pages 1000 at a time
//   await d.upsert('ca_li_perf', rows, 'day,campaign_id,ad_id')
//   await d.insert('ca_uploads', row, { returning: true })
//   await d.update('ca_uploads', { id: 'eq.<uuid>' }, { row_count: 12 })
//   await d.del('ca_uploads', { id: 'eq.<uuid>' })
//
// `params` values are PostgREST operators ('eq.x', 'gte.x', 'in.(a,b)'); an array
// value repeats the key (day=gte.a&day=lte.b).

import { HttpError } from './http.js'

export const PAGE = 1000

export function dbConfigured(env) {
  return Boolean(env && env.CA_SUPABASE_URL && env.CA_SUPABASE_KEY)
}

export function db(env) {
  if (!dbConfigured(env)) throw new HttpError(503, 'Database not configured (CA_SUPABASE_URL / CA_SUPABASE_KEY)')
  const base = String(env.CA_SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/'
  const key = env.CA_SUPABASE_KEY

  function url(table, params, opts = {}) {
    const u = new URL(base + table)
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, String(x))
      else u.searchParams.append(k, String(v))
    }
    if (opts.select) u.searchParams.set('select', opts.select)
    if (opts.order) u.searchParams.set('order', opts.order)
    if (opts.limit !== undefined) u.searchParams.set('limit', String(opts.limit))
    if (opts.offset !== undefined) u.searchParams.set('offset', String(opts.offset))
    return u.toString()
  }

  async function call(method, u, { body, prefer, range } = {}) {
    const headers = {
      apikey: key,
      Accept: 'application/json',
    }
    // Legacy service_role keys are JWTs and go in both headers. The newer
    // sb_secret_... keys are not JWTs: Supabase rejects them as a Bearer
    // token, so they travel in `apikey` only.
    if (!String(key).startsWith('sb_')) headers.Authorization = `Bearer ${key}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (prefer) headers.Prefer = prefer
    if (range) headers.Range = range
    const res = await fetch(u, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) {
      let detail = ''
      try {
        const t = await res.text()
        try { const j = JSON.parse(t); detail = j.message || j.hint || j.details || t } catch { detail = t }
      } catch { /* ignore */ }
      // 4xx from PostgREST is a bad request on our side, 5xx is upstream.
      const status = res.status >= 500 ? 502 : 500
      throw new HttpError(status, `Database ${method} ${res.status}: ${String(detail).slice(0, 200)}`)
    }
    if (res.status === 204) return null
    const text = await res.text()
    if (!text) return null
    try { return JSON.parse(text) } catch { return null }
  }

  return {
    async select(table, opts = {}) {
      const rows = await call('GET', url(table, opts.params, opts))
      return Array.isArray(rows) ? rows : []
    },
    // Pages through PostgREST's default 1000-row cap using Range headers.
    async selectAll(table, opts = {}) {
      const out = []
      let from = 0
      const page = opts.page || PAGE
      for (let guard = 0; guard < 500; guard++) {
        // A stable order keeps Range pages from overlapping. Callers pass a
        // key; without one we still page, PostgREST just uses table order.
        const rows = await call('GET', url(table, opts.params, { select: opts.select, order: opts.order }), { range: `${from}-${from + page - 1}` })
        const list = Array.isArray(rows) ? rows : []
        out.push(...list)
        if (list.length < page) break
        from += page
        if (opts.max && out.length >= opts.max) break
      }
      return out
    },
    async insert(table, rows, { returning = false } = {}) {
      const body = Array.isArray(rows) ? rows : [rows]
      const data = await call('POST', url(table), { body, prefer: returning ? 'return=representation' : 'return=minimal' })
      return returning ? (Array.isArray(data) ? data : []) : null
    },
    async upsert(table, rows, onConflict, { returning = false } = {}) {
      const body = Array.isArray(rows) ? rows : [rows]
      if (!body.length) return null
      const u = url(table, onConflict ? { on_conflict: onConflict } : {})
      const data = await call('POST', u, {
        body,
        prefer: `resolution=merge-duplicates,${returning ? 'return=representation' : 'return=minimal'}`,
      })
      return returning ? (Array.isArray(data) ? data : []) : null
    },
    async update(table, params, patch, { returning = false } = {}) {
      const data = await call('PATCH', url(table, params), { body: patch, prefer: returning ? 'return=representation' : 'return=minimal' })
      return returning ? (Array.isArray(data) ? data : []) : null
    },
    async del(table, params) {
      if (!params || !Object.keys(params).length) throw new HttpError(500, `Refusing to delete from ${table} without a filter`)
      await call('DELETE', url(table, params), { prefer: 'return=minimal' })
      return true
    },
  }
}

// Split a list of ids into PostgREST in.(...) filters that keep URLs short.
export function inChunks(ids, size = 150) {
  const out = []
  for (let i = 0; i < ids.length; i += size) {
    const part = ids.slice(i, i + size).map((v) => `"${String(v).replace(/"/g, '')}"`)
    out.push(`in.(${part.join(',')})`)
  }
  return out
}
