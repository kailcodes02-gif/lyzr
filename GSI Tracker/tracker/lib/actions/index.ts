// Client-side data operations: every function talks to Supabase directly
// from the browser; RLS in the database is the security boundary.
import { createClient } from '@/lib/supabase/client'
import type { TaskStatus, TaskPriority, AssignmentRole, BudgetScopeType, BudgetPeriodType } from '@/lib/types/database'
import { format } from 'date-fns'
import { advanceRecurrence, legacyPatternFields, normalizeEmail, incompleteBlockers } from '@/lib/task-logic'
import type { RecurrenceRule, RecurrenceEnd } from '@/lib/task-logic'
import type { VerticalSettings, CampaignKind, CampaignStatus } from '@/lib/types/database'

// UX-level gate mirroring the RLS helper can_manage_vertical(): global admin
// or explicit owner of the vertical. RLS remains the real boundary; this just
// produces a readable error instead of a silent 0-row update.
async function assertCanManage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  verticalId: string | null | undefined,
  what = 'this vertical',
) {
  const { data: profile } = await supabase.from('users').select('role').eq('id', userId).single()
  if (profile?.role === 'admin') return
  if (verticalId) {
    const { data } = await supabase
      .from('vertical_owners').select('vertical_id').eq('vertical_id', verticalId).eq('user_id', userId).maybeSingle()
    if (data) return
  }
  throw new Error(`Only admins or owners of ${what} can do that`)
}

async function verticalOfChannel(supabase: ReturnType<typeof createClient>, channelId: string) {
  const { data } = await supabase.from('channels').select('vertical_id').eq('id', channelId).maybeSingle()
  return data?.vertical_id as string | undefined
}

// The row shape recurring_templates needs for interval_count/unit/weekdays/
// end-condition, shared by createTask, makeTaskRecurring, and the auto-spawn
// logic below.
function recurrenceInsertFields(rule: RecurrenceRule, end: RecurrenceEnd) {
  const legacy = legacyPatternFields(rule)
  return {
    ...legacy,
    interval_count: rule.interval_count,
    interval_unit: rule.interval_unit,
    by_weekdays: rule.by_weekdays && rule.by_weekdays.length ? rule.by_weekdays : null,
    end_type: end.type,
    ends_on: end.type === 'on_date' ? end.date : null,
    occurrences_total: end.type === 'after_count' ? end.total : null,
    occurrences_done: 1, // the originating task is occurrence #1
  }
}

export async function queueSlackNotification(channelId: string, message: string) {
  console.log(`[SLACK NOTIFICATION STUB] Channel/User: ${channelId} | Message: ${message}`)
  
  const supabase = await createClient()
  try {
    const { error } = await supabase
      .from('pending_slack_notifications')
      .insert({
        channel_id: channelId,
        message,
        status: 'pending'
      })
    if (error) {
      console.warn(`Failed to insert into pending_slack_notifications: ${error.message}`)
    }
  } catch (err: any) {
    console.warn(`Failed to queue Slack notification: ${err.message}`)
  }
}

// ============ TASKS ============

export async function createTask(data: {
  channel_id: string
  title: string
  description?: string
  priority: TaskPriority
  due_date?: string
  parent_task_id?: string
  nesting_level?: number
  budget_allocated?: number | null
  campaign_id?: string | null
  planning_fields?: Record<string, unknown>
  assignments: { user_id: string; role: AssignmentRole }[]
  recurrence?: {
    rule: RecurrenceRule
    end: RecurrenceEnd
    starts_on?: string
  }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Priority cascade rule: a P0 parent forces P0 on its subtasks; under any
  // other parent priority the subtask keeps its own.
  if (data.parent_task_id) {
    const { data: parent } = await supabase
      .from('tasks').select('priority').eq('id', data.parent_task_id).single()
    if (parent?.priority === 'P0') data.priority = 'P0'
  }

  let templateId: string | null = null

  if (data.recurrence) {
    const { rule, end } = data.recurrence
    const anchor = data.due_date || new Date().toISOString().split('T')[0]
    const { data: template, error: tempError } = await supabase
      .from('recurring_templates')
      .insert({
        channel_id: data.channel_id,
        title: data.title,
        description: data.description || null,
        default_priority: data.priority,
        default_planning_fields: data.planning_fields || {},
        ...recurrenceInsertFields(rule, end),
        starts_on: data.recurrence.starts_on || anchor,
        // The first instance is created now with due_date = data.due_date; the
        // template's next_due_date must be ONE interval later so the next spawned
        // instance does not land on the same date as the first.
        next_due_date: format(advanceRecurrence(new Date(anchor), rule), 'yyyy-MM-dd'),
        default_assignees: data.assignments.map(a => a.user_id),
        created_by: user.id,
      })
      .select()
      .single()
    if (tempError) throw tempError
    templateId = template.id
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      channel_id: data.channel_id,
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      due_date: data.due_date || null,
      parent_task_id: data.parent_task_id || null,
      nesting_level: data.nesting_level || 0,
      budget_allocated: data.budget_allocated ?? null,
      planning_fields: data.planning_fields || {},
      campaign_id: data.campaign_id || null,
      recurring_template_id: templateId,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw error

  // Insert assignments
  if (data.assignments.length > 0) {
    const { error: assignError } = await supabase
      .from('task_assignments')
      .insert(
        data.assignments.map(a => ({
          task_id: task.id,
          user_id: a.user_id,
          role: a.role,
          assigned_by: user.id,
        }))
      )
    if (assignError) throw assignError

    // 'assigned' notifications come from the task_assignments trigger (020).
  }

  // Log activity
  await supabase.from('activity_log').insert({
    task_id: task.id,
    actor_id: user.id,
    action: 'created',
    to_value: { title: data.title },
  })

  // Slack notification trigger
  try {
    const { data: channel } = await supabase
      .from('channels')
      .select('category_id, name')
      .eq('id', data.channel_id)
      .single()

    if (channel && channel.category_id) {
      const { data: slackSetting } = await supabase
        .from('slack_settings')
        .select('*')
        .eq('category_id', channel.category_id)
        .single()

      if (slackSetting && slackSetting.notify_on_create) {
        await queueSlackNotification(
          slackSetting.slack_channel_id,
          `🆕 *New Task Created* inside channel *${channel.name}*:\n*Title*: ${data.title}\n*Priority*: ${data.priority}\n*Due*: ${data.due_date || 'None'}`
        )
      }
    }
  } catch (err: any) {
    console.warn(`Slack notify_on_create failed: ${err.message}`)
  }

  return task
}

export async function updateTask(
  taskId: string,
  data: Partial<{
    title: string
    description: string | null
    priority: TaskPriority
    status: TaskStatus
    due_date: string | null
    result_url: string | null
    result_file_path: string | null
    budget_allocated: number | null
    budget_period_id: string | null
    blocked_reason: string | null
    blocked_by_email: string | null
    planning_fields: Record<string, unknown>
    tracker_fields: Record<string, unknown>
    campaign_id: string | null
  }>,
  opts?: { overrideBlockers?: boolean }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Get current task for activity log
  const { data: oldTask } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  // Cascade guard: a subtask cannot drop below P0 while its parent is P0.
  if (data.priority && data.priority !== 'P0' && oldTask?.parent_task_id) {
    const { data: parent } = await supabase
      .from('tasks').select('priority').eq('id', oldTask.parent_task_id).single()
    if (parent?.priority === 'P0') {
      throw new Error('Parent activity is P0 — sub-activities inherit P0. Lower the parent first.')
    }
  }

  // Server-side guard: a task cannot be closed while its blocker dependencies
  // (the tasks it depends on) are still open, unless an explicit override is
  // passed (the drawer offers this after a confirm). The previous guard lived
  // only in the client and was trivially bypassable.
  if (data.status === 'done' && oldTask && oldTask.status !== 'done' && !opts?.overrideBlockers) {
    const { data: deps } = await supabase
      .from('task_dependencies')
      .select('depends_on_task_id')
      .eq('task_id', taskId)
    const blockerIds = (deps || []).map((d: { depends_on_task_id: string }) => d.depends_on_task_id)
    if (blockerIds.length > 0) {
      const { data: blockers } = await supabase
        .from('tasks')
        .select('id, status')
        .in('id', blockerIds)
      const incomplete = incompleteBlockers(blockers as { status: string }[] | null)
      if (incomplete.length > 0) {
        throw new Error(
          `Cannot mark done: ${incomplete.length} blocking task(s) still incomplete. Resolve them or override.`
        )
      }
    }
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .update(data)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error

  // Priority cascade: setting a task to P0 forces ALL descendants to P0
  // (nesting is capped at 3 levels, so one grandchild pass suffices).
  // Other priorities leave subtask priorities independent.
  if (data.priority === 'P0') {
    const { data: children } = await supabase
      .from('tasks').update({ priority: 'P0' }).eq('parent_task_id', taskId).select('id')
    if (children?.length) {
      await supabase.from('tasks').update({ priority: 'P0' })
        .in('parent_task_id', children.map(c => c.id))
    }
  }

  // Auto-generate next task instance if recurring task is marked done
  if (data.status === 'done' && oldTask && oldTask.status !== 'done' && oldTask.recurring_template_id) {
    const { data: template } = await supabase
      .from('recurring_templates')
      .select('*')
      .eq('id', oldTask.recurring_template_id)
      .single()

    if (template && template.is_active) {
      const nextDue = new Date(template.next_due_date)
      const endsOn = template.end_type === 'on_date' && template.ends_on ? new Date(template.ends_on) : null
      const withinDate = !endsOn || nextDue <= endsOn
      const withinCount = template.end_type !== 'after_count'
        || !template.occurrences_total
        || template.occurrences_done < template.occurrences_total

      if (withinDate && withinCount) {
        const { data: nextTask, error: spawnErr } = await supabase
          .from('tasks')
          .insert({
            channel_id: template.channel_id,
            title: template.title,
            description: template.description || null,
            priority: template.default_priority,
            due_date: template.next_due_date,
            recurring_template_id: template.id,
            planning_fields: template.default_planning_fields,
            created_by: user.id,
            status: 'not_started',
          })
          .select()
          .single()

        if (!spawnErr && nextTask) {
          if (template.default_assignees && template.default_assignees.length > 0) {
            await supabase.from('task_assignments').insert(
              template.default_assignees.map((uid: string, idx: number) => ({
                task_id: nextTask.id,
                user_id: uid,
                role: idx === 0 ? ('primary' as const) : ('other' as const),
                assigned_by: user.id,
              }))
            )
          }

          const rule: RecurrenceRule = {
            interval_count: template.interval_count,
            interval_unit: template.interval_unit,
            by_weekdays: template.by_weekdays,
          }
          const advancedDate = advanceRecurrence(new Date(template.next_due_date), rule)
          const nextDueStr = format(advancedDate, 'yyyy-MM-dd')
          const occurrencesDone = (template.occurrences_done || 1) + 1
          const isExpiredByDate = endsOn && advancedDate > endsOn
          const isExpiredByCount = template.end_type === 'after_count'
            && template.occurrences_total
            && occurrencesDone >= template.occurrences_total

          await supabase
            .from('recurring_templates')
            .update({
              next_due_date: nextDueStr,
              occurrences_done: occurrencesDone,
              is_active: !isExpiredByDate && !isExpiredByCount,
            })
            .eq('id', template.id)
        }
      }
    }
  }

  // Log status changes specifically
  if (data.status && oldTask && data.status !== oldTask.status) {
    await supabase.from('activity_log').insert({
      task_id: taskId,
      actor_id: user.id,
      action: 'status_changed',
      from_value: { status: oldTask.status },
      to_value: { status: data.status },
    })

    // If marked done, trigger notifications for any dependent tasks
    if (data.status === 'done') {
      const { data: dependentDeps } = await supabase
        .from('task_dependencies')
        .select('task_id')
        .eq('depends_on_task_id', taskId)

      if (dependentDeps && dependentDeps.length > 0) {
        for (const dep of dependentDeps) {
          const { data: assignees } = await supabase
            .from('task_assignments')
            .select('user_id, user:users(email, display_name)')
            .eq('task_id', dep.task_id)

          if (assignees && assignees.length > 0) {
            await supabase.from('notifications').insert(
              assignees.map(a => ({
                user_id: a.user_id,
                task_id: dep.task_id,
                type: 'dependency_completed' as const,
                payload: {
                  dependency_task_title: task.title,
                  dependency_task_id: taskId,
                },
              }))
            )

            // Slack DM to owners of the dependent task
            for (const a of assignees) {
              const u: any = a.user
              const email = Array.isArray(u) ? u[0]?.email : u?.email
              if (email) {
                await queueSlackNotification(
                  email,
                  `🔔 *Dependency Completed DM*:\nTask *${task.title}* (which your task depends on) has been marked as DONE. You can now unblock your work!`
                )
              }
            }
          }
        }
      }
    }

    // Slack settings-based notifications (create, live, done, blocked)
    try {
      const { data: channel } = await supabase
        .from('channels')
        .select('category_id, name')
        .eq('id', task.channel_id)
        .single()

      if (channel && channel.category_id) {
        const { data: slackSetting } = await supabase
          .from('slack_settings')
          .select('*')
          .eq('category_id', channel.category_id)
          .single()

        if (slackSetting) {
          let shouldNotify = false
          let msg = ''

          if (data.status === 'live' && slackSetting.notify_on_live) {
            shouldNotify = true
            msg = `🚀 *Task is now Live* in *${channel.name}*:\n*Title*: ${task.title}`
          } else if (data.status === 'done' && slackSetting.notify_on_complete) {
            shouldNotify = true
            msg = `✅ *Task Completed* in *${channel.name}*:\n*Title*: ${task.title}`
          } else if (data.status === 'blocked' && slackSetting.notify_on_blocked) {
            shouldNotify = true
            msg = `⚠️ *Task Blocked* in *${channel.name}*:\n*Title*: ${task.title}\n*Reason*: ${data.blocked_reason || 'No reason given'}`
          }

          if (shouldNotify && msg) {
            await queueSlackNotification(slackSetting.slack_channel_id, msg)
          }
        }
      }
    } catch (err: any) {
      console.warn(`Slack status transition notification failed: ${err.message}`)
    }

    // Notify assigned users of status change
    const { data: assignments } = await supabase
      .from('task_assignments')
      .select('user_id')
      .eq('task_id', taskId)

    if (assignments) {
      const notifications = assignments
        .filter(a => a.user_id !== user.id)
        .map(a => ({
          user_id: a.user_id,
          task_id: taskId,
          type: 'status_change' as const,
          payload: {
            task_title: task.title,
            from_status: oldTask.status,
            to_status: data.status,
            changed_by: user.id,
          },
        }))
      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications)
      }
    }
  }

  return task
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
  if (error) throw error
}

export async function addTaskDependency(taskId: string, dependsOnTaskId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('task_dependencies')
    .insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId })

  if (error) throw error
}

export async function removeTaskDependency(taskId: string, dependsOnTaskId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('task_id', taskId)
    .eq('depends_on_task_id', dependsOnTaskId)

  if (error) throw error
}

// ============ ASSIGNMENTS ============

export async function updateAssignments(
  taskId: string,
  assignments: { user_id: string; role: AssignmentRole }[]
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Delete existing assignments
  await supabase
    .from('task_assignments')
    .delete()
    .eq('task_id', taskId)

  // Insert new ones
  if (assignments.length > 0) {
    const { error } = await supabase
      .from('task_assignments')
      .insert(
        assignments.map(a => ({
          task_id: taskId,
          user_id: a.user_id,
          role: a.role,
          assigned_by: user.id,
        }))
      )
    if (error) throw error
  }

}

// ============ CHECKLISTS ============

export async function addChecklistItem(taskId: string, body: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('checklist_items')
    .insert({
      task_id: taskId,
      body,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function toggleChecklistItem(itemId: string, isDone: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('checklist_items')
    .update({
      is_done: isDone,
      done_at: isDone ? new Date().toISOString() : null,
      done_by: isDone ? user.id : null,
    })
    .eq('id', itemId)

  if (error) throw error
}

export async function deleteChecklistItem(itemId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('checklist_items')
    .delete()
    .eq('id', itemId)
  if (error) throw error
}

// ============ COMMENTS ============

export async function addComment(taskId: string, body: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      task_id: taskId,
      user_id: user.id,
      body,
    })
    .select('*, user:users(*)')
    .single()

  if (error) throw error

  // 'comment' notifications come from the task_comments trigger (020).

  // Log activity
  await supabase.from('activity_log').insert({
    task_id: taskId,
    actor_id: user.id,
    action: 'commented',
    to_value: { body: body.substring(0, 100) },
  })

  return data
}

// ============ MENTIONS ============

export async function createMention(
  taskId: string,
  surface: 'task_description' | 'task_comment' | 'checklist_item' | 'blocked_description' | 'insight',
  email: string,
  surfaceRefId?: string
) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) throw new Error('Not authenticated')

  // Normalize the mentioned email so it matches how users / pending rows are
  // stored (Google SSO emails arrive lowercased) and resolves on first sign-in.
  const normalizedEmail = normalizeEmail(email)

  // Check if user exists
  const { data: targetUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .single()

  if (targetUser) {
    // Create resolved mention
    await supabase.from('mentions').insert({
      task_id: taskId,
      surface,
      surface_ref_id: surfaceRefId || null,
      mentioned_user_id: targetUser.id,
      mentioned_email: normalizedEmail,
      mentioned_by: authUser.id,
    })

    // Notify mentioned user
    await supabase.from('notifications').insert({
      user_id: targetUser.id,
      task_id: taskId,
      type: 'mentioned',
      payload: {
        surface,
        mentioned_by: authUser.id,
      },
    })
  } else {
    // Create pending mention for unresolved user
    await supabase.from('pending_mentions').insert({
      email: normalizedEmail,
      task_id: taskId,
      surface,
      surface_ref_id: surfaceRefId || null,
    })
  }

}

// ============ BUDGETS ============

export async function createBudgetPeriod(data: {
  scope_type: BudgetScopeType
  scope_id?: string
  period_type: BudgetPeriodType
  period_label: string
  starts_on: string
  ends_on: string
  total_budget: number
  notes?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Global budgets are admin-only; scoped budgets need the vertical's manager.
  let verticalId: string | null | undefined = null
  if (data.scope_type === 'vertical') verticalId = data.scope_id
  else if (data.scope_type === 'category' && data.scope_id) {
    const { data: cat } = await supabase.from('categories').select('vertical_id').eq('id', data.scope_id).maybeSingle()
    verticalId = cat?.vertical_id
  } else if (data.scope_type === 'channel' && data.scope_id) {
    verticalId = await verticalOfChannel(supabase, data.scope_id)
  }
  await assertCanManage(supabase, user.id, data.scope_type === 'global' ? null : verticalId, 'this budget scope')

  const { data: budget, error } = await supabase
    .from('budget_periods')
    .insert({
      ...data,
      scope_id: data.scope_id || null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw error
  return budget
}

// ============ NOTIFICATIONS ============

export async function markNotificationsRead(notificationIds: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Restrict to the caller's own notifications so a user can't mark someone else's read.
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', notificationIds)
    .eq('user_id', user.id)
  if (error) throw error
}

export async function markAllNotificationsRead() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
  if (error) throw error
}

// ============ FILE UPLOAD ============

export async function uploadResultFile(taskId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const file = formData.get('file') as File
  if (!file) throw new Error('No file provided')
  if (file.size > 2 * 1024 * 1024) throw new Error('File must be under 2MB')

  const ext = file.name.split('.').pop()
  const path = `${taskId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('task-results')
    .upload(path, file)

  if (uploadError) throw uploadError

  // Update task with file path
  await supabase
    .from('tasks')
    .update({ result_file_path: path })
    .eq('id', taskId)

  return path
}

// ============ LEADS CSV IMPORT ============

export async function importLeads(leads: {
  name: string
  email: string
  company: string
  source: string
  generated_date: string
  lead_status: string
  notes?: string
  extra_fields?: Record<string, unknown>
}[], dedup: boolean = true, verticalId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Get THIS vertical's "All leads" channel (every vertical may have one).
  let q = supabase.from('channels').select('id').eq('slug', 'all-leads')
  if (verticalId && verticalId !== 'all') q = q.eq('vertical_id', verticalId)
  const { data: channel } = await q.limit(1).maybeSingle()

  if (!channel) throw new Error('This vertical has no "All leads" channel yet. Add one under Leads Pipeline first.')

  let importedCount = 0
  let skippedCount = 0

  for (const lead of leads) {
    // Dedup check by email
    if (dedup && lead.email) {
      const { data: existing } = await supabase
        .from('tasks')
        .select('id')
        .eq('channel_id', channel.id)
        .contains('planning_fields', { email: lead.email })
        .limit(1)

      if (existing && existing.length > 0) {
        skippedCount++
        continue
      }
    }

    const hasExtras = lead.extra_fields && Object.keys(lead.extra_fields).length > 0

    await supabase.from('tasks').insert({
      channel_id: channel.id,
      title: lead.name,
      description: lead.notes
        ? lead.notes
        : `Lead: ${lead.name} (${lead.email}) from ${lead.source}`,
      priority: 'P2',
      status: 'not_started',
      due_date: lead.generated_date || null,
      planning_fields: {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        source: lead.source,
        source_channel: lead.source,
        generated_date: lead.generated_date,
        lead_status: lead.lead_status,
        notes: lead.notes || '',
        ...(hasExtras ? { extra_fields: lead.extra_fields } : {}),
      },
      created_by: user.id,
    })
    importedCount++
  }

  // Log activity
  await supabase.from('activity_log').insert({
    actor_id: user.id,
    action: 'imported_leads',
    to_value: { imported: importedCount, skipped: skippedCount },
  })

  return { imported: importedCount, skipped: skippedCount }
}

// ============ AUTH ============

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

export async function updateUserRole(userId: string, role: 'admin' | 'member') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Verify current user is admin
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    throw new Error('Only admin can modify user roles')
  }

  const { error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)

  if (error) throw error
}

export async function upsertChannelField(data: {
  id?: string
  channel_id: string
  name: string
  slug: string
  field_type: string
  surface: string
  is_required?: boolean
  options?: string[] | null
  formula?: string | null
  is_auto_calc?: boolean
  description?: string | null
  sort_order?: number
  cascades_to_children?: boolean
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    throw new Error('Unauthorized: Admin role required')
  }

  const payload = {
    channel_id: data.channel_id,
    name: data.name,
    slug: data.slug,
    field_type: data.field_type,
    surface: data.surface,
    is_required: data.is_required ?? false,
    options: data.options || null,
    formula: data.formula || null,
    is_auto_calc: data.is_auto_calc ?? false,
    description: data.description || null,
    sort_order: data.sort_order ?? 0,
    cascades_to_children: data.cascades_to_children ?? true,
  }

  let error
  if (data.id) {
    const { error: updateError } = await supabase
      .from('channel_fields')
      .update(payload)
      .eq('id', data.id)
    error = updateError
  } else {
    const { error: insertError } = await supabase
      .from('channel_fields')
      .insert(payload)
    error = insertError
  }

  if (error) throw error
}

export async function deleteChannelField(fieldId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    throw new Error('Unauthorized: Admin role required')
  }

  const { error } = await supabase
    .from('channel_fields')
    .delete()
    .eq('id', fieldId)

  if (error) throw error
}

export async function disconnectHubSpot() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('hubspot_connection')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // delete all

  if (error) throw error
}

export async function createCategory(data: { vertical_id: string; name: string; icon?: string; sort_order?: number }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!data.vertical_id) throw new Error('A vertical is required')
  await assertCanManage(supabase, user.id, data.vertical_id)

  let slug = data.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
  const { data: existing } = await supabase
    .from('categories').select('id').eq('vertical_id', data.vertical_id).eq('slug', slug).maybeSingle()
  if (existing) {
    slug = `${slug}-${Math.floor(Math.random() * 1000)}`
  }

  const { error } = await supabase
    .from('categories')
    .insert({
      vertical_id: data.vertical_id,
      name: data.name,
      slug,
      icon: data.icon || 'folder',
      sort_order: data.sort_order ?? 0,
      is_active: true
    })

  if (error) throw error
}

export async function updateCategory(data: { id: string; name: string; icon?: string; sort_order?: number; is_active?: boolean }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: cat } = await supabase.from('categories').select('vertical_id').eq('id', data.id).maybeSingle()
  await assertCanManage(supabase, user.id, cat?.vertical_id)

  const { error } = await supabase
    .from('categories')
    .update({
      name: data.name,
      icon: data.icon,
      sort_order: data.sort_order,
      is_active: data.is_active
    })
    .eq('id', data.id)

  if (error) throw error
}

export async function createChannel(data: {
  category_id: string
  parent_channel_id?: string | null
  name: string
  sort_order?: number
  function_id?: string | null
  tier?: string | null
  goal?: string | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: cat } = await supabase.from('categories').select('vertical_id').eq('id', data.category_id).maybeSingle()
  if (!cat) throw new Error('Category not found')
  await assertCanManage(supabase, user.id, cat.vertical_id)

  let slug = data.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
  let query = supabase.from('channels').select('id').eq('category_id', data.category_id).eq('slug', slug)
  if (data.parent_channel_id) {
    query = query.eq('parent_channel_id', data.parent_channel_id)
  } else {
    query = query.is('parent_channel_id', null)
  }
  const { data: existing } = await query.maybeSingle()
  if (existing) {
    slug = `${slug}-${Math.floor(Math.random() * 1000)}`
  }

  const { error } = await supabase
    .from('channels')
    .insert({
      category_id: data.category_id,
      parent_channel_id: data.parent_channel_id || null,
      name: data.name,
      slug,
      sort_order: data.sort_order ?? 0,
      is_active: true,
      // Sub-channels inherit the parent's function in the DB trigger when null.
      function_id: data.function_id || null,
      ...(data.tier !== undefined ? { tier: data.tier || null } : {}),
      ...(data.goal !== undefined ? { goal: data.goal || null } : {}),
    })

  if (error) throw error
}

export async function updateChannel(data: {
  id: string
  name: string
  parent_channel_id?: string | null
  sort_order?: number
  is_active?: boolean
  function_id?: string | null
  tier?: string | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  await assertCanManage(supabase, user.id, await verticalOfChannel(supabase, data.id))

  const { error } = await supabase
    .from('channels')
    .update({
      name: data.name,
      parent_channel_id: data.parent_channel_id === 'none' ? null : data.parent_channel_id,
      sort_order: data.sort_order,
      is_active: data.is_active,
      ...(data.function_id !== undefined ? { function_id: data.function_id || null } : {}),
      ...(data.tier !== undefined ? { tier: data.tier || null } : {}),
    })
    .eq('id', data.id)

  if (error) throw error
}

export async function setChannelFunction(channelId: string, functionId: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  await assertCanManage(supabase, user.id, await verticalOfChannel(supabase, channelId))
  const { data, error } = await supabase
    .from('channels').update({ function_id: functionId }).eq('id', channelId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated')
  return { updated: true }
}

// ============ INVITES ============

export async function inviteUser(email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Invalid email address')
  }
  if (!normalized.endsWith('@lyzr.com')) {
    throw new Error('Only lyzr.com addresses can be invited')
  }

  // Admin-only
  const { data: profile } = await supabase
    .from('users')
    .select('role, display_name')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    throw new Error('Only admins can invite users')
  }

  // If this email already has an account, surface that explicitly.
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()
  if (existingUser) {
    throw new Error('That user is already in the tracker')
  }

  // Upsert pending invite (lets admins re-send by re-inviting).
  const { data: invite, error: inviteErr } = await supabase
    .from('pending_invites')
    .upsert(
      { email: normalized, invited_by: user.id },
      { onConflict: 'email' }
    )
    .select()
    .single()
  if (inviteErr) throw inviteErr

  // Send the email (no-op + console-log if RESEND_API_KEY not set).
  // Static build has no email server; invites resolve on first sign-in regardless.
  const sendInviteEmail = async (..._args: unknown[]) => { console.log('[invite email skipped - no server]'); return { sent: false, error: null as string | null } }
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const result = await sendInviteEmail({
    to: normalized,
    inviterName: profile?.display_name || 'A teammate',
    appUrl,
  })

  await supabase
    .from('pending_invites')
    .update({
      email_sent_at: result.sent ? new Date().toISOString() : null,
      email_send_error: result.error || (result.sent ? null : 'Email provider not configured'),
    })
    .eq('id', invite.id)
  return { invite, emailResult: result }
}

export async function cancelInvite(inviteId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    throw new Error('Only admins can cancel invites')
  }

  const { error } = await supabase
    .from('pending_invites')
    .delete()
    .eq('id', inviteId)
    .is('resolved_user_id', null)
  if (error) throw error
}

// ============ ASSIGN BY EMAIL ============
// Used when an admin/teammate wants to assign a task to someone who hasn't
// signed in yet. If the email already corresponds to a real user, fall through
// to a normal task_assignments insert. Otherwise queue it in pending_assignments
// — the handle_new_user trigger materializes it on first sign-in.

export async function assignTaskByEmail(args: {
  taskId: string
  email: string
  role: AssignmentRole
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const normalized = args.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Invalid email address')
  }

  // Existing user? Do a normal assignment.
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('task_assignments')
      .upsert(
        { task_id: args.taskId, user_id: existing.id, role: args.role, assigned_by: user.id },
        { onConflict: 'task_id,user_id' }
      )
    if (error) throw error
    return { mode: 'assigned' as const, user_id: existing.id }
  }

  // No user yet — queue a pending assignment.
  const { error: pendingErr } = await supabase
    .from('pending_assignments')
    .upsert(
      { task_id: args.taskId, email: normalized, role: args.role, assigned_by: user.id },
      { onConflict: 'task_id,email' }
    )
  if (pendingErr) throw pendingErr

  // Auto-create a pending_invite so the admin doesn't have to do it separately.
  // The user can sign in via Google and everything resolves automatically.
  await supabase
    .from('pending_invites')
    .upsert(
      { email: normalized, invited_by: user.id },
      { onConflict: 'email', ignoreDuplicates: true }
    )

  return { mode: 'pending' as const, email: normalized }
}

// ============ SAVED VIEWS ============
// Per-user named filter/sort configurations for a given page (e.g. the
// Global Tracker). RLS (migration 009) guarantees a user only ever touches
// their own rows; we also stamp user_id explicitly so inserts satisfy the
// WITH CHECK policy.

export async function saveView(args: {
  page: string
  name: string
  config: Record<string, unknown>
  verticalId?: string | null   // null / 'all' = workspace-level view
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const name = args.name.trim()
  if (!name) throw new Error('View name is required')
  if (!args.page.trim()) throw new Error('Page is required')

  const verticalId = args.verticalId && args.verticalId !== 'all' ? args.verticalId : null

  // Re-saving under an existing name overwrites that view. The unique index
  // is expression-based (COALESCE on vertical_id) so it cannot be an upsert
  // target: look up, then update or insert.
  let existingQ = supabase.from('saved_views').select('id').eq('user_id', user.id).eq('page', args.page).eq('name', name)
  existingQ = verticalId ? existingQ.eq('vertical_id', verticalId) : existingQ.is('vertical_id', null)
  const { data: existing } = await existingQ.maybeSingle()

  const row = { user_id: user.id, page: args.page, name, config: args.config, vertical_id: verticalId, updated_at: new Date().toISOString() }
  const { data, error } = existing
    ? await supabase.from('saved_views').update(row).eq('id', existing.id).select().single()
    : await supabase.from('saved_views').insert(row).select().single()

  if (error) throw error
  return data
}

export async function deleteSavedView(viewId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Scope the delete to the caller's own rows so a user can't delete
  // someone else's view even if RLS were ever relaxed.
  const { error } = await supabase
    .from('saved_views')
    .delete()
    .eq('id', viewId)
    .eq('user_id', user.id)

  if (error) throw error
}

// ============ BULK OPERATIONS ============
// Multi-select a set of tasks and apply one action across all of them
// (BACKLOG #20). These reuse the same anon-client + user-JWT path as the
// single-task actions, so RLS still gates every write. Status changes are
// applied one task at a time through updateTask() so that the existing
// activity-log / notification / Slack / recurring side effects all fire,
// matching how a single status change behaves.

export async function bulkUpdateTaskStatus(taskIds: string[], status: TaskStatus) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (taskIds.length === 0) return { updated: 0 }

  let updated = 0
  const errors: string[] = []
  for (const taskId of taskIds) {
    try {
      await updateTask(taskId, { status })
      updated++
    } catch (err: any) {
      errors.push(`${taskId}: ${err?.message || 'failed'}`)
    }
  }

  if (updated === 0 && errors.length > 0) {
    throw new Error(`Failed to update tasks: ${errors[0]}`)
  }
  return { updated, failed: errors.length }
}

export async function bulkSetPrimaryAssignee(taskIds: string[], userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (taskIds.length === 0) return { updated: 0 }

  // Confirm the target user exists (avoids FK errors mid-loop).
  const { data: target } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (!target) throw new Error('Target user not found')

  let updated = 0
  for (const taskId of taskIds) {
    // Only one 'primary' per task is allowed (task_assignments_primary_unique).
    // Demote any existing primary that isn't the new assignee, then upsert the
    // new one as primary. We don't touch other (secondary/tertiary/other) rows.
    await supabase
      .from('task_assignments')
      .update({ role: 'other' })
      .eq('task_id', taskId)
      .eq('role', 'primary')
      .neq('user_id', userId)

    const { error } = await supabase
      .from('task_assignments')
      .upsert(
        { task_id: taskId, user_id: userId, role: 'primary', assigned_by: user.id },
        { onConflict: 'task_id,user_id' }
      )
    if (error) continue

    // 'assigned' notification comes from the task_assignments trigger (020).
    updated++
  }

  return { updated }
}

export async function bulkDeleteTasks(taskIds: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (taskIds.length === 0) return { deleted: 0 }

  // RLS (migration 008) only lets the creator-or-admin delete a task, so this
  // silently no-ops on rows the caller may not delete rather than erroring.
  const { data, error } = await supabase
    .from('tasks')
    .delete()
    .in('id', taskIds)
    .select('id')

  if (error) throw error
  return { deleted: data?.length ?? 0 }
}


// ============ CHANNEL RESOURCES & LEARNINGS (GTM blueprint) ============

export async function addChannelResource(channelId: string, name: string, url: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!name.trim() || !url.trim()) throw new Error('Name and URL are required')

  const { data, error } = await supabase
    .from('channel_resources')
    .insert({ channel_id: channelId, name: name.trim(), url: url.trim(), added_by: user.id })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function deleteChannelResource(resourceId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // RLS (migration 010) restricts deletion to the adder or an admin.
  const { error } = await supabase.from('channel_resources').delete().eq('id', resourceId)
  if (error) throw error
  return { deleted: true }
}

export async function addChannelLearning(channelId: string, body: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!body.trim()) throw new Error('Learning text is required')

  const { data, error } = await supabase
    .from('channel_learnings')
    .insert({ channel_id: channelId, body: body.trim(), added_by: user.id })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function deleteChannelLearning(learningId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('channel_learnings').delete().eq('id', learningId)
  if (error) throw error
  return { deleted: true }
}

export async function addChannelTarget(channelId: string, body: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!body.trim()) throw new Error('Target text is required')

  const { data, error } = await supabase
    .from('channel_targets')
    .insert({ channel_id: channelId, body: body.trim(), added_by: user.id })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function deleteChannelTarget(targetId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('channel_targets').delete().eq('id', targetId)
  if (error) throw error
  return { deleted: true }
}

// ============ CHANNEL OWNERS & DESCRIPTION (admin, RLS-enforced) ============

export async function updateChannelDescription(channelId: string, goal: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('channels')
    .update({ goal: goal?.trim() || null })
    .eq('id', channelId)
    .select('id')

  if (error) throw error
  // RLS silently matches 0 rows for non-admins — surface that as an error.
  if (!data?.length) throw new Error('Only admins or this vertical\'s owners can edit channel details')
  return { updated: true }
}

export async function addChannelOwner(channelId: string, email: string, makePrimary: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const clean = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email')

  const { data: existing, error: readErr } = await supabase
    .from('channel_owners').select('email, sort_order').eq('channel_id', channelId).order('sort_order')
  if (readErr) throw readErr

  // Convention: primary ⇔ sort_order <= 0. Multiple primaries are allowed;
  // each new primary gets a smaller number, each secondary a larger one.
  const sortOrder = makePrimary
    ? (existing?.length ? Math.min(0, ...existing.map(o => o.sort_order)) - 1 : 0)
    : (existing?.length ? Math.max(1, ...existing.map(o => o.sort_order + 1)) : 1)

  const { data: matched } = await supabase.from('users').select('id').eq('email', clean).maybeSingle()
  const { error } = await supabase
    .from('channel_owners')
    .upsert(
      { channel_id: channelId, email: clean, user_id: matched?.id ?? null, sort_order: sortOrder },
      { onConflict: 'channel_id,email' }
    )
  if (error) {
    if (error.code === '42501' || /policy/i.test(error.message)) throw new Error('Only admins or this vertical\'s owners can edit channel owners')
    throw error
  }
  return { added: clean, primary: makePrimary }
}

export async function removeChannelOwner(channelId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('channel_owners').delete().eq('channel_id', channelId).eq('email', email.toLowerCase())
    .select('email')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing removed: only admins or this vertical\'s owners can edit channel owners')
  return { removed: true }
}

export async function setPrimaryChannelOwner(channelId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: existing, error: readErr } = await supabase
    .from('channel_owners').select('email, sort_order').eq('channel_id', channelId).order('sort_order')
  if (readErr) throw readErr
  if (!existing?.length) throw new Error('No owners on this channel')

  const minOrder = Math.min(0, ...existing.map(o => o.sort_order))
  const { data, error } = await supabase
    .from('channel_owners')
    .update({ sort_order: minOrder - 1 })
    .eq('channel_id', channelId)
    .eq('email', email.toLowerCase())
    .select('email')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated: only admins or this vertical\'s owners can edit channel owners')
  return { primary: email }
}

export async function setSecondaryChannelOwner(channelId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: existing, error: readErr } = await supabase
    .from('channel_owners').select('email, sort_order').eq('channel_id', channelId).order('sort_order')
  if (readErr) throw readErr
  if (!existing?.length) throw new Error('No owners on this channel')

  const maxOrder = Math.max(0, ...existing.map(o => o.sort_order))
  const { data, error } = await supabase
    .from('channel_owners')
    .update({ sort_order: maxOrder + 1 })
    .eq('channel_id', channelId)
    .eq('email', email.toLowerCase())
    .select('email')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated: only admins or this vertical\'s owners can edit channel owners')
  return { secondary: email }
}

// ============ TASK OWNERS (add/remove at activity & sub-activity level) ============

export async function addTaskOwner(taskId: string, email: string, role: 'primary' | 'secondary') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const clean = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email')

  // One primary per task: making someone primary demotes the current one.
  if (role === 'primary') {
    await supabase.from('task_assignments')
      .update({ role: 'secondary' }).eq('task_id', taskId).eq('role', 'primary')
    await supabase.from('pending_assignments')
      .update({ role: 'secondary' }).eq('task_id', taskId).eq('role', 'primary').is('resolved_user_id', null)
  }

  const { data: matched } = await supabase.from('users').select('id').eq('email', clean).maybeSingle()
  if (matched) {
    const { error } = await supabase.from('task_assignments')
      .upsert({ task_id: taskId, user_id: matched.id, role, assigned_by: user.id }, { onConflict: 'task_id,user_id' })
    if (error) throw error
  } else {
    const { error } = await supabase.from('pending_assignments')
      .upsert({ task_id: taskId, email: clean, role, assigned_by: user.id }, { onConflict: 'task_id,email' })
    if (error) throw error
  }
  return { email: clean, role, pending: !matched }
}

export async function removeTaskOwner(taskId: string, ref: { userId?: string; email?: string }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  if (ref.userId) {
    const { error } = await supabase.from('task_assignments')
      .delete().eq('task_id', taskId).eq('user_id', ref.userId)
    if (error) throw error
  }
  if (ref.email) {
    const { error } = await supabase.from('pending_assignments')
      .delete().eq('task_id', taskId).eq('email', ref.email.toLowerCase())
    if (error) throw error
  }
  return { removed: true }
}

// ============ RECURRENCE ON EXISTING TASKS ============

export async function makeTaskRecurring(taskId: string, opts: {
  rule: RecurrenceRule
  end: RecurrenceEnd
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: task, error: tErr } = await supabase
    .from('tasks')
    .select('*, assignments:task_assignments(user_id)')
    .eq('id', taskId)
    .single()
  if (tErr) throw tErr
  if (task.recurring_template_id) throw new Error('Task is already recurring')

  const anchor = task.due_date || new Date().toISOString().split('T')[0]
  const { data: template, error } = await supabase
    .from('recurring_templates')
    .insert({
      channel_id: task.channel_id,
      title: task.title,
      description: task.description,
      default_priority: task.priority,
      default_planning_fields: task.planning_fields || {},
      ...recurrenceInsertFields(opts.rule, opts.end),
      starts_on: anchor,
      // Next instance lands ONE interval after this task's due date
      next_due_date: format(advanceRecurrence(new Date(anchor), opts.rule), 'yyyy-MM-dd'),
      default_assignees: (task.assignments || []).map((a: { user_id: string }) => a.user_id),
      created_by: user.id,
    })
    .select()
    .single()
  if (error) throw error

  const { error: linkErr } = await supabase
    .from('tasks')
    .update({ recurring_template_id: template.id })
    .eq('id', taskId)
  if (linkErr) throw linkErr

  return template
}

export async function stopTaskRecurring(taskId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: task } = await supabase
    .from('tasks').select('recurring_template_id').eq('id', taskId).single()
  if (!task?.recurring_template_id) throw new Error('Task is not recurring')

  const { data, error } = await supabase
    .from('recurring_templates')
    .update({ is_active: false })
    .eq('id', task.recurring_template_id)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Only the template creator or an admin can stop it')
  return { stopped: true }
}


// ============ VERTICALS ============
// The workspace's top level. Admins create verticals (via the create_vertical
// RPC so the optional template clone is atomic); admins or the vertical's
// owners edit them. RLS (migration 015) enforces all of this server-side.

export async function createVertical(args: {
  name: string
  slug?: string
  description?: string
  settings?: Partial<VerticalSettings>
  templateId?: string | null
  ownerEmails?: string[]
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!args.name.trim()) throw new Error('Vertical name is required')

  const { data, error } = await supabase.rpc('create_vertical', {
    p_name: args.name.trim(),
    p_slug: args.slug?.trim() || null,
    p_settings: args.settings ? { leads_pipeline: false, weekly_report_builder: false, resources: false, hubspot_contacts: false, ...args.settings } : null,
    p_template_id: args.templateId || null,
    p_owner_emails: (args.ownerEmails || []).map(e => e.trim().toLowerCase()).filter(Boolean),
    p_description: args.description?.trim() || null,
  })
  if (error) {
    if (/forbidden/i.test(error.message)) throw new Error('Only admins can create verticals')
    if (/verticals_slug_key|duplicate key/i.test(error.message)) throw new Error('A vertical with that slug already exists')
    throw error
  }
  return data as string
}

export async function updateVertical(args: {
  id: string
  name?: string
  slug?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  sort_order?: number
  is_active?: boolean
  settings?: Partial<VerticalSettings>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  await assertCanManage(supabase, user.id, args.id)

  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'slug', 'description', 'icon', 'color', 'sort_order', 'is_active'] as const) {
    if (args[k] !== undefined) patch[k] = args[k]
  }
  if (args.settings) {
    const { data: current } = await supabase.from('verticals').select('settings').eq('id', args.id).single()
    patch.settings = { ...(current?.settings || {}), ...args.settings }
  }
  const { data, error } = await supabase.from('verticals').update(patch).eq('id', args.id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated')
  return { updated: true }
}

async function upsertOwnerRow(
  supabase: ReturnType<typeof createClient>,
  table: 'vertical_owners' | 'function_owners',
  keyCol: 'vertical_id' | 'function_id',
  keyVal: string,
  email: string,
  makePrimary: boolean,
) {
  const clean = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email')
  const { data: existing, error: readErr } = await supabase.from(table).select('email, sort_order').eq(keyCol, keyVal)
  if (readErr) throw readErr
  const sortOrder = makePrimary
    ? (existing?.length ? Math.min(0, ...existing.map(o => o.sort_order)) - 1 : 0)
    : (existing?.length ? Math.max(1, ...existing.map(o => o.sort_order + 1)) : 1)
  const { data: matched } = await supabase.from('users').select('id').eq('email', clean).maybeSingle()
  const { error } = await supabase.from(table).upsert(
    { [keyCol]: keyVal, email: clean, user_id: matched?.id ?? null, sort_order: sortOrder },
    { onConflict: `${keyCol},email` },
  )
  if (error) {
    if (error.code === '42501' || /policy/i.test(error.message)) throw new Error('Only admins can edit these owners')
    throw error
  }
  return { added: clean, primary: makePrimary }
}

async function removeOwnerRow(
  supabase: ReturnType<typeof createClient>,
  table: 'vertical_owners' | 'function_owners',
  keyCol: 'vertical_id' | 'function_id',
  keyVal: string,
  email: string,
) {
  const { data, error } = await supabase.from(table).delete().eq(keyCol, keyVal).eq('email', email.toLowerCase()).select('email')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing removed: only admins can edit these owners')
  return { removed: true }
}

async function promoteOwnerRow(
  supabase: ReturnType<typeof createClient>,
  table: 'vertical_owners' | 'function_owners',
  keyCol: 'vertical_id' | 'function_id',
  keyVal: string,
  email: string,
) {
  const { data: existing, error: readErr } = await supabase.from(table).select('email, sort_order').eq(keyCol, keyVal)
  if (readErr) throw readErr
  if (!existing?.length) throw new Error('No owners yet')
  const minOrder = Math.min(0, ...existing.map(o => o.sort_order))
  const { data, error } = await supabase.from(table).update({ sort_order: minOrder - 1 })
    .eq(keyCol, keyVal).eq('email', email.toLowerCase()).select('email')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated: only admins can edit these owners')
  return { primary: email }
}

export async function addVerticalOwner(verticalId: string, email: string, makePrimary: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return upsertOwnerRow(supabase, 'vertical_owners', 'vertical_id', verticalId, email, makePrimary)
}

export async function removeVerticalOwner(verticalId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return removeOwnerRow(supabase, 'vertical_owners', 'vertical_id', verticalId, email)
}

export async function setPrimaryVerticalOwner(verticalId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return promoteOwnerRow(supabase, 'vertical_owners', 'vertical_id', verticalId, email)
}

// ============ VERTICAL RESOURCES ============

export async function addVerticalResource(verticalId: string, groupName: string, name: string, url: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!groupName.trim() || !name.trim() || !url.trim()) throw new Error('Group, name and URL are required')
  await assertCanManage(supabase, user.id, verticalId)
  const clean = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`
  const { data: existing } = await supabase.from('vertical_resources').select('sort_order').eq('vertical_id', verticalId)
  const { data, error } = await supabase
    .from('vertical_resources')
    .insert({
      vertical_id: verticalId, group_name: groupName.trim(), name: name.trim(), url: clean,
      sort_order: existing?.length ? Math.max(0, ...existing.map(r => r.sort_order)) + 1 : 0,
      added_by: user.id,
    })
    .select('*').single()
  if (error) throw error
  return data
}

export async function updateVerticalResource(id: string, patch: { group_name?: string; name?: string; url?: string; sort_order?: number }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('vertical_resources').update(patch).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated: only admins or this vertical\'s owners can edit resources')
  return { updated: true }
}

export async function deleteVerticalResource(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('vertical_resources').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing removed: only admins or this vertical\'s owners can edit resources')
  return { deleted: true }
}

// ============ FUNCTIONS (workspace-wide, admin) ============

export async function createFunction(data: { name: string; icon?: string; sort_order?: number }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!data.name.trim()) throw new Error('Function name is required')
  await assertCanManage(supabase, user.id, null, 'the workspace')
  const slug = data.name.toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const { data: row, error } = await supabase
    .from('functions')
    .insert({ name: data.name.trim(), slug, icon: data.icon || null, sort_order: data.sort_order ?? 0, is_active: true })
    .select('*').single()
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new Error('A function with that name already exists')
    throw error
  }
  return row
}

export async function updateFunction(data: { id: string; name?: string; icon?: string | null; sort_order?: number; is_active?: boolean }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  await assertCanManage(supabase, user.id, null, 'the workspace')
  const { id, ...patch } = data
  const { data: rows, error } = await supabase.from('functions').update(patch).eq('id', id).select('id')
  if (error) throw error
  if (!rows?.length) throw new Error('Nothing updated')
  return { updated: true }
}

export async function deleteFunction(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  await assertCanManage(supabase, user.id, null, 'the workspace')
  const { data, error } = await supabase.from('functions').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing deleted')
  return { deleted: true }
}

export async function addFunctionOwner(functionId: string, email: string, makePrimary: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return upsertOwnerRow(supabase, 'function_owners', 'function_id', functionId, email, makePrimary)
}

export async function removeFunctionOwner(functionId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return removeOwnerRow(supabase, 'function_owners', 'function_id', functionId, email)
}

export async function setPrimaryFunctionOwner(functionId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return promoteOwnerRow(supabase, 'function_owners', 'function_id', functionId, email)
}

// ============ TAXONOMY TEMPLATES ============

export async function saveVerticalAsTemplate(verticalId: string, name: string, slug?: string, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!name.trim()) throw new Error('Template name is required')
  const { data, error } = await supabase.rpc('save_vertical_as_template', {
    p_vertical_id: verticalId,
    p_name: name.trim(),
    p_slug: slug?.trim() || null,
    p_description: description?.trim() || null,
  })
  if (error) {
    if (/forbidden/i.test(error.message)) throw new Error('Only admins or this vertical\'s owners can save it as a template')
    throw error
  }
  return data as string
}

export async function applyTaxonomyTemplate(verticalId: string, templateId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.rpc('apply_taxonomy_template', { p_vertical_id: verticalId, p_template_id: templateId })
  if (error) {
    if (/forbidden/i.test(error.message)) throw new Error('Only admins or this vertical\'s owners can apply a template')
    throw error
  }
  return data as { categories: number; channels: number }
}

export async function deleteTaxonomyTemplate(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('taxonomy_templates').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing deleted: only the creator or an admin can delete a template')
  return { deleted: true }
}


// ============ CAMPAIGNS ============
// Hero items (launch / thunderclap / campaign) shown as banners. Admins create
// workspace-wide ones; vertical managers create theirs; campaign owners edit.

const slugit = (t: string) => t.toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export async function createCampaign(args: {
  vertical_id: string | null
  kind: CampaignKind
  name: string
  headline?: string
  description?: string
  cta_label?: string
  cta_url?: string
  starts_on?: string | null
  ends_on?: string | null
  status?: CampaignStatus
  ask?: string
  color?: string
  ownerEmails?: string[]
  participantEmails?: string[]
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!args.name.trim()) throw new Error('Name is required')
  await assertCanManage(supabase, user.id, args.vertical_id, args.vertical_id ? 'this vertical' : 'the workspace')

  let slug = slugit(args.name)
  const { data: dup } = await supabase.from('campaigns').select('id').eq('slug', slug)
    .filter('vertical_id', args.vertical_id ? 'eq' : 'is', args.vertical_id ?? null).maybeSingle()
  if (dup) slug = `${slug}-${Math.floor(Math.random() * 1000)}`

  const { data: row, error } = await supabase.from('campaigns').insert({
    vertical_id: args.vertical_id, kind: args.kind, name: args.name.trim(), slug,
    headline: args.headline?.trim() || null, description: args.description?.trim() || null,
    cta_label: args.cta_label?.trim() || null, cta_url: args.cta_url?.trim() || null,
    starts_on: args.starts_on || null, ends_on: args.ends_on || null,
    status: args.status || 'upcoming', ask: args.ask?.trim() || null, color: args.color || null,
    created_by: user.id,
  }).select('*').single()
  if (error) throw error

  const emails = (list?: string[]) => [...new Set((list || []).map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))]
  const { data: users } = await supabase.from('users').select('id, email')
  const uid = (e: string) => users?.find(u => u.email.toLowerCase() === e)?.id ?? null
  const owners = emails(args.ownerEmails)
  if (owners.length) {
    const { error: oe } = await supabase.from('campaign_owners').insert(owners.map((email, i) => ({ campaign_id: row.id, email, user_id: uid(email), sort_order: i })))
    if (oe) throw oe
  }
  const parts = emails(args.participantEmails)
  if (parts.length) {
    const { error: pe } = await supabase.from('campaign_participants').insert(parts.map(email => ({ campaign_id: row.id, email, user_id: uid(email) })))
    if (pe) throw pe
  }
  return row
}

export async function updateCampaign(id: string, patch: Partial<{
  kind: CampaignKind; name: string; headline: string | null; description: string | null
  cta_label: string | null; cta_url: string | null; starts_on: string | null; ends_on: string | null
  status: CampaignStatus; is_pinned: boolean; ask: string | null; color: string | null
}>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('campaigns').update(patch).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated: only admins, the vertical\'s owners or the campaign owners can edit it')
  return { updated: true }
}

export async function deleteCampaign(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('campaigns').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing deleted: only admins or the vertical\'s owners can delete a campaign')
  return { deleted: true }
}

export async function setCampaignPeople(id: string, kind: 'owners' | 'participants', emailsIn: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const table = kind === 'owners' ? 'campaign_owners' : 'campaign_participants'
  const emails = [...new Set(emailsIn.map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))]
  const { data: users } = await supabase.from('users').select('id, email')
  const uid = (e: string) => users?.find(u => u.email.toLowerCase() === e)?.id ?? null
  const { data: existing, error: re } = await supabase.from(table).select('email').eq('campaign_id', id)
  if (re) throw re
  const have = new Set((existing || []).map(r => r.email))
  const toAdd = emails.filter(e => !have.has(e))
  const toRemove = [...have].filter(e => !emails.includes(e))
  if (toAdd.length) {
    const rows = toAdd.map((email, i) => kind === 'owners' ? { campaign_id: id, email, user_id: uid(email), sort_order: have.size + i } : { campaign_id: id, email, user_id: uid(email) })
    const { error } = await supabase.from(table).insert(rows)
    if (error) throw error
  }
  if (toRemove.length) {
    const { error } = await supabase.from(table).delete().eq('campaign_id', id).in('email', toRemove)
    if (error) throw error
  }
  return { added: toAdd.length, removed: toRemove.length }
}

// A participant ticks their own thunderclap action (managers can tick anyone).
export async function setParticipantDone(campaignId: string, email: string, done: boolean, proofUrl?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('campaign_participants')
    .update({ done_at: done ? new Date().toISOString() : null, ...(proofUrl !== undefined ? { proof_url: proofUrl || null } : {}) })
    .eq('campaign_id', campaignId).eq('email', email.toLowerCase()).select('email')
  if (error) throw error
  if (!data?.length) throw new Error('You can only tick your own action (or you manage this campaign)')
  return { done }
}

export async function setTaskCampaign(taskId: string, campaignId: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('tasks').update({ campaign_id: campaignId }).eq('id', taskId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing updated')
  return { updated: true }
}


// ============ MEMBERS, BADGES, SUGGESTIONS ============

const cleanEmail = (e: string) => { const x = e.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) throw new Error('Enter a valid email'); return x }

export async function addVerticalMember(verticalId: string, email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const e = cleanEmail(email)
  const { data: u } = await supabase.from('users').select('id').ilike('email', e).maybeSingle()
  const { error } = await supabase.from('vertical_members').upsert({ vertical_id: verticalId, email: e, user_id: u?.id ?? null, added_by: user.id })
  if (error) throw error
  return { email: e }
}

export async function removeVerticalMember(verticalId: string, email: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('vertical_members').delete().eq('vertical_id', verticalId).eq('email', email.toLowerCase()).select('email')
  if (error) throw error
  if (!data?.length) throw new Error('Nothing removed: only admins or the vertical owners can manage members')
  return { removed: true }
}

// Admin and Leadership badges live in email tables so they survive resets and
// apply on first sign-in. Admin also flips users.role for people already in.
export async function setBadge(kind: 'admin' | 'leadership', email: string, on: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const e = cleanEmail(email)
  const table = kind === 'admin' ? 'admin_emails' : 'leadership_emails'
  if (on) {
    const { error } = await supabase.from(table).upsert({ email: e })
    if (error) throw error
  } else {
    if (kind === 'admin' && e === user.email?.toLowerCase()) throw new Error('You cannot remove your own admin badge')
    const { error } = await supabase.from(table).delete().eq('email', e)
    if (error) throw error
  }
  if (kind === 'admin') {
    const { error } = await supabase.from('users').update({ role: on ? 'admin' : 'member' }).ilike('email', e)
    if (error) throw error
  }
  return { email: e, on }
}

export async function suggestTaskEdit(taskId: string, patch: Record<string, unknown>, note?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  if (!Object.keys(patch).length) throw new Error('Nothing to suggest')
  const { data, error } = await supabase.from('task_suggestions')
    .insert({ task_id: taskId, suggested_by: user.id, patch, note: note?.trim() || null }).select('id').single()
  if (error) throw error
  return data
}

// Accepting applies the patch through updateTask (so history + blockers run),
// then marks the suggestion. Only people who can edit the task get past RLS.
export async function resolveTaskSuggestion(id: string, accept: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data: sg, error: re } = await supabase.from('task_suggestions').select('*').eq('id', id).single()
  if (re) throw re
  if (sg.status !== 'pending') throw new Error('Already resolved')
  if (accept) await updateTask(sg.task_id, sg.patch as Parameters<typeof updateTask>[1], { overrideBlockers: true })
  const { data, error } = await supabase.from('task_suggestions')
    .update({ status: accept ? 'accepted' : 'rejected', resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Only the task owners can accept or reject')
  return { accepted: accept }
}

export async function withdrawTaskSuggestion(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('task_suggestions').delete().eq('id', id)
  if (error) throw error
}

export async function deleteNotifications(ids: string[]) {
  const supabase = await createClient()
  const { error } = await supabase.from('notifications').delete().in('id', ids)
  if (error) throw error
}
