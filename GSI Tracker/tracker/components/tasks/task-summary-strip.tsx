'use client'

import { isBefore, parseISO, startOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { OPEN_STATUSES } from '@/lib/week-logic'
import type { Task } from '@/lib/types/database'

// One glance over whatever the filters show: total, done, not done, live,
// blocked, overdue, and the P0/P1 still open. Tiles toggle the status filter.

export function TaskSummaryStrip({ tasks, onPick, active }: { tasks: Task[]; onPick: (statuses: string[]) => void; active: string[] }) {
  const today = startOfDay(new Date())
  const open = tasks.filter(t => OPEN_STATUSES.has(t.status))
  const done = tasks.filter(t => t.status === 'done')
  const live = tasks.filter(t => t.status === 'live')
  const blocked = tasks.filter(t => t.status === 'blocked')
  const overdue = open.filter(t => t.due_date && isBefore(parseISO(t.due_date), today))
  const critical = open.filter(t => t.priority === 'P0' || t.priority === 'P1')
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
  const openSet = ['not_started', 'in_progress', 'live', 'blocked']

  const tiles: { label: string; value: number; tone: string; statuses?: string[]; hint?: string }[] = [
    { label: 'All', value: tasks.length, tone: 'text-zinc-900', statuses: [] },
    { label: 'Done', value: done.length, tone: 'text-emerald-700', statuses: ['done'], hint: `${pct}%` },
    { label: 'Not done', value: open.length, tone: 'text-amber-700', statuses: openSet },
    { label: 'Live', value: live.length, tone: 'text-emerald-600', statuses: ['live'] },
    { label: 'Blocked', value: blocked.length, tone: 'text-red-600', statuses: ['blocked'] },
    { label: 'Overdue', value: overdue.length, tone: 'text-red-700', hint: 'open, past due' },
    { label: 'P0 / P1 open', value: critical.length, tone: 'text-orange-700', hint: 'critical' },
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {tiles.map(t => {
          const clickable = !!t.statuses
          const on = clickable && same(active, t.statuses!)
          return (
            <button key={t.label} disabled={!clickable} onClick={() => clickable && onPick(t.statuses!)}
              className={cn('rounded-xl border bg-white px-3 py-2 text-left transition-all', clickable ? 'hover:border-blue-300 cursor-pointer' : 'cursor-default', on ? 'border-blue-400 ring-2 ring-blue-100' : 'border-zinc-200')}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{t.label}</div>
              <div className={cn('text-xl font-bold', t.tone)}>{t.value}</div>
              {t.hint && <div className="text-[10px] text-zinc-400">{t.hint}</div>}
            </button>
          )
        })}
      </div>
      <div className="h-1.5 rounded-full bg-zinc-200 overflow-hidden flex">
        <span className="bg-emerald-500" style={{ width: `${tasks.length ? (done.length / tasks.length) * 100 : 0}%` }} />
        <span className="bg-emerald-300" style={{ width: `${tasks.length ? (live.length / tasks.length) * 100 : 0}%` }} />
        <span className="bg-red-400" style={{ width: `${tasks.length ? (blocked.length / tasks.length) * 100 : 0}%` }} />
      </div>
    </div>
  )
}
