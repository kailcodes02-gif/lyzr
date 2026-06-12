import { createServiceClient } from '@/lib/supabase/server'
import { startOfWeek, format } from 'date-fns'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  // Authorization check
  const { searchParams } = new URL(req.url)
  // The ?bypass=true escape hatch is for local manual testing only; it is
  // disabled in production so the cron endpoint can never be triggered
  // unauthenticated there.
  const bypass = process.env.NODE_ENV !== 'production' && searchParams.get('bypass') === 'true'

  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!bypass) {
    if (!cronSecret) {
      return new Response('CRON_SECRET not configured', { status: 500 })
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  try {
    const supabase = await createServiceClient()

    // 1. Fetch all data needed for aggregation
    const { data: tasks, error: tasksErr } = await supabase
      .from('tasks')
      .select(`
        id, status, channel_id, budget_allocated,
        channel:channels(id, category_id, category:categories(slug, name)),
        assignments:task_assignments(user_id, user:users!user_id(email))
      `)
    if (tasksErr) throw tasksErr

    const { data: categories, error: catsErr } = await supabase
      .from('categories')
      .select('id, name, slug')
    if (catsErr) throw catsErr

    const { data: budgets, error: budgetsErr } = await supabase
      .from('budget_periods')
      .select('id, total_budget, scope_type, scope_id, allocated')
    if (budgetsErr) throw budgetsErr

    // 2. Count by status
    let total_tasks = 0
    let completed_tasks = 0
    let blocked_tasks = 0
    let live_tasks = 0
    let in_progress_tasks = 0
    let not_started_tasks = 0
    let cancelled_tasks = 0

    const by_category: Record<string, number> = {}
    const by_owner: Record<string, number> = {}

    // Initialize category counts
    categories?.forEach(cat => {
      by_category[cat.slug] = 0
    })

    tasks?.forEach(task => {
      total_tasks++
      switch (task.status) {
        case 'done': completed_tasks++; break
        case 'blocked': blocked_tasks++; break
        case 'live': live_tasks++; break
        case 'in_progress': in_progress_tasks++; break
        case 'not_started': not_started_tasks++; break
        case 'cancelled': cancelled_tasks++; break
      }

      // Aggregate by category
      const categorySlug = (task.channel as any)?.category?.slug
      if (categorySlug) {
        by_category[categorySlug] = (by_category[categorySlug] || 0) + 1
      }

      // Aggregate by owner
      const owners = task.assignments || []
      owners.forEach((a: any) => {
        const email = a.user?.email
        if (email) {
          by_owner[email] = (by_owner[email] || 0) + 1
        }
      })
    })

    // 3. Aggregate budgets
    let totalLimit = 0
    let totalAllocated = 0

    budgets?.forEach(b => {
      totalLimit += Number(b.total_budget || 0)
      totalAllocated += Number(b.allocated || 0)
    })

    const budget_summary = {
      total_limit: totalLimit,
      total_allocated: totalAllocated,
      unspent_budget: Math.max(0, totalLimit - totalAllocated)
    }

    // 4. Calculate week starting (Monday of this week)
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
    const week_starting = format(monday, 'yyyy-MM-dd')

    const snapshot = {
      week_starting,
      total_tasks,
      completed_tasks,
      blocked_tasks,
      live_tasks,
      in_progress_tasks,
      not_started_tasks,
      cancelled_tasks,
      by_category,
      by_owner,
      budget_summary,
    }

    // 5. Upsert to database
    const { data: upsertData, error: upsertErr } = await supabase
      .from('weekly_snapshots')
      .upsert(snapshot, { onConflict: 'week_starting' })
      .select()
      .single()

    if (upsertErr) throw upsertErr

    // 6. Log Slack Summary post stub
    const slackMessage = `📊 *Weekly Marketing Review Snapshot (${week_starting})*\n` +
      `• *Total Tasks*: ${total_tasks} (${completed_tasks} done, ${blocked_tasks} blocked)\n` +
      `• *Budgets*: Limit $${totalLimit.toLocaleString()}, Allocated $${totalAllocated.toLocaleString()} (Unspent: $${budget_summary.unspent_budget.toLocaleString()})\n` +
      `• *Category Breakdown*: ${JSON.stringify(by_category)}\n` +
      `• *Top Owner Load*: ${JSON.stringify(by_owner)}`

    console.log('[SLACK WEEKLY SNAPSHOT CRON POST STUB]:', slackMessage)

    // Insert Slack notification queue entry
    const { data: slackChannels } = await supabase
      .from('slack_settings')
      .select('slack_channel_id')
      .limit(1)

    // Post to the first Slack channel we find, or a fallback 'general'
    const targetChannel = slackChannels?.[0]?.slack_channel_id || 'general'
    
    try {
      const { error: slackQueueErr } = await supabase.from('pending_slack_notifications').insert({
        channel_id: targetChannel,
        message: slackMessage,
        status: 'pending'
      })
      if (slackQueueErr) {
        console.warn('Could not queue weekly snapshot Slack message in table:', slackQueueErr.message)
      }
    } catch (e: any) {
      console.warn('Could not queue weekly snapshot Slack message in table:', e.message)
    }

    return NextResponse.json({
      success: true,
      message: 'Weekly snapshot generated and queued for Slack successfully',
      snapshot: upsertData,
    })

  } catch (error: any) {
    console.error('Weekly Snapshot Cron Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 })
  }
}
