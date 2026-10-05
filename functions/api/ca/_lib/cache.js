// Shared server-side cache for the heavy GET endpoints (/api/ca/linkedin, hubspot, email, ...).
// One row per path + params in ca_cache (Campaign_Analytics/supabase/010_cache.sql); the body is the
// serialized JSON the handler would have sent. Every signed-in user gets the same body, which is the
// point: once generated, the data stays for TTL (8 hours) for everyone, across logins and date
// ranges, until a write changes the data or someone presses "Refresh data".
//
//   const r = await cachedGet(env, request, { path: 'linkedin', params: { from, to, platform }, waitUntil }, async () => body)
//   return cacheResponse(r)          // -> Response with x-ca-cache / x-ca-cached-at headers
//
// Invalidation: a sentinel row `_version` holds the time of the last data write; an entry stored
// before it is ignored. Writers call bumpCacheVersion(env) on their success path.
// Bypass: a request with `x-ca-refresh: 1` recomputes and overwrites the entry (the top-bar Refresh
// data button sends it for 90 seconds).
// Nothing here ever fails a request: a missing table (migration not run yet), a slow store or an
// oversized body all fall back to a plain compute, with a warning the handler can surface.

import { db } from './db.js'

export const CACHE_TABLE = 'ca_cache'
export const VERSION_KEY = '_version'
// Bump when a wrapped response changes shape, so old entries are never served to new client code.
export const CACHE_SCHEMA = 'v1'
export const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000
export const DEFAULT_MAX_BYTES = 4_000_000
export const REFRESH_HEADER = 'x-ca-refresh'
export const MIGRATION_WARNING = 'cache: run Campaign_Analytics/supabase/010_cache.sql'

/** Stable key: schema + path + params sorted by name; empty values are left out. */
export function cacheKey(path, params = {}) {
  const p = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '')
  const parts = Object.keys(params || {})
    .filter((k) => params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
  return `${CACHE_SCHEMA}:${p}${parts.length ? '?' + parts.join('&') : ''}`.replace(/["\s]/g, '')
}

export function wantsRefresh(request) {
  try { return ['1', 'true', 'yes'].includes(String(request.headers.get(REFRESH_HEADER) || '').toLowerCase()) } catch { return false }
}

const inList = (keys) => `in.(${keys.map((k) => `"${String(k).replace(/"/g, '')}"`).join(',')})`
const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN }

/**
 * -> { body, text, hit: 'hit'|'miss'|'bypass', at, warning }
 * body is the object (parsed on a hit), text its serialized form, at the ISO time it was computed.
 * When the store cannot be read, `warning` is set and, if body.warnings is an array, pushed into it.
 * opts.db overrides the client (tests); opts.waitUntil defers the store so the response is not held up.
 */
export async function cachedGet(env, request, opts, compute) {
  const { path, params = {}, ttlMs = DEFAULT_TTL_MS, maxBytes = DEFAULT_MAX_BYTES, waitUntil } = opts || {}
  const key = cacheKey(path, params)
  let d = null
  try { d = opts.db || db(env) } catch { d = null }
  const bypass = wantsRefresh(request)
  let readFailed = !d
  let warning = d ? null : MIGRATION_WARNING

  if (d && !bypass) {
    try {
      const rows = await d.select(CACHE_TABLE, { params: { key: inList([VERSION_KEY, key]) }, select: 'key,body,at', limit: 2 })
      const version = rows.find((r) => r.key === VERSION_KEY)
      const row = rows.find((r) => r.key === key)
      if (row && typeof row.body === 'string') {
        const at = ms(row.at)
        const writtenAt = version ? (ms(version.at) || ms(version.body) || 0) : 0
        if (Number.isFinite(at) && Date.now() - at < ttlMs && at >= writtenAt) {
          let body = null
          try { body = JSON.parse(row.body) } catch { body = null }
          if (body !== null) return { body, text: row.body, hit: 'hit', at: new Date(at).toISOString(), warning: null }
        }
      }
    } catch (e) {
      readFailed = true
      warning = MIGRATION_WARNING
      console.warn(`[ca] cache read failed for ${key}: ${String(e && e.message || e).slice(0, 160)}`)
    }
  }

  const body = await compute()
  if (warning && body && Array.isArray(body.warnings) && !body.warnings.includes(warning)) body.warnings.push(warning)
  const at = new Date().toISOString()
  const text = JSON.stringify(body)
  if (d && !readFailed && text.length <= maxBytes) {
    const store = d.upsert(CACHE_TABLE, [{ key, body: text, bytes: text.length, at }], 'key')
      .catch((e) => console.warn(`[ca] cache store failed for ${key}: ${String(e && e.message || e).slice(0, 160)}`))
    let deferred = false
    if (typeof waitUntil === 'function') { try { waitUntil(store); deferred = true } catch { deferred = false } }
    if (!deferred) await store
  }
  return { body, text, hit: bypass ? 'bypass' : 'miss', at, warning }
}

/** Response for a cachedGet result: the serialized text as-is, plus the cache headers. */
export function cacheResponse(r, status = 200, extraHeaders = {}) {
  return new Response(r.text, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'x-ca-cache, x-ca-cached-at',
      'Cache-Control': 'no-store',
      'x-ca-cache': r.hit,
      'x-ca-cached-at': r.at,
      ...extraHeaders,
    },
  })
}

/** Mark the data as changed: every cache entry stored before now is ignored. Never throws. Takes env or a db client. */
export async function bumpCacheVersion(envOrDb) {
  try {
    const d = envOrDb && typeof envOrDb.upsert === 'function' ? envOrDb : db(envOrDb)
    const now = new Date().toISOString()
    await d.upsert(CACHE_TABLE, [{ key: VERSION_KEY, body: now, bytes: now.length, at: now }], 'key')
    return true
  } catch (e) {
    console.warn(`[ca] cache version bump failed: ${String(e && e.message || e).slice(0, 160)}`)
    return false
  }
}
