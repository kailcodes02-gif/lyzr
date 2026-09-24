'use client'

import { useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'
import { useTasks, useChannels } from '@/lib/hooks/use-data'
import { TaskView } from '@/components/tasks/task-view'
import { InfoTip } from '@/components/ui/info-tip'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { TaskFilterBar, EMPTY_FILTERS, applyTaskFilters, filterContextFrom, type TaskFilters } from '@/components/filters/task-filter-bar'

export default function WorkspaceTasksPage() {
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const ctx = useMemo(() => filterContextFrom(channels), [channels])
  const filtered = useMemo(() => applyTaskFilters(tasks || [], filters, ctx), [tasks, filters, ctx])

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1400px] mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <Table2 className="w-6 h-6 text-blue-600" /> All tasks <InfoTip text="Every task in every vertical. Use the filter bar to narrow by date, vertical, function, owner, status or priority." />
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Every task in every vertical. Filter by date, vertical, function, owner, status or priority.</p>
      </div>

      <TaskFilterBar
        value={filters} onChange={setFilters} tasks={tasks}
        show={{ vertical: true, function: true, owner: true, status: true, priority: true, search: true }}
        dateFields={['due_date', 'completed_at', 'created_at', 'went_live_at']}
        count={filtered.length}
      />

      {isLoading ? <div className="h-96 bg-zinc-200 rounded-xl animate-pulse" /> : (
        <TaskView tasks={filtered} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn showVerticalColumn defaultView="table" />
      )}

      {selectedTaskId && (
        <TaskDetailDrawer taskId={selectedTaskId} open={!!selectedTaskId}
          onOpenChange={open => { if (!open) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />
      )}
    </div>
  )
}
