// Backs up every tracker table to backups/<timestamp>/<table>.json before a
// destructive reset. Read-only against the live project (service role).
//
//   node scripts/export-live.mjs            -> backups/2026-09-23T10-00-00Z/
//
// Also writes _summary.json: row counts per table plus a split of tasks into
// blueprint-seeded (planning_fields.bp_id present) vs user-created, so you
// know exactly what restore-live.mjs --tasks will bring back.
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const TABLES = [
  'users', 'categories', 'channels', 'channel_fields', 'channel_owners', 'channel_resources',
  'channel_targets', 'channel_learnings', 'tasks', 'task_assignments', 'pending_assignments',
  'checklist_items', 'task_comments', 'task_dependencies', 'mentions', 'pending_mentions',
  'recurring_templates', 'budget_periods', 'activity_log', 'notifications', 'saved_views',
  'pending_invites', 'slack_settings', 'pending_slack_notifications', 'hubspot_connection',
  'hubspot_synced_contacts', 'lead_companies', 'lead_tracking', 'email_leads', 'weekly_snapshots',
  // 013 tables may not exist on the live project yet; missing tables are skipped, not fatal
  'weekly_reports', 'report_ad_spend', 'report_done_items',
  // 014+ tables, present only if the migration already ran
  'verticals', 'vertical_owners', 'functions', 'function_owners', 'vertical_resources', 'taxonomy_templates',
]

async function dumpTable(table) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').range(from, from + PAGE - 1)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return null
      throw new Error(`${table}: ${error.message}`)
    }
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = join(root, 'backups', stamp)
mkdirSync(dir, { recursive: true })

const summary = { exported_at: new Date().toISOString(), project: env.NEXT_PUBLIC_SUPABASE_URL, tables: {} }
for (const t of TABLES) {
  const rows = await dumpTable(t)
  if (rows === null) { summary.tables[t] = 'missing'; console.log(`  ${t}: (table missing, skipped)`); continue }
  writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 1))
  summary.tables[t] = rows.length
  console.log(`  ${t}: ${rows.length}`)
}

const tasks = JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8'))
const blueprint = tasks.filter(t => t.planning_fields?.bp_id)
const userMade = tasks.filter(t => !t.planning_fields?.bp_id)
const changedBlueprint = blueprint.filter(t => t.status !== 'not_started')
summary.tasks = {
  total: tasks.length,
  blueprint: blueprint.length,
  blueprint_with_live_state: changedBlueprint.length,
  user_created: userMade.length,
}
writeFileSync(join(dir, '_summary.json'), JSON.stringify(summary, null, 2))

console.log(`\nBACKUP COMPLETE -> ${dir}`)
console.log(`tasks: ${tasks.length} total, ${blueprint.length} blueprint (${changedBlueprint.length} with status changes), ${userMade.length} user-created`)
console.log('Next: run supabase/RESET_ALL.sql, then seed-gtm.mjs, then restore-live.mjs --tasks ' + join('backups', stamp))
