// Small document store on top of ca_insights (scope = document id, content = JSON body), so new
// features need no new table. Prefixes in use:
//   leads:<id>   LinkedIn lead-form leads: one CSV upload, the LinkedIn API pull (leads:li-api) or a screenshot
//   screen:<id>  what Claude Sonnet read from an uploaded screenshot
//   _<name>      private server records (the LinkedIn OAuth token, `_li_oauth`); never served by GET insights
// Documents are whole JSON bodies; keep each under a few MB.

import { db } from './db.js'

const SELECT = 'scope,content,created_at,created_by,model'

export async function getDoc(env, id) {
  const rows = await db(env).select('ca_insights', { params: { scope: `eq.${id}` }, select: SELECT, limit: 1 })
  return rows.length ? toDoc(rows[0]) : null
}

// Every document whose id starts with prefix (e.g. 'leads:'), newest first.
export async function listDocs(env, prefix) {
  const like = String(prefix).replace(/[%_\\]/g, (c) => '\\' + c) + '%'
  const rows = await db(env).selectAll('ca_insights', { params: { scope: `like.${like}` }, select: SELECT, order: 'created_at.desc' })
  return rows.map(toDoc)
}

export async function putDoc(env, id, content, { by = null, model = 'doc' } = {}) {
  const created_at = new Date().toISOString()
  await db(env).upsert('ca_insights', [{ scope: id, input_hash: null, model, content, created_at, created_by: by }], 'scope')
  return { id, content, created_at, created_by: by }
}

export async function delDoc(env, id) {
  await db(env).del('ca_insights', { scope: `eq.${id}` })
}

const toDoc = (r) => ({ id: r.scope, content: r.content, created_at: r.created_at, created_by: r.created_by, model: r.model })
