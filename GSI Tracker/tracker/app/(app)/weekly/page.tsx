'use client'

import { useMemo, useState } from 'react'
import {
  startOfISOWeek, endOfISOWeek, addWeeks, format, parseISO, isWithinInterval, isBefore,
} from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  CheckSquare, AlertCircle, Zap, Layers, Users as UsersIcon,
  Calendar as CalendarIcon, ExternalLink, Landmark, Info,
} from 'lucide-react'
import { useWeeklySnapshot, useRecentWeeklySnapshots, type WeeklySnapshot } from '@/lib/hooks/use-weekly'
import { useTasks, useBudgetPeriods, useCategories, useUsers } from '@/lib/hooks/use-data'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { ReportBuilder } from '@/components/weekly/report-builder'
import type { Task } from '@/lib/types/database'

const WEEK_COUNT = 12
const ISO_DATE = 'yyyy-MM-dd'

function buildWeeks(count: number): Array<{ start: Date; end: Date; key: string; label: string }> {
  const now = new Date()
  const thisWeekStart = startOfISOWeek(now)
  const weeks: Array<{ start: Date; end: Date; key: string; label: string }> = []
  for (let i = 0; i < count; i++) {
    const start = addWeeks(thisWeekStart, -i)
    const end = endOfISOWeek(start)
    const sameMonth = format(start, 'MMM') === format(end, 'MMM')
    const label = sameMonth
      ? `${format(start, 'MMM d')}–${format(end, 'd')}`
      : `${format(start, 'MMM d')}–${format(end, 'MMM d')}`
    weeks.push({ start, end, key: format(start, ISO_DATE), label })
  }
  return weeks
}

interface CountEntry { name: string; count: number; by_status?: Record<string, number> }

function normalizeCounts(input: WeeklySnapshot['by_category'] | WeeklySnapshot['by_owner']): CountEntry[] {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map(e => ({ name: e.name, count: Number(e.count) || 0, by_status: (e as CountEntry).by_status }))
      .filter(e => e.name)
  }
  return Object.entries(input as Record<string, number>)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter(e => e.name)
}

interface LiveAggregate {
  totals: { total: number; completed: number; blocked: number; live: number }
  byCategory: CountEntry[]
  byOwner: CountEntry[]
  completedTasks: Task[]
  blockedTasks: Task[]
}

function computeLiveAggregate(
  tasks: Task[],
  weekStart: Date,
  weekEnd: Date,
  categoryNameById: Map<string, string>,
): LiveAggregate {
  const existsByEnd = tasks.filter(t => {
    const created = parseISO(t.created_at)
    if (isBefore(weekEnd, created)) return false
    if (t.cancelled_at) {
      const cancelled = parseISO(t.cancelled_at)
      if (isBefore(cancelled, weekStart)) return false
    }
    return true
  })

  let total = 0, completed = 0, blocked = 0, live = 0
  const catMap = new Map<string, { count: number; by_status: Record<string, number> }>()
  const ownerMap = new Map<string, number>()

  const completedInWeek: Task[] = []
  const blockedAtEnd: Task[] = []

  for (const t of existsByEnd) {
    const completedAt = t.completed_at ? parseISO(t.completed_at) : null
    const completedThisWeek = completedAt
      ? isWithinInterval(completedAt, { start: weekStart, end: weekEnd })
      : false

    let endStatus: string = t.status
    if (completedAt && isBefore(weekEnd, completedAt)) {
      endStatus = 'in_progress'
    }
    if (completedThisWeek) {
      endStatus = 'done'
    }

    total += 1
    if (endStatus === 'done') completed += 1
    if (endStatus === 'blocked') blocked += 1
    if (endStatus === 'live') live += 1

    const catName = t.channel?.category_id
      ? categoryNameById.get(t.channel.category_id) || 'Uncategorized'
      : 'Uncategorized'
    const catEntry = catMap.get(catName) || { count: 0, by_status: {} }
    catEntry.count += 1
    catEntry.by_status[endStatus] = (catEntry.by_status[endStatus] || 0) + 1
    catMap.set(catName, catEntry)

    const primary = t.assignments?.find(a => a.role === 'primary')
    const ownerName = primary?.user?.display_name || primary?.user?.email || 'Unassigned'
    ownerMap.set(ownerName, (ownerMap.get(ownerName) || 0) + 1)

    if (completedThisWeek) completedInWeek.push(t)
    if (endStatus === 'blocked') blockedAtEnd.push(t)
  }

  return {
    totals: { total, completed, blocked, live },
    byCategory: Array.from(catMap.entries())
      .map(([name, v]) => ({ name, count: v.count, by_status: v.by_status }))
      .sort((a, b) => b.count - a.count),
    byOwner: Array.from(ownerMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    completedTasks: completedInWeek.sort((a, b) =>
      (b.completed_at || '').localeCompare(a.completed_at || '')
    ),
    blockedTasks: blockedAtEnd,
  }
}

const statusBarColors: Record<string, string> = {
  done: 'bg-emerald-500',
  live: 'bg-blue-500',
  in_progress: 'bg-violet-500',
  blocked: 'bg-red-500',
  not_started: 'bg-zinc-600',
  cancelled: 'bg-zinc-300',
}

export default function WeeklyReviewPage() {
  const weeks = useMemo(() => buildWeeks(WEEK_COUNT), [])
  const [selectedKey, setSelectedKey] = useState<string>(weeks[0].key)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const selectedWeek = weeks.find(w => w.key === selectedKey) || weeks[0]
  const isCurrentWeek = selectedKey === weeks[0].key

  const { data: snapshot, isLoading: snapLoading } = useWeeklySnapshot(isCurrentWeek ? null : selectedKey)
  const { data: recentSnapshots } = useRecentWeeklySnapshots(WEEK_COUNT)
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: budgets } = useBudgetPeriods()
  const { data: categories } = useCategories()
  const { data: users } = useUsers()

  const snapshotKeySet = useMemo(
    () => new Set((recentSnapshots || []).map(s => s.week_starting)),
    [recentSnapshots],
  )

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>()
    categories?.forEach(c => m.set(c.id, c.name))
    return m
  }, [categories])

  const taskById = useMemo(() => {
    const m = new Map<string, Task>()
    tasks?.forEach(t => m.set(t.id, t))
    return m
  }, [tasks])

  const live = useMemo(() => {
    if (!tasks) return null
    return computeLiveAggregate(tasks, selectedWeek.start, selectedWeek.end, categoryNameById)
  }, [tasks, selectedWeek.start, selectedWeek.end, categoryNameById])

  const isLoading = (isCurrentWeek ? tasksLoading : snapLoading || tasksLoading)

  const hasSnapshot = isCurrentWeek ? true : !!snapshot

  const totals = useMemo(() => {
    if (isCurrentWeek && live) return live.totals
    if (snapshot) {
      return {
        total: snapshot.total_tasks,
        completed: snapshot.completed_tasks,
        blocked: snapshot.blocked_tasks,
        live: snapshot.live_tasks,
      }
    }
    return null
  }, [isCurrentWeek, live, snapshot])

  const byCategory = useMemo(() => {
    if (isCurrentWeek && live) return live.byCategory
    if (snapshot) return normalizeCounts(snapshot.by_category)
    return []
  }, [isCurrentWeek, live, snapshot])

  const byOwner = useMemo(() => {
    if (isCurrentWeek && live) return live.byOwner
    if (snapshot) {
      const owners = normalizeCounts(snapshot.by_owner)
      const usersByIdName = new Map<string, string>()
      users?.forEach(u => {
        usersByIdName.set(u.id, u.display_name || u.email)
      })
      return owners.map(o => ({
        ...o,
        name: usersByIdName.get(o.name) || o.name,
      }))
    }
    return []
  }, [isCurrentWeek, live, snapshot, users])

  const completedTasksDisplay: Array<{ id: string; title: string; result_url?: string | null; channel?: string | null }> =
    useMemo(() => {
      if (isCurrentWeek && live) {
        return live.completedTasks.map(t => ({
          id: t.id,
          title: t.title,
          result_url: t.result_url,
          channel: t.channel?.name || null,
        }))
      }
      if (snapshot && Array.isArray((snapshot as unknown as { completed_task_ids?: string[] }).completed_task_ids)) {
        const ids = (snapshot as unknown as { completed_task_ids: string[] }).completed_task_ids
        return ids
          .map(id => {
            const t = taskById.get(id)
            return t
              ? { id: t.id, title: t.title, result_url: t.result_url, channel: t.channel?.name || null }
              : null
          })
          .filter((x): x is { id: string; title: string; result_url: string | null; channel: string | null } => !!x)
      }
      return []
    }, [isCurrentWeek, live, snapshot, taskById])

  const blockedTasksDisplay: Array<{ id: string; title: string; channel?: string | null; reason?: string | null }> =
    useMemo(() => {
      if (isCurrentWeek && live) {
        return live.blockedTasks.map(t => ({
          id: t.id,
          title: t.title,
          channel: t.channel?.name || null,
          reason: t.blocked_reason,
        }))
      }
      if (snapshot && Array.isArray((snapshot as unknown as { blocked_task_ids?: string[] }).blocked_task_ids)) {
        const ids = (snapshot as unknown as { blocked_task_ids: string[] }).blocked_task_ids
        return ids
          .map(id => {
            const t = taskById.get(id)
            return t
              ? { id: t.id, title: t.title, channel: t.channel?.name || null, reason: t.blocked_reason }
              : null
          })
          .filter((x): x is { id: string; title: string; channel: string | null; reason: string | null } => !!x)
      }
      return []
    }, [isCurrentWeek, live, snapshot, taskById])

  const budgetSummary = useMemo(() => {
    type BucketRow = { label: string; total_budget: number; allocated: number; ended_in_week: boolean; unspent: number }
    let totalAllocated = 0
    const buckets: BucketRow[] = []
    const unspentCallouts: Array<{ label: string; unspent: number; total_budget: number }> = []

    if (!isCurrentWeek && snapshot?.budget_summary && typeof snapshot.budget_summary === 'object') {
      const bs = snapshot.budget_summary as {
        total_allocated?: number
        by_bucket?: Array<{ label: string; total_budget: number; allocated: number; ended_in_week?: boolean; unspent?: number }>
        unspent_callouts?: Array<{ label: string; unspent: number; total_budget: number }>
      }
      if (typeof bs.total_allocated === 'number') totalAllocated = bs.total_allocated
      if (Array.isArray(bs.by_bucket)) {
        for (const b of bs.by_bucket) {
          const allocated = Number(b.allocated) || 0
          const total = Number(b.total_budget) || 0
          const ended = !!b.ended_in_week
          const unspent = typeof b.unspent === 'number' ? b.unspent : Math.max(0, total - allocated)
          buckets.push({ label: b.label, total_budget: total, allocated, ended_in_week: ended, unspent })
          if (ended && unspent > 0) unspentCallouts.push({ label: b.label, unspent, total_budget: total })
        }
      }
      if (Array.isArray(bs.unspent_callouts) && unspentCallouts.length === 0) {
        for (const c of bs.unspent_callouts) unspentCallouts.push(c)
      }
      return { totalAllocated, buckets, unspentCallouts }
    }

    if (budgets) {
      for (const b of budgets) {
        const starts = parseISO(b.starts_on)
        const ends = parseISO(b.ends_on)
        const activeInWeek = !(isBefore(selectedWeek.end, starts) || isBefore(ends, selectedWeek.start))
        if (!activeInWeek) continue
        const allocated = Number(b.allocated) || 0
        const total = Number(b.total_budget) || 0
        const endedInWeek = isWithinInterval(ends, { start: selectedWeek.start, end: selectedWeek.end })
        const unspent = Math.max(0, total - allocated)
        totalAllocated += allocated
        buckets.push({
          label: `${b.period_label} (${b.scope_type})`,
          total_budget: total,
          allocated,
          ended_in_week: endedInWeek,
          unspent,
        })
        if (endedInWeek && unspent > 0) {
          unspentCallouts.push({ label: `${b.period_label} (${b.scope_type})`, unspent, total_budget: total })
        }
      }
    }

    return { totalAllocated, buckets, unspentCallouts }
  }, [isCurrentWeek, snapshot, budgets, selectedWeek.start, selectedWeek.end])

  const maxCategory = byCategory.reduce((m, c) => Math.max(m, c.count), 0) || 1
  const maxOwner = byOwner.reduce((m, c) => Math.max(m, c.count), 0) || 1

  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-blue-600" /> Weekly Review
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Time travel through completed ISO weeks. Pick a week to reconstruct the state of the world at end of week.
        </p>
      </div>

      {/* Week picker */}
      <div className="overflow-x-auto pb-2 -mx-1 px-1">
        <div className="flex items-center gap-2 min-w-max">
          {weeks.map((w, i) => {
            const isActive = w.key === selectedKey
            const isCurrent = i === 0
            const hasSnap = isCurrent || snapshotKeySet.has(w.key)
            return (
              <button
                key={w.key}
                onClick={() => setSelectedKey(w.key)}
                className={[
                  'group relative shrink-0 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all',
                  isActive
                    ? 'border-blue-400 bg-blue-50 text-blue-800 shadow-md shadow-blue-200/50'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100',
                ].join(' ')}
              >
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500 group-hover:text-zinc-600">
                  {isCurrent ? 'This week' : `Week of ${format(w.start, 'MMM d')}`}
                </span>
                <span className="block mt-0.5 font-semibold">{w.label}</span>
                {!hasSnap && !isCurrent && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-zinc-600" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected week meta */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span>
          ISO week {format(selectedWeek.start, "RRRR-'W'II")} ·{' '}
          {format(selectedWeek.start, 'EEE d MMM')} to {format(selectedWeek.end, 'EEE d MMM, yyyy')}
        </span>
        {isCurrentWeek ? (
          <Badge className="bg-blue-500/15 text-blue-600 border-blue-300">Live (current week)</Badge>
        ) : hasSnapshot ? (
          <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200">Snapshot</Badge>
        ) : (
          <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300">No snapshot</Badge>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-white rounded-xl" />
          ))}
        </div>
      )}

      {/* No snapshot empty state */}
      {!isLoading && !hasSnapshot && (
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardContent className="py-16 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center">
              <Info className="w-5 h-5 text-zinc-600" />
            </div>
            <h3 className="text-base font-semibold text-zinc-800">No snapshot for this week</h3>
            <p className="text-sm text-zinc-500 max-w-md mx-auto">
              Weekly snapshots are written every Sunday at 23:55 IST for the just-completed ISO week. This week is either
              before the snapshot system started or the job has not run yet.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {!isLoading && hasSnapshot && totals && (
        <>
          <ReportBuilder
            weekKey={selectedWeek.key}
            weekStart={selectedWeek.start}
            weekEnd={selectedWeek.end}
            weekLabel={selectedWeek.label}
            trackerDone={completedTasksDisplay.map(t => ({ title: t.title, channel: t.channel ?? null }))}
          />

          {/* KPI tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Total tasks" value={totals.total} icon={<Layers className="w-5 h-5" />} accent="blue" />
            <KpiTile label="Completed" value={totals.completed} icon={<CheckSquare className="w-5 h-5" />} accent="emerald" />
            <KpiTile label="Blocked" value={totals.blocked} icon={<AlertCircle className="w-5 h-5" />} accent="red" />
            <KpiTile label="Live" value={totals.live} icon={<Zap className="w-5 h-5" />} accent="violet" />
          </div>

          {/* Bars */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By category (stacked by status if available) */}
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" /> Tasks by Category
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {byCategory.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-6">No data.</p>
                ) : (
                  byCategory.map(c => {
                    const pct = (c.count / maxCategory) * 100
                    const segments = c.by_status
                      ? Object.entries(c.by_status).filter(([, n]) => n > 0)
                      : []
                    return (
                      <div key={c.name} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-zinc-700 truncate max-w-[60%]">{c.name}</span>
                          <span className="text-zinc-600">{c.count}</span>
                        </div>
                        <div className="relative h-2 rounded-full bg-zinc-200 overflow-hidden">
                          {segments.length > 0 ? (
                            <div className="absolute inset-0 flex" style={{ width: `${pct}%` }}>
                              {segments.map(([status, n]) => (
                                <div
                                  key={status}
                                  className={statusBarColors[status] || 'bg-zinc-500'}
                                  style={{ flex: `${n} 0 0%` }}
                                  title={`${status}: ${n}`}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
                {byCategory.some(c => c.by_status) && (
                  <div className="flex flex-wrap gap-3 pt-2 text-[10px] text-zinc-500">
                    <LegendDot color="bg-emerald-500" label="Done" />
                    <LegendDot color="bg-blue-500" label="Live" />
                    <LegendDot color="bg-violet-500" label="In progress" />
                    <LegendDot color="bg-red-500" label="Blocked" />
                    <LegendDot color="bg-zinc-600" label="Not started" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* By owner */}
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
                  <UsersIcon className="w-4 h-4 text-violet-600" /> Tasks by Owner
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {byOwner.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-6">No data.</p>
                ) : (
                  byOwner.map(o => {
                    const pct = (o.count / maxOwner) * 100
                    return (
                      <div key={o.name} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-zinc-700 truncate max-w-[60%]">{o.name}</span>
                          <span className="text-zinc-600">{o.count}</span>
                        </div>
                        <Progress value={pct} className="h-2 bg-zinc-200" indicatorClassName="bg-violet-500" />
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Completed + Blocked lists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-emerald-600" /> Completed in This Week
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {completedTasksDisplay.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-8 px-4">
                    Nothing shipped in this week.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-200">
                    {completedTasksDisplay.map(t => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTaskId(t.id)}
                        className="px-4 py-3 hover:bg-zinc-100 transition-colors cursor-pointer flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-medium text-zinc-800 truncate">{t.title}</p>
                          {t.channel && (
                            <p className="text-[11px] text-zinc-500 truncate">{t.channel}</p>
                          )}
                        </div>
                        {t.result_url && (
                          <a
                            href={t.result_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700"
                          >
                            Result <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600" /> Blocked at End of Week
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {blockedTasksDisplay.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-8 px-4">
                    Nothing blocked at end of week.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-200">
                    {blockedTasksDisplay.map(t => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTaskId(t.id)}
                        className="px-4 py-3 hover:bg-zinc-100 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-800 truncate">{t.title}</p>
                          {t.channel && (
                            <span className="shrink-0 text-[11px] text-zinc-500">{t.channel}</span>
                          )}
                        </div>
                        {t.reason && (
                          <p className="text-[11px] text-red-600/80 line-clamp-2">{t.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Budget summary */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
                <Landmark className="w-4 h-4 text-emerald-600" /> Budget Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Total allocated this week
                  </span>
                  <p className="text-2xl font-bold text-emerald-600">
                    ${budgetSummary.totalAllocated.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Active buckets
                  </span>
                  <p className="text-2xl font-bold text-zinc-900">{budgetSummary.buckets.length}</p>
                </div>
              </div>

              {budgetSummary.unspentCallouts.length > 0 && (
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-orange-300 text-xs font-semibold uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4" /> Periods ending this week with unspent funds
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {budgetSummary.unspentCallouts.map(c => (
                      <li key={c.label} className="flex justify-between gap-3 text-zinc-800">
                        <span className="truncate">{c.label}</span>
                        <span className="text-orange-300 font-semibold">
                          ${c.unspent.toLocaleString()} unspent of ${c.total_budget.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-4">
                {budgetSummary.buckets.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-6">
                    No budget periods active during this week.
                  </p>
                ) : (
                  budgetSummary.buckets.map(b => {
                    const pct = b.total_budget > 0
                      ? Math.round((b.allocated / b.total_budget) * 100)
                      : 0
                    return (
                      <div key={b.label} className="space-y-2">
                        <div className="flex justify-between items-center text-xs gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-zinc-700 truncate">{b.label}</span>
                            {b.ended_in_week && (
                              <Badge className="bg-orange-500/15 text-orange-300 border-orange-500/30">
                                Ended this week
                              </Badge>
                            )}
                          </div>
                          <span className="text-zinc-600 shrink-0">
                            ${b.allocated.toLocaleString()} / ${b.total_budget.toLocaleString()} ({pct}%)
                          </span>
                        </div>
                        <Progress
                          value={pct}
                          className="h-1.5 bg-zinc-200"
                          indicatorClassName={pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-orange-500' : 'bg-emerald-500'}
                        />
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Task drawer */}
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

function KpiTile({
  label, value, icon, accent,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accent: 'blue' | 'emerald' | 'red' | 'violet'
}) {
  const accentMap = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    violet: 'bg-violet-50 text-violet-600',
  } as const
  return (
    <Card className="bg-white border-zinc-200 backdrop-blur-xl hover:border-zinc-300 transition-all">
      <CardContent className="p-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
          <h3 className="text-3xl font-bold text-zinc-900 mt-1">{value}</h3>
        </div>
        <div className={`p-3 rounded-xl ${accentMap[accent]}`}>{icon}</div>
      </CardContent>
    </Card>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}
