'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ChevronRight, CheckSquare, CircleDashed, AlertTriangle, Ban } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { STATUS_CONFIG, type Task, type Channel, type Vertical } from '@/lib/types/database'
import { bucketWeek, groupTasks, type Group, type GroupKey, type WeekRange } from '@/lib/week-logic'
import { cn } from '@/lib/utils'

// Founder view: what was planned for a week (by due date) split into done,
// not done and overdue carried in, grouped Vertical › Channel › Owner.

export interface WeekBoardContext {
  verticalById: Map<string, Vertical>
  channelById: Map<string, Channel>
}

function ownerLabel(t: Task): string {
  const primary = t.assignments?.find(a => a.role === 'primary') || t.assignments?.[0]
  if (primary) return primary.user?.display_name || primary.user?.email || 'Owner'
  const pending = (t.pending_assignments || []).find(p => !p.resolved_user_id)
  if (pending) return pending.email.split('@')[0]
  return 'Unassigned'
}

export function resolveGroup(ctx: WeekBoardContext) {
  return (t: Task, key: GroupKey) => {
    if (key === 'vertical') {
      const vid = t.channel?.vertical_id || ctx.channelById.get(t.channel_id)?.vertical_id || ''
      const v = ctx.verticalById.get(vid)
      return { key: vid || 'none', label: v?.name || 'No vertical' }
    }
    if (key === 'channel') {
      const ch = t.channel || ctx.channelById.get(t.channel_id)
      const parent = ch?.parent_channel_id ? ctx.channelById.get(ch.parent_channel_id) : null
      return { key: ch?.id || 'none', label: parent ? `${parent.name} › ${ch?.name}` : (ch?.name || 'No channel') }
    }
    const o = ownerLabel(t)
    return { key: o.toLowerCase(), label: o }
  }
}

function TaskLine({ t, onClick }: { t: Task; onClick: (t: Task) => void }) {
  const cfg = STATUS_CONFIG[t.status]
  return (
    <button onClick={() => onClick(t)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50 rounded-md">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
      <span className="text-sm text-zinc-800 truncate flex-1">{t.title}</span>
      <span className="text-[11px] text-zinc-500 shrink-0">{ownerLabel(t)}</span>
      {t.due_date && <span className="text-[11px] text-zinc-400 shrink-0 w-14 text-right">{format(parseISO(t.due_date), 'd MMM')}</span>}
      <Badge className="text-[10px] border-0 shrink-0" style={{ backgroundColor: cfg.bgColor, color: cfg.color }}>{cfg.label}</Badge>
    </button>
  )
}

function GroupNode({ g, depth, onClick, defaultOpen }: { g: Group<Task>; depth: number; onClick: (t: Task) => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const leaf = !g.children
  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-zinc-200 pl-2')}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-1.5 py-1.5 text-left">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
        <span className={cn('truncate', depth === 0 ? 'text-sm font-semibold text-zinc-800' : depth === 1 ? 'text-[13px] font-medium text-zinc-700' : 'text-xs text-zinc-600')}>{g.label}</span>
        <span className="text-[11px] text-zinc-400">{g.items.length}</span>
      </button>
      {open && (leaf
        ? <div className="space-y-0.5 mb-1">{g.items.map(t => <TaskLine key={t.id} t={t} onClick={onClick} />)}</div>
        : g.children!.map(c => <GroupNode key={c.key} g={c} depth={depth + 1} onClick={onClick} defaultOpen={depth < 1} />)
      )}
    </div>
  )
}

export function WeekDoneBoard({ tasks, week, groupBy, ctx, onTaskClick }: {
  tasks: Task[]
  week: WeekRange | { start: Date; end: Date }
  groupBy: GroupKey[]
  ctx: WeekBoardContext
  onTaskClick: (t: Task) => void
}) {
  const buckets = useMemo(() => bucketWeek(tasks, week), [tasks, week])
  const resolver = useMemo(() => resolveGroup(ctx), [ctx])
  const sections: { key: string; title: string; icon: React.ReactNode; items: Task[]; tone: string }[] = [
    { key: 'done', title: 'Done', icon: <CheckSquare className="w-4 h-4" />, items: buckets.done, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { key: 'notDone', title: 'Not done', icon: <CircleDashed className="w-4 h-4" />, items: buckets.notDone, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
    { key: 'overdue', title: 'Overdue carried in', icon: <AlertTriangle className="w-4 h-4" />, items: buckets.overdueCarried, tone: 'text-red-700 bg-red-50 border-red-200' },
    { key: 'cancelled', title: 'Cancelled', icon: <Ban className="w-4 h-4" />, items: buckets.cancelled, tone: 'text-zinc-600 bg-zinc-100 border-zinc-200' },
  ]
  const planned = buckets.done.length + buckets.notDone.length
  const pct = planned ? Math.round((buckets.done.length / planned) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-zinc-600">
        <span><strong className="text-zinc-900">{buckets.done.length}</strong> of <strong className="text-zinc-900">{planned}</strong> planned tasks done ({pct}%)</span>
        <div className="h-1.5 w-40 rounded-full bg-zinc-200 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        {buckets.overdueCarried.length > 0 && <span className="text-red-600">{buckets.overdueCarried.length} overdue from earlier weeks</span>}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {sections.filter(s => s.key !== 'cancelled' || s.items.length > 0).map(s => (
          <Card key={s.key} className="bg-white border-zinc-200">
            <CardHeader className="py-3">
              <CardTitle className={cn('text-sm font-semibold flex items-center gap-2 rounded-lg border px-2.5 py-1 w-fit', s.tone)}>
                {s.icon} {s.title} <span className="font-normal opacity-80">{s.items.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {s.items.length === 0
                ? <p className="text-xs text-zinc-400 py-2">Nothing here.</p>
                : groupTasks(s.items, groupBy, resolver).map(g => <GroupNode key={g.key} g={g} depth={0} onClick={onTaskClick} defaultOpen />)}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
