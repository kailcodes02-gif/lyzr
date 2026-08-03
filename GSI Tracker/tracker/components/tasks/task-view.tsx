'use client'

import { useMemo, useState } from 'react'
import { type Task, type TaskStatus, STATUS_CONFIG, KANBAN_COLUMNS } from '@/lib/types/database'
import { TaskCard, TaskRow } from './task-card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Columns3, Table as TableIcon, Eye, EyeOff, Trash2, X, Loader2, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Hover explanations for each board column
const STATUS_HELP: Record<string, string> = {
  not_started: 'Planned work that has not begun. Drag a card here (or use its status dropdown) to send it back to the queue.',
  in_progress: 'Actively being worked on right now by its owners.',
  live: 'The campaign/activity is running in the market. Once live, its Tracker fields open up for recording actual results (KPI actual, spend, evidence).',
  blocked: 'Cannot move forward — something or someone is in the way. Open the card to record the blocker reason and who it waits on.',
  done: 'Finished and results captured. Done tasks feed the Tracker and Weekly Review reports.',
  cancelled: 'Deliberately abandoned. Kept for history; hidden from the board by default.',
}
import { cn } from '@/lib/utils'
import { updateTask, bulkUpdateTaskStatus, bulkSetPrimaryAssignee, bulkDeleteTasks } from '@/lib/actions'
import { useUsers, useTasks } from '@/lib/hooks/use-data'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

interface TaskViewProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
  showChannelColumn?: boolean
}

export function TaskView({ tasks: allTasks, onTaskClick, showChannelColumn }: TaskViewProps) {
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban')
  const [showCancelled, setShowCancelled] = useState(false)
  // Sub-activities render nested INSIDE their parent activity card, so the
  // board/table lists only top-level activities — EXCEPT orphans: on filtered
  // pages (e.g. My Tasks) a sub-activity whose parent isn't in the list must
  // still show as its own card or it would vanish entirely.
  const presentIds = new Set(allTasks.map(t => t.id))
  const tasks = allTasks.filter(t => !t.parent_task_id || !presentIds.has(t.parent_task_id))

  return (
    <div>
      {/* View toggle */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex bg-zinc-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('kanban')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              viewMode === 'kanban' ? 'bg-zinc-200/70 text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'
            )}
          >
            <Columns3 className="w-3.5 h-3.5" /> Kanban
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              viewMode === 'table' ? 'bg-zinc-200/70 text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'
            )}
          >
            <TableIcon className="w-3.5 h-3.5" /> Table
          </button>
        </div>
        <button
          onClick={() => setShowCancelled(!showCancelled)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
        >
          {showCancelled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showCancelled ? 'Hide' : 'Show'} Cancelled
        </button>
      </div>

      {viewMode === 'kanban' ? (
        <KanbanBoard tasks={tasks} onTaskClick={onTaskClick} showCancelled={showCancelled} />
      ) : (
        <TaskTable tasks={tasks} onTaskClick={onTaskClick} showCancelled={showCancelled} showChannelColumn={showChannelColumn} />
      )}
    </div>
  )
}

function KanbanBoard({ tasks, onTaskClick, showCancelled }: {
  tasks: Task[]
  onTaskClick: (task: Task) => void
  showCancelled: boolean
}) {
  const queryClient = useQueryClient()
  const columns = showCancelled ? [...KANBAN_COLUMNS, 'cancelled' as TaskStatus] : KANBAN_COLUMNS

  const handleDrop = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await updateTask(taskId, { status: newStatus })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success(`Task moved to ${STATUS_CONFIG[newStatus].label}`)
    } catch (err: any) {
      console.error('updateTask (kanban drop) failed:', err)
      toast.error(err?.message || 'Failed to update task status')
    }
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map(status => {
        const config = STATUS_CONFIG[status]
        const columnTasks = tasks.filter(t => t.status === status)

        return (
          <div
            key={status}
            className="flex-shrink-0 w-72"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const taskId = e.dataTransfer.getData('taskId')
              if (taskId) handleDrop(taskId, status)
            }}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
              <span className="text-sm font-medium text-zinc-700">{config.label}</span>
              <span className="text-xs text-zinc-600 bg-zinc-100 px-1.5 py-0.5 rounded-full">
                {columnTasks.length}
              </span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-600" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
                  {STATUS_HELP[status]}
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Cards */}
            <div className="space-y-2">
              {columnTasks.map(task => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('taskId', task.id)
                  }}
                >
                  {/* Clicking a nested sub-activity opens the PARENT activity
                      drawer — sub-activity ops live inline there. */}
                  <TaskCard task={task} onClick={() => onTaskClick(task)} onSubtaskClick={() => onTaskClick(task)} compact />
                </div>
              ))}
              {columnTasks.length === 0 && (
                <div className="text-center py-8 text-zinc-600 text-xs border border-dashed border-zinc-200 rounded-xl">
                  No tasks
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskTable({ tasks, onTaskClick, showCancelled, showChannelColumn }: {
  tasks: Task[]
  onTaskClick: (task: Task) => void
  showCancelled: boolean
  showChannelColumn?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: users } = useUsers()
  // Full task list (react-query cache) to resolve parent titles for
  // sub-activity rows whose parent isn't part of the filtered list.
  const { data: allTasksForParents } = useTasks()
  const titleById = useMemo(
    () => new Map((allTasksForParents || []).map(t => [t.id, t.title])),
    [allTasksForParents]
  )

  const filteredTasks = showCancelled ? tasks : tasks.filter(t => t.status !== 'cancelled')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkRunning, setIsBulkRunning] = useState(false)

  // Keep selection in sync with what's actually visible (e.g. after a filter
  // toggle or a bulk delete removes rows).
  const visibleIds = useMemo(() => new Set(filteredTasks.map(t => t.id)), [filteredTasks])
  const selectedVisible = useMemo(
    () => [...selectedIds].filter(id => visibleIds.has(id)),
    [selectedIds, visibleIds]
  )

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const allVisibleSelected = filteredTasks.length > 0 && selectedVisible.length === filteredTasks.length
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filteredTasks.map(t => t.id)) : new Set())
  }

  const clearSelection = () => setSelectedIds(new Set())

  const afterBulk = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['activity'] })
    clearSelection()
  }

  const runBulkStatus = async (status: TaskStatus) => {
    if (selectedVisible.length === 0) return
    setIsBulkRunning(true)
    try {
      const res = await bulkUpdateTaskStatus(selectedVisible, status)
      afterBulk()
      toast.success(`Updated ${res.updated} task${res.updated === 1 ? '' : 's'} to ${STATUS_CONFIG[status].label}`)
    } catch (err: any) {
      console.error('bulkUpdateTaskStatus failed:', err)
      toast.error(err?.message || 'Bulk status update failed')
    } finally {
      setIsBulkRunning(false)
    }
  }

  const runBulkAssignee = async (userId: string) => {
    if (selectedVisible.length === 0 || !userId) return
    setIsBulkRunning(true)
    try {
      const res = await bulkSetPrimaryAssignee(selectedVisible, userId)
      afterBulk()
      toast.success(`Set primary owner on ${res.updated} task${res.updated === 1 ? '' : 's'}`)
    } catch (err: any) {
      console.error('bulkSetPrimaryAssignee failed:', err)
      toast.error(err?.message || 'Bulk assignee update failed')
    } finally {
      setIsBulkRunning(false)
    }
  }

  const runBulkDelete = async () => {
    if (selectedVisible.length === 0) return
    if (!confirm(`Delete ${selectedVisible.length} task${selectedVisible.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    setIsBulkRunning(true)
    try {
      const res = await bulkDeleteTasks(selectedVisible)
      afterBulk()
      toast.success(`Deleted ${res.deleted} task${res.deleted === 1 ? '' : 's'}`)
    } catch (err: any) {
      console.error('bulkDeleteTasks failed:', err)
      toast.error(err?.message || 'Bulk delete failed')
    } finally {
      setIsBulkRunning(false)
    }
  }

  const colSpan = (showChannelColumn ? 5 : 4) + 1

  return (
    <div className="space-y-3">
      {selectedVisible.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-xs font-medium text-blue-800">
            {selectedVisible.length} selected
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-600">Set status</span>
            <Select onValueChange={val => { if (val) runBulkStatus(val as TaskStatus) }} disabled={isBulkRunning}>
              <SelectTrigger className="h-7 w-[150px] bg-white border-zinc-300 text-xs text-zinc-800">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent className="bg-white shadow-lg border-zinc-300">
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                      {config.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-600">Set owner</span>
            <Select onValueChange={val => { if (val) runBulkAssignee(val as string) }} disabled={isBulkRunning}>
              <SelectTrigger className="h-7 w-[170px] bg-white border-zinc-300 text-xs text-zinc-800">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent className="bg-white shadow-lg border-zinc-300 max-h-60">
                {users?.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.display_name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={runBulkDelete}
            disabled={isBulkRunning}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 text-xs"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
          </Button>

          {isBulkRunning && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}

          <Button
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            disabled={isBulkRunning}
            className="text-zinc-600 hover:text-zinc-800 h-7 text-xs ml-auto"
          >
            <X className="w-3.5 h-3.5 mr-1" /> Clear
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-100/50">
              <th className="text-left py-3 pl-4 pr-0 w-8">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={checked => toggleAll(!!checked)}
                  disabled={filteredTasks.length === 0}
                  className="border-zinc-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                  aria-label="Select all tasks"
                />
              </th>
              <th className="text-left text-xs font-medium text-zinc-600 py-3 px-4">Title</th>
              <th className="text-left text-xs font-medium text-zinc-600 py-3 px-4">Status</th>
              <th className="text-left text-xs font-medium text-zinc-600 py-3 px-4">Owners</th>
              <th className="text-left text-xs font-medium text-zinc-600 py-3 px-4">Due Date</th>
              {showChannelColumn && (
                <th className="text-left text-xs font-medium text-zinc-600 py-3 px-4">Channel</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
                selectable
                selected={selectedIds.has(task.id)}
                onSelectChange={checked => toggleOne(task.id, checked)}
                parentLabel={task.parent_task_id ? titleById.get(task.parent_task_id) : undefined}
              />
            ))}
            {filteredTasks.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="py-12 text-center text-zinc-600 text-sm">
                  No tasks found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
