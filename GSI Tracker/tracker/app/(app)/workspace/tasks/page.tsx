'use client'

import { useMemo, useState } from 'react'
import { Table2, Search } from 'lucide-react'
import { useTasks, useVerticalLookup, useFunctions, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Input } from '@/components/ui/input'
import { STATUS_CONFIG, type TaskStatus, type TaskPriority } from '@/lib/types/database'
import { taskChannelIds } from '@/lib/task-channels'

export default function WorkspaceTasksPage() {
  const { verticals } = useVertical()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: functions } = useFunctions()
  const { data: users } = useUsers()
  const lookup = useVerticalLookup()

  const [fVertical, setFVertical] = useState('all')
  const [fFunction, setFFunction] = useState('all')
  const [fOwner, setFOwner] = useState('all')
  const [fStatus, setFStatus] = useState<'all' | TaskStatus>('all')
  const [fPriority, setFPriority] = useState<'all' | TaskPriority>('all')
  const [search, setSearch] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (tasks || []).filter(t => {
      if (fVertical !== 'all' && (t.channel?.vertical_id || lookup.channelById.get(t.channel_id)?.vertical_id) !== fVertical) return false
      if (fFunction !== 'all' && !taskChannelIds(t).some(id => lookup.channelById.get(id)?.function_id === fFunction)) return false
      if (fOwner !== 'all' && !t.assignments?.some(a => a.user_id === fOwner)) return false
      if (fStatus !== 'all' && t.status !== fStatus) return false
      if (fPriority !== 'all' && t.priority !== fPriority) return false
      if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, fVertical, fFunction, fOwner, fStatus, fPriority, search, lookup.channelById])

  const sel = 'bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700'

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1400px] mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <Table2 className="w-6 h-6 text-blue-600" /> All tasks
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Every task in every vertical. Filter by vertical, function, owner, status or priority.</p>
      </div>

      <div className="bg-zinc-100 border border-zinc-300 rounded-xl p-3 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Vertical
          <select value={fVertical} onChange={e => setFVertical(e.target.value)} className={sel}><option value="all">All</option>{verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Function
          <select value={fFunction} onChange={e => setFFunction(e.target.value)} className={sel}><option value="all">All</option>{(functions || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Owner
          <select value={fOwner} onChange={e => setFOwner(e.target.value)} className={sel}><option value="all">All</option>{(users || []).filter(u => u.email !== 'preview@lyzr.ai').map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Status
          <select value={fStatus} onChange={e => setFStatus(e.target.value as 'all' | TaskStatus)} className={sel}><option value="all">All</option>{Object.entries(STATUS_CONFIG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Priority
          <select value={fPriority} onChange={e => setFPriority(e.target.value as 'all' | TaskPriority)} className={sel}><option value="all">All</option>{(['P0', 'P1', 'P2', 'P3', 'P4'] as TaskPriority[]).map(p => <option key={p} value={p}>{p}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium flex-1 min-w-[200px]">Search
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Title or description" className="bg-white border-zinc-300 text-xs h-8 pl-8" />
          </div>
        </label>
        <span className="text-xs text-zinc-500 pb-2">{filtered.length} task{filtered.length === 1 ? '' : 's'}</span>
      </div>

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
