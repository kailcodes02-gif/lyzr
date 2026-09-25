'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { isBefore, parseISO, startOfDay } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { useChannels, useFunctions } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { bucketWeek, currentWeek, OPEN_STATUSES } from '@/lib/week-logic'
import type { Task } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// Leadership grid: verticals across, domains down; each cell = open /
// overdue / this week's done vs planned for that vertical's instance of the
// domain. Click a cell to drop into those tasks.

export function DomainGrid({ tasks }: { tasks: Task[] }) {
  const { verticals } = useVertical()
  const { data: channels } = useChannels('all')
  const { data: functions } = useFunctions()
  const today = startOfDay(new Date())

  const chById = useMemo(() => new Map((channels || []).map(c => [c.id, c])), [channels])
  const fnOf = (channelId: string): string | null => {
    const c = chById.get(channelId); if (!c) return null
    if (c.function_id) return c.function_id
    return c.parent_channel_id ? (chById.get(c.parent_channel_id)?.function_id ?? null) : null
  }
  const cells = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) {
      const v = t.channel?.vertical_id || chById.get(t.channel_id)?.vertical_id
      const f = fnOf(t.channel_id) || 'none'
      if (!v) continue
      const k = `${v}|${f}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(t)
    }
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, chById])

  const rows = [...(functions || []), { id: 'none', name: 'Unlinked channels', slug: 'none' }].filter(f => verticals.some(v => cells.has(`${v.id}|${f.id}`)))

  return (
    <Card className="bg-white border-zinc-200">
      <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2">Verticals × domains <InfoTip k="functions_view" /></CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-zinc-50 text-zinc-600">
            <th className="text-left px-3 py-2 font-medium w-40">Domain</th>
            {verticals.map(v => <th key={v.id} className="text-left px-3 py-2 font-medium"><Link href={withVertical('/dashboard/', v.slug)} className="hover:text-blue-700">{v.name}</Link></th>)}
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(f => (
              <tr key={f.id}>
                <td className="px-3 py-2 font-medium text-zinc-800">{f.id === 'none' ? f.name : <Link href={`/function/?id=${f.id}`} className="hover:text-blue-700">{f.name}</Link>}</td>
                {verticals.map(v => {
                  const list = cells.get(`${v.id}|${f.id}`)
                  if (!list) return <td key={v.id} className="px-3 py-2 text-zinc-300">·</td>
                  const open = list.filter(t => OPEN_STATUSES.has(t.status))
                  const overdue = open.filter(t => t.due_date && isBefore(parseISO(t.due_date), today))
                  const wk = bucketWeek(list, currentWeek())
                  const planned = wk.done.length + wk.notDone.length
                  const pct = planned ? Math.round((wk.done.length / planned) * 100) : null
                  return (
                    <td key={v.id} className="px-3 py-2 align-top">
                      <Link href={f.id === 'none' ? withVertical('/tracker/', v.slug) : `/function/?id=${f.id}`} className="block rounded-lg border border-zinc-200 hover:border-blue-300 px-2 py-1.5 min-w-[120px]">
                        <div className="flex items-center gap-2"><strong className="text-zinc-900">{open.length}</strong> <span className="text-zinc-500">open</span>{overdue.length > 0 && <span className="text-red-600 font-medium">{overdue.length} late</span>}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="h-1 w-14 rounded-full bg-zinc-200 overflow-hidden"><span className={cn('block h-full', pct === null ? 'bg-zinc-300' : pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${pct ?? 0}%` }} /></span>
                          <span className="text-[10px] text-zinc-500">{planned ? `${wk.done.length}/${planned} this week` : 'nothing due'}</span>
                        </div>
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
