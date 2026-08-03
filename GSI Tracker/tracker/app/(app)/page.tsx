'use client'

import { useCurrentUser, useTasks, useMentionsForUser, useBudgetPeriods, useRecentActivity } from '@/lib/hooks/use-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { AlertCircle, Calendar, CheckSquare, MessageSquare, Plus, ArrowRight, DollarSign, Activity } from 'lucide-react'
import { useState } from 'react'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { format, isBefore, isToday, startOfDay, addDays, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import type { Task } from '@/lib/types/database'

const IST = 'Asia/Kolkata'

export default function DashboardPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: mentions } = useMentionsForUser()
  const { data: budgets } = useBudgetPeriods()
  const { data: activities } = useRecentActivity(20)

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  if (userLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-zinc-200 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-zinc-200 rounded-xl" />
          <div className="h-96 bg-zinc-200 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!user) return null

  // Time calculations in IST
  const nowIST = toZonedTime(new Date(), IST)
  const todayStartIST = startOfDay(nowIST)
  const nextWeekEndIST = addDays(todayStartIST, 7)

  // Filter tasks assigned to current user
  const myTasks = tasks?.filter(t => 
    t.assignments?.some(a => a.user_id === user.id)
  ) || []

  const myOpenTasks = myTasks.filter(t => 
    t.status !== 'done' && t.status !== 'cancelled'
  )

  const myOverdueTasks = myOpenTasks.filter(t => {
    if (!t.due_date) return false
    const dueTime = toZonedTime(parseISO(t.due_date), IST)
    return isBefore(dueTime, todayStartIST) && !isToday(dueTime)
  })

  // Mentioned tasks (from mentions hook or fallback in-memory)
  const uniqueMentionedTaskIds = new Set(mentions?.map(m => m.task_id) || [])
  const mentionedTasksCount = uniqueMentionedTaskIds.size

  // Global budget calculations
  const globalBudget = budgets?.find(b => b.scope_type === 'global')
  const totalGlobalBudget = globalBudget ? Number(globalBudget.total_budget) : 0
  const allocatedGlobalBudget = globalBudget ? Number(globalBudget.allocated) : 0
  const remainingGlobalBudget = Math.max(0, totalGlobalBudget - allocatedGlobalBudget)

  // "My Day" list: Assigned to me OR mentioning me, due today or overdue
  const myDayTasks = tasks?.filter(t => {
    const isAssigned = t.assignments?.some(a => a.user_id === user.id)
    const isMentioned = uniqueMentionedTaskIds.has(t.id)
    if (!isAssigned && !isMentioned) return false
    if (t.status === 'done' || t.status === 'cancelled') return false
    if (!t.due_date) return false
    
    const dueTime = toZonedTime(parseISO(t.due_date), IST)
    return isBefore(dueTime, todayStartIST) || isToday(dueTime)
  }).sort((a, b) => {
    // Sort priority P0 -> P1 -> P2 -> P3
    const priorityMap = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }
    const pDiff = priorityMap[a.priority] - priorityMap[b.priority]
    if (pDiff !== 0) return pDiff
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  }) || []

  // "Going Live This Week" list: Tasks going live or due in the next 7 days
  const goingLiveTasks = tasks?.filter(t => {
    if (t.status === 'done' || t.status === 'cancelled') return false
    if (!t.due_date) return false
    const dueTime = toZonedTime(parseISO(t.due_date), IST)
    return !isBefore(dueTime, todayStartIST) && isBefore(dueTime, nextWeekEndIST)
  }).slice(0, 5) || []

  const priorityColors = {
    P0: 'bg-red-500/20 text-red-600 border-red-500/30',
    P1: 'bg-orange-500/20 text-orange-600 border-orange-500/30',
    P2: 'bg-blue-500/20 text-blue-600 border-blue-300',
    P3: 'bg-zinc-500/20 text-zinc-600 border-zinc-500/30',
    P4: 'bg-zinc-100 text-zinc-500 border-zinc-600/30',
  }

  const statusLabels = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    live: 'Live',
    blocked: 'Blocked',
    done: 'Done',
    cancelled: 'Cancelled'
  }

  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
            Welcome back, {user.display_name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Here's what's happening with GSI/SI marketing today
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <Link href="/calendar" className="flex-1 sm:flex-none">
            <Button variant="outline" className="w-full border-zinc-300 hover:bg-zinc-100 text-zinc-700">
              <Calendar className="w-4 h-4 mr-2" /> Calendar View
            </Button>
          </Link>
          <Button
            onClick={() => setCreateOpen(true)}
            className="flex-1 sm:flex-none bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/10 border-0"
          >
            <Plus className="w-4 h-4 mr-2" /> New Task
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-zinc-200 backdrop-blur-xl hover:border-zinc-300 transition-all">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">My Open Tasks</p>
              <h3 className="text-3xl font-bold text-zinc-900 mt-1">{myOpenTasks.length}</h3>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <CheckSquare className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200 backdrop-blur-xl hover:border-zinc-300 transition-all">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Overdue</p>
              <h3 className={`text-3xl font-bold mt-1 ${myOverdueTasks.length > 0 ? 'text-red-600' : 'text-zinc-900'}`}>
                {myOverdueTasks.length}
              </h3>
            </div>
            <div className={`p-3 rounded-xl ${myOverdueTasks.length > 0 ? 'bg-red-500/15 text-red-600' : 'bg-zinc-200 text-zinc-600'}`}>
              <AlertCircle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200 backdrop-blur-xl hover:border-zinc-300 transition-all">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Mentions</p>
              <h3 className="text-3xl font-bold text-zinc-900 mt-1">{mentionedTasksCount}</h3>
            </div>
            <div className="p-3 bg-violet-50 text-violet-600 rounded-xl">
              <MessageSquare className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200 backdrop-blur-xl hover:border-zinc-300 transition-all">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Global Budget Left</p>
              <h3 className="text-3xl font-bold text-emerald-600 mt-1">
                ${remainingGlobalBudget.toLocaleString()}
              </h3>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <DollarSign className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left / Mid Column: Tasks */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* My Day */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold flex items-center gap-2 text-zinc-900">
                <Calendar className="w-4 h-4 text-blue-600" /> My Day
              </CardTitle>
              <span className="text-xs text-zinc-600">{format(nowIST, 'EEEE, d MMMM')}</span>
            </CardHeader>
            <CardContent className="p-0">
              {myDayTasks.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">
                  No tasks due today. Sweet! 🙌
                </div>
              ) : (
                <div className="divide-y divide-zinc-200">
                  {myDayTasks.map(task => (
                    <div 
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className="p-4 hover:bg-zinc-100 transition-colors cursor-pointer flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={priorityColors[task.priority]}>
                            {task.priority}
                          </Badge>
                          <h4 className="text-sm font-medium text-zinc-800 truncate">{task.title}</h4>
                        </div>
                        <p className="text-xs text-zinc-500 truncate">{task.description || 'No description'}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {task.due_date && (
                          <span className={`text-xs ${isBefore(parseISO(task.due_date), todayStartIST) && !isToday(parseISO(task.due_date)) ? 'text-red-600 font-medium' : 'text-zinc-600'}`}>
                            {format(parseISO(task.due_date), 'd MMM')}
                          </span>
                        )}
                        <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300">
                          {statusLabels[task.status]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Going Live This Week */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2 text-zinc-900">
                <ArrowRight className="w-4 h-4 text-emerald-600" /> Going Live This Week
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {goingLiveTasks.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">
                  Nothing scheduled to go live in the next 7 days.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200">
                  {goingLiveTasks.map(task => (
                    <div 
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className="p-4 hover:bg-zinc-100 transition-colors cursor-pointer flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <h4 className="text-sm font-medium text-zinc-800 truncate">{task.title}</h4>
                        <p className="text-xs text-zinc-500 truncate">Channel: {task.channel?.name}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {task.due_date && (
                          <span className="text-xs text-zinc-600">
                            {format(parseISO(task.due_date), 'd MMM')}
                          </span>
                        )}
                        <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300">
                          {statusLabels[task.status]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Activity & Budgets */}
        <div className="space-y-6">
          
          {/* Budget Progress */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-zinc-900">Budget Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {budgets && budgets.length > 0 ? (
                budgets.slice(0, 3).map(budget => {
                  const limit = Number(budget.total_budget)
                  const allocated = Number(budget.allocated)
                  const percent = limit > 0 ? Math.round((allocated / limit) * 100) : 0
                  
                  return (
                    <div key={budget.budget_period_id} className="space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-zinc-700 truncate max-w-[120px]">
                          {budget.period_label} ({budget.scope_type})
                        </span>
                        <span className="text-zinc-600">
                          ${allocated.toLocaleString()} / ${limit.toLocaleString()} ({percent}%)
                        </span>
                      </div>
                      <Progress 
                        value={percent} 
                        className="h-2 bg-zinc-200"
                        indicatorClassName={percent > 100 ? 'bg-red-500' : percent > 80 ? 'bg-orange-500' : 'bg-blue-500'}
                      />
                    </div>
                  )
                })
              ) : (
                <div className="text-center p-4 text-zinc-500 text-sm">
                  No budgets defined for the active period.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity Log */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2 text-zinc-900">
                <Activity className="w-4 h-4 text-violet-600" /> Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[350px] overflow-y-auto pr-2 space-y-4">
              {activities && activities.length > 0 ? (
                activities.map(log => (
                  <div key={log.id} className="flex gap-3 text-xs">
                    <div className="w-6 h-6 rounded-full bg-zinc-200 border border-zinc-200 flex items-center justify-center shrink-0 text-[10px] font-semibold text-zinc-500 uppercase">
                      {log.actor?.display_name?.charAt(0) || '?'}
                    </div>
                    <div className="space-y-1">
                      <p className="text-zinc-700 leading-snug">
                        <span className="font-medium text-zinc-900">{log.actor?.display_name || 'System'}</span>{' '}
                        {log.action === 'created' && 'created task'}{' '}
                        {log.action === 'status_changed' && 'updated status of'}{' '}
                        {log.action === 'commented' && 'commented on'}{' '}
                        {log.action === 'imported_leads' && 'imported CSV leads'}{' '}
                        <span 
                          onClick={() => log.task?.id && setSelectedTaskId(log.task.id)}
                          className="text-blue-600 hover:underline cursor-pointer font-medium"
                        >
                          {log.task?.title || 'a task'}
                        </span>
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {format(new Date(log.created_at), 'd MMM · h:mm a')}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center p-4 text-zinc-500 text-sm">
                  No activity logged yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Task Creation Dialog */}
      {createOpen && (
        <CreateTaskDialog 
          open={createOpen} 
          onOpenChange={setCreateOpen} 
          onSuccess={() => {
            setCreateOpen(false)
          }}
        />
      )}

      {/* Task Detail Drawer */}
      {selectedTaskId && (
        <TaskDetailDrawer 
          taskId={selectedTaskId} 
          open={!!selectedTaskId} 
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null)
          }}
          onTaskIdChange={setSelectedTaskId}
        />
      )}
    </div>
  )
}
