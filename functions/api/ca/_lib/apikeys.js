// API keys for the data API (/api/ca/v1/*) and the MCP server (/api/ca/mcp).
// Keys live in the Pages secret CA_API_KEYS as "label:key, label:key" (never in git). A caller sends one as
//   Authorization: Bearer <key>     or   x-api-key: <key>     or   ?key=<key>     or   /api/ca/mcp/<key>
// Keys are read-only by nature: those routes only read. A signed-in dashboard user (Microsoft or email
// session) is accepted too, so the browser can call the same endpoints.
import { requireUser } from './auth.js'

export function apiKeys(env) {
  const out = new Map()
  for (const pair of String((env && env.CA_API_KEYS) || '').split(/[,;\n]+/)) {
    const i = pair.indexOf(':')
    if (i > 0) { const label = pair.slice(0, i).trim(), key = pair.slice(i + 1).trim(); if (label && key.length >= 16) out.set(key, label) }
  }
  return out
}

function same(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }

export function keyFrom(request, pathKey) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const header = request.headers.get('x-api-key') || ''
  let q = ''
  try { q = new URL(request.url).searchParams.get('key') || '' } catch { q = '' }
  return [pathKey, header, q, bearer].map((s) => String(s || '').trim()).filter(Boolean)
}

/** -> { kind:'key', label } | { kind:'user', email, isEditor } | null */
export async function requireReader(request, env, { pathKey } = {}) {
  const keys = apiKeys(env)
  for (const candidate of keyFrom(request, pathKey)) for (const [k, label] of keys) if (same(k, candidate)) return { kind: 'key', label }
  const user = await requireUser(request, env).catch(() => null)
  if (user) return { kind: 'user', email: user.email, isEditor: !!user.isEditor }
  return null
}
