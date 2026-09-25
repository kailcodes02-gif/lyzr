import type { NotificationType } from '@/lib/types/database'

// One place for how a notification reads. Payload keys come from the
// client inserts (status_change, mentioned) and the 020 triggers.
const FIELD: Record<string, string> = {
  title: 'title', description: 'description', priority: 'priority', due_date: 'due date', channel_id: 'channel',
  parent_task_id: 'parent', budget_allocated: 'budget', budget_period_id: 'budget period', campaign_id: 'campaign',
  result_url: 'result link', blocked_reason: 'blocker', blocked_by_email: 'blocked by', planning_fields: 'planning fields', tracker_fields: 'tracker fields',
}
const fieldList = (v: unknown) => Array.isArray(v) ? v.map(f => FIELD[String(f)] || String(f)).join(', ') : ''

export function notificationText(type: NotificationType | string, p: Record<string, any>, actor?: string): string {
  const who = actor || 'Someone'
  const t = p?.task_title ? `“${p.task_title}”` : 'a task'
  switch (type) {
    case 'assigned': return `${who} asked you to own ${t}${p?.role ? ` as ${p.role}` : ''}.`
    case 'mentioned': return `${who} mentioned you in ${t}.`
    case 'comment': return `${who} commented on ${t}: “${String(p?.comment_body || '').slice(0, 80)}”`
    case 'status_change': return `${who} moved ${t} from ${p?.from_status} to ${p?.to_status}.`
    case 'task_edited': return `${who} changed ${fieldList(p?.fields) || 'details'} on ${t}.`
    case 'task_created': return `${who} added ${t} on a channel you own.`
    case 'subtask_added': return `${who} added the sub-task “${p?.subtask_title}” under ${t}.`
    case 'checklist': return `${who} ${p?.action === 'done' ? 'ticked' : p?.action === 'reopened' ? 'un-ticked' : 'added'} “${p?.item}” on ${t}.`
    case 'suggestion': return `${who} suggests changing ${fieldList(p?.fields) || 'something'} on ${t}${p?.note ? `: “${p.note}”` : '.'} Accept or reject inside the task.`
    case 'suggestion_resolved': return `Your suggestion on ${t} was ${p?.result}.`
    case 'campaign_ask': return `You are part of ${p?.kind === 'thunderclap' ? 'the thunderclap' : 'the campaign'} “${p?.campaign_name}”${p?.ask ? `: ${p.ask}` : '.'}`
    case 'dependency_completed': return `A task ${t} depends on is done.`
    case 'subtask_completed': return `A sub-task of ${t} is done.`
    case 'parent_blocked': return `A sub-task of ${t} is blocked: ${p?.blocked_reason || 'no reason given'}.`
    case 'budget_overrun_warning': return `Budget warning on ${t}.`
    case 'overdue': return `${t} is overdue.`
    default: return `Update on ${t}.`
  }
}

export function notificationHref(type: string, p: Record<string, any>): string | null {
  if (type === 'campaign_ask' && p?.campaign_id) return `/campaign/?id=${p.campaign_id}`
  return null
}
