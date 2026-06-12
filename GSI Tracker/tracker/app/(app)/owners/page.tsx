'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useUsers, useTasks } from '@/lib/hooks/use-data'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Users as UsersIcon, ListTodo, AlertTriangle, Radio, AtSign } from 'lucide-react'
import { parseISO, isBefore, startOfDay } from 'date-fns'
import type { Mention } from '@/lib/types/database'

function useAllMentions() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['mentions', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mentions')
        .select('id, task_id, mentioned_user_id, surface')
      if (error) throw error
      return data as Pick<Mention, 'id' | 'task_id' | 'mentioned_user_id' | 'surface'>[]
    },
  })
}

const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked'])

export default function OwnersPage() {
  const { data: users, isLoading: usersLoading } = useUsers()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: mentions, isLoading: mentionsLoading } = useAllMentions()

  if (usersLoading || tasksLoading || mentionsLoading) {
    return (
      <div className="p-4 lg:p-8 space-y-6 bg-[#0a0a0f] text-zinc-100 min-h-screen animate-pulse">
        <div className="h-8 bg-zinc-800 rounded w-1/4" />
        <div className="h-4 bg-zinc-800 rounded w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-zinc-800/50 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const today = startOfDay(new Date())

  const statsByUserId = new Map<string, { open: number; overdue: number; live: number; mentioned: number }>()

  for (const u of users ?? []) {
    statsByUserId.set(u.id, { open: 0, overdue: 0, live: 0, mentioned: 0 })
  }

  for (const task of tasks ?? []) {
    const assignees = task.assignments?.map(a => a.user_id) ?? []
    const uniqueAssignees = Array.from(new Set(assignees))
    for (const uid of uniqueAssignees) {
      const stats = statsByUserId.get(uid)
      if (!stats) continue
      if (OPEN_STATUSES.has(task.status)) stats.open += 1
      if (task.status === 'live') stats.live += 1
      if (
        task.due_date &&
        task.status !== 'done' &&
        task.status !== 'cancelled'
      ) {
        try {
          if (isBefore(startOfDay(parseISO(task.due_date)), today)) {
            stats.overdue += 1
          }
        } catch {}
      }
    }
  }

  const mentionedTasksByUser = new Map<string, Set<string>>()
  for (const m of mentions ?? []) {
    if (!m.mentioned_user_id) continue
    if (!mentionedTasksByUser.has(m.mentioned_user_id)) {
      mentionedTasksByUser.set(m.mentioned_user_id, new Set())
    }
    mentionedTasksByUser.get(m.mentioned_user_id)!.add(m.task_id)
  }
  for (const [uid, set] of mentionedTasksByUser) {
    const stats = statsByUserId.get(uid)
    if (stats) stats.mentioned = set.size
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-[#0a0a0f] text-zinc-100 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <UsersIcon className="w-6 h-6 text-blue-400" /> Owners
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          People on the marketing team and what they own
        </p>
      </div>

      {(!users || users.length === 0) ? (
        <Card className="bg-zinc-900/30 border-white/5 backdrop-blur-xl">
          <CardContent className="p-12 text-center text-sm text-zinc-500">
            No owners yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {users.map(user => {
            const stats = statsByUserId.get(user.id) ?? { open: 0, overdue: 0, live: 0, mentioned: 0 }
            const initial = (user.display_name || user.email)?.charAt(0).toUpperCase() || '?'
            return (
              <Link
                key={user.id}
                href={`/owners/${encodeURIComponent(user.email)}`}
                className="group"
              >
                <Card className="bg-zinc-900/40 border-white/5 hover:border-white/10 hover:bg-zinc-900/60 transition-all backdrop-blur-xl h-full">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-12 h-12 border border-white/10">
                        <AvatarImage src={user.avatar_url || ''} />
                        <AvatarFallback className="bg-zinc-800 text-zinc-300 text-sm">
                          {initial}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white truncate group-hover:text-blue-300 transition-colors">
                          {user.display_name || user.email.split('@')[0]}
                        </h3>
                        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <StatPill
                        icon={<ListTodo className="w-3.5 h-3.5" />}
                        label="Open"
                        value={stats.open}
                        accent="text-blue-300"
                      />
                      <StatPill
                        icon={<AlertTriangle className="w-3.5 h-3.5" />}
                        label="Overdue"
                        value={stats.overdue}
                        accent={stats.overdue > 0 ? 'text-red-300' : 'text-zinc-400'}
                      />
                      <StatPill
                        icon={<Radio className="w-3.5 h-3.5" />}
                        label="Live"
                        value={stats.live}
                        accent="text-emerald-300"
                      />
                      <StatPill
                        icon={<AtSign className="w-3.5 h-3.5" />}
                        label="Mentioned"
                        value={stats.mentioned}
                        accent="text-violet-300"
                      />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatPill({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/5 border border-white/5 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-zinc-400">
        <span className={accent}>{icon}</span>
        <span>{label}</span>
      </div>
      <span className={`font-semibold ${accent}`}>{value}</span>
    </div>
  )
}
