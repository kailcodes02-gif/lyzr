'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, CheckSquare, MessageSquare, Calendar as CalendarIcon, Activity, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUsers, useTasks, useRecentActivity, useAllChannelOwners } from '@/lib/hooks/use-data'
import { effectiveOwnerEmails } from '@/lib/effective-owners'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar as DayPicker } from '@/components/ui/calendar'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import type { Mention, Task } from '@/lib/types/database'

type MentionWithTask = Mention & {
  task: Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'channel_id' | 'due_date'> | null
}

function useMentionsByUserId(userId: string | undefined) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['mentions', 'user', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mentions')
        .select('*, task:tasks(id, title, status, priority, channel_id, due_date)')
        .eq('mentioned_user_id', userId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as MentionWithTask[]
    },
  })
}

const SURFACE_LABELS: Record<string, string> = {
  task_description: 'Description',
  task_comment: 'Comment',
  checklist_item: 'Checklist Item',
  blocked_description: 'Blocked Reason',
  insight: 'Insights',
}

function OwnerDetailContent() {
  const email = useSearchParams().get('email') || ''

  const { data: users, isLoading: usersLoading } = useUsers()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: activities } = useRecentActivity(200)
  const { data: channelOwners } = useAllChannelOwners()

  const signedInOwner = useMemo(
    () => users?.find(u => u.email.toLowerCase() === email.toLowerCase()),
    [users, email]
  )
  // People who haven't signed in yet still have pending assignments — show
  // their page with a pseudo profile instead of a dead end.
  const owner = useMemo(() => signedInOwner ?? {
    id: '',
    email: email.toLowerCase(),
    display_name: email.split('@')[0].split('.')[0].replace(/^./, c => c.toUpperCase()),
    avatar_url: null,
    role: 'member' as const,
    created_at: '',
  }, [signedInOwner, email])
  const isPendingOwner = !signedInOwner

  const { data: mentions, isLoading: mentionsLoading } = useMentionsByUserId(owner?.id)

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined)

  if (usersLoading || tasksLoading) {
    return (
      <div className="p-4 lg:p-8 space-y-6 bg-zinc-50 text-zinc-900 min-h-screen animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-4 bg-zinc-200 rounded w-1/3" />
        <div className="h-96 bg-zinc-200 rounded-xl" />
      </div>
    )
  }

  // A task belongs to this owner if they hold a real assignment (signed in)
  // OR an unresolved pending assignment under their email.
  const ownsTask = (t: Task, role?: string) =>
    t.assignments?.some(a => a.user_id === owner.id && owner.id && (!role || a.role === role)) ||
    (t.pending_assignments || []).some(p =>
      !p.resolved_user_id && p.email.toLowerCase() === owner.email && (!role || p.role === role))

  // Plus tasks inherited through the ownership chain
  // (sub-activity → activity → sub-channel → channel).
  const tasksById = new Map((tasks || []).map(t => [t.id, t]))
  const inheritsTask = (t: Task) => {
    if (ownsTask(t)) return false
    const eff = effectiveOwnerEmails(t, tasksById, channelOwners || [], new Map())
    return eff.source !== 'direct' && eff.emails.has(owner.email)
  }

  const assignedTasks = tasks?.filter(t => ownsTask(t) || inheritsTask(t)) ?? []

  const getTasksByRole = (role?: string) => {
    if (!role) return assignedTasks
    return assignedTasks.filter(t => ownsTask(t, role))
  }

  const mentionedTaskIds = new Set((mentions ?? []).map(m => m.task_id))
  const mentionedTasks = (tasks ?? []).filter(t => mentionedTaskIds.has(t.id))

  const calendarTaskMap = new Map<string, Task[]>()
  const calendarTasks = (tasks ?? []).filter(t => {
    if (!t.due_date) return false
    const isAssigned = ownsTask(t)
    const isMentioned = mentionedTaskIds.has(t.id)
    return isAssigned || isMentioned
  })

  for (const t of calendarTasks) {
    if (!t.due_date) continue
    try {
      const key = format(parseISO(t.due_date), 'yyyy-MM-dd')
      if (!calendarTaskMap.has(key)) calendarTaskMap.set(key, [])
      calendarTaskMap.get(key)!.push(t)
    } catch {}
  }

  const calendarDueDates = Array.from(calendarTaskMap.keys()).map(k => parseISO(k))
  const selectedDayKey = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : null
  const tasksForSelectedDay = selectedDayKey ? calendarTaskMap.get(selectedDayKey) ?? [] : []

  const ownerActivities = (activities ?? []).filter(a => a.actor_id === owner.id)

  const initial = (owner.display_name || owner.email).charAt(0).toUpperCase()

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <Link
        href="/owners"
        className="text-xs text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to owners
      </Link>

      <div className="flex items-center gap-4">
        <Avatar className="w-16 h-16 border border-zinc-300">
          <AvatarImage src={owner.avatar_url || ''} />
          <AvatarFallback className="bg-zinc-200 text-zinc-700 text-lg">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 truncate">
            {owner.display_name || owner.email.split('@')[0]}
            {isPendingOwner && (
              <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 px-2 py-0.5">
                Awaiting first sign-in
              </span>
            )}
          </h1>
          <p className="text-sm text-zinc-500 truncate">{owner.email}</p>
        </div>
      </div>

      <Tabs defaultValue="assigned" className="w-full">
        <TabsList className="bg-white border border-zinc-200 p-1 rounded-lg">
          <TabsTrigger value="assigned" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <CheckSquare className="w-4 h-4 mr-2" /> Assigned to me
          </TabsTrigger>
          <TabsTrigger value="mentioned" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <MessageSquare className="w-4 h-4 mr-2" /> Mentioned ({mentionedTasks.length})
          </TabsTrigger>
          <TabsTrigger value="calendar" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <CalendarIcon className="w-4 h-4 mr-2" /> Calendar
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <Activity className="w-4 h-4 mr-2" /> Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assigned" className="mt-6 space-y-6">
          <Tabs defaultValue="all" className="w-full">
            <div className="flex justify-between items-center mb-4">
              <TabsList className="bg-zinc-100 border border-zinc-200 p-0.5 rounded-lg">
                <TabsTrigger value="all" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  All
                </TabsTrigger>
                <TabsTrigger value="primary" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  Primary
                </TabsTrigger>
                <TabsTrigger value="secondary" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  Secondary
                </TabsTrigger>
                <TabsTrigger value="tertiary" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  Tertiary
                </TabsTrigger>
                <TabsTrigger value="other" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  Other
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="all" className="mt-0">
              <TaskView tasks={getTasksByRole()} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="primary" className="mt-0">
              <TaskView tasks={getTasksByRole('primary')} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="secondary" className="mt-0">
              <TaskView tasks={getTasksByRole('secondary')} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="tertiary" className="mt-0">
              <TaskView tasks={getTasksByRole('tertiary')} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="other" className="mt-0">
              <TaskView tasks={getTasksByRole('other')} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="mentioned" className="mt-6">
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardContent className="p-0 overflow-hidden">
              {mentionsLoading ? (
                <div className="p-8 text-center text-sm text-zinc-500">Loading mentions...</div>
              ) : mentionedTasks.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 text-sm">
                  No mentions for this owner yet.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200">
                  {mentionedTasks.map(task => {
                    const taskMentions = (mentions ?? []).filter(m => m.task_id === task.id)
                    return (
                      <div
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className="p-4 hover:bg-zinc-100 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1 min-w-0">
                          <h4 className="text-sm font-medium text-zinc-800 truncate">{task.title}</h4>
                          <div className="flex flex-wrap gap-2 items-center text-xs text-zinc-500">
                            <span>Status: {task.status}</span>
                            <span>{'•'}</span>
                            <span className="text-violet-600">
                              Mentioned in {taskMentions.map(m => SURFACE_LABELS[m.surface] || m.surface).join(', ')}
                            </span>
                          </div>
                        </div>
                        <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300 self-start md:self-auto">
                          View Task
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardContent className="p-3">
                <DayPicker
                  mode="single"
                  selected={selectedDay}
                  onSelect={setSelectedDay}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  modifiers={{ hasTask: calendarDueDates }}
                  modifiersClassNames={{
                    hasTask: 'relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-violet-400',
                  }}
                />
              </CardContent>
            </Card>

            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-zinc-700">
                  <CalendarIcon className="w-4 h-4 text-violet-600" />
                  {selectedDay
                    ? <span>{format(selectedDay, 'EEEE, d MMM yyyy')}</span>
                    : <span className="text-zinc-500">Select a day to see tasks</span>}
                </div>

                {selectedDay ? (
                  tasksForSelectedDay.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-6 text-center">
                      No tasks due on this day.
                    </p>
                  ) : (
                    <div className="divide-y divide-zinc-200 -mx-4">
                      {tasksForSelectedDay.map(task => {
                        const isAssigned = task.assignments?.some(a => a.user_id === owner.id)
                        return (
                          <button
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className="w-full text-left px-4 py-3 hover:bg-zinc-100 transition-colors flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm text-zinc-800 truncate">{task.title}</p>
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                                {task.status} {'·'} {task.priority}
                              </p>
                            </div>
                            <Badge className={isAssigned ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-violet-50 border-violet-500/20 text-violet-600'}>
                              {isAssigned ? 'Assigned' : 'Mentioned'}
                            </Badge>
                          </button>
                        )
                      })}
                    </div>
                  )
                ) : (
                  <div className="text-xs text-zinc-500 space-y-2">
                    <p>{calendarTasks.length} tasks with due dates across assigned and mentioned.</p>
                    {calendarTasks.length > 0 && (
                      <p>Days marked with a dot have tasks.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardContent className="p-6 space-y-6 max-h-[600px] overflow-y-auto pr-2">
              {ownerActivities.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-sm">
                  No recent activity for this owner.
                </div>
              ) : (
                ownerActivities.map(log => (
                  <div key={log.id} className="flex gap-3 text-xs">
                    <div className="p-2 bg-zinc-200 text-zinc-600 rounded-lg shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-zinc-700">
                        <span className="text-zinc-600">
                          {log.action === 'created' && 'Created task'}
                          {log.action === 'status_changed' && 'Updated status of'}
                          {log.action === 'commented' && 'Commented on'}
                          {log.action === 'imported_leads' && 'Imported CSV leads'}
                          {!['created', 'status_changed', 'commented', 'imported_leads'].includes(log.action) && log.action}
                        </span>{' '}
                        <span
                          onClick={() => log.task?.id && setSelectedTaskId(log.task.id)}
                          className="text-blue-600 hover:underline cursor-pointer font-medium"
                        >
                          {log.task?.title || 'a task'}
                        </span>
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {format(new Date(log.created_at), 'd MMM yyyy, h:mm a')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={open => {
            if (!open) setSelectedTaskId(null)
          }}
          onTaskIdChange={setSelectedTaskId}
        />
      )}
    </div>
  )
}


export default function OwnerDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 bg-zinc-50 min-h-screen" />}>
      <OwnerDetailContent />
    </Suspense>
  )
}
