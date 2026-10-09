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

// Every vertical was seeded with the same channel set (Content, Events, …),
// so the Lyzr board — which shows every vertical's tasks — would list each
// name once per vertical. Merge same-named channels into one entry (the home
// vertical's copy where it exists) and remember the ids it stands for, so the
// merged channel's page can scope tasks across all of them.
export interface MergedChannels<C extends ChannelLike> {
  channels: C[]
  // merged channel id → every channel id it stands for (itself included)
  twins: Map<string, string[]>
}
type ChannelLike = { id: string; vertical_id: string; slug: string; parent_channel_id: string | null; sort_order: number }

export function mergeChannelsByName<C extends ChannelLike>(channels: C[], homeVerticalId: string): MergedChannels<C> {
  const byId = new Map(channels.map(c => [c.id, c]))
  const keyOf = (c: C): string => {
    const parent = c.parent_channel_id ? byId.get(c.parent_channel_id) : undefined
    return parent ? `${keyOf(parent)}/${c.slug}` : c.slug
  }
  const groups = new Map<string, C[]>()
  for (const c of channels) {
    const k = keyOf(c)
    groups.set(k, [...(groups.get(k) || []), c])
  }
  const keptByKey = new Map<string, C>()
  const twins = new Map<string, string[]>()
  for (const [k, members] of groups) {
    const kept = members.find(m => m.vertical_id === homeVerticalId) || members[0]
    keptByKey.set(k, kept)
    twins.set(kept.id, members.map(m => m.id))
  }
  const merged = [...keptByKey.values()].map(c => {
    if (!c.parent_channel_id) return c
    const parent = byId.get(c.parent_channel_id)
    const keptParent = parent ? keptByKey.get(keyOf(parent)) : undefined
    return keptParent && keptParent.id !== c.parent_channel_id ? { ...c, parent_channel_id: keptParent.id } : c
  }).sort((a, b) => a.sort_order - b.sort_order)
  return { channels: merged, twins }
}
