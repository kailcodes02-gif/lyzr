// Shared HTTP helpers for the Campaign Analytics Pages Functions (/api/ca/*).
// Same CORS and JSON conventions as functions/api/events.js.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

// Every handler file re-exports this so the browser can preflight.
export async function corsPreflight() {
  return new Response(null, { headers: CORS })
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function readJson(request) {
  try {
    const b = await request.json()
    return b && typeof b === 'object' ? b : {}
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

// Wrap a handler so thrown errors become { error } JSON with the right status.
// Never echo secrets: messages are truncated and only e.message is used.
export function handle(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx)
    } catch (e) {
      const status = Number.isInteger(e && e.status) ? e.status : 500
      const message = String((e && e.message) || e || 'Unexpected error').slice(0, 400)
      // Server-side errors go to the Pages Function log (wrangler pages deployment tail).
      if (status >= 500) console.error(`[ca] ${status} ${message}`)
      return json({ error: message }, status)
    }
  }
}

export function isoDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
}

export function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  const n = Number(String(v).replace(/[,$%\s]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
