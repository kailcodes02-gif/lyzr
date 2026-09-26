'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { isBefore, parseISO, startOfDay, format } from 'date-fns'
import { ChevronDown, ChevronRight, Building2, Folder, Layers, GitBranch, ListTodo, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { InfoTip } from '@/components/ui/info-tip'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { TaskFilterBar, EMPTY_FILTERS, applyTaskFilters, filterContextFrom, type TaskFilters } from '@/components/filters/task-filter-bar'
import { useCategories, useChannels, useTasks } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { OPEN_STATUSES } from '@/lib/week-logic'
import { STATUS_CONFIG, type Task, type Channel } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// The whole plan as one collapsible tree:
// Vertical › Group › Channel › Sub-channel › Task › Sub-task.
// Company mode shows every vertical; a vertical space shows just its own.

function counts(tasks: Task[], today: Date) {
  const open = tasks.filter(t => OPEN_STATUSES.has(t.status))
  return { total: tasks.length, open: open.length, done: tasks.filter(t => t.status === 'done').length, overdue: open.filter(t => t.due_date && isBefore(parseISO(t.due_date), today)).length }
}

function Counts({ c }: { c: ReturnType<typeof counts> }) {
  if (!c.total) return <span className="text-[11px] text-zinc-300">empty</span>
  const pct = Math.round((c.done / c.total) * 100)
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-zinc-500 shrink-0">
      <span className="h-1.5 w-16 rounded-full bg-zinc-200 overflow-hidden hidden sm:inline-block"><span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
      <span><strong className="text-zinc-800">{c.open}</strong> open</span>
      <span>{c.done}/{c.total} done</span>
      {c.overdue > 0 && <span className="text-red-600 inline-flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> {c.overdue}</span>}
    </span>
  )
}

function Node({ icon, label, depth, count, defaultOpen, href, children, tone }: {
  icon: React.ReactNode; label: React.ReactNode; depth: number; count: ReturnType<typeof counts>; defaultOpen: boolean; href?: string; children?: React.ReactNode; tone?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const hasChildren = !!children
  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-zinc-200 pl-2')}>
      <div className={cn('flex items-center gap-1.5 py-1.5 rounded-md px-1 hover:bg-zinc-50', tone)}>
        <button onClick={() => setOpen(o => !o)} className="text-zinc-400 w-4 shrink-0" disabled={!hasChildren}>
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : <span className="inline-block w-3.5" />}
        </button>
        <span className="shrink-0">{icon}</span>
        {href ? <Link href={href} className={cn('truncate hover:text-blue-700', depth === 0 ? 'text-sm font-semibold text-zinc-900' : depth === 1 ? 'text-[13px] font-medium text-zinc-700' : 'text-[13px] text-zinc-800')}>{label}</Link>
              : <span className={cn('truncate', depth === 0 ? 'text-sm font-semibold text-zinc-900' : depth === 1 ? 'text-[13px] font-medium text-zinc-700' : 'text-[13px] text-zinc-800')}>{label}</span>}
        <span className="ml-auto"><Counts c={count} /></span>
      </div>
      {open && children}
    </div>
  )
}

function TaskLine({ t, depth, onClick, subs }: { t: Task; depth: number; onClick: (t: Task) => void; subs: Task[] }) {
  const [open, setOpen] = useState(false)
  const cfg = STATUS_CONFIG[t.status]
  const today = startOfDay(new Date())
  const late = t.due_date && OPEN_STATUSES.has(t.status) && isBefore(parseISO(t.due_date), today)
  const owner = t.assignments?.find(a => a.role === 'primary')?.user?.display_name || t.assignments?.[0]?.user?.display_name || (t.pending_assignments || []).find(p => !p.resolved_user_id)?.email.split('@')[0]
  return (
    <div className={cn('ml-4 border-l border-zinc-200 pl-2')}>
      <div className="flex items-center gap-1.5 py-1 rounded-md px-1 hover:bg-blue-50/60">
        <button onClick={() => setOpen(o => !o)} className="text-zinc-400 w-4 shrink-0" disabled={!subs.length}>
          {subs.length ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : <span className="inline-block w-3.5" />}
        </button>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
        <button onClick={() => onClick(t)} className="text-[13px] text-zinc-800 truncate text-left hover:text-blue-700">{t.title}</button>
        {subs.length > 0 && <span className="text-[10px] text-zinc-400">{subs.filter(s => s.status === 'done').length}/{subs.length}</span>}
        <span className="ml-auto inline-flex items-center gap-2 shrink-0 text-[11px] text-zinc-500">
          {owner && <span className="truncate max-w-[110px]">{owner}</span>}
          {t.due_date && <span className={cn(late && 'text-red-600 font-medium')}>{format(parseISO(t.due_date), 'd MMM')}</span>}
          <Badge className="text-[10px] border-0" style={{ backgroundColor: cfg.bgColor, color: cfg.color }}>{cfg.label}</Badge>
        </span>
      </div>
      {open && subs.map(s => <TaskLine key={s.id} t={s} depth={depth + 1} onClick={onClick} subs={[]} />)}
    </div>
  )
}

export function TreeOverview() {
  const { verticalId, verticals, mode } = useVertical()
  const { data: tasks, isLoading } = useTasks({ verticalId })
  const { data: channels } = useChannels(verticalId)
  const { data: categories } = useCategories(verticalId)
  const { data: allChannels } = useChannels('all')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const today = startOfDay(new Date())

  const ctx = useMemo(() => filterContextFrom(allChannels), [allChannels])
  const visible = useMemo(() => applyTaskFilters(tasks || [], filters, ctx), [tasks, filters, ctx])
  const byChannel = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of visible) { if (t.parent_task_id) continue; if (!m.has(t.channel_id)) m.set(t.channel_id, []); m.get(t.channel_id)!.push(t) }
    return m
  }, [visible])
  const subsOf = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of visible) if (t.parent_task_id) { if (!m.has(t.parent_task_id)) m.set(t.parent_task_id, []); m.get(t.parent_task_id)!.push(t) }
    return m
  }, [visible])
  const allTasksUnder = (chIds: string[]) => visible.filter(t => chIds.includes(t.channel_id))
  const childrenOf = (chId: string) => (channels || []).filter(c => c.parent_channel_id === chId && c.is_active)

  const vList = mode === 'workspace' ? verticals : verticals.filter(v => v.id === verticalId)

  const renderChannel = (ch: Channel, depth: number, slug: string) => {
    const kids = childrenOf(ch.id)
    const ids = [ch.id, ...kids.map(k => k.id)]
    const own = (byChannel.get(ch.id) || []).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'))
    return (
      <Node key={ch.id} depth={depth} icon={kids.length || !ch.parent_channel_id ? <Layers className="w-3.5 h-3.5 text-blue-600" /> : <GitBranch className="w-3.5 h-3.5 text-violet-600" />}
        label={ch.name} count={counts(allTasksUnder(ids), today)} defaultOpen={false} href={withVertical('/channel/', slug, { id: ch.id })}>
        {(own.length > 0 || kids.length > 0) && (
          <div>
            {kids.map(k => renderChannel(k, depth + 1, slug))}
            {own.map(t => <TaskLine key={t.id} t={t} depth={depth + 1} onClick={x => setSelectedTaskId(x.id)} subs={subsOf.get(t.id) || []} />)}
          </div>
        )}
      </Node>
    )
  }

  if (isLoading) return <div className="h-96 bg-zinc-200 rounded-xl animate-pulse" />

  return (
    <div className="space-y-4">
      <TaskFilterBar value={filters} onChange={setFilters} tasks={tasks}
        show={{ vertical: false, function: true, owner: true, status: true, priority: true, search: true }} count={visible.length} />
      <div className="rounded-xl border border-zinc-200 bg-white p-3">
        {vList.map(v => {
          const cats = (categories || []).filter(c => c.vertical_id === v.id && c.is_active).sort((a, b) => a.sort_order - b.sort_order)
          const vChannels = (channels || []).filter(c => c.vertical_id === v.id && c.is_active)
          return (
            <Node key={v.id} depth={0} icon={<Building2 className="w-4 h-4 text-blue-600" />} label={v.name}
              count={counts(visible.filter(t => vChannels.some(c => c.id === t.channel_id)), today)} defaultOpen href={withVertical('/dashboard/', v.slug)} tone="bg-zinc-50">
              <div>
                {cats.map(cat => {
                  const tops = vChannels.filter(c => c.category_id === cat.id && !c.parent_channel_id).sort((a, b) => a.sort_order - b.sort_order)
                  const ids = vChannels.filter(c => c.category_id === cat.id).map(c => c.id)
                  return (
                    <Node key={cat.id} depth={1} icon={<Folder className="w-3.5 h-3.5 text-zinc-500" />} label={<>{cat.name} <span className="text-[10px] text-zinc-400 font-normal">group</span></>}
                      count={counts(allTasksUnder(ids), today)} defaultOpen={mode === 'space'}>
                      <div>{tops.map(ch => renderChannel(ch, 2, v.slug))}</div>
                    </Node>
                  )
                })}
                {cats.length === 0 && <p className="text-xs text-zinc-400 pl-6 py-2">No channels yet.</p>}
              </div>
            </Node>
          )
        })}
      </div>
      <p className="text-[11px] text-zinc-400 inline-flex items-center gap-1"><ListTodo className="w-3 h-3" /> Click a name to open its page, a task to open its drawer. Counts respect the filters above.</p>
      {selectedTaskId && <TaskDetailDrawer taskId={selectedTaskId} open onOpenChange={o => { if (!o) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />}
    </div>
  )
}

export function OverviewHeader() {
  const { mode, vertical } = useVertical()
  return (
    <div className="pl-12 lg:pl-0">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
        <GitBranch className="w-6 h-6 text-blue-600" /> {mode === 'workspace' ? 'Company overview' : `${vertical?.name || ''} overview`} <InfoTip k="overview" />
      </h1>
      <p className="text-sm text-zinc-500 mt-1">{mode === 'workspace' ? 'Every vertical, group, channel, sub-channel, task and sub-task in one tree.' : 'This vertical\'s whole plan as one tree, down to sub-tasks.'}</p>
    </div>
  )
}
