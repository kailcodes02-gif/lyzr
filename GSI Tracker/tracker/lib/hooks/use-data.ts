'use client'

import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import type {
  User, Category, Channel,
  ChannelOwner, ChannelResource, ChannelLearning, ChannelTarget,
} from '@/lib/types/database'

// ============ AUTH ============

export function useCurrentUser() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['currentUser'],
    // Current user's profile rarely changes mid-session.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return null
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()
      return data as User | null
    },
  })
}

// ============ TAXONOMY ============

export function useCategories() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['categories'],
    // Taxonomy rarely changes; keep it fresh for 10 minutes to avoid refetches on every nav.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      return data as Category[]
    },
  })
}

export function useChannels(categoryId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channels', categoryId],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let query = supabase
        .from('channels')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (categoryId) {
        query = query.eq('category_id', categoryId)
      }
      const { data, error } = await query
      if (error) throw error
      return data as Channel[]
    },
  })
}

// Build a tree of channels from flat list
export function buildChannelTree(channels: Channel[]): Channel[] {
  const map = new Map<string, Channel>()
  const roots: Channel[] = []

  channels.forEach(ch => {
    map.set(ch.id, { ...ch, children: [] })
  })

  channels.forEach(ch => {
    const node = map.get(ch.id)!
    if (ch.parent_channel_id && map.has(ch.parent_channel_id)) {
      map.get(ch.parent_channel_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  })

  return roots
}

// ============ CHANNEL METADATA (GTM blueprint) ============

export function useChannelOwners(channelId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelOwners', channelId],
    enabled: !!channelId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_owners')
        .select('*')
        .eq('channel_id', channelId!)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return data as ChannelOwner[]
    },
  })
}

export function useChannelResources(channelId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelResources', channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_resources')
        .select('*')
        .eq('channel_id', channelId!)
        .order('created_at')
      if (error) throw error
      return data as ChannelResource[]
    },
  })
}

// Every owner on every channel — used for owner inheritance on task cards
// (task -> its sub-channel's owners -> its channel's owners).
export function useAllChannelOwners() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelOwners', 'all'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_owners').select('*').order('sort_order').order('created_at')
      if (error) throw error
      return data as ChannelOwner[]
    },
  })
}

// Union of every email the tracker knows (signed-in users, channel owners,
// pending assignees) — feeds the owner-suggestion datalists.
export function useKnownEmails() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['knownEmails'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [u, co, pa] = await Promise.all([
        supabase.from('users').select('email'),
        supabase.from('channel_owners').select('email'),
        supabase.from('pending_assignments').select('email'),
      ])
      const all = [
        ...(u.data || []), ...(co.data || []), ...(pa.data || []),
      ].map(r => r.email.toLowerCase()).filter(e => e !== 'preview@lyzr.ai')
      return [...new Set(all)].sort()
    },
  })
}

export function useChannelTargets(channelId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelTargets', channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_targets')
        .select('*')
        .eq('channel_id', channelId!)
        .order('sort_order')
      if (error) throw error
      return data as ChannelTarget[]
    },
  })
}

export function useChannelLearnings(channelId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelLearnings', channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_learnings')
        .select('*')
        .eq('channel_id', channelId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ChannelLearning[]
    },
  })
}

// ============ TASKS ============

export function useTasks(filters?: {
  channelId?: string
  categoryId?: string
  status?: string
  assignedTo?: string
  createdBy?: string
  parentTaskId?: string | null
}) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select(`
          *,
          channel:channels!channel_id(*),
          creator:users!created_by(id, email, display_name, avatar_url),
          assignments:task_assignments(*, user:users!user_id(*)),
          pending_assignments:pending_assignments(email, role, resolved_user_id),
          subtasks:tasks!parent_task_id(id, title, description, status, priority, nesting_level, due_date, budget_allocated, planning_fields, assignments:task_assignments(user_id, role, user:users!user_id(display_name, avatar_url)), pending_assignments:pending_assignments(email, role, resolved_user_id))
        `)
        .order('created_at', { ascending: false })

      if (filters?.channelId) {
        query = query.eq('channel_id', filters.channelId)
      }
      if (filters?.categoryId) {
        query = query.eq('channel.category_id', filters.categoryId)
      }
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }
      if (filters?.parentTaskId === null) {
        query = query.is('parent_task_id', null)
      } else if (filters?.parentTaskId) {
        query = query.eq('parent_task_id', filters.parentTaskId)
      }

      const { data, error } = await query
      if (error) throw error
      return data as Task[]
    },
  })
}

export function useTask(taskId: string | null) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['task', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          *,
          channel:channels!channel_id(*, category:categories!category_id(*), parent_channel:parent_channel_id(id, name, slug)),
          creator:users!created_by(id, email, display_name, avatar_url),
          assignments:task_assignments(*, user:users!user_id(*)),
          pending_assignments:pending_assignments(email, role, resolved_user_id),
          subtasks:tasks!parent_task_id(id, title, description, status, priority, nesting_level, channel_id, due_date, budget_allocated, planning_fields, pending_assignments:pending_assignments(email, role, resolved_user_id), assignments:task_assignments(user_id, role, user:users!user_id(display_name))),
          checklist_items(* ),
          comments:task_comments(*, user:users(*))
        `)
        .eq('id', taskId!)
        .single()
      if (error) throw error
      return data as Task
    },
  })
}

// ============ TASKS BY CHANNEL (with category join) ============

export function useTasksByChannel(channelIds: string[]) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['tasks', 'channels', channelIds],
    enabled: channelIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          *,
          channel:channels!channel_id(*),
          creator:users!created_by(id, email, display_name, avatar_url),
          assignments:task_assignments(*, user:users!user_id(*))
        `)
        .in('channel_id', channelIds)
        .is('parent_task_id', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Task[]
    },
  })
}

// ============ USERS ============

export function useUsers() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['users'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('display_name')
      if (error) throw error
      return data as User[]
    },
  })
}

// ============ INVITES ============

export function usePendingInvites() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['pendingInvites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_invites')
        .select('*, inviter:users!invited_by(display_name, email)')
        .is('resolved_user_id', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

// ============ BUDGETS ============

export function useBudgetPeriods() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['budgetPeriods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_period_summary')
        .select('*')
        .order('starts_on', { ascending: false })
      if (error) throw error
      return data as BudgetPeriodSummary[]
    },
  })
}

// ============ NOTIFICATIONS ============

export function useNotifications() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['notifications'],
    refetchInterval: 90 * 1000, // 90s — was 30s; reduces server load by 3x
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('notifications')
        .select('*, task:tasks(id, title)')
        .eq('user_id', user.id)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as Notification[]
    },
  })
}

// ============ ACTIVITY ============

export function useRecentActivity(limit = 20) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, actor:users!actor_id(id, display_name, avatar_url), task:tasks(id, title)')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data as ActivityLog[]
    },
  })
}

// ============ MENTIONS ============

export function useMentionsForUser() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['myMentions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('mentions')
        .select('*, task:tasks(id, title, status, priority, channel_id)')
        .eq('mentioned_user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Mention[]
    },
  })
}

export function useChannelFields(channelId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelFields', channelId],
    queryFn: async () => {
      let query = supabase
        .from('channel_fields')
        .select('*')
        .order('sort_order')
      if (channelId) {
        query = query.eq('channel_id', channelId)
      }
      const { data, error } = await query
      if (error) throw error
      return data as ChannelField[]
    },
  })
}

// ============ SAVED VIEWS ============

export function useSavedViews(page: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['savedViews', page],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('saved_views')
        .select('*')
        .eq('user_id', user.id)
        .eq('page', page)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as SavedView[]
    },
  })
}

export function useHubSpotConnection() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['hubspotConnection'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hubspot_connection')
        .select('*, connector:users!connected_by(display_name, email)')
        .order('connected_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useHubSpotSyncedContacts() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['hubspotSyncedContacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hubspot_synced_contacts')
        .select('*')
        .order('synced_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

// Re-export types for convenience
import type {
  Task, BudgetPeriodSummary, Notification, ActivityLog, Mention, ChannelField, SavedView
} from '@/lib/types/database'



