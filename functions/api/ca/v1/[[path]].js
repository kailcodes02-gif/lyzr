// Campaign Analytics data API, v1: GET /api/ca/v1/<source>?<params>
//   /api/ca/v1                 index: sources, their parameters, the readable tables, how to call
//   /api/ca/v1/openapi.json    OpenAPI 3.1 description
//   /api/ca/v1/<source>        one of the sources in _lib/query.js (linkedin/performance, hubspot/leads, table...)
// Auth: API key (Pages secret CA_API_KEYS, "label:key, label:key") as Authorization: Bearer, x-api-key or
// ?key=, or a signed-in dashboard session. Read-only. format=csv returns the rows as a CSV file.
import { SOURCES, TABLES, runSource, toCsv, QueryError } from '../_lib/query.js'
import { requireReader } from '../_lib/apikeys.js'
import { openapi } from './_openapi.js'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-api-key', 'Access-Control-Max-Age': '86400' }
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body, null, 2), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })
const fail = (status, code, message) => json({ error: { code, message } }, status)

export const onRequestOptions = async () => new Response(null, { status: 204, headers: CORS })

export function indexBody(origin) {
  return {
    name: 'Lyzr Campaign Analytics data API', version: 'v1',
    docs: `${origin}/api/ca/v1/openapi.json`, mcp: `${origin}/api/ca/mcp`,
    auth: 'Authorization: Bearer <key>  |  x-api-key: <key>  |  ?key=<key>   (read-only keys from the owner)',
    how: 'GET /api/ca/v1/<source>?from=YYYY-MM-DD&to=YYYY-MM-DD&... ; add format=csv for a CSV of the rows. Start with linkedin/windows to see which dates have data.',
    sources: SOURCES.map((s) => ({ name: s.name, title: s.title, description: s.description, params: s.params, example: `${origin}/api/ca/v1/${s.name}${s.name === 'settings' ? '?name=accounts' : s.name === 'table' ? '?name=ca_li_perf&day=gte.2026-09-01&limit=100' : s.params.from ? '?from=2026-09-01&to=2026-09-30' : ''}` })),
    tables: TABLES,
  }
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api\/ca\/v1\/?/, '').replace(/\/+$/, '')
  if (path === 'openapi.json') return json(openapi(url.origin))
  if (!path || path === 'sources' || path === 'index') return json(indexBody(url.origin))
  const who = await requireReader(request, env)
  if (!who) return fail(401, 'unauthorized', 'Send an API key as Authorization: Bearer <key>, x-api-key or ?key=. Keys are set by the owner in the Pages secret CA_API_KEYS. GET /api/ca/v1 needs no key.')
  const q = Object.fromEntries(url.searchParams.entries())
  delete q.key
  const format = (q.format || 'json').toLowerCase(); delete q.format
  try {
    const out = await runSource(env, request, path, q)
    if (format === 'csv') {
      const rows = Array.isArray(out.rows) ? out.rows : Array.isArray(out.value) ? out.value : [out]
      return new Response(toCsv(rows), { headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.replace(/\W+/g, '_')}.csv"`, 'Cache-Control': 'no-store' } })
    }
    return json(out, 200, { 'x-ca-reader': who.kind === 'key' ? `key:${who.label}` : 'session' })
  } catch (e) {
    if (e instanceof QueryError) return fail(e.status, e.code, e.message)
    const status = Number(e && e.status) || 500
    return fail(status === 502 ? 500 : status, status >= 500 ? 'server_error' : 'error', String((e && e.message) || e).slice(0, 400))
  }
}
