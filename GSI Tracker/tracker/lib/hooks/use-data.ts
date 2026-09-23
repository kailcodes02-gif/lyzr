'use client'

import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import type {
  User, Category, Channel,
  ChannelOwner, ChannelResource, ChannelLearning, ChannelTarget,
  Vertical, VerticalOwner, Fn, FunctionOwner, VerticalResource, TaxonomyTemplate,
  EffectiveChannelOwner,
} from '@/lib/types/database'
import { taskChannelIds } from '@/lib/task-channels'

// A vertical scope: a vertical id, or 'all' for workspace-wide views.
export type VerticalScope = string | 'all'

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

// ============ VERTICALS ============

export function useVerticals(includeInactive = false) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['verticals', includeInactive],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from('verticals').select('*').order('sort_order').order('name')
      if (!includeInactive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data as Vertical[]
    },
  })
}

export function useVertical(slug?: string | null) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['vertical', slug],
    enabled: !!slug && slug !== 'all',
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('verticals').select('*').eq('slug', slug!).maybeSingle()
      if (error) throw error
      return data as Vertical | null
    },
  })
}

export function useVerticalOwners(verticalId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['verticalOwners', verticalId],
    enabled: !!verticalId && verticalId !== 'all',
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vertical_owners').select('*').eq('vertical_id', verticalId!).order('sort_order').order('created_at')
      if (error) throw error
      return data as VerticalOwner[]
    },
  })
}

export function useAllVerticalOwners() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['verticalOwners', 'all'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vertical_owners').select('*').order('sort_order')
      if (error) throw error
      return data as VerticalOwner[]
    },
  })
}

// Ids of the verticals the signed-in user owns (admins manage every vertical
// but this only lists explicit ownership rows).
export function useMyVerticalIds() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['myVerticalIds'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return [] as string[]
      const { data, error } = await supabase.from('vertical_owners').select('vertical_id').eq('user_id', user.id)
      if (error) throw error
      return (data || []).map(r => r.vertical_id as string)
    },
  })
}

export function useVerticalResources(verticalId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['verticalResources', verticalId],
    enabled: !!verticalId && verticalId !== 'all',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vertical_resources').select('*').eq('vertical_id', verticalId!).order('sort_order').order('created_at')
      if (error) throw error
      return data as VerticalResource[]
    },
  })
}

export function useTaxonomyTemplates() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['taxonomyTemplates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('taxonomy_templates').select('*').order('name')
      if (error) throw error
      return data as TaxonomyTemplate[]
    },
  })
}

// ============ FUNCTIONS ============

export function useFunctions(includeInactive = false) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['functions', includeInactive],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from('functions').select('*').order('sort_order').order('name')
      if (!includeInactive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data as Fn[]
    },
  })
}

export function useFunctionOwners(functionId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['functionOwners', functionId],
    enabled: !!functionId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('function_owners').select('*').eq('function_id', functionId!).order('sort_order').order('created_at')
      if (error) throw error
      return data as FunctionOwner[]
    },
  })
}

export function useAllFunctionOwners() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['functionOwners', 'all'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('function_owners').select('*').order('sort_order')
      if (error) throw error
      return data as FunctionOwner[]
    },
  })
}

// ============ TAXONOMY ============

export function useCategories(verticalId: VerticalScope = 'all') {
  const supabase = createClient()
  return useQuery({
    queryKey: ['categories', verticalId],
    // Taxonomy rarely changes; keep it fresh for 10 minutes to avoid refetches on every nav.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let query = supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (verticalId !== 'all') query = query.eq('vertical_id', verticalId)
      const { data, error } = await query
      if (error) throw error
      return data as Category[]
    },
  })
}

export function useChannels(verticalId: VerticalScope = 'all', categoryId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channels', verticalId, categoryId],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let query = supabase
        .from('channels')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (verticalId !== 'all') query = query.eq('vertical_id', verticalId)
      if (categoryId) query = query.eq('category_id', categoryId)
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

// Memo-friendly lookup maps across the WHOLE workspace: which vertical a
// channel/category/task belongs to. Cheap (a few hundred rows).
export function useVerticalLookup() {
  const { data: verticals } = useVerticals(true)
  const { data: channels } = useChannels('all')
  const { data: categories } = useCategories('all')
  const verticalById = new Map<string, Vertical>()
  verticals?.forEach(v => verticalById.set(v.id, v))
  const channelById = new Map<string, Channel>()
  channels?.forEach(c => channelById.set(c.id, c))
  const categoryById = new Map<string, Category>()
  categories?.forEach(c => categoryById.set(c.id, c))
  return {
    verticals: verticals || [],
    verticalById,
    channelById,
    categoryById,
    verticalOfChannel: (channelId: string | null | undefined) =>
      channelId ? verticalById.get(channelById.get(channelId)?.vertical_id || '') || null : null,
    ready: !!verticals && !!channels && !!categories,
  }
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

// Owners as the app should treat them: explicit channel owners, else the
// parent channel's, else the channel function's owners (DB view).
export function useEffectiveChannelOwners(channelId?: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['effectiveChannelOwners', channelId],
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('effective_channel_owners').select('*').eq('channel_id', channelId!).order('sort_order')
      if (error) throw error
      return data as EffectiveChannelOwner[]
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

// Every effective owner on every channel — used for owner inheritance on
// task cards (task -> its sub-channel's owners -> its channel's owners ->
// its function's owners). Reads the effective_channel_owners view so the
// function fallback comes for free.
export function useAllChannelOwners() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelOwners', 'all'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('effective_channel_owners').select('*').order('sort_order')
      if (error) throw error
      return data as EffectiveChannelOwner[]
    },
  })
}

// External collaborators (outside @lyzr.ai) who should always appear in
// owner suggestions even before their first sign-in or assignment.
const EXTRA_KNOWN_EMAILS = [
  'isha@whitepath.in', // White Path (ads agency)
  'anand@lyzr.ai',
  'skanda@lyzr.ai',
]

// Union of every email the tracker knows (signed-in users, channel /
// vertical / function owners, pending assignees) — feeds the owner-suggestion datalists.
export function useKnownEmails() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['knownEmails'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [u, co, pa, vo, fo] = await Promise.all([
        supabase.from('users').select('email'),
        supabase.from('channel_owners').select('email'),
        supabase.from('pending_assignments').select('email'),
        supabase.from('vertical_owners').select('email'),
        supabase.from('function_owners').select('email'),
      ])
      const all = [
        ...(u.data || []), ...(co.data || []), ...(pa.data || []), ...(vo.data || []), ...(fo.data || []),
      ].map(r => r.email.toLowerCase()).filter(e => e !== 'preview@lyzr.ai')
      return [...new Set([...all, ...EXTRA_KNOWN_EMAILS])].sort()
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

// Channel ids belonging to a vertical (used to scope tasks client-side so
// tasks multi-homed INTO the vertical via also_channels still show up).
async function verticalChannelIds(supabase: ReturnType<typeof createClient>, verticalId: string) {
  const { data, error } = await supabase.from('channels').select('id').eq('vertical_id', verticalId)
  if (error) throw error
  return new Set((data || []).map(r => r.id as string))
}

export function useTasks(filters?: {
  channelId?: string
  categoryId?: string
  status?: string
  assignedTo?: string
  createdBy?: string
  parentTaskId?: string | null
  verticalId?: VerticalScope
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
      let tasks = data as Task[]

      // Category filter used to target the embedded resource without an
      // inner join, which never removed rows. Filter client-side instead.
      if (filters?.categoryId) {
        tasks = tasks.filter(t => t.channel?.category_id === filters.categoryId)
      }
      if (filters?.verticalId && filters.verticalId !== 'all') {
        const ids = await verticalChannelIds(supabase, filters.verticalId)
        tasks = tasks.filter(t => taskChannelIds(t).some(id => ids.has(id)))
      }
      return tasks
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

// Scoped: the vertical's own rows PLUS workspace-global rows (vertical_id NULL).
export function useBudgetPeriods(verticalId: VerticalScope = 'all') {
  const supabase = createClient()
  return useQuery({
    queryKey: ['budgetPeriods', verticalId],
    queryFn: async () => {
      let query = supabase
        .from('budget_period_summary')
        .select('*')
        .order('starts_on', { ascending: false })
      if (verticalId !== 'all') query = query.or(`vertical_id.eq.${verticalId},vertical_id.is.null`)
      const { data, error } = await query
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

export function useRecentActivity(limit = 20, verticalId: VerticalScope = 'all') {
  const supabase = createClient()
  return useQuery({
    queryKey: ['activity', limit, verticalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, actor:users!actor_id(id, display_name, avatar_url), task:tasks(id, title, channel_id)')
        .order('created_at', { ascending: false })
        // Over-fetch when scoping so a busy sibling vertical cannot starve the list.
        .limit(verticalId === 'all' ? limit : limit * 4)
      if (error) throw error
      let rows = data as ActivityLog[]
      if (verticalId !== 'all') {
        const ids = await verticalChannelIds(supabase, verticalId)
        rows = rows.filter(r => !r.task?.channel_id || ids.has(r.task.channel_id)).slice(0, limit)
      }
      return rows
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

export function useChannelFields(channelId?: string, verticalId: VerticalScope = 'all') {
  const supabase = createClient()
  return useQuery({
    queryKey: ['channelFields', channelId, verticalId],
    queryFn: async () => {
      let query = supabase
        .from('channel_fields')
        .select(verticalId === 'all' ? '*' : '*, channel:channels!channel_id!inner(vertical_id)')
        .order('sort_order')
      if (channelId) {
        query = query.eq('channel_id', channelId)
      }
      if (verticalId !== 'all') query = query.eq('channel.vertical_id', verticalId)
      const { data, error } = await query
      if (error) throw error
      return data as unknown as ChannelField[]
    },
  })
}

// ============ SAVED VIEWS ============

export function useSavedViews(page: string, verticalId: VerticalScope = 'all') {
  const supabase = createClient()
  return useQuery({
    queryKey: ['savedViews', page, verticalId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      let query = supabase
        .from('saved_views')
        .select('*')
        .eq('user_id', user.id)
        .eq('page', page)
        .order('created_at', { ascending: true })
      query = verticalId === 'all' ? query.is('vertical_id', null) : query.eq('vertical_id', verticalId)
      const { data, error } = await query
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
