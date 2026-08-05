import type { Task } from './types/database'

// Multi-homing: a task lives in its home channel (tasks.channel_id) and can
// ALSO appear in extra channels, stored in planning_fields.also_channels.
export function taskChannelIds(t: Task): string[] {
  const extra = (t.planning_fields as Record<string, unknown> | null)?.also_channels as string[] | undefined
  return [t.channel_id, ...(extra || [])]
}

export function taskInScope(t: Task, scopeChannelIds: string[]): boolean {
  return taskChannelIds(t).some(id => scopeChannelIds.includes(id))
}
