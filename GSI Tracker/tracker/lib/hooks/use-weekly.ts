'use client'

import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'

export interface WeeklySnapshot {
  id: string
  week_starting: string
  total_tasks: number
  completed_tasks: number
  blocked_tasks: number
  live_tasks: number
  in_progress_tasks: number
  not_started_tasks: number
  cancelled_tasks: number
  by_category: Record<string, number> | Array<{ name: string; count: number; by_status?: Record<string, number> }>
  by_owner: Record<string, number> | Array<{ name: string; count: number }>
  budget_summary: {
    total_allocated?: number
    by_bucket?: Array<{
      label: string
      scope_type?: string
      total_budget: number
      allocated: number
      ended_in_week?: boolean
      unspent?: number
    }>
    unspent_callouts?: Array<{ label: string; unspent: number; total_budget: number }>
  } | Record<string, unknown>
  created_at: string
}

export function useWeeklySnapshot(weekStarting: string | null) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['weeklySnapshot', weekStarting],
    enabled: !!weekStarting,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_snapshots')
        .select('*')
        .eq('week_starting', weekStarting!)
        .maybeSingle()
      if (error) throw error
      return data as WeeklySnapshot | null
    },
  })
}

export function useRecentWeeklySnapshots(limit: number) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['weeklySnapshots', 'recent', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_snapshots')
        .select('id, week_starting, total_tasks, completed_tasks, blocked_tasks, live_tasks, created_at')
        .order('week_starting', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data || []) as Pick<
        WeeklySnapshot,
        'id' | 'week_starting' | 'total_tasks' | 'completed_tasks' | 'blocked_tasks' | 'live_tasks' | 'created_at'
      >[]
    },
  })
}
