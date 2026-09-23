'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarRange } from 'lucide-react'
import { useTasks, useVerticalLookup, useFunctions, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { buildWeeks, type GroupKey } from '@/lib/week-logic'
import { WeekDoneBoard } from '@/components/weekly/week-done-board'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { taskChannelIds } from '@/lib/task-channels'

const WEEK_COUNT = 12
const GROUPINGS: { value: string; label: string; keys: GroupKey[] }[] = [
  { value: 'vco', label: 'Vertical › Channel › Owner', keys: ['vertical', 'channel', 'owner'] },
  { value: 'vo', label: 'Vertical › Owner', keys: ['vertical', 'owner'] },
  { value: 'ov', label: 'Owner › Vertical', keys: ['owner', 'vertical'] },
  { value: 'c', label: 'Channel', keys: ['channel'] },
]

export default function WorkspaceWeeklyPage() {
  const weeks = useMemo(() => buildWeeks(WEEK_COUNT), [])
  const [selectedKey, setSelectedKey] = useState(weeks[0].key)
  const [grouping, setGrouping] = useState('vco')
  const [fVertical, setFVertical] = useState('all')
  const [fFunction, setFFunction] = useState('all')
  const [fOwner, setFOwner] = useState('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const { verticals } = useVertical()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: functions } = useFunctions()
  const { data: users } = useUsers()
  const lookup = useVerticalLookup()

  const week = weeks.find(w => w.key === selectedKey) || weeks[0]
  const ctx = useMemo(() => ({ verticalById: lookup.verticalById, channelById: lookup.channelById }), [lookup.verticalById, lookup.channelById])

  const filtered = useMemo(() => (tasks || []).filter(t => {
    if (fVertical !== 'all' && (t.channel?.vertical_id || lookup.channelById.get(t.channel_id)?.vertical_id) !== fVertical) return false
    if (fFunction !== 'all') {
      const inFn = taskChannelIds(t).some(id => lookup.channelById.get(id)?.function_id === fFunction)
      if (!inFn) return false
    }
    if (fOwner !== 'all' && !t.assignments?.some(a => a.user_id === fOwner)) return false
    return true
  }), [tasks, fVertical, fFunction, fOwner, lookup.channelById])

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <CalendarRange className="w-6 h-6 text-blue-600" /> Weekly, across the workspace
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          What was planned for the week (by due date) and whether it got done, for every vertical.
        </p>
      </div>

      <div className="overflow-x-auto pb-2 -mx-1 px-1">
        <div className="flex items-center gap-2 min-w-max">
          {weeks.map((w, i) => (
            <button key={w.key} onClick={() => setSelectedKey(w.key)}
              className={['shrink-0 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all',
                w.key === selectedKey ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'].join(' ')}>
              <span className="block text-[10px] uppercase tracking-wider text-zinc-500">{i === 0 ? 'This week' : `Week of ${format(w.start, 'MMM d')}`}</span>
              <span className="block mt-0.5 font-semibold">{w.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-zinc-100 border border-zinc-300 rounded-xl p-3 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Group by
          <select value={grouping} onChange={e => setGrouping(e.target.value)} className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700">
            {GROUPINGS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Vertical
          <select value={fVertical} onChange={e => setFVertical(e.target.value)} className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700">
            <option value="all">All</option>{verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Function
          <select value={fFunction} onChange={e => setFFunction(e.target.value)} className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700">
            <option value="all">All</option>{(functions || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-zinc-500 font-medium">Owner
          <select value={fOwner} onChange={e => setFOwner(e.target.value)} className="bg-white border border-zinc-300 rounded-lg px-3 py-1.5 text-xs text-zinc-700">
            <option value="all">All</option>{(users || []).filter(u => u.email !== 'preview@lyzr.ai').map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="h-64 bg-zinc-200 rounded-xl animate-pulse" />
      ) : (
        <WeekDoneBoard
          tasks={filtered} week={week}
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
