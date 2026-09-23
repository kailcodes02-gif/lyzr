'use client'

import { useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { useTasks, useVerticalLookup, useChannels } from '@/lib/hooks/use-data'
import { type GroupKey } from '@/lib/week-logic'
import { WeekDoneBoard } from '@/components/weekly/week-done-board'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { resolveRange, type DateRangeValue } from '@/lib/date-range'
import { TaskFilterBar, EMPTY_FILTERS, applyTaskFilters, filterContextFrom, type TaskFilters } from '@/components/filters/task-filter-bar'

const GROUPINGS: { value: string; label: string; keys: GroupKey[] }[] = [
  { value: 'vco', label: 'Vertical › Channel › Owner', keys: ['vertical', 'channel', 'owner'] },
  { value: 'vo', label: 'Vertical › Owner', keys: ['vertical', 'owner'] },
  { value: 'ov', label: 'Owner › Vertical', keys: ['owner', 'vertical'] },
  { value: 'c', label: 'Channel', keys: ['channel'] },
]

export default function WorkspaceWeeklyPage() {
  // The period is any range (week, month, quarter, custom); the board buckets
  // tasks whose due date falls inside it, plus older open ones carried in.
  const [period, setPeriod] = useState<DateRangeValue>({ preset: 'this_week' })
  const [grouping, setGrouping] = useState('vco')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const lookup = useVerticalLookup()
  const ctx = useMemo(() => ({ verticalById: lookup.verticalById, channelById: lookup.channelById }), [lookup.verticalById, lookup.channelById])
  const fctx = useMemo(() => filterContextFrom(channels), [channels])

  const bounds = useMemo(() => {
    const r = resolveRange(period)
    return { start: r.from || new Date(), end: r.to || new Date() }
  }, [period])
  const filtered = useMemo(() => applyTaskFilters(tasks || [], filters, fctx), [tasks, filters, fctx])

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <CalendarRange className="w-6 h-6 text-blue-600" /> Weekly, across the workspace
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            What was planned for the period (by due date) and whether it got done, for every vertical. Step week by week, month by month, or pick any range.
          </p>
        </div>
        <DateRangePicker label="Period" value={period} onChange={setPeriod} allowAll={false} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[10px] text-zinc-500 font-medium">Group by
          <select value={grouping} onChange={e => setGrouping(e.target.value)} className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700">
            {GROUPINGS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
      </div>
      <TaskFilterBar
        value={filters} onChange={setFilters} tasks={tasks}
        show={{ date: false, vertical: true, function: true, owner: true, status: false, priority: true, search: true }}
        count={filtered.length}
      />

      {isLoading ? (
        <div className="h-64 bg-zinc-200 rounded-xl animate-pulse" />
      ) : (
        <WeekDoneBoard
          tasks={filtered} week={bounds}
          groupBy={GROUPINGS.find(g => g.value === grouping)!.keys}
          ctx={ctx}
          onTaskClick={t => setSelectedTaskId(t.id)}
        />
      )}

      {selectedTaskId && (
        <TaskDetailDrawer taskId={selectedTaskId} open={!!selectedTaskId}
          onOpenChange={open => { if (!open) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />
      )}
    </div>
  )
}
