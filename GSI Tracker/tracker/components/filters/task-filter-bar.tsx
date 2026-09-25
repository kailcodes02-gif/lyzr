'use client'

import { useMemo } from 'react'
import { Filter, Search, X } from 'lucide-react'
import { InfoTip } from '@/components/ui/info-tip'
import { Input } from '@/components/ui/input'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { MultiSelect } from '@/components/leads/multi-select'
import { useVertical } from '@/lib/hooks/use-vertical'
import { useCategories, useChannels, useFunctions, useUsers } from '@/lib/hooks/use-data'
import { ALL_TIME, inRange, resolveRange, type DateRangeValue } from '@/lib/date-range'
import { taskChannelIds } from '@/lib/task-channels'
import { STATUS_CONFIG, type Task, type TaskStatus, type TaskPriority } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// One filter model for every task list in the app. Pages keep it in state
// (or persisted) and run `applyTaskFilters` over their tasks. Which date a
// task is matched on is the page's choice (due date, completion, creation).

export type DateField = 'due_date' | 'completed_at' | 'created_at' | 'went_live_at'

export interface TaskFilters {
  range: DateRangeValue
  dateField: DateField
  owners: string[]      // user ids or pending emails
  statuses: string[]    // TaskStatus[]
  priorities: string[]  // TaskPriority[]
  verticals: string[]
  functions: string[]
  categories: string[]
  channels: string[]
  search: string
}

export const EMPTY_FILTERS: TaskFilters = {
  range: ALL_TIME, dateField: 'due_date', owners: [], statuses: [], priorities: [],
  verticals: [], functions: [], categories: [], channels: [], search: '',
}

export function filtersActive(f: TaskFilters): boolean {
  return f.range.preset !== 'all' || !!f.owners.length || !!f.statuses.length || !!f.priorities.length
    || !!f.verticals.length || !!f.functions.length || !!f.categories.length || !!f.channels.length || !!f.search.trim()
}

export interface FilterContext {
  channelFunction: (channelId: string) => string | null | undefined
  channelVertical: (channelId: string) => string | null | undefined
  channelCategory: (channelId: string) => string | null | undefined
}

export function ownerKeysOf(t: Task): string[] {
  return [
    ...(t.assignments || []).map(a => a.user_id),
    ...(t.pending_assignments || []).filter(p => !p.resolved_user_id).map(p => p.email.toLowerCase()),
  ]
}

export function applyTaskFilters(tasks: Task[], f: TaskFilters, ctx: FilterContext): Task[] {
  const r = resolveRange(f.range)
  const q = f.search.trim().toLowerCase()
  const has = (arr: string[]) => arr.length > 0
  return tasks.filter(t => {
    if ((r.from || r.to) && !inRange(t[f.dateField] as string | null, r)) return false
    if (has(f.statuses) && !f.statuses.includes(t.status)) return false
    if (has(f.priorities) && !f.priorities.includes(t.priority)) return false
    if (has(f.owners)) {
      const keys = ownerKeysOf(t)
      if (f.owners.includes('__unassigned__') ? keys.length > 0 && !keys.some(k => f.owners.includes(k)) : !keys.some(k => f.owners.includes(k))) return false
    }
    const chIds = taskChannelIds(t)
    if (has(f.verticals) && !chIds.some(id => f.verticals.includes(ctx.channelVertical(id) || ''))) return false
    if (has(f.functions) && !chIds.some(id => f.functions.includes(ctx.channelFunction(id) || ''))) return false
    if (has(f.categories) && !chIds.some(id => f.categories.includes(ctx.channelCategory(id) || ''))) return false
    if (has(f.channels) && !chIds.some(id => f.channels.includes(id))) return false
    if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false
    return true
  })
}

const DATE_FIELD_LABELS: Record<DateField, string> = {
  due_date: 'Due', completed_at: 'Completed', created_at: 'Created', went_live_at: 'Went live',
}

export function TaskFilterBar({ value, onChange, show, dateFields, tasks, count, className }: {
  value: TaskFilters
  onChange: (next: TaskFilters) => void
  // which controls to render; owners + date + status on by default
  show?: Partial<Record<'date' | 'owner' | 'status' | 'priority' | 'vertical' | 'function' | 'category' | 'channel' | 'search', boolean>>
  dateFields?: DateField[]   // more than one = a "match on" selector appears
  tasks?: Task[]              // to derive owner options from the list itself
  count?: number
  className?: string
}) {
  const { verticalId, verticals, mode } = useVertical()
  const { data: users } = useUsers()
  const { data: functions } = useFunctions()
  const { data: categories } = useCategories(verticalId)
  const { data: channels } = useChannels(verticalId)
  const s = { date: true, owner: true, status: true, priority: false, vertical: mode === 'workspace', function: false, category: false, channel: false, search: false, ...(show || {}) }
  const set = (patch: Partial<TaskFilters>) => onChange({ ...value, ...patch })

  // Owner options: signed-in users plus any pending emails on the given tasks.
  const ownerOptions = useMemo(() => {
    const m = new Map<string, string>()
    users?.filter(u => u.email !== 'preview@lyzr.ai').forEach(u => m.set(u.id, u.display_name || u.email))
    tasks?.forEach(t => (t.pending_assignments || []).forEach(p => { if (!p.resolved_user_id) m.set(p.email.toLowerCase(), `${p.email.split('@')[0]} (pending)`) }))
    return m
  }, [users, tasks])
  const ownerLabels = useMemo(() => [...ownerOptions.values()].sort(), [ownerOptions])
  const labelToKey = useMemo(() => new Map([...ownerOptions.entries()].map(([k, v]) => [v, k])), [ownerOptions])
  const keyToLabel = (k: string) => ownerOptions.get(k) || k
  const OWNER_UNASSIGNED = 'Unassigned'

  const statusLabels = Object.entries(STATUS_CONFIG).map(([k, c]) => c.label + `|${k}`)
  const channelLabel = (c: { id: string; name: string; parent_channel_id: string | null }) => {
    const parent = channels?.find(p => p.id === c.parent_channel_id)
    return parent ? `${parent.name} › ${c.name}` : c.name
  }

  const multi = (label: string, options: string[], selected: string[], onSel: (v: string[]) => void, width?: string) =>
    <MultiSelect label={label} options={options} selected={selected} onChange={onSel} width={width} />

  return (
    <div className={cn('bg-zinc-100 border border-zinc-300 rounded-xl p-3 flex flex-wrap items-center gap-2', className)}>
      <span className="inline-flex items-center gap-1.5 text-zinc-600 text-xs font-medium uppercase tracking-wider mr-1">
        <Filter className="w-3.5 h-3.5" /> Filters <InfoTip k="date_field" />
      </span>

      {s.date && (
        <div className="inline-flex items-center gap-1">
          {(dateFields && dateFields.length > 1) ? (
            <select value={value.dateField} onChange={e => set({ dateField: e.target.value as DateField })}
              className="h-8 text-xs rounded-md border border-zinc-300 bg-white px-2 text-zinc-700">
              {dateFields.map(d => <option key={d} value={d}>{DATE_FIELD_LABELS[d]}</option>)}
            </select>
          ) : (
            <span className="text-[10px] text-zinc-500 font-medium">{DATE_FIELD_LABELS[(dateFields?.[0] || value.dateField)]}</span>
          )}
          <DateRangePicker value={value.range} onChange={range => set({ range })} />
        </div>
      )}

      {s.vertical && verticals.length > 1 && multi('Vertical',
        verticals.map(v => v.name),
        value.verticals.map(id => verticals.find(v => v.id === id)?.name || id),
        names => set({ verticals: names.map(n => verticals.find(v => v.name === n)?.id || n) }), 'w-[160px]')}

      {s.function && multi('Domain',
        (functions || []).map(f => f.name),
        value.functions.map(id => functions?.find(f => f.id === id)?.name || id),
        names => set({ functions: names.map(n => functions?.find(f => f.name === n)?.id || n) }), 'w-[160px]')}

      {s.category && multi('Group',
        (categories || []).map(c => c.name),
        value.categories.map(id => categories?.find(c => c.id === id)?.name || id),
        names => set({ categories: names.map(n => categories?.find(c => c.name === n)?.id || n) }), 'w-[160px]')}

      {s.channel && multi('Channel',
        (channels || []).map(channelLabel),
        value.channels.map(id => { const c = channels?.find(x => x.id === id); return c ? channelLabel(c) : id }),
        labels => set({ channels: labels.map(l => channels?.find(c => channelLabel(c) === l)?.id || l) }), 'w-[200px]')}

      {s.owner && multi('Owner',
        [OWNER_UNASSIGNED, ...ownerLabels],
        value.owners.map(k => k === '__unassigned__' ? OWNER_UNASSIGNED : keyToLabel(k)),
        labels => set({ owners: labels.map(l => l === OWNER_UNASSIGNED ? '__unassigned__' : (labelToKey.get(l) || l)) }), 'w-[170px]')}

      {s.status && multi('Status',
        statusLabels.map(x => x.split('|')[0]),
        value.statuses.map(k => STATUS_CONFIG[k as TaskStatus]?.label || k),
        labels => set({ statuses: labels.map(l => (Object.entries(STATUS_CONFIG).find(([, c]) => c.label === l)?.[0] || l)) }), 'w-[150px]')}

      {s.priority && multi('Priority', ['P0', 'P1', 'P2', 'P3', 'P4'], value.priorities, v => set({ priorities: v as TaskPriority[] }), 'w-[130px]')}

      {s.search && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={value.search} onChange={e => set({ search: e.target.value })} placeholder="Search title or description"
            className="bg-white border-zinc-300 text-xs h-8 pl-8 w-52" />
        </div>
      )}

      {filtersActive(value) && (
        <button onClick={() => onChange({ ...EMPTY_FILTERS, dateField: value.dateField })} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-500 font-medium">
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
      {typeof count === 'number' && <span className="ml-auto text-xs text-zinc-500">{count} {count === 1 ? 'task' : 'tasks'}</span>}
    </div>
  )
}

// Convenience: build the FilterContext from the workspace-wide channel list.
export function filterContextFrom(channels: { id: string; vertical_id: string; function_id: string | null; category_id: string }[] | undefined): FilterContext {
  const m = new Map((channels || []).map(c => [c.id, c]))
  return {
    channelFunction: id => m.get(id)?.function_id,
    channelVertical: id => m.get(id)?.vertical_id,
    channelCategory: id => m.get(id)?.category_id,
  }
}
