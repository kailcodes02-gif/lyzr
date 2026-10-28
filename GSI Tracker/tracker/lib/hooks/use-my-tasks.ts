'use client'

import { useMemo } from 'react'
import { useAllChannelOwners, useChannels, useCurrentUser, useTasks } from '@/lib/hooks/use-data'

// Mine = assigned to me (signed in or still pending by email), or on a
// channel I own when the task has no explicit owner. Shared by My Board and
// the weekly check-in so both agree on what "my work" is.
export function useMyTasks() {
  const { data: me } = useCurrentUser()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const { data: owners } = useAllChannelOwners()

  const myEmail = me?.email.toLowerCase()
  const myChannelIds = useMemo(
    () => new Set((owners || []).filter(o => myEmail && o.email.toLowerCase() === myEmail).map(o => o.channel_id)),
    [owners, myEmail])
  const channelById = useMemo(() => new Map((channels || []).map(c => [c.id, c])), [channels])

  const myTasks = useMemo(() => (tasks || []).filter(t => {
    if (!me) return false
    if (t.assignments?.some(a => a.user_id === me.id)) return true
    if (t.pending_assignments?.some(p => !p.resolved_user_id && p.email.toLowerCase() === myEmail)) return true
    const hasOwner = (t.assignments?.length || 0) > 0 || (t.pending_assignments || []).some(p => !p.resolved_user_id)
    if (hasOwner) return false
    const ch = channelById.get(t.channel_id)
    return myChannelIds.has(t.channel_id) || (!!ch?.parent_channel_id && myChannelIds.has(ch.parent_channel_id))
  }), [tasks, me, myEmail, channelById, myChannelIds])

  return { me, tasks, channels, channelById, myChannelIds, myTasks, isLoading }
}
