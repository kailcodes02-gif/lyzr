// Seeds the GTM blueprint (scripts/gtm-blueprint.json) into the tracker DB.
//
// Prereqs: supabase/RESET_ALL.sql has been run in the SQL Editor, and the
// admin (kailash.gm@lyzr.ai) exists in public.users (RESET_ALL backfills this
// if they ever signed in; otherwise they must sign in once first).
//
// Usage:
//   node scripts/seed-gtm.mjs               full seed (aborts if taxonomy already seeded)
//   node scripts/seed-gtm.mjs --owners-only (re)apply owner mapping only — safe after
//                                           scripts/owner-emails.json arrives or changes
//
// Owner mapping: scripts/owner-emails.json = { "Rishabh": "rishabh@lyzr.ai", ... }.
// Names missing from the mapping seed unowned and are listed at the end, as are
// non-person labels ("Partnership Team"/"Unassigned"), which additionally leave
// an owner_note trace in the channel's extra JSONB so the concept isn't lost.
//
// Primary assignment rule: the blueprint's FIRST listed owner is the only one
// ever given the 'primary' role (task_assignments has a unique primary per
// task). If that person's email isn't mapped yet, nobody takes primary — it
// stays reserved until their email arrives and --owners-only is re-run.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OWNERS_ONLY = process.argv.includes('--owners-only')

// ---------- env / clients ----------
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ---------- inputs ----------
const blueprint = JSON.parse(readFileSync(join(root, 'scripts', 'gtm-blueprint.json'), 'utf8'))
const ownersPath = join(root, 'scripts', 'owner-emails.json')
const ownerEmails = existsSync(ownersPath) ? JSON.parse(readFileSync(ownersPath, 'utf8')) : {}
const NON_PEOPLE = new Set(['Partnership Team', 'Unassigned'])
const unmappedNames = new Set()
const nonPeopleHits = new Set()

const emailFor = (name) => {
  if (NON_PEOPLE.has(name)) {
    nonPeopleHits.add(name)
    return null
  }
  const email = ownerEmails[name]
  if (!email) unmappedNames.add(name)
  return email || null
}

// Non-person owner labels can't become channel_owners rows; keep them visible
// in the channel's extra JSONB instead of dropping the concept entirely.
const ownerNote = (owners = []) => {
  const np = owners.filter(o => NON_PEOPLE.has(o))
  return np.length ? { owner_note: np.join(', ') } : {}
}

// Sub-activity entries are usually strings, but can be {t, d} objects
// (e.g. c2s1a1 "5 Email Nurture Sequence").
const saText = (x) => (typeof x === 'string' ? x : [x.t, x.d].filter(Boolean).join(' — '))

const CATEGORIES = [
  { slug: 'paid', name: 'Paid', icon: 'zap', sort_order: 1 },
  { slug: 'outbound', name: 'Outbound', icon: 'send', sort_order: 2 },
  { slug: 'organic', name: 'Organic', icon: 'sprout', sort_order: 3 },
  { slug: 'events', name: 'Events & ABM', icon: 'calendar', sort_order: 4 },
]

const GRADE_PRIORITY = { gold: 'P0', silver: 'P1', bronze: 'P2' }

const slugify = (s) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Timeline vs frequency: the blueprint carries only a cadence string (f), no
// dates. Every task gets an initial due_date derived from that cadence —
// daily/weekly → end of this week, quarterly → end of this quarter, everything
// else (monthly, ongoing, event-basis, TBD) → end of this month. Owners adjust
// per task after go-live.
const isoDate = (d) => d.toISOString().slice(0, 10)
const deriveDueDate = (f) => {
  const s = (f || '').toLowerCase()
  const now = new Date()
  if (/daily|weekly|\/wk|per week/.test(s)) {
    const sunday = new Date(now)
    sunday.setUTCDate(now.getUTCDate() + ((7 - now.getUTCDay()) % 7 || 7))
    return isoDate(sunday)
  }
  if (/quarter/.test(s)) {
    const qEndMonth = Math.floor(now.getUTCMonth() / 3) * 3 + 3
    return isoDate(new Date(Date.UTC(now.getUTCFullYear(), qEndMonth, 0)))
  }
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)))
}

// "$3,000 / mo" -> 3000 · "$500 - $1,000 / mo" -> 1000 · "Content Team" -> null
const parseBudget = (s) => {
  if (!s || !s.includes('$')) return null
  const nums = [...s.matchAll(/\$\s*([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')))
  return nums.length ? Math.max(...nums) : null
}

const die = (msg, error) => {
  console.error('ABORT:', msg, error ? `\n${JSON.stringify(error, null, 2)}` : '')
  process.exit(1)
}

const insert = async (table, rows, opts = {}) => {
  if (!rows.length) return []
  const { data, error } = await db.from(table).insert(rows).select(opts.select ?? '*')
  if (error) die(`insert into ${table} failed`, error)
  return data
}

// ---------- owners-only mode helpers ----------
// Maps blueprint node id (c1, c1s1) -> channel row, via extra.bp_id stored at seed time.
const loadChannelsByBpId = async () => {
  const { data, error } = await db.from('channels').select('id, name, extra')
  if (error) die('reading channels failed', error)
  const map = new Map()
  for (const ch of data) if (ch.extra?.bp_id) map.set(ch.extra.bp_id, ch)
  return map
}

const seedOwners = async (byBpId, adminId) => {
  // channel + sub-channel owners
  const ownerRows = []
  for (const ch of blueprint.channels) {
    const nodes = [[ch.id, ch.owners || []], ...(ch.subs || []).map(s => [s.id, s.owners || []])]
    for (const [bpId, owners] of nodes) {
      const row = byBpId.get(bpId)
      if (!row) continue
      owners.forEach((name, i) => {
        const email = emailFor(name)
        if (email) ownerRows.push({ channel_id: row.id, email: email.toLowerCase(), sort_order: i })
      })
    }
  }
  if (ownerRows.length) {
    const { error } = await db.from('channel_owners').upsert(ownerRows, { onConflict: 'channel_id,email' })
    if (error) die('upsert channel_owners failed', error)
  }

  // resolve emails that already have accounts
  const { data: users, error: uErr } = await db.from('users').select('id, email')
  if (uErr) die('reading users failed', uErr)
  for (const u of users) {
    await db.from('channel_owners').update({ user_id: u.id }).eq('email', u.email).is('user_id', null)
  }

  // pre-assign each sub-channel's tasks to its owners (primary = first owner)
  const { data: tasks, error: tErr } = await db.from('tasks').select('id, channel_id')
  if (tErr) die('reading tasks failed', tErr)
  const byChannel = new Map()
  for (const t of tasks) {
    if (!byChannel.has(t.channel_id)) byChannel.set(t.channel_id, [])
    byChannel.get(t.channel_id).push(t.id)
  }
  const emailToUser = new Map(users.map(u => [u.email, u.id]))
  let assigned = 0, pended = 0
  for (const ch of blueprint.channels) {
    for (const sub of ch.subs || []) {
      const row = byBpId.get(sub.id)
      const taskIds = row ? byChannel.get(row.id) || [] : []
      // Role comes from the UNFILTERED blueprint list: only the first listed
      // owner may be primary (the rest are secondary). This keeps --owners-only
      // re-runs from ever producing a second primary (task_assignments_primary_unique).
      const owners = (sub.owners || [])
        .map((name, idx) => ({ email: emailFor(name), role: idx === 0 ? 'primary' : 'secondary' }))
        .filter(o => o.email)
        .map(o => ({ ...o, email: o.email.toLowerCase() }))
      for (const taskId of taskIds) {
        for (const { email, role } of owners) {
          const userId = emailToUser.get(email)
          if (userId) {
            const { error } = await db.from('task_assignments')
              .upsert({ task_id: taskId, user_id: userId, role, assigned_by: adminId }, { onConflict: 'task_id,user_id', ignoreDuplicates: true })
            if (error) die('upsert task_assignments failed', error)
            assigned++
          } else {
            const { error } = await db.from('pending_assignments')
              .upsert({ task_id: taskId, email, role, assigned_by: adminId }, { onConflict: 'task_id,email', ignoreDuplicates: true })
            if (error) die('upsert pending_assignments failed', error)
            pended++
          }
        }
      }
    }
  }
  console.log(`owners: ${ownerRows.length} channel_owner rows · ${assigned} direct assignments · ${pended} pending (pre-sign-in)`)
}

// ---------- main ----------
const { data: admin, error: adminErr } = await db
  .from('users').select('id').eq('email', 'kailash.gm@lyzr.ai').maybeSingle()
if (adminErr) die('cannot read users table — did RESET_ALL.sql run?', adminErr)
if (!admin) die('kailash.gm@lyzr.ai not found in public.users. Run RESET_ALL.sql (it backfills from auth.users), or sign in once, then re-run.')

if (OWNERS_ONLY) {
  await seedOwners(await loadChannelsByBpId(), admin.id)
  if (unmappedNames.size) console.log('UNMAPPED owner names (seeded unowned):', [...unmappedNames].sort().join(', '))
  if (nonPeopleHits.size) console.log('Non-person owner labels (kept as extra.owner_note, no assignment):', [...nonPeopleHits].sort().join(', '))
  process.exit(0)
}

const { count } = await db.from('categories').select('*', { count: 'exact', head: true })
if (count > 0) die(`categories table already has ${count} rows — this script seeds a CLEAN db only. Run RESET_ALL.sql first (or use --owners-only).`)

// 1. categories
const catRows = await insert('categories', CATEGORIES.map(c => ({ ...c, is_active: true })))
const catBySlug = new Map(catRows.map(c => [c.slug, c.id]))

// 2. channels + sub-channels
const byBpId = new Map()
for (const ch of blueprint.channels) {
  const [parent] = await insert('channels', [{
    category_id: catBySlug.get(ch.cat === 'events' ? 'events' : ch.cat),
    name: ch.name,
    slug: slugify(ch.name),
    sort_order: ch.num,
    tier: ch.tier || null,
    goal: ch.goal || null,
    budget_note: ch.budget || null,
    extra: { bp_id: ch.id, num: ch.num, color: ch.color || null, ...ownerNote(ch.owners) },
  }])
  byBpId.set(ch.id, parent)

  const subRows = (ch.subs || []).map((sub, i) => ({
    category_id: parent.category_id,
    parent_channel_id: parent.id,
    name: sub.name,
    slug: slugify(sub.name),
    sort_order: i + 1,
    target: sub.target || null,
    budget_note: sub.budget || null,
    extra: {
      bp_id: sub.id,
      ...(sub.opp != null ? { opp_target: sub.opp } : {}),
      ...(sub.isNew ? { is_new: true } : {}),
      ...(sub.onote ? { onote: sub.onote } : {}),
      ...(sub.platforms ? { platforms: sub.platforms } : {}),
      ...ownerNote(sub.owners),
    },
  }))
  const subInserted = await insert('channels', subRows)
  ;(ch.subs || []).forEach((sub, i) => byBpId.set(sub.id, subInserted[i]))
}

// 3. resources + learnings (channel- and sub-channel-level)
const resourceRows = []
const learningRows = []
for (const ch of blueprint.channels) {
  const nodes = [[ch.id, ch], ...(ch.subs || []).map(s => [s.id, s])]
  for (const [bpId, node] of nodes) {
    const chId = byBpId.get(bpId).id
    for (const r of node.resources || []) resourceRows.push({ channel_id: chId, name: r.n, url: r.u, added_by: admin.id })
    for (const l of node.learnings || []) learningRows.push({ channel_id: chId, body: typeof l === 'string' ? l : JSON.stringify(l), added_by: admin.id })
  }
}
await insert('channel_resources', resourceRows)
await insert('channel_learnings', learningRows)

// 3b. targets — the board writes multiple targets in one string separated by
// "•"; split them into individual channel_targets rows (multi-target support)
const targetRows = []
for (const ch of blueprint.channels) {
  for (const sub of ch.subs || []) {
    if (!sub.target) continue
    const chId = byBpId.get(sub.id).id
    sub.target.split('•').map(t => t.trim()).filter(Boolean).forEach((body, i) =>
      targetRows.push({ channel_id: chId, body, sort_order: i, added_by: admin.id }))
  }
}
await insert('channel_targets', targetRows)

// 4. activities -> tasks; sub-activities -> CHILD tasks (level 4 of the
// hierarchy, each with its own description/status/priority, per user reqs)
let taskCount = 0, subTaskCount = 0
for (const ch of blueprint.channels) {
  for (const sub of ch.subs || []) {
    const channelId = byBpId.get(sub.id).id
    for (const act of sub.acts || []) {
      const saList = act.sa || []
      const due = deriveDueDate(act.f)
      const [task] = await insert('tasks', [{
        channel_id: channelId,
        title: act.t,
        description: saList.length === 1 ? saText(saList[0]) : null,
        priority: GRADE_PRIORITY[act.grade] || 'P2',
        status: 'not_started',
        due_date: due,
        budget_allocated: typeof act.bud === 'number' ? act.bud : parseBudget(act.bud),
        created_by: admin.id,
        planning_fields: {
          ...(act.f ? { frequency: act.f } : {}),
          ...(act.k ? { kpi_target: act.k } : {}),
          ...(act.grade ? { grade: act.grade } : {}),
          ...(act.opp != null ? { opp_target: act.opp } : {}),
          bp_id: act.id,
        },
      }])
      taskCount++
      // A single sa entry is the activity's own description (set above);
      // multiple entries are distinct pieces of work -> child tasks.
      if (saList.length > 1) {
        await insert('tasks', saList.map((x, i) => ({
          channel_id: channelId,
          parent_task_id: task.id,
          nesting_level: 1,
          title: typeof x === 'string' ? x : x.t,
          description: typeof x === 'string' ? null : x.d || null,
          priority: 'P2',
          status: 'not_started',
          due_date: due,
          created_by: admin.id,
          planning_fields: { bp_id: `${act.id}-sa${i + 1}` },
        })))
        subTaskCount += saList.length
      }
    }
  }
}

// 5. generic channel_fields on the 12 top channels (cascade to sub-channels)
const fieldDefs = [
  { name: 'Frequency', slug: 'frequency', field_type: 'text', surface: 'planning', sort_order: 1 },
  { name: 'KPI target', slug: 'kpi_target', field_type: 'text', surface: 'planning', sort_order: 2 },
  { name: 'Star grade', slug: 'grade', field_type: 'dropdown', surface: 'planning', options: ['gold', 'silver', 'bronze'], sort_order: 3 },
  { name: 'Opportunity target', slug: 'opp_target', field_type: 'number', surface: 'planning', sort_order: 4 },
  { name: 'KPI actual', slug: 'kpi_actual', field_type: 'text', surface: 'tracker', sort_order: 1 },
  { name: 'Opportunities actual', slug: 'opportunities_actual', field_type: 'number', surface: 'tracker', sort_order: 2 },
  { name: 'Spend', slug: 'spend', field_type: 'currency', surface: 'tracker', sort_order: 3 },
  { name: 'Evidence URL', slug: 'evidence_url', field_type: 'url', surface: 'tracker', sort_order: 4 },
]
const fieldRows = []
for (const ch of blueprint.channels) {
  const parent = byBpId.get(ch.id)
  for (const f of fieldDefs) {
    fieldRows.push({
      channel_id: parent.id, name: f.name, slug: f.slug, field_type: f.field_type,
      surface: f.surface, sort_order: f.sort_order, cascades_to_children: true,
      ...(f.options ? { options: f.options } : {}),
    })
  }
}
await insert('channel_fields', fieldRows)

// 6. budget periods (channel-scoped, current month) for numeric budgets
const now = new Date()
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
const iso = (d) => d.toISOString().slice(0, 10)
const label = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const budgetRows = []
for (const ch of blueprint.channels) {
  const nodes = [[ch.id, ch.budget], ...(ch.subs || []).map(s => [s.id, s.budget])]
  for (const [bpId, budgetStr] of nodes) {
    const amount = parseBudget(budgetStr)
    if (amount == null) continue
    budgetRows.push({
      scope_type: 'channel', scope_id: byBpId.get(bpId).id,
      period_type: 'monthly', period_label: label,
      starts_on: iso(monthStart), ends_on: iso(monthEnd),
      total_budget: amount, created_by: admin.id,
      notes: `Seeded from GTM blueprint: "${budgetStr}"`,
    })
  }
}
await insert('budget_periods', budgetRows)

// 7. owners + task assignments
await seedOwners(byBpId, admin.id)

console.log(`\nSEED COMPLETE:
  categories:        ${catRows.length}
  channels:          ${byBpId.size} (12 top + 38 sub)
  activity tasks:    ${taskCount}
  sub-activity tasks:${subTaskCount}
  targets:           ${targetRows.length}
  resources:         ${resourceRows.length}
  learnings:         ${learningRows.length}
  channel_fields:    ${fieldRows.length}
  budget periods:    ${budgetRows.length}`)
if (unmappedNames.size) {
  console.log(`\nUNMAPPED owner names (seeded unowned — add to scripts/owner-emails.json and re-run with --owners-only):\n  ${[...unmappedNames].sort().join(', ')}`)
}
if (nonPeopleHits.size) {
  console.log(`Non-person owner labels (kept as extra.owner_note on their channels, no assignment): ${[...nonPeopleHits].sort().join(', ')}`)
}
