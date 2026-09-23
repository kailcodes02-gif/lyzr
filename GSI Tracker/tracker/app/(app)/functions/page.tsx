'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Workflow, ArrowRight, Crown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useFunctions, useAllFunctionOwners, useChannels, useTasks, useUsers, useCurrentUser } from '@/lib/hooks/use-data'
import { OPEN_STATUSES } from '@/lib/week-logic'
import { taskChannelIds } from '@/lib/task-channels'

export default function FunctionsPage() {
  const { data: functions, isLoading } = useFunctions()
  const { data: owners } = useAllFunctionOwners()
  const { data: channels } = useChannels('all')
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: users } = useUsers()
  const { data: me } = useCurrentUser()

  const stats = useMemo(() => {
    const chFn = new Map((channels || []).map(c => [c.id, c.function_id]))
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const m = new Map<string, { open: number; overdue: number; verticals: Set<string>; channels: number }>()
    for (const c of channels || []) {
      if (!c.function_id) continue
      const s = m.get(c.function_id) || { open: 0, overdue: 0, verticals: new Set<string>(), channels: 0 }
      s.verticals.add(c.vertical_id)
      if (!c.parent_channel_id) s.channels++
      m.set(c.function_id, s)
    }
    for (const t of tasks || []) {
      const fns = new Set(taskChannelIds(t).map(id => chFn.get(id)).filter(Boolean) as string[])
      for (const f of fns) {
        const s = m.get(f)
        if (!s) continue
        if (OPEN_STATUSES.has(t.status)) { s.open++; if (t.due_date && new Date(t.due_date) < today) s.overdue++ }
      }
    }
    return m
  }, [channels, tasks])

  const nameOf = (email: string) => users?.find(u => u.email.toLowerCase() === email.toLowerCase())?.display_name?.split(' ')[0] || email.split('@')[0]

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <Workflow className="w-6 h-6 text-emerald-600" /> Functions
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          One discipline across every vertical: Content, Social, Paid and so on. Open a function to see its work everywhere it runs.
        </p>
      </div>

      {isLoading ? <div className="h-64 bg-zinc-200 rounded-xl animate-pulse" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(functions || []).map(f => {
            const s = stats.get(f.id)
            const fo = (owners || []).filter(o => o.function_id === f.id).sort((a, b) => a.sort_order - b.sort_order)
            const mine = !!me && fo.some(o => o.user_id === me.id || o.email.toLowerCase() === me.email.toLowerCase())
            return (
              <Link key={f.id} href={`/function/?id=${f.id}`} className="block group">
                <Card className="bg-white border-zinc-200 group-hover:border-emerald-300 transition-all h-full">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Workflow className="w-4 h-4" /></div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-zinc-900 flex items-center gap-1.5">{f.name}{mine && <Crown className="w-3.5 h-3.5 text-amber-500" />}</h3>
                        <p className="text-xs text-zinc-500">{s ? `${s.channels} channel${s.channels === 1 ? '' : 's'} in ${s.verticals.size} vertical${s.verticals.size === 1 ? '' : 's'}` : 'Not linked to any channel yet'}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-emerald-500" />
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span><strong className="text-zinc-900">{s?.open || 0}</strong> <span className="text-zinc-500">open</span></span>
                      <span className={s?.overdue ? 'text-red-600' : ''}><strong>{s?.overdue || 0}</strong> <span className={s?.overdue ? '' : 'text-zinc-500'}>overdue</span></span>
                    </div>
                    <p className="text-[11px] text-zinc-500 truncate">{fo.length ? `Owners: ${fo.map(o => nameOf(o.email)).join(', ')}` : 'No default owners'}</p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
