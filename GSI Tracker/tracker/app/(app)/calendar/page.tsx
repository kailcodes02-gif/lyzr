'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  parseISO,
} from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Calendar as CalendarIcon,
  RefreshCw,
} from 'lucide-react'
import { useTasks, useCategories, useChannels, useUsers } from '@/lib/hooks/use-data'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

const PRIORITY_STYLES = {
  P0: 'bg-red-50 border-red-200 text-red-600 hover:bg-red-500/20',
  P1: 'bg-orange-500/10 border-orange-500/20 text-orange-600 hover:bg-orange-500/20',
  P2: 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100',
  P3: 'bg-zinc-100 border-zinc-300 text-zinc-600 hover:bg-zinc-500/20',
  P4: 'bg-zinc-500/5 border-zinc-600/20 text-zinc-500 hover:bg-zinc-100',
}

function CalendarContent() {
  const searchParams = useSearchParams()
  const categoryParam = searchParams.get('category')
  const channelParam = searchParams.get('channel')

  const [currentDate, setCurrentDate] = useState(new Date())
  // Google-Calendar-style week view is the default; month remains available
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [selectedOwner, setSelectedOwner] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // React to query parameter changes
  useEffect(() => {
    if (categoryParam) {
      setSelectedCategory(categoryParam)
    }
  }, [categoryParam])

  useEffect(() => {
    if (channelParam) {
      setSelectedChannel(channelParam)
    }
  }, [channelParam])

  // Fetch all taxonomy + users for filters
  const { data: categories } = useCategories()
  const { data: channels } = useChannels(selectedCategory !== 'all' ? selectedCategory : undefined)
  const { data: users } = useUsers()

  // Fetch tasks
  const { data: tasks, isLoading, refetch } = useTasks()

  // Calendar dates generation
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(monthStart)
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 }) // Start week on Sunday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // Week range (Monday-start, like Google Calendar)
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  const goNext = () => setCurrentDate(viewMode === 'week' ? addWeeks(currentDate, 1) : addMonths(currentDate, 1))
  const goPrev = () => setCurrentDate(viewMode === 'week' ? subWeeks(currentDate, 1) : subMonths(currentDate, 1))

  // Filter tasks client side
  const filteredTasks = tasks?.filter(task => {
    if (!task.due_date) return false

    // Category filter
    if (selectedCategory !== 'all') {
      if (task.channel?.category_id !== selectedCategory) return false
    }

    // Channel filter
    if (selectedChannel !== 'all') {
      if (task.channel_id !== selectedChannel) return false
    }

    // Owner filter
    if (selectedOwner !== 'all') {
      const hasAssignee = task.assignments?.some(a => a.user_id === selectedOwner)
      if (!hasAssignee) return false
    }

    // Status filter
    if (selectedStatus !== 'all') {
      if (task.status !== selectedStatus) return false
    }

    return true
  }) || []

  return (
    <div className="p-4 lg:p-6 space-y-6 bg-zinc-50 min-h-screen text-zinc-900">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-violet-600" />
            Content & Campaign Calendar
          </h1>
          <p className="text-xs text-zinc-600">Track and coordinate marketing timelines</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-100 border border-zinc-300 rounded-lg p-0.5 mr-1">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === 'week' ? 'bg-white shadow text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'}`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === 'month' ? 'bg-white shadow text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'}`}
            >
              Month
            </button>
          </div>
          <button
            onClick={goPrev}
            className="p-2 bg-zinc-100 border border-zinc-300 rounded-lg hover:bg-zinc-200/70 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold min-w-[150px] text-center">
            {viewMode === 'week'
              ? `${format(weekStart, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`
              : format(currentDate, 'MMMM yyyy')}
          </span>
          <button
            onClick={goNext}
            className="p-2 bg-zinc-100 border border-zinc-300 rounded-lg hover:bg-zinc-200/70 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-2 bg-zinc-100 border border-zinc-300 rounded-lg hover:bg-zinc-200/70 transition-colors text-xs font-medium"
          >
            Today
          </button>
          <button
            onClick={() => refetch()}
            className="p-2 bg-zinc-100 border border-zinc-300 rounded-lg hover:bg-zinc-200/70 transition-colors ml-2"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-zinc-100 border border-zinc-300 rounded-xl p-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2 text-zinc-600 text-xs font-medium uppercase tracking-wider mr-2">
          <Filter className="w-3.5 h-3.5" />
          Filters
        </div>

        {/* Category Filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">Category</label>
          <select
            value={selectedCategory}
            onChange={e => {
              setSelectedCategory(e.target.value)
              setSelectedChannel('all') // reset channel on category change
            }}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Categories</option>
            {categories?.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        {/* Channel Filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">Channel</label>
          <select
            value={selectedChannel}
            onChange={e => setSelectedChannel(e.target.value)}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Channels</option>
            {channels?.map(ch => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
        </div>

        {/* Owner Filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">Assignee</label>
          <select
            value={selectedOwner}
            onChange={e => setSelectedOwner(e.target.value)}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Owners</option>
            {users?.map(u => (
              <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">Status</label>
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Statuses</option>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="live">Live</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Week view (default) — one column per day of the current week */}
      {!isLoading && viewMode === 'week' && (
        <div className="border border-zinc-300 rounded-xl overflow-hidden bg-white">
          <div className="grid grid-cols-7 divide-x divide-zinc-200 min-h-[560px]">
            {weekDays.map(day => {
              const dayStr = format(day, 'yyyy-MM-dd')
              const dayTasks = filteredTasks.filter(t => {
                try { return format(parseISO(t.due_date!), 'yyyy-MM-dd') === dayStr } catch { return t.due_date === dayStr }
              })
              const today = isToday(day)
              return (
                <div key={dayStr} className={today ? 'bg-blue-50/50' : ''}>
                  <div className={`text-center py-2.5 border-b border-zinc-200 ${today ? 'bg-blue-100/60' : 'bg-zinc-50'}`}>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">{format(day, 'EEE')}</p>
                    <p className={`text-lg font-semibold leading-tight ${today ? 'text-blue-700' : 'text-zinc-800'}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  <div className="p-1.5 space-y-1.5">
                    {dayTasks.map(task => (
                      <button
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className={`w-full text-left rounded-md border px-2 py-1.5 text-[11px] leading-snug transition-colors ${PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.P2}`}
                        title={`${task.title} · ${task.channel?.name || ''}`}
                      >
                        <span className="font-semibold">{task.priority}</span> {task.title}
                        {task.channel?.name && (
                          <span className="block text-[9px] opacity-70 truncate">{task.channel.name}</span>
                        )}
                      </button>
                    ))}
                    {dayTasks.length === 0 && (
                      <p className="text-center text-[10px] text-zinc-300 pt-4">—</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Month grid */}
      {isLoading ? (
        <div className="flex justify-center items-center h-96">
          <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full" />
        </div>
      ) : viewMode === 'month' && (
        <div className="border border-zinc-300 rounded-xl overflow-hidden bg-zinc-100 backdrop-blur-xl">
          {/* Days of week header */}
          <div className="grid grid-cols-7 border-b border-zinc-300 bg-white text-center py-3 text-xs font-semibold text-zinc-600">
            <div>Sunday</div>
            <div>Monday</div>
            <div>Tuesday</div>
            <div>Wednesday</div>
            <div>Thursday</div>
            <div>Friday</div>
            <div>Saturday</div>
          </div>

          {/* Month cells */}
          <div className="grid grid-cols-7 grid-rows-6 auto-rows-[120px] min-h-[600px] divide-x divide-y divide-zinc-200">
            {days.map((day, dayIdx) => {
              const dayStr = format(day, 'yyyy-MM-dd')
              const isCurrentMonth = isSameMonth(day, currentDate)
              const dayTasks = filteredTasks.filter(task => {
                if (!task.due_date) return false
                // Parse and compare
                try {
                  const taskDate = format(parseISO(task.due_date), 'yyyy-MM-dd')
                  return taskDate === dayStr
                } catch {
                  return task.due_date === dayStr
                }
              })

              return (
                <div
                  key={day.toString()}
                  className={`p-2 flex flex-col gap-1 overflow-hidden transition-all ${
                    isCurrentMonth ? 'bg-transparent' : 'bg-zinc-100/40 opacity-35'
                  } ${dayIdx < 7 ? 'border-t-0' : ''}`}
                >
                  {/* Date indicator */}
                  <span className={`text-xs font-medium self-end px-1.5 py-0.5 rounded-full ${
                    isSameDay(day, new Date())
                      ? 'bg-violet-600 text-white font-bold'
                      : 'text-zinc-500'
                  }`}>
                    {format(day, 'd')}
                  </span>

                  {/* Tasks List */}
                  <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {dayTasks.map(task => {
                      const style = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.P2
                      const isRecurring = !!task.recurring_template_id
                      const primaryOwner = task.assignments?.find(a => a.role === 'primary')?.user

                      return (
                        <button
                          key={task.id}
                          onClick={() => setSelectedTaskId(task.id)}
                          className={`w-full text-left p-1 rounded border text-[10px] leading-tight flex items-center gap-1 transition-all ${style}`}
                        >
                          {isRecurring && (
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" title="Recurring" />
                          )}
                          <span className="truncate flex-1 font-medium">{task.title}</span>
                          {primaryOwner && (
                            <Avatar className="w-3.5 h-3.5 shrink-0 border border-zinc-300">
                              <AvatarImage src={primaryOwner.avatar_url || ''} />
                              <AvatarFallback className="bg-zinc-200 text-[8px] text-zinc-700">
                                {primaryOwner.display_name?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Task Drawer */}
      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={!!selectedTaskId}
        onOpenChange={open => !open && setSelectedTaskId(null)}
        onTaskIdChange={setSelectedTaskId}
      />
    </div>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center h-screen bg-zinc-50 text-zinc-900">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full" />
      </div>
    }>
      <CalendarContent />
    </Suspense>
  )
}
