// Restores selected data from an export-live.mjs backup after RESET_ALL.sql
// + seed-gtm.mjs have rebuilt the database under the verticals model.
//
//   node scripts/restore-live.mjs --roles <backupDir>
//       re-apply users.role (RESET resets everyone but the bootstrap admin to member)
//   node scripts/restore-live.mjs --vertical-owners gsi=a@lyzr.ai,b@lyzr.ai
//       seed vertical_owners rows (resolves user_id when the person has signed in)
//   node scripts/restore-live.mjs --tasks <backupDir> [--vertical gsi] [--merge-blueprint-state]
//       re-create user-made tasks (no bp_id) inside the vertical, remapping channels by
//       (category slug, parent slug, slug); re-links assignments, pending assignments,
//       checklists, comments, dependencies, also_channels and budget periods.
//       --merge-blueprint-state additionally copies status / dates / comments / checklists
//       from backed-up blueprint tasks onto their reseeded twins (matched by bp_id).
//
// Idempotent-ish: tasks are matched on (channel, title, created_at) before insert,
// so re-running does not duplicate.
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
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

const argv = process.argv.slice(2)
const argValue = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
const VERTICAL_SLUG = (argValue('--vertical') || 'gsi').toLowerCase()
const MERGE_BP = argv.includes('--merge-blueprint-state')

const die = (msg, error) => { console.error('ABORT:', msg, error ? `\n${JSON.stringify(error, null, 2)}` : ''); process.exit(1) }
const load = (dir, table) => {
  const p = join(dir, `${table}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
}

// ---------- --roles ----------
if (argv.includes('--roles')) {
  const dir = argValue('--roles')
  if (!dir) die('--roles needs the backup directory')
  const users = load(dir, 'users')
  let n = 0
  for (const u of users) {
    const { data, error } = await db.from('users').update({ role: u.role }).eq('email', u.email).select('id')
    if (error) die(`role update for ${u.email} failed`, error)
    if (data?.length) n++
  }
  console.log(`roles: ${n}/${users.length} users updated`)
}

// ---------- --vertical-owners ----------
if (argv.includes('--vertical-owners')) {
  const spec = argValue('--vertical-owners') || ''
  const [slug, list] = spec.split('=')
  if (!slug || !list) die('--vertical-owners expects <slug>=<email,email>')
  const { data: v } = await db.from('verticals').select('id').eq('slug', slug).maybeSingle()
  if (!v) die(`vertical "${slug}" not found`)
  const { data: users } = await db.from('users').select('id, email')
  const byEmail = new Map((users || []).map(u => [u.email.toLowerCase(), u.id]))
  const rows = list.split(',').map(e => e.trim().toLowerCase()).filter(Boolean).map((email, i) => ({
    vertical_id: v.id, email, user_id: byEmail.get(email) || null, sort_order: i,
  }))
  const { error } = await db.from('vertical_owners').upsert(rows, { onConflict: 'vertical_id,email' })
  if (error) die('vertical_owners upsert failed', error)
  console.log(`vertical owners: ${rows.length} rows on "${slug}"`)
}

// ---------- --tasks ----------
if (argv.includes('--tasks')) {
  const dir = argValue('--tasks')
  if (!dir) die('--tasks needs the backup directory')

  const { data: vertical } = await db.from('verticals').select('id').eq('slug', VERTICAL_SLUG).maybeSingle()
  if (!vertical) die(`vertical "${VERTICAL_SLUG}" not found — seed it first`)

  // Old taxonomy (from backup) and new taxonomy (live) -> channel id map by path.
  const oldCats = load(dir, 'categories')
  const oldChannels = load(dir, 'channels')
  const oldCatSlug = new Map(oldCats.map(c => [c.id, c.slug]))
  const oldChById = new Map(oldChannels.map(c => [c.id, c]))
  const pathOf = (ch, catSlugOf, byId) => {
    const parent = ch.parent_channel_id ? byId.get(ch.parent_channel_id) : null
    return `${catSlugOf.get(ch.category_id)}/${parent ? parent.slug + '/' : ''}${ch.slug}`
  }
  const { data: newCats } = await db.from('categories').select('id, slug').eq('vertical_id', vertical.id)
  const { data: newChannels } = await db.from('channels').select('id, slug, category_id, parent_channel_id').eq('vertical_id', vertical.id)
  const newCatSlug = new Map((newCats || []).map(c => [c.id, c.slug]))
  const newChById = new Map((newChannels || []).map(c => [c.id, c]))
  const newByPath = new Map((newChannels || []).map(c => [pathOf(c, newCatSlug, newChById), c.id]))
  const channelMap = new Map()
  for (const ch of oldChannels) {
    const target = newByPath.get(pathOf(ch, oldCatSlug, oldChById))
    if (target) channelMap.set(ch.id, target)
  }
  const unmappedChannels = oldChannels.filter(c => !channelMap.has(c.id)).map(c => c.slug)
  if (unmappedChannels.length) console.log(`channels with no new counterpart (their tasks will be skipped): ${unmappedChannels.join(', ')}`)

  // Budget period map by (scope path, label)
  const oldBudgets = load(dir, 'budget_periods')
  const { data: newBudgets } = await db.from('budget_periods').select('id, scope_type, scope_id, period_label')
  const budgetKey = (b, chMap) => `${b.scope_type}:${b.scope_type === 'channel' ? (chMap ? chMap.get(b.scope_id) : b.scope_id) : b.scope_id || ''}:${b.period_label}`
  const newBudgetByKey = new Map((newBudgets || []).map(b => [budgetKey(b), b.id]))
  const budgetMap = new Map()
  for (const b of oldBudgets) {
    const id = newBudgetByKey.get(budgetKey(b, channelMap))
    if (id) budgetMap.set(b.id, id)
  }

  const { data: users } = await db.from('users').select('id, email')
  const userIds = new Set((users || []).map(u => u.id))
  const emailById = new Map((users || []).map(u => [u.id, u.email]))
  const { data: admin } = await db.from('users').select('id').eq('email', 'kailash.gm@lyzr.ai').maybeSingle()
  const fallbackCreator = admin?.id
  if (!fallbackCreator) die('admin user not found in public.users')

  const oldTasks = load(dir, 'tasks')
  const oldAssign = load(dir, 'task_assignments')
  const oldPending = load(dir, 'pending_assignments')
  const oldChecklist = load(dir, 'checklist_items')
  const oldComments = load(dir, 'task_comments')
  const oldDeps = load(dir, 'task_dependencies')

  const userMade = oldTasks.filter(t => !t.planning_fields?.bp_id)
  const byLevel = [...userMade].sort((a, b) => a.nesting_level - b.nesting_level)
  const taskMap = new Map() // old id -> new id

  // Existing (already restored) rows: match on channel + title + created_at
  const { data: existingTasks } = await db.from('tasks').select('id, channel_id, title, created_at')
  const existingKey = new Map((existingTasks || []).map(t => [`${t.channel_id}|${t.title}|${t.created_at}`, t.id]))

  let inserted = 0, skipped = 0, matched = 0
  for (const t of byLevel) {
    const channelId = channelMap.get(t.channel_id)
    if (!channelId) { skipped++; continue }
    if (t.parent_task_id && !taskMap.has(t.parent_task_id)) { skipped++; continue }
    const key = `${channelId}|${t.title}|${t.created_at}`
    if (existingKey.has(key)) { taskMap.set(t.id, existingKey.get(key)); matched++; continue }

    const pf = { ...(t.planning_fields || {}) }
    if (Array.isArray(pf.also_channels)) {
      pf.also_channels = pf.also_channels.map(id => channelMap.get(id)).filter(Boolean)
    }
    const { data, error } = await db.from('tasks').insert({
      channel_id: channelId,
      parent_task_id: t.parent_task_id ? taskMap.get(t.parent_task_id) : null,
      nesting_level: t.nesting_level,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      due_date: t.due_date,
      result_url: t.result_url,
      result_file_path: t.result_file_path,
      budget_allocated: t.budget_allocated,
      budget_period_id: t.budget_period_id ? budgetMap.get(t.budget_period_id) || null : null,
      blocked_by_user_id: userIds.has(t.blocked_by_user_id) ? t.blocked_by_user_id : null,
      blocked_by_email: t.blocked_by_email,
      blocked_reason: t.blocked_reason,
      planning_fields: pf,
      tracker_fields: t.tracker_fields || {},
      created_by: userIds.has(t.created_by) ? t.created_by : fallbackCreator,
      created_at: t.created_at,
      went_live_at: t.went_live_at,
      completed_at: t.completed_at,
      cancelled_at: t.cancelled_at,
      tracker_frozen_at: t.tracker_frozen_at,
    }).select('id').single()
    if (error) die(`insert task "${t.title}" failed`, error)
    taskMap.set(t.id, data.id)
    inserted++
  }
  console.log(`tasks: ${inserted} inserted, ${matched} already present, ${skipped} skipped (unmapped channel/parent)`)

  // --merge-blueprint-state: copy live state onto reseeded blueprint twins.
  if (MERGE_BP) {
    const { data: newBp } = await db.from('tasks').select('id, planning_fields').not('planning_fields->>bp_id', 'is', null)
    const prefix = `${VERTICAL_SLUG}:`
    const newByBp = new Map((newBp || []).map(t => {
      const id = String(t.planning_fields?.bp_id || '')
      return [id.startsWith(prefix) ? id.slice(prefix.length) : id, t.id]
    }))
    let merged = 0
    for (const t of oldTasks.filter(x => x.planning_fields?.bp_id)) {
      const oldBp = String(t.planning_fields.bp_id).startsWith(prefix)
        ? String(t.planning_fields.bp_id).slice(prefix.length) : String(t.planning_fields.bp_id)
      const newId = newByBp.get(oldBp)
      if (!newId) continue
      taskMap.set(t.id, newId)
      if (t.status === 'not_started' && !t.result_url && !t.description) continue
      const { error } = await db.from('tasks').update({
        status: t.status, due_date: t.due_date, description: t.description, priority: t.priority,
        result_url: t.result_url, result_file_path: t.result_file_path,
        budget_allocated: t.budget_allocated, tracker_fields: t.tracker_fields || {},
        planning_fields: { ...(t.planning_fields || {}), bp_id: `${prefix}${oldBp}` },
        went_live_at: t.went_live_at, completed_at: t.completed_at, cancelled_at: t.cancelled_at,
        blocked_reason: t.blocked_reason, blocked_by_email: t.blocked_by_email,
      }).eq('id', newId)
      if (error) die(`merge state onto ${oldBp} failed`, error)
      merged++
    }
    console.log(`blueprint state merged onto ${merged} reseeded tasks`)
  }

  // Children rows for every mapped task
  const rowsFor = (arr) => arr.filter(r => taskMap.has(r.task_id))
  let nA = 0, nP = 0, nC = 0, nM = 0, nD = 0
  for (const a of rowsFor(oldAssign)) {
    if (!userIds.has(a.user_id)) {
      const email = emailById.get(a.user_id)
      if (!email) continue
      const { error } = await db.from('pending_assignments').upsert(
        { task_id: taskMap.get(a.task_id), email, role: a.role, assigned_by: fallbackCreator }, { onConflict: 'task_id,email', ignoreDuplicates: true })
      if (error) die('pending_assignments upsert failed', error)
      nP++
      continue
    }
    const { error } = await db.from('task_assignments').upsert(
      { task_id: taskMap.get(a.task_id), user_id: a.user_id, role: a.role, assigned_by: userIds.has(a.assigned_by) ? a.assigned_by : null, assigned_at: a.assigned_at },
      { onConflict: 'task_id,user_id', ignoreDuplicates: true })
    if (error) {
      // a second primary on the same task: demote to secondary
      if (/task_assignments_primary_unique/.test(error.message)) {
        await db.from('task_assignments').upsert(
          { task_id: taskMap.get(a.task_id), user_id: a.user_id, role: 'secondary', assigned_by: null }, { onConflict: 'task_id,user_id', ignoreDuplicates: true })
      } else die('task_assignments upsert failed', error)
    }
    nA++
  }
  for (const p of rowsFor(oldPending).filter(p => !p.resolved_user_id)) {
    const { error } = await db.from('pending_assignments').upsert(
      { task_id: taskMap.get(p.task_id), email: p.email, role: p.role, assigned_by: fallbackCreator }, { onConflict: 'task_id,email', ignoreDuplicates: true })
    if (error) die('pending_assignments upsert failed', error)
    nP++
  }
  for (const c of rowsFor(oldChecklist)) {
    const { data: dup } = await db.from('checklist_items').select('id').eq('task_id', taskMap.get(c.task_id)).eq('body', c.body).limit(1)
    if (dup?.length) continue
    const { error } = await db.from('checklist_items').insert({
      task_id: taskMap.get(c.task_id), body: c.body, is_done: c.is_done, done_at: c.done_at,
      done_by: userIds.has(c.done_by) ? c.done_by : null, sort_order: c.sort_order,
      created_by: userIds.has(c.created_by) ? c.created_by : fallbackCreator, created_at: c.created_at,
    })
    if (error) die('checklist insert failed', error)
    nC++
  }
  for (const m of rowsFor(oldComments)) {
    if (!userIds.has(m.user_id)) continue
    const { data: dup } = await db.from('task_comments').select('id').eq('task_id', taskMap.get(m.task_id)).eq('created_at', m.created_at).limit(1)
    if (dup?.length) continue
    const { error } = await db.from('task_comments').insert({
      task_id: taskMap.get(m.task_id), user_id: m.user_id, body: m.body, file_path: m.file_path, created_at: m.created_at, updated_at: m.updated_at,
    })
    if (error) die('comment insert failed', error)
    nM++
  }
  for (const d of oldDeps) {
    if (!taskMap.has(d.task_id) || !taskMap.has(d.depends_on_task_id)) continue
    const { error } = await db.from('task_dependencies').upsert(
      { task_id: taskMap.get(d.task_id), depends_on_task_id: taskMap.get(d.depends_on_task_id) }, { onConflict: 'task_id,depends_on_task_id', ignoreDuplicates: true })
    if (error) die('dependency upsert failed', error)
    nD++
  }
  console.log(`linked: ${nA} assignments, ${nP} pending assignments, ${nC} checklist items, ${nM} comments, ${nD} dependencies`)
}

if (!argv.some(a => ['--roles', '--vertical-owners', '--tasks'].includes(a))) {
  console.log('nothing to do: pass --roles <dir>, --vertical-owners <slug>=<emails>, and/or --tasks <dir>')
}
