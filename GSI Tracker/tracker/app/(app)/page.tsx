'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, isBefore, isToday, parseISO, startOfDay } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { Plus, CheckSquare, AlertCircle, Radio, CalendarRange, Activity, Calendar, Building2, Table2 } from 'lucide-react'
import {
  useCurrentUser, useTasks, useVerticals, useAllVerticalOwners, useUsers, useChannels, useRecentActivity, useMentionsForUser,
} from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { KpiTile } from '@/components/ui/kpi-tile'
import { InfoTip } from '@/components/ui/info-tip'
import { VerticalCard } from '@/components/workspace/vertical-card'
import { MyBoard } from '@/components/workspace/my-board'
import { CampaignBanner } from '@/components/campaigns/campaign-banner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { bucketWeek, currentWeek, OPEN_STATUSES } from '@/lib/week-logic'
import { STATUS_CONFIG, type Task } from '@/lib/types/database'

const IST = 'Asia/Kolkata'

export default function HomePage() {
  const { data: user, isLoading } = useCurrentUser()
  const { ownedVerticalIds, isAdmin, resolving } = useVertical()
  if (isLoading || resolving) return <div className="p-8 animate-pulse"><div className="h-8 w-1/4 bg-zinc-200 rounded" /></div>
  if (!user) return null
  if (isAdmin || ownedVerticalIds.size > 0) return <WorkspaceHomePage />
  return <MyBoard showFullWorkspaceLink />
}

function WorkspaceHomePage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { verticals, ownedVerticalIds, isAdmin } = useVertical()
  const { data: tasks, isLoading: tasksLoading } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const { data: owners } = useAllVerticalOwners()
  const { data: users } = useUsers()
  const { data: mentions } = useMentionsForUser()
  const { data: activities } = useRecentActivity(15, 'all')
  useVerticals()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const chVertical = useMemo(() => new Map((channels || []).map(c => [c.id, c.vertical_id])), [channels])
  const verticalName = (t: Task) => {
    const v = t.channel?.vertical_id || chVertical.get(t.channel_id)
    return verticals.find(x => x.id === v)?.name || ''
  }
  const tasksByVertical = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks || []) {
      const v = t.channel?.vertical_id || chVertical.get(t.channel_id)
      if (!v) continue
      if (!m.has(v)) m.set(v, [])
      m.get(v)!.push(t)
    }
    return m
  }, [tasks, chVertical])

  const all = tasks || []
  const today = startOfDay(toZonedTime(new Date(), IST))
  const open = all.filter(t => OPEN_STATUSES.has(t.status))
  const overdue = open.filter(t => t.due_date && isBefore(toZonedTime(parseISO(t.due_date), IST), today) && !isToday(parseISO(t.due_date)))
  const live = all.filter(t => t.status === 'live')
  const week = bucketWeek(all, currentWeek())

  const mentionedIds = new Set(mentions?.map(m => m.task_id) || [])
  const myDay = user ? all.filter(t => {
    const mine = t.assignments?.some(a => a.user_id === user.id) || mentionedIds.has(t.id)
    if (!mine || !OPEN_STATUSES.has(t.status) || !t.due_date) return false
    const due = toZonedTime(parseISO(t.due_date), IST)
    return isBefore(due, today) || isToday(due)
  }).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')) : []

  if (userLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-zinc-200 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-56 bg-zinc-200 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-500 bg-clip-text text-transparent">
            Welcome back, {user?.display_name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-zinc-600 mt-1 inline-flex items-center gap-1">
            <InfoTip k="workspace_home" /> Everything the marketing team is doing, across {verticals.length} vertical{verticals.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/workspace/weekly/">
            <Button variant="outline" className="border-zinc-300 hover:bg-zinc-100 text-zinc-700">
              <CalendarRange className="w-4 h-4 mr-2" /> Weekly
            </Button>
          </Link>
          <Link href="/calendar/?v=all">
            <Button variant="outline" className="border-zinc-300 hover:bg-zinc-100 text-zinc-700">
              <Calendar className="w-4 h-4 mr-2" /> Calendar
            </Button>
          </Link>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white border-0"
          >
            <Plus className="w-4 h-4 mr-2" /> New Task
          </Button>
        </div>
      </div>

      {/* Workspace KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Open tasks" value={open.length} icon={<CheckSquare className="w-5 h-5" />} accent="blue" />
        <KpiTile label="Overdue" value={overdue.length} icon={<AlertCircle className="w-5 h-5" />} accent="red" valueClassName={overdue.length ? 'text-red-600' : undefined} />
        <KpiTile label="Live now" value={live.length} icon={<Radio className="w-5 h-5" />} accent="emerald" />
        <KpiTile
          label="This week"
          value={`${week.done.length} / ${week.done.length + week.notDone.length}`}
          hint={`done of planned · ${week.overdueCarried.length} carried over`}
          icon={<CalendarRange className="w-5 h-5" />} accent="violet"
        />
      </div>

      <CampaignBanner verticalId="all" />

      {/* Verticals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600" /> Verticals <InfoTip k="vertical" />
          </h2>
          <Link href="/workspace/tasks/" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <Table2 className="w-3.5 h-3.5" /> All tasks table
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...verticals].sort((a, b) => Number(ownedVerticalIds.has(b.id)) - Number(ownedVerticalIds.has(a.id))).map(v => (
            <VerticalCard
              key={v.id}
              vertical={v}
              tasks={tasksByVertical.get(v.id) || []}
              owners={(owners || []).filter(o => o.vertical_id === v.id)}
              users={users || []}
              owned={ownedVerticalIds.has(v.id)}
            />
          ))}
          {isAdmin && (
            <Link href="/admin/?tab=verticals" className="block">
              <Card className="h-full border-dashed border-zinc-300 bg-transparent hover:bg-white hover:border-blue-300 transition-all">
                <CardContent className="p-5 h-full flex flex-col items-center justify-center text-zinc-500 gap-2 min-h-[180px]">
                  <Plus className="w-6 h-6" />
                  <span className="text-sm font-medium">New vertical</span>
                  <span className="text-[11px] text-center">Clone a template or start empty</span>
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-white border-zinc-200 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2 text-zinc-900">
              <Calendar className="w-4 h-4 text-blue-600" /> My Day
            </CardTitle>
            <span className="text-xs text-zinc-600">{format(toZonedTime(new Date(), IST), 'EEEE, d MMMM')}</span>
          </CardHeader>
          <CardContent className="p-0">
            {myDay.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-sm">Nothing due today across your verticals.</div>
            ) : (
              <div className="divide-y divide-zinc-200">
                {myDay.map(task => (
                  <div key={task.id} onClick={() => setSelectedTaskId(task.id)}
                    className="p-4 hover:bg-zinc-100 transition-colors cursor-pointer flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{verticalName(task)}</Badge>
                        <h4 className="text-sm font-medium text-zinc-800 truncate">{task.title}</h4>
                      </div>
                      <p className="text-xs text-zinc-500 truncate">{task.channel?.name}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {task.due_date && (
                        <span className={`text-xs ${isBefore(parseISO(task.due_date), today) && !isToday(parseISO(task.due_date)) ? 'text-red-600 font-medium' : 'text-zinc-600'}`}>
                          {format(parseISO(task.due_date), 'd MMM')}
                        </span>
                      )}
                      <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300">{STATUS_CONFIG[task.status].label}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2 text-zinc-900">
              <Activity className="w-4 h-4 text-violet-600" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-y-auto pr-2 space-y-4">
            {activities && activities.length > 0 ? activities.map(log => (
              <div key={log.id} className="flex gap-3 text-xs">
                <div className="w-6 h-6 rounded-full bg-zinc-200 flex items-center justify-center shrink-0 text-[10px] font-semibold text-zinc-500 uppercase">
                  {log.actor?.display_name?.charAt(0) || '?'}
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-zinc-700 leading-snug">
                    <span className="font-medium text-zinc-900">{log.actor?.display_name || 'System'}</span>{' '}
                    {log.action === 'created' && 'created'}
                    {log.action === 'status_changed' && 'updated status of'}
                    {log.action === 'commented' && 'commented on'}
                    {log.action === 'imported_leads' && 'imported CSV leads'}
                    {!['created', 'status_changed', 'commented', 'imported_leads'].includes(log.action) && log.action.replace(/_/g, ' ')}{' '}
                    <span onClick={() => log.task?.id && setSelectedTaskId(log.task.id)} className="text-blue-600 hover:underline cursor-pointer font-medium">
                      {log.task?.title || 'a task'}
                    </span>
                  </p>
                  <p className="text-[10px] text-zinc-500">{format(new Date(log.created_at), 'd MMM · h:mm a')}</p>
                </div>
              </div>
            )) : <div className="text-center p-4 text-zinc-500 text-sm">No activity logged yet.</div>}
          </CardContent>
        </Card>
      </div>

      {createOpen && (
        <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={() => setCreateOpen(false)} />
      )}
      {selectedTaskId && (
        <TaskDetailDrawer taskId={selectedTaskId} open={!!selectedTaskId}
          onOpenChange={open => { if (!open) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />
      )}
    </div>
  )
}
