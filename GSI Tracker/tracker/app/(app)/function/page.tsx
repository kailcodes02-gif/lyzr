'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Workflow, ListTodo, CalendarRange, Building2, ArrowLeft, Crown } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { useFunctions, useFunctionOwners, useChannels, useTasks, useUsers, useVerticalLookup } from '@/lib/hooks/use-data'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { WeekDoneBoard } from '@/components/weekly/week-done-board'
import { buildWeeks, OPEN_STATUSES } from '@/lib/week-logic'
import { withVertical } from '@/lib/hooks/use-space-href'
import { taskChannelIds } from '@/lib/task-channels'
import { format } from 'date-fns'

function FunctionContent() {
  const id = useSearchParams().get('id') || ''
  const { data: functions } = useFunctions(true)
  const { data: owners } = useFunctionOwners(id)
  const { data: channels } = useChannels('all')
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: users } = useUsers()
  const lookup = useVerticalLookup()
  const weeks = useMemo(() => buildWeeks(8), [])
  const [weekKey, setWeekKey] = useState(weeks[0].key)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const fn = functions?.find(f => f.id === id)
  const fnChannels = useMemo(() => (channels || []).filter(c => c.function_id === id), [channels, id])
  const chIds = useMemo(() => new Set(fnChannels.map(c => c.id)), [fnChannels])
  const fnTasks = useMemo(() => (tasks || []).filter(t => taskChannelIds(t).some(cid => chIds.has(cid))), [tasks, chIds])

  const perVertical = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const m = new Map<string, { open: number; overdue: number; live: number; channels: typeof fnChannels }>()
    for (const c of fnChannels) {
      const s = m.get(c.vertical_id) || { open: 0, overdue: 0, live: 0, channels: [] }
      if (!c.parent_channel_id) s.channels.push(c)
      m.set(c.vertical_id, s)
    }
    for (const t of fnTasks) {
      const vid = t.channel?.vertical_id || lookup.channelById.get(t.channel_id)?.vertical_id
      const s = vid ? m.get(vid) : undefined
      if (!s) continue
      if (OPEN_STATUSES.has(t.status)) { s.open++; if (t.due_date && new Date(t.due_date) < today) s.overdue++ }
      if (t.status === 'live') s.live++
    }
    return m
  }, [fnChannels, fnTasks, lookup.channelById])

  const ctx = useMemo(() => ({ verticalById: lookup.verticalById, channelById: lookup.channelById }), [lookup.verticalById, lookup.channelById])
  const nameOf = (email: string) => users?.find(u => u.email.toLowerCase() === email.toLowerCase())?.display_name || email

  if (!fn) return <div className="p-8 text-center text-zinc-500 bg-zinc-50 min-h-screen">{functions ? 'Function not found.' : 'Loading…'}</div>

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <Link href="/functions/" className="text-xs text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> All functions</Link>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2"><Workflow className="w-6 h-6 text-emerald-600" /> {fn.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {fnChannels.filter(c => !c.parent_channel_id).length} channel{fnChannels.filter(c => !c.parent_channel_id).length === 1 ? '' : 's'} across {perVertical.size} vertical{perVertical.size === 1 ? '' : 's'} · {fnTasks.length} tasks
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(owners || []).sort((a, b) => a.sort_order - b.sort_order).map(o => (
            <span key={o.email} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${o.sort_order <= 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-zinc-100 border-zinc-200 text-zinc-700'}`}>
              {o.sort_order <= 0 && <Crown className="w-3 h-3" />}{nameOf(o.email)}
            </span>
          ))}
          {(owners || []).length === 0 && <span className="text-xs text-zinc-400">No default owners (set in Admin › Functions)</span>}
        </div>
      </div>

      <Tabs defaultValue="verticals" className="w-full">
        <TabsList className="bg-white border border-zinc-200 p-1 rounded-lg">
          <TabsTrigger value="verticals" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><Building2 className="w-4 h-4 mr-2" /> Per vertical</TabsTrigger>
          <TabsTrigger value="tasks" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><ListTodo className="w-4 h-4 mr-2" /> Tasks</TabsTrigger>
          <TabsTrigger value="weekly" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><CalendarRange className="w-4 h-4 mr-2" /> Weekly</TabsTrigger>
        </TabsList>

        <TabsContent value="verticals" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...perVertical.entries()].map(([vid, s]) => {
              const v = lookup.verticalById.get(vid)
              if (!v) return null
              return (
                <Card key={vid} className="bg-white border-zinc-200">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-600" />
                      <Link href={withVertical('/dashboard/', v.slug)} className="text-base font-semibold text-zinc-900 hover:text-blue-700">{v.name}</Link>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span><strong>{s.open}</strong> <span className="text-zinc-500">open</span></span>
                      <span className={s.overdue ? 'text-red-600' : ''}><strong>{s.overdue}</strong> <span className={s.overdue ? '' : 'text-zinc-500'}>overdue</span></span>
                      <span><strong className="text-emerald-600">{s.live}</strong> <span className="text-zinc-500">live</span></span>
                    </div>
                    <div className="space-y-0.5">
                      {s.channels.map(c => (
                        <Link key={c.id} href={withVertical('/channel/', v.slug, { id: c.id })} className="block text-xs text-blue-700 hover:underline truncate">{c.name}</Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
            {perVertical.size === 0 && <p className="text-sm text-zinc-500">No channel is linked to this function yet. Link channels under Admin › Functions.</p>}
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="mt-6">
          {isLoading ? <div className="h-96 bg-zinc-200 rounded-xl animate-pulse" /> :
            <TaskView tasks={fnTasks} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn showVerticalColumn />}
        </TabsContent>

        <TabsContent value="weekly" className="mt-6 space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {weeks.map((w, i) => (
              <button key={w.key} onClick={() => setWeekKey(w.key)}
                className={['shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium', w.key === weekKey ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-zinc-200 bg-white text-zinc-700'].join(' ')}>
                {i === 0 ? 'This week' : format(w.start, 'MMM d')}
              </button>
            ))}
          </div>
          <WeekDoneBoard tasks={fnTasks} week={weeks.find(w => w.key === weekKey) || weeks[0]} groupBy={['vertical', 'owner']} ctx={ctx} onTaskClick={t => setSelectedTaskId(t.id)} />
        </TabsContent>
      </Tabs>

      {selectedTaskId && (
        <TaskDetailDrawer taskId={selectedTaskId} open={!!selectedTaskId}
          onOpenChange={open => { if (!open) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />
      )}
    </div>
  )
}

export default function FunctionPage() {
  return (
    <Suspense fallback={<div className="p-8 bg-zinc-50 min-h-screen" />}>
      <FunctionContent />
    </Suspense>
  )
}
