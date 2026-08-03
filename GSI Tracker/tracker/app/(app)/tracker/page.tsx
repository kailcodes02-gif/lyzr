'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Download,
  Eye,
  EyeOff,
  Filter,
  Lightbulb,
  Lock,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { format, parseISO, isAfter, isBefore } from 'date-fns'
import Papa from 'papaparse'
import { toast } from 'sonner'

import { useTasks, useCategories, useChannels, useSavedViews } from '@/lib/hooks/use-data'
import { saveView, deleteSavedView } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { STATUS_CONFIG, type Task, type TaskStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'

type SortKey = 'completed' | 'channel' | 'owner'
type SortDir = 'asc' | 'desc'

type Insight = {
  n?: number
  body?: string
  added_at?: string
  added_by?: string
}

const TRACKER_STATUSES: TaskStatus[] = ['live', 'done', 'cancelled']

// Saved-views identifier for this page (see migration 009 / saveView action).
const SAVED_VIEW_PAGE = 'tracker'

// Snapshot of the tracker's filter/sort state persisted in a saved view's
// `config` JSON. Kept intentionally flat so it round-trips through JSONB.
type TrackerViewConfig = {
  selectedCategory: string
  selectedChannel: string
  selectedStatus: 'all' | TaskStatus
  hideCancelled: boolean
  dateFrom: string
  dateTo: string
  sortKey: SortKey
  sortDir: SortDir
}

function parseInsights(value: unknown): Insight[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((v): v is Insight => !!v && typeof v === 'object')
  }
  if (typeof value === 'string' && value.trim()) {
    return [{ n: 1, body: value }]
  }
  return []
}

function formatDate(value: string | null | undefined) {
  if (!value) return ''
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

function getCompletedDate(task: Task): string | null {
  return task.completed_at || task.went_live_at || null
}

function getPrimaryOwnerName(task: Task): string {
  const primary = task.assignments?.find(a => a.role === 'primary')
  const fallback = task.assignments?.[0]
  const user = primary?.user || fallback?.user
  return user?.display_name || user?.email || ''
}

export default function TrackerPage() {
  const { data: tasks, isLoading, refetch } = useTasks()
  const { data: categories } = useCategories()

  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<'all' | TaskStatus>('all')
  const [hideCancelled, setHideCancelled] = useState(true)
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('completed')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const { data: channels } = useChannels(
    selectedCategory !== 'all' ? selectedCategory : undefined
  )

  // ---- Saved views ----
  const queryClient = useQueryClient()
  const { data: savedViews } = useSavedViews(SAVED_VIEW_PAGE)
  const [activeViewId, setActiveViewId] = useState<string>('')
  const [isSavingView, setIsSavingView] = useState(false)

  const applyView = (config: TrackerViewConfig) => {
    setSelectedCategory(config.selectedCategory ?? 'all')
    setSelectedChannel(config.selectedChannel ?? 'all')
    setSelectedStatus(config.selectedStatus ?? 'all')
    setHideCancelled(config.hideCancelled ?? true)
    setDateFrom(config.dateFrom ?? '')
    setDateTo(config.dateTo ?? '')
    setSortKey(config.sortKey ?? 'completed')
    setSortDir(config.sortDir ?? 'desc')
  }

  const handleLoadView = (viewId: string) => {
    setActiveViewId(viewId)
    if (!viewId) return
    const view = savedViews?.find(v => v.id === viewId)
    if (view) applyView(view.config as TrackerViewConfig)
  }

  const handleSaveView = async () => {
    const name = window.prompt('Name this view (e.g. "My P0s due this week"):')?.trim()
    if (!name) return
    const config: TrackerViewConfig = {
      selectedCategory,
      selectedChannel,
      selectedStatus,
      hideCancelled,
      dateFrom,
      dateTo,
      sortKey,
      sortDir,
    }
    setIsSavingView(true)
    try {
      const saved = await saveView({ page: SAVED_VIEW_PAGE, name, config })
      await queryClient.invalidateQueries({ queryKey: ['savedViews', SAVED_VIEW_PAGE] })
      if (saved?.id) setActiveViewId(saved.id)
      toast.success(`Saved view "${name}"`)
    } catch (err: any) {
      console.error('saveView failed:', err)
      toast.error(err?.message || 'Failed to save view')
    } finally {
      setIsSavingView(false)
    }
  }

  const handleDeleteView = async () => {
    if (!activeViewId) return
    const view = savedViews?.find(v => v.id === activeViewId)
    if (!view) return
    if (!confirm(`Delete saved view "${view.name}"?`)) return
    try {
      await deleteSavedView(activeViewId)
      await queryClient.invalidateQueries({ queryKey: ['savedViews', SAVED_VIEW_PAGE] })
      setActiveViewId('')
      toast.success('View deleted')
    } catch (err: any) {
      console.error('deleteSavedView failed:', err)
      toast.error(err?.message || 'Failed to delete view')
    }
  }

  const trackerTasks = useMemo(() => {
    if (!tasks) return []
    return tasks.filter(t => TRACKER_STATUSES.includes(t.status))
  }, [tasks])

  const filtered = useMemo(() => {
    let rows = trackerTasks

    if (hideCancelled) {
      rows = rows.filter(t => t.status !== 'cancelled')
    }

    if (selectedCategory !== 'all') {
      rows = rows.filter(t => t.channel?.category_id === selectedCategory)
    }

    if (selectedChannel !== 'all') {
      rows = rows.filter(t => t.channel_id === selectedChannel)
    }

    if (selectedStatus !== 'all') {
      rows = rows.filter(t => t.status === selectedStatus)
    }

    if (dateFrom) {
      try {
        const from = parseISO(dateFrom)
        rows = rows.filter(t => {
          const compRaw = getCompletedDate(t)
          if (!compRaw) return false
          return !isBefore(parseISO(compRaw), from)
        })
      } catch {}
    }

    if (dateTo) {
      try {
        const to = parseISO(dateTo)
        rows = rows.filter(t => {
          const compRaw = getCompletedDate(t)
          if (!compRaw) return false
          return !isAfter(parseISO(compRaw), to)
        })
      } catch {}
    }

    const sorted = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'completed') {
        const av = getCompletedDate(a) || ''
        const bv = getCompletedDate(b) || ''
        cmp = av.localeCompare(bv)
      } else if (sortKey === 'channel') {
        cmp = (a.channel?.name || '').localeCompare(b.channel?.name || '')
      } else if (sortKey === 'owner') {
        cmp = getPrimaryOwnerName(a).localeCompare(getPrimaryOwnerName(b))
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [
    trackerTasks,
    hideCancelled,
    selectedCategory,
    selectedChannel,
    selectedStatus,
    dateFrom,
    dateTo,
    sortKey,
    sortDir,
  ])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Nothing to export')
      return
    }

    const rows = filtered.map(task => {
      const completedRaw = getCompletedDate(task)
      const insights = parseInsights(
        (task.tracker_fields as Record<string, unknown> | undefined)?.insights
      )
      const insightText = insights
        .map((ins, idx) => `${ins.n ?? idx + 1}. ${ins.body || ''}`)
        .join(' | ')

      const categoryName = task.channel?.category?.name
        || categories?.find(c => c.id === task.channel?.category_id)?.name
        || ''

      return {
        title: task.title,
        category: categoryName,
        channel: task.channel?.name || '',
        status: task.status,
        priority: task.priority,
        primary_owner: getPrimaryOwnerName(task),
        all_owners: (task.assignments || [])
          .map(a => a.user?.display_name || a.user?.email || '')
          .filter(Boolean)
          .join('; '),
        started_on: task.went_live_at ? formatDate(task.went_live_at) : '',
        completed_on: task.completed_at ? formatDate(task.completed_at) : '',
        completed_iso: completedRaw || '',
        result_url: task.result_url || '',
        insights_count: insights.length,
        insights: insightText,
        tracker_frozen: task.tracker_frozen_at
          && new Date(task.tracker_frozen_at) < new Date()
          ? 'yes'
          : 'no',
      }
    })

    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `tracker-export-${format(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${rows.length} rows`)
  }

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3" />
      : <ArrowDown className="w-3 h-3" />
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 bg-zinc-50 text-zinc-900 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-violet-600" /> Global Tracker
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            All live, completed, and cancelled campaigns across every category
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 bg-zinc-100 border border-zinc-300 rounded-lg hover:bg-zinc-200/70 transition-colors text-zinc-700"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Button
            onClick={handleExportCsv}
            className="bg-emerald-600 hover:bg-emerald-500 text-white border-0"
          >
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Saved Views Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-zinc-600 text-xs font-medium uppercase tracking-wider mr-1">
          <Bookmark className="w-3.5 h-3.5" />
          Saved Views
        </div>

        <select
          value={activeViewId}
          onChange={e => handleLoadView(e.target.value)}
          className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500 min-w-[180px]"
        >
          <option value="">
            {savedViews && savedViews.length > 0 ? 'Load a saved view…' : 'No saved views yet'}
          </option>
          {savedViews?.map(v => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <Button
          onClick={handleSaveView}
          disabled={isSavingView}
          variant="outline"
          className="border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-200/70 text-xs"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" /> Save current
        </Button>

        {activeViewId && (
          <Button
            onClick={handleDeleteView}
            variant="ghost"
            className="text-zinc-500 hover:text-red-600 text-xs"
            aria-label="Delete saved view"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-zinc-100 border border-zinc-300 rounded-xl p-3 sm:p-4 flex flex-wrap gap-3 sm:gap-4 items-end">
        <div className="flex items-center gap-2 text-zinc-600 text-xs font-medium uppercase tracking-wider self-center mr-2">
          <Filter className="w-3.5 h-3.5" />
          Filters
        </div>

        <div className="flex flex-col gap-1 w-full sm:w-auto">
          <label className="text-[10px] text-zinc-500 font-medium">Category</label>
          <select
            value={selectedCategory}
            onChange={e => {
              setSelectedCategory(e.target.value)
              setSelectedChannel('all')
            }}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500 w-full sm:min-w-[160px]"
          >
            <option value="all">All Categories</option>
            {categories?.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 w-full sm:w-auto">
          <label className="text-[10px] text-zinc-500 font-medium">Channel</label>
          <select
            value={selectedChannel}
            onChange={e => setSelectedChannel(e.target.value)}
            disabled={selectedCategory === 'all'}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500 w-full sm:min-w-[160px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="all">All Channels</option>
            {channels?.map(ch => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">Status</label>
          <div className="flex bg-white border border-zinc-300 rounded-lg p-0.5">
            {(['all', 'live', 'done', 'cancelled'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSelectedStatus(s)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md transition-colors capitalize',
                  selectedStatus === s
                    ? 'bg-zinc-200/70 text-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-700'
                )}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">Started / Completed From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-500 font-medium">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-violet-500"
          />
        </div>

        <button
          onClick={() => setHideCancelled(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-800 border border-zinc-300 rounded-lg bg-white transition-colors self-end"
        >
          {hideCancelled
            ? <><EyeOff className="w-3.5 h-3.5" /> Cancelled hidden</>
            : <><Eye className="w-3.5 h-3.5" /> Cancelled shown</>}
        </button>

        <div className="ml-auto text-xs text-zinc-500 self-center">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-zinc-300 rounded-xl text-zinc-500 text-sm">
          No tracker entries match the current filters.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 overflow-hidden bg-white backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100/50 text-zinc-600">
                  <th className="text-left font-medium py-3 px-4">Campaign</th>
                  <th className="text-left font-medium py-3 px-4">Category</th>
                  <th className="text-left font-medium py-3 px-4">
                    <button
                      onClick={() => toggleSort('channel')}
                      className="flex items-center gap-1 hover:text-zinc-900 transition-colors"
                    >
                      Channel {renderSortIcon('channel')}
                    </button>
                  </th>
                  <th className="text-left font-medium py-3 px-4">Status</th>
                  <th className="text-left font-medium py-3 px-4">
                    <button
                      onClick={() => toggleSort('owner')}
                      className="flex items-center gap-1 hover:text-zinc-900 transition-colors"
                    >
                      Owner {renderSortIcon('owner')}
                    </button>
                  </th>
                  <th className="text-left font-medium py-3 px-4">
                    <button
                      onClick={() => toggleSort('completed')}
                      className="flex items-center gap-1 hover:text-zinc-900 transition-colors"
                    >
                      Completed {renderSortIcon('completed')}
                    </button>
                  </th>
                  <th className="text-left font-medium py-3 px-4">Insights</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {filtered.map(task => {
                  const insights = parseInsights(
                    (task.tracker_fields as Record<string, unknown> | undefined)?.insights
                  )
                  const primary = task.assignments?.find(a => a.role === 'primary')
                    || task.assignments?.[0]
                  const ownerUser = primary?.user
                  const completedRaw = getCompletedDate(task)
                  const categoryName = task.channel?.category?.name
                    || categories?.find(c => c.id === task.channel?.category_id)?.name
                    || ''
                  const isFrozen = task.tracker_frozen_at
                    && new Date(task.tracker_frozen_at) < new Date()
                  const statusConfig = STATUS_CONFIG[task.status]

                  return (
                    <tr
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className="hover:bg-zinc-100 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-4 max-w-[280px]">
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-zinc-800 truncate">{task.title}</span>
                          {isFrozen && (
                            <Badge className="bg-blue-50 text-blue-600 border-blue-200 text-[9px] shrink-0 gap-1">
                              <Lock className="w-2.5 h-2.5" /> Frozen
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-600">
                        {categoryName || <span className="text-zinc-600">-</span>}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-600">
                        {task.channel?.name || <span className="text-zinc-600">-</span>}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge
                          className="text-[10px] border-0"
                          style={{
                            backgroundColor: statusConfig.bgColor,
                            color: statusConfig.color,
                          }}
                        >
                          {statusConfig.label}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4">
                        {ownerUser ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="w-5 h-5 border border-zinc-300">
                              <AvatarImage src={ownerUser.avatar_url || ''} />
                              <AvatarFallback className="bg-zinc-200 text-[9px] text-zinc-700">
                                {(ownerUser.display_name || ownerUser.email).charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-zinc-700 truncate max-w-[120px]">
                              {ownerUser.display_name || ownerUser.email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-600">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-600 whitespace-nowrap">
                        {completedRaw ? formatDate(completedRaw) : <span className="text-zinc-600">-</span>}
                      </td>
                      <td
                        className="py-3.5 px-4"
                        onClick={e => e.stopPropagation()}
                      >
                        {insights.length > 0 ? (
                          <Popover>
                            <PopoverTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-colors text-[11px]">
                              <Lightbulb className="w-3 h-3" />
                              {insights.length}
                            </PopoverTrigger>
                            <PopoverContent
                              align="end"
                              className="w-80 bg-white border border-zinc-300 text-zinc-800"
                            >
                              <div className="flex items-center gap-2 mb-2 text-xs text-zinc-500 uppercase tracking-wider">
                                <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                                Insights ({insights.length})
                              </div>
                              <ol className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
                                {insights.map((ins, idx) => (
                                  <li key={idx} className="bg-zinc-100/60 border border-zinc-200 rounded-md p-2">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-amber-600 font-semibold shrink-0">
                                        {ins.n ?? idx + 1}.
                                      </span>
                                      <span className="text-zinc-800 leading-relaxed whitespace-pre-wrap break-words">
                                        {ins.body || <span className="text-zinc-600 italic">empty</span>}
                                      </span>
                                    </div>
                                    {ins.added_at && (
                                      <p className="text-[10px] text-zinc-600 mt-1.5">
                                        {formatDate(ins.added_at)}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <span className="text-zinc-600 text-[11px]">none</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TaskDetailDrawer
        taskId={selectedTaskId}
        open={!!selectedTaskId}
        onOpenChange={open => !open && setSelectedTaskId(null)}
        onTaskIdChange={setSelectedTaskId}
      />
    </div>
  )
}
