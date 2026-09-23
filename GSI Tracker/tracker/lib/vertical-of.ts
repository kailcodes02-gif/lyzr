import type { Task, Channel } from './types/database'
import { taskChannelIds } from './task-channels'

// Pure helpers to answer "which vertical does this belong to?" without
// a network round-trip. Channels carry a denormalised vertical_id, so a
// task's home vertical is its channel's; multi-homed tasks (also_channels)
// may additionally SHOW in other verticals.

export function verticalIdOfChannel(channelId: string, channelById: Map<string, Channel>): string | null {
  return channelById.get(channelId)?.vertical_id ?? null
}

export function homeVerticalOfTask(task: Task, channelById: Map<string, Channel>): string | null {
  if (task.channel?.vertical_id) return task.channel.vertical_id
  return verticalIdOfChannel(task.channel_id, channelById)
}

// Every vertical a task appears in: home + any vertical it is multi-homed into.
export function verticalsOfTask(task: Task, channelById: Map<string, Channel>): Set<string> {
  const out = new Set<string>()
  for (const chId of taskChannelIds(task)) {
    const v = verticalIdOfChannel(chId, channelById)
    if (v) out.add(v)
  }
  const home = homeVerticalOfTask(task, channelById)
  if (home) out.add(home)
  return out
}

export function taskInVertical(task: Task, verticalId: string | 'all', channelById: Map<string, Channel>): boolean {
  if (verticalId === 'all') return true
  return verticalsOfTask(task, channelById).has(verticalId)
}
