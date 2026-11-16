// Ask and reply on a task (migration 038).
//
// "Assigned by" asks for a priority and a due date. "Assigned to" (the primary
// person) replies: accepts them, or comes back with their own. Both pairs stay
// on the task; the task itself runs on the reply once there is one.
import type { Task, TaskPriority } from '@/lib/types/database'

export const PRIORITY_NAMES: Record<string, string> = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low', P4: 'Backlog' }

export function primaryAssignee(task: Task) {
  return task.assignments?.find(a => a.role === 'primary') || null
}

// People the task is assigned to (primary first), and the people helping.
export function assignedTo(task: Task) {
  const rows = (task.assignments || []).filter(a => a.role === 'primary' || a.role === 'secondary')
  return rows.sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
}
export function contributors(task: Task) {
  return (task.assignments || []).filter(a => a.role !== 'primary' && a.role !== 'secondary')
}

export function isSelfAssigned(task: Task) {
  const p = primaryAssignee(task)
  return !!p && p.user_id === task.created_by
}

const open = (t: Task) => t.status !== 'done' && t.status !== 'cancelled'

export interface AskState {
  /** The database has the ask/reply columns (false before migration 038). */
  tracked: boolean
  askedPriority: TaskPriority
  askedDue: string | null
  repliedPriority: TaskPriority | null
  repliedDue: string | null
  /** Assigned to someone else who has not answered yet. */
  awaiting: boolean
  replied: boolean
  /** Replied, and the reply is not what was asked. */
  differs: boolean
  priorityDiffers: boolean
  dueDiffers: boolean
  self: boolean
}

export function askState(task: Task): AskState {
  const tracked = task.requested_priority !== undefined
  const askedPriority = (task.requested_priority || task.priority) as TaskPriority
  const askedDue = tracked ? (task.requested_due_date ?? null) : task.due_date
  const self = isSelfAssigned(task)
  const hasPrimary = !!primaryAssignee(task) || (task.pending_assignments || []).some(p => p.role === 'primary' && !p.resolved_user_id)
  const replied = tracked && !!task.replied_at
  const awaiting = tracked && !replied && hasPrimary && !self && open(task)
  const repliedPriority = replied ? ((task.replied_priority || task.priority) as TaskPriority) : null
  const repliedDue = replied ? (task.replied_due_date ?? null) : null
  const priorityDiffers = replied && !self && repliedPriority !== askedPriority
  const dueDiffers = replied && !self && (repliedDue || '') !== (askedDue || '')
  return { tracked, askedPriority, askedDue, repliedPriority, repliedDue, awaiting, replied, differs: priorityDiffers || dueDiffers, priorityDiffers, dueDiffers, self }
}

// Tasks waiting for this person's reply: they are the primary person on it,
// someone else assigned it, and they have not answered.
export function needsMyReply(task: Task, userId?: string | null) {
  if (!userId) return false
  const p = primaryAssignee(task)
  return !!p && p.user_id === userId && askState(task).awaiting
}

// Tasks this person assigned to others that are still waiting for a reply.
export function awaitingTheirReply(task: Task, userId?: string | null) {
  return !!userId && task.created_by === userId && askState(task).awaiting
}

export function shortDate(d?: string | null) {
  if (!d) return 'No date'
  const dt = new Date(d.length <= 10 ? d + 'T00:00:00' : d)
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
