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

// Owners who exist only as pending assignments / channel ownership (haven't
// signed in yet, so they have no users row). Shown so the team roster is
// complete before everyone's first login.
function usePendingOwners() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['pendingOwners'],
    queryFn: async () => {
      const [pa, co] = await Promise.all([
        supabase.from('pending_assignments').select('email').is('resolved_user_id', null),
        supabase.from('channel_owners').select('email').is('user_id', null),
      ])
      if (pa.error) throw pa.error
      if (co.error) throw co.error
      const taskCounts = new Map<string, number>()
      for (const row of pa.data) taskCounts.set(row.email, (taskCounts.get(row.email) || 0) + 1)
      const channelCounts = new Map<string, number>()
      for (const row of co.data) channelCounts.set(row.email, (channelCounts.get(row.email) || 0) + 1)
      const emails = new Set([...taskCounts.keys(), ...channelCounts.keys()])
      return [...emails].sort().map(email => ({
        email,
        pendingTasks: taskCounts.get(email) || 0,
        channels: channelCounts.get(email) || 0,
      }))
    },
  })
}

// Dev-only preview account (app/api/dev-login) — not a real teammate.
const HIDDEN_EMAILS = new Set(['preview@lyzr.ai'])

const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked'])

export default function OwnersPage() {
  const { data: allUsers, isLoading: usersLoading } = useUsers()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: mentions, isLoading: mentionsLoading } = useAllMentions()
  const { data: pendingOwners } = usePendingOwners()
  const users = allUsers?.filter(u => !HIDDEN_EMAILS.has(u.email))

  if (usersLoading || tasksLoading || mentionsLoading) {
    return (
      <div className="p-4 lg:p-8 space-y-6 bg-zinc-50 text-zinc-900 min-h-screen animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-4 bg-zinc-200 rounded w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-zinc-200/60 rounded-xl" />
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
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <UsersIcon className="w-6 h-6 text-blue-600" /> Owners
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          People on the marketing team and what they own
        </p>
      </div>

      {(!users || users.length === 0) ? (
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
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
                <Card className="bg-white border-zinc-200 hover:border-zinc-300 hover:bg-white transition-all backdrop-blur-xl h-full">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-12 h-12 border border-zinc-300">
                        <AvatarImage src={user.avatar_url || ''} />
                        <AvatarFallback className="bg-zinc-200 text-zinc-700 text-sm">
                          {initial}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-zinc-900 truncate group-hover:text-blue-600 transition-colors">
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
                        accent="text-blue-600"
                      />
                      <StatPill
                        icon={<AlertTriangle className="w-3.5 h-3.5" />}
                        label="Overdue"
                        value={stats.overdue}
                        accent={stats.overdue > 0 ? 'text-red-600' : 'text-zinc-600'}
                      />
                      <StatPill
                        icon={<Radio className="w-3.5 h-3.5" />}
                        label="Live"
                        value={stats.live}
                        accent="text-emerald-600"
                      />
                      <StatPill
                        icon={<AtSign className="w-3.5 h-3.5" />}
                        label="Mentioned"
                        value={stats.mentioned}
                        accent="text-violet-600"
                      />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {pendingOwners && pendingOwners.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-700">Awaiting first sign-in</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Already own channels and tasks — everything attaches automatically the first time they sign in with Google.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {pendingOwners.map(p => (
              <Link key={p.email} href={`/owners/${encodeURIComponent(p.email)}`} className="group">
              <Card className="bg-white border-zinc-200 border-dashed backdrop-blur-xl h-full group-hover:border-zinc-300 transition-all">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-12 h-12 border border-dashed border-zinc-300">
                      <AvatarFallback className="bg-white text-zinc-500 text-sm">
                        {p.email.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-zinc-600 truncate capitalize">
                        {p.email.split('@')[0].split('.')[0]}
                      </h3>
                      <p className="text-xs text-zinc-600 truncate">{p.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded-md bg-zinc-100 border border-zinc-200 px-2 py-1">
                      {p.pendingTasks} task{p.pendingTasks === 1 ? '' : 's'} waiting
                    </span>
                    <span className="rounded-md bg-zinc-100 border border-zinc-200 px-2 py-1">
                      {p.channels} channel{p.channels === 1 ? '' : 's'}
                    </span>
                  </div>
                </CardContent>
              </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <UnassignedTasksSection tasks={tasks} />
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
    <div className="flex items-center justify-between rounded-lg bg-zinc-100 border border-zinc-200 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-zinc-600">
        <span className={accent}>{icon}</span>
        <span>{label}</span>
      </div>
      <span className={`font-semibold ${accent}`}>{value}</span>
    </div>
  )
}

// Tasks with no direct owner (no assignment, no unresolved pending row).
// They still inherit channel owners for display, but this list is the
// operator's queue of work nobody has explicitly picked up.
function UnassignedTasksSection({ tasks }: { tasks?: import('@/lib/types/database').Task[] }) {
  const unassigned = (tasks || []).filter(t =>
    t.status !== 'done' && t.status !== 'cancelled' &&
    !(t.assignments?.length) &&
    !(t.pending_assignments || []).some(p => !p.resolved_user_id)
  )
  if (!unassigned.length) return null
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-700">Unassigned tasks ({unassigned.length})</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          No direct owner yet — they display their channel&apos;s owners until someone is assigned.
        </p>
      </div>
      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 divide-y divide-zinc-200">
          {unassigned.map(t => (
            <Link key={t.id} href={`/channel/${t.channel_id}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-zinc-50 transition-colors">
              <div className="min-w-0">
                <p className="text-sm text-zinc-800 truncate">{t.title}</p>
                <p className="text-[11px] text-zinc-500 truncate">{t.channel?.name || 'Unknown channel'}</p>
              </div>
              <span className="text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600">
                {t.priority}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
