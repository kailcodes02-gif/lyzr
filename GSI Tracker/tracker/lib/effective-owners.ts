import type { Task, ChannelOwner } from './types/database'

// The ownership inheritance chain, shared by My Tasks / Owner pages / cards:
//   1. the task's own owners (signed-in assignments + pending emails)
//   2. else its parent activity's effective owners
//   3. else its sub-channel's owners
//   4. else its channel's owners
export type OwnerSource = 'direct' | 'activity' | 'channel' | 'none'

export function effectiveOwnerEmails(
  task: Task,
  tasksById: Map<string, Task>,
  channelOwners: ChannelOwner[],
  emailByUserId: Map<string, string>,
  depth = 0
): { emails: Set<string>; source: OwnerSource } {
  const direct = new Set<string>()
  task.assignments?.forEach(a => {
    const e = a.user?.email || emailByUserId.get(a.user_id)
    if (e) direct.add(e.toLowerCase())
  })
  task.pending_assignments?.forEach(p => {
    if (!p.resolved_user_id) direct.add(p.email.toLowerCase())
  })
  if (direct.size) return { emails: direct, source: 'direct' }

  if (task.parent_task_id && depth < 3) {
    const parent = tasksById.get(task.parent_task_id)
    if (parent) {
      const up = effectiveOwnerEmails(parent, tasksById, channelOwners, emailByUserId, depth + 1)
      if (up.emails.size) return { emails: up.emails, source: up.source === 'direct' ? 'activity' : up.source }
    }
  }

  const ownersOf = (chId?: string | null) =>
    channelOwners.filter(o => o.channel_id === chId).map(o => o.email.toLowerCase())
  let ch = ownersOf(task.channel_id)
  if (!ch.length && task.channel?.parent_channel_id) ch = ownersOf(task.channel.parent_channel_id)
  if (ch.length) return { emails: new Set(ch), source: 'channel' }

  return { emails: new Set(), source: 'none' }
}
