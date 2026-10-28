'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, parseISO, isBefore, startOfDay } from 'date-fns'
import { AlertCircle, ArrowRight, Check, CheckSquare, ClipboardCheck, Layers, Plus, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { CampaignBanner } from '@/components/campaigns/campaign-banner'
import { InboxCard } from '@/components/workspace/inbox-card'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { QuickAdd } from '@/components/tasks/quick-add'
import { CheckInDialog } from '@/components/tasks/check-in'
import { useMyTasks } from '@/lib/hooks/use-my-tasks'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { updateTask } from '@/lib/actions'
import { checkInQueue } from '@/lib/check-in'
import { bucketWeek, currentWeek, OPEN_STATUSES } from '@/lib/week-logic'
import { STATUS_CONFIG, type Task } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// The simplest possible home for a channel or function owner: add a task in
// one line, see what needs you this week, tick things off in place, and run
// the weekly check-in. Channel cards sit below. No toggles, no filters.

export function MyBoard({ showFullWorkspaceLink }: { showFullWorkspaceLink?: boolean }) {
  const queryClient = useQueryClient()
  const { verticals } = useVertical()
  const { me, tasks, channels, channelById, myChannelIds, myTasks, isLoading } = useMyTasks()
  const [createOpen, setCreateOpen] = useState(false)
  const [createChannel, setCreateChannel] = useState<string | undefined>()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [closing, setClosing] = useState<Set<string>>(new Set())

  const myChannels = (channels || []).filter(c => myChannelIds.has(c.id))
  const verticalName = (id?: string | null) => verticals.find(v => v.id === id)?.name || ''

  const week = bucketWeek(myTasks, currentWeek())
  const today = startOfDay(new Date())
  const openMine = myTasks.filter(t => OPEN_STATUSES.has(t.status))
  const toCheck = checkInQueue(myTasks).length

  // One click to close; Undo puts the old status back. Dependencies still
  // guard it: the drawer is where you override.
  const markDone = (t: Task) => {
    setClosing(s => new Set(s).add(t.id))
    updateTask(t.id, { status: 'done' })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        toast.success(`Done: ${t.title}`, {
          action: {
            label: 'Undo',
            onClick: () => updateTask(t.id, { status: t.status })
              .then(() => queryClient.invalidateQueries({ queryKey: ['tasks'] }))
              .catch(err => toast.error((err as Error).message)),
          },
        })
      })
      .catch(err => {
        const msg = (err as Error).message || ''
        toast.error(/blocking task/i.test(msg) ? 'It depends on unfinished tasks. Open it to close anyway.' : msg)
      })
      .finally(() => setClosing(s => { const n = new Set(s); n.delete(t.id); return n }))
  }

  const row = (t: Task) => {
    const cfg = STATUS_CONFIG[t.status]
    const isOpen = OPEN_STATUSES.has(t.status)
    const late = t.due_date && isBefore(parseISO(t.due_date), today) && isOpen
    return (
      <div key={t.id} className="flex items-center gap-1 pl-2 pr-4 hover:bg-zinc-50">
        {isOpen ? (
          <button onClick={() => markDone(t)} disabled={closing.has(t.id)} aria-label={`Mark “${t.title}” done`} title="Mark done"
            className="group shrink-0 p-2">
            <span className={cn('flex w-[18px] h-[18px] items-center justify-center rounded-full border-2 border-zinc-300 group-hover:border-emerald-500 group-hover:bg-emerald-50',
              closing.has(t.id) && 'border-emerald-500 bg-emerald-500')}>
              <Check className={cn('w-3 h-3 text-emerald-600 opacity-0 group-hover:opacity-100', closing.has(t.id) && 'text-white opacity-100')} />
            </span>
          </button>
        ) : (
          <span className="shrink-0 p-2"><span className="flex w-[18px] h-[18px] items-center justify-center rounded-full bg-emerald-500"><Check className="w-3 h-3 text-white" /></span></span>
        )}
        <button onClick={() => setSelectedTaskId(t.id)} className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-left">
          <span className="flex-1 min-w-0">
            <span className={cn('block text-sm truncate', isOpen ? 'text-zinc-800' : 'text-zinc-500 line-through')}>{t.title}</span>
            <span className="block text-[11px] text-zinc-500 truncate">{verticalName(t.vertical_ids?.[0] || t.channel?.vertical_id)} · {t.channel?.name}</span>
          </span>
          {t.due_date && <span className={cn('text-[11px] shrink-0', late ? 'text-red-600 font-medium' : 'text-zinc-500')}>{format(parseISO(t.due_date), 'EEE d MMM')}</span>}
          <Badge className="text-[10px] border-0 shrink-0" style={{ backgroundColor: cfg.bgColor, color: cfg.color }}>{cfg.label}</Badge>
        </button>
      </div>
    )
  }

  if (isLoading || !me) return <div className="p-8 animate-pulse space-y-4"><div className="h-8 w-1/3 bg-zinc-200 rounded" /><div className="h-40 bg-zinc-200 rounded-xl" /></div>

  const needsYou = [...week.overdueCarried, ...week.notDone]

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Hi {me.display_name?.split(' ')[0]}</h1>
          <p className="text-sm text-zinc-600 mt-1 inline-flex items-center gap-1"><InfoTip k="my_board" /> {openMine.length} open · {week.notDone.length} due this week · {week.overdueCarried.length} overdue</p>
        </div>
        <div className="flex items-center gap-2">
          {showFullWorkspaceLink && <Link href="/workspace/tasks/"><Button variant="outline" className="border-zinc-300 text-zinc-700"><Building2 className="w-4 h-4 mr-2" /> Full company view</Button></Link>}
          <Button variant="outline" onClick={() => setCheckInOpen(true)} className="border-zinc-300 text-zinc-700">
            <ClipboardCheck className="w-4 h-4 mr-2" /> Check in
            {toCheck > 0 && <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 text-[10px] font-semibold text-white">{toCheck}</span>}
          </Button>
        </div>
      </div>

      <QuickAdd onCreated={setSelectedTaskId} />

      {/* What needs you: overdue first, then the rest of this week */}
      <Card className="bg-white border-zinc-200">
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-zinc-800">
            Due this week <span className="font-normal text-zinc-400">{needsYou.length}</span>
            {week.overdueCarried.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600"><AlertCircle className="w-3 h-3" /> {week.overdueCarried.length} overdue</span>}
            <InfoTip k="weekly" />
          </CardTitle>
          {needsYou.length > 0 && <button onClick={() => setCheckInOpen(true)} className="text-[11px] text-blue-600 hover:underline">Update them all in 2 minutes</button>}
        </CardHeader>
        <CardContent className="p-0 divide-y divide-zinc-100">
          {needsYou.length === 0
            ? <p className="p-6 text-sm text-zinc-400 text-center">Nothing due or overdue. Add what you are working on above so the team can see it.</p>
            : needsYou.map(row)}
        </CardContent>
      </Card>

      {week.done.length > 0 && (
        <Card className="bg-white border-zinc-200">
          <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-700">Done this week <span className="font-normal text-zinc-400">{week.done.length}</span></CardTitle></CardHeader>
          <CardContent className="p-0 divide-y divide-zinc-100">{week.done.map(row)}</CardContent>
        </Card>
      )}

      <InboxCard />

      <CampaignBanner verticalId="all" compact canCreate={false} />

      {/* My channels across verticals */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider flex items-center gap-2"><Layers className="w-4 h-4 text-blue-600" /> My channels <InfoTip k="channel_owner" /></h2>
        {myChannels.length === 0 ? (
          <Card className="bg-white border-zinc-200"><CardContent className="p-6 text-sm text-zinc-500">You are not a channel or function owner yet. Tasks assigned to you still show above.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {myChannels.map(ch => {
              const v = verticals.find(x => x.id === ch.vertical_id)
              const chTasks = (tasks || []).filter(t => t.channel_id === ch.id || channelById.get(t.channel_id)?.parent_channel_id === ch.id)
              const open = chTasks.filter(t => OPEN_STATUSES.has(t.status))
              const overdue = open.filter(t => t.due_date && isBefore(parseISO(t.due_date), today))
              const parent = ch.parent_channel_id ? channelById.get(ch.parent_channel_id) : null
              return (
                <Card key={ch.id} className="bg-white border-zinc-200 hover:border-blue-300 transition-all">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{v?.name}{parent ? ` · ${parent.name}` : ''}</div>
                        <Link href={withVertical('/channel/', v?.slug || 'all', { id: ch.id })} className="text-sm font-semibold text-zinc-900 hover:text-blue-700 truncate block">{ch.name}</Link>
                      </div>
                      <button onClick={() => { setCreateChannel(ch.id); setCreateOpen(true) }} className="text-zinc-400 hover:text-blue-600" title="New task here"><Plus className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                      <span className="inline-flex items-center gap-1"><CheckSquare className="w-3 h-3" /> {open.length} open</span>
                      {overdue.length > 0 && <span className="inline-flex items-center gap-1 text-red-600"><AlertCircle className="w-3 h-3" /> {overdue.length} overdue</span>}
                      <Link href={withVertical('/channel/', v?.slug || 'all', { id: ch.id })} className="ml-auto text-blue-600 hover:underline inline-flex items-center gap-0.5">Open <ArrowRight className="w-3 h-3" /></Link>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {createOpen && <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} defaultChannelId={createChannel} onSuccess={() => setCreateOpen(false)} />}
      {selectedTaskId && <TaskDetailDrawer taskId={selectedTaskId} open onOpenChange={o => { if (!o) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />}
      <CheckInDialog open={checkInOpen} onOpenChange={setCheckInOpen} tasks={myTasks} name={me.display_name || me.email} />
    </div>
  )
}
