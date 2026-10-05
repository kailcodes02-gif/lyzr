// Campaign Analytics MCP server (Model Context Protocol, streamable HTTP, stateless).
//   POST /api/ca/mcp            JSON-RPC 2.0: initialize, ping, tools/list, tools/call  (notifications -> 202)
//   POST /api/ca/mcp/<key>      same, with the API key in the path (for clients that cannot send headers)
//   GET  /api/ca/mcp            a short JSON description (the server keeps no session stream, so GET is not SSE)
// Every tool is one source from _lib/query.js, so Claude (claude.ai custom connector, Claude Code
// `claude mcp add --transport http`, the Agent SDK) pulls the same numbers the dashboard shows.
// Auth: API key (Pages secret CA_API_KEYS) as Authorization: Bearer, x-api-key, ?key= or the path.
import { SOURCES, TABLES, runSource, QueryError } from '../_lib/query.js'
import { requireReader } from '../_lib/apikeys.js'

export const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
export const SERVER = { name: 'lyzr-campaign-analytics', version: '1.0.0', title: 'Lyzr Campaign Analytics' }
export const MAX_TEXT = 400_000 // characters of JSON per tool result; bigger answers are cut with a note

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-api-key, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Max-Age': '86400' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } })

export const onRequestOptions = async () => new Response(null, { status: 204, headers: CORS })

/** The tool list: one per source, parameters as a JSON schema of strings. */
export function tools() {
  return SOURCES.map((s) => ({
    name: s.name.replace(/\//g, '_'),
    title: s.title,
    description: s.description + (s.name === 'table' ? ' Tables: ' + Object.entries(TABLES).map(([k, v]) => `${k}: ${v}`).join('; ') : ''),
    inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(s.params).filter(([k]) => !k.startsWith('<')).map(([k, v]) => [k, { type: 'string', description: v }])), ...(s.name === 'table' ? { additionalProperties: { type: 'string', description: 'A PostgREST filter on a column, e.g. day: "gte.2026-09-01"' } } : {}), required: Object.entries(s.params).filter(([, v]) => /required/.test(v)).map(([k]) => k) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }))
}

export async function callTool(env, request, name, args) {
  const source = SOURCES.find((s) => s.name.replace(/\//g, '_') === name || s.name === name)
  if (!source) throw new QueryError(404, 'unknown_tool', `Unknown tool ${name}. Tools: ${SOURCES.map((s) => s.name.replace(/\//g, '_')).join(', ')}`)
  const out = await runSource(env, request, source.name, Object.fromEntries(Object.entries(args || {}).map(([k, v]) => [k, v == null ? '' : String(v)])))
  let text = JSON.stringify(out)
  if (text.length > MAX_TEXT) {
    const rows = Array.isArray(out.rows) ? out.rows : null
    if (rows) { let keep = rows.length; while (keep > 1 && JSON.stringify({ ...out, rows: rows.slice(0, keep) }).length > MAX_TEXT) keep = Math.floor(keep / 2); text = JSON.stringify({ ...out, rows: rows.slice(0, keep), truncated: true, note: `${rows.length} rows matched; ${keep} returned. Narrow the dates or filters, or use offset / limit.` }) }
    else text = text.slice(0, MAX_TEXT) + '\n… (cut: ask for a narrower scope)'
  }
  return { content: [{ type: 'text', text }], structuredContent: text.length < 100_000 ? out : undefined }
}

export async function handleRpc(env, request, msg, who) {
  const id = msg && msg.id
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(id, -32600, 'Invalid request')
  const { method, params = {} } = msg
  if (method.startsWith('notifications/')) return null
  if (method === 'initialize') {
    const asked = String(params.protocolVersion || '')
    return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: 'Read-only data from the Lyzr Campaign Analytics dashboard: ad performance, demographics, penetration against MD / MD-1 / MD-2 pools by company, region and tier, HubSpot GSI leads and funnel, deals, Instantly email, PhantomBuster, the action tracker, settings, and any ca_* table (tool "table"). Dates are YYYY-MM-DD inclusive. Call linkedin_windows first to learn which dates have data.' } }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (!who) return rpcError(id, -32001, 'Unauthorized: send an API key as Authorization: Bearer <key>, x-api-key, ?key= or in the path /api/ca/mcp/<key>')
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: tools() } }
  if (method === 'tools/call') {
    try { return { jsonrpc: '2.0', id, result: await callTool(env, request, String(params.name || ''), params.arguments || {}) } }
    catch (e) { return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `${e && e.code ? e.code + ': ' : ''}${String((e && e.message) || e).slice(0, 500)}` }] } } }
  }
  if (method === 'resources/list' || method === 'prompts/list') return { jsonrpc: '2.0', id, result: { [method.split('/')[0]]: [] } }
  return rpcError(id, -32601, `Method not found: ${method}`)
}

const pathKey = (request) => { const m = new URL(request.url).pathname.match(/^\/api\/ca\/mcp\/([^/]+)\/?$/); return m ? decodeURIComponent(m[1]) : '' }

export const onRequestGet = async ({ request }) => json({ name: SERVER.name, title: SERVER.title, transport: 'streamable-http (POST JSON-RPC, stateless; no SSE stream)', url: new URL(request.url).origin + '/api/ca/mcp', auth: 'Authorization: Bearer <key> | x-api-key | ?key= | /api/ca/mcp/<key>', tools: tools().map((t) => t.name), rest: new URL(request.url).origin + '/api/ca/v1' })

export const onRequestPost = async ({ request, env }) => {
  let body
  try { body = await request.json() } catch { return json(rpcError(null, -32700, 'Parse error: body must be JSON-RPC 2.0'), 400) }
  const who = await requireReader(request, env, { pathKey: pathKey(request) })
  const batch = Array.isArray(body)
  const answers = []
  for (const msg of batch ? body : [body]) { const a = await handleRpc(env, request, msg, who); if (a) answers.push(a) }
  if (!answers.length) return new Response(null, { status: 202, headers: CORS })
  const unauth = answers.every((a) => a.error && a.error.code === -32001)
  return json(batch ? answers : answers[0], unauth ? 401 : 200)
}
