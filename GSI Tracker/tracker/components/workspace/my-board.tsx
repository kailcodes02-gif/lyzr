'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, isBefore, startOfDay } from 'date-fns'
import { AlertCircle, ArrowRight, CheckSquare, Layers, Plus, Sparkles, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { CampaignBanner } from '@/components/campaigns/campaign-banner'
import { InboxCard } from '@/components/workspace/inbox-card'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { useAllChannelOwners, useChannels, useCurrentUser, useTasks } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { bucketWeek, currentWeek, OPEN_STATUSES } from '@/lib/week-logic'
import { STATUS_CONFIG, type Task } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// The simplest possible home for a channel or function owner: the hero
// banner, the channels they own (in every vertical), and what they owe this
// week. No toggles, no filters.

export function MyBoard({ showFullWorkspaceLink }: { showFullWorkspaceLink?: boolean }) {
  const { data: me } = useCurrentUser()
  const { verticals } = useVertical()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const { data: owners } = useAllChannelOwners()
  const [createOpen, setCreateOpen] = useState(false)
  const [createChannel, setCreateChannel] = useState<string | undefined>()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const myEmail = me?.email.toLowerCase()
  const myChannelIds = useMemo(() => new Set((owners || []).filter(o => myEmail && o.email.toLowerCase() === myEmail).map(o => o.channel_id)), [owners, myEmail])
  const myChannels = useMemo(() => (channels || []).filter(c => myChannelIds.has(c.id)), [channels, myChannelIds])
  const channelById = useMemo(() => new Map((channels || []).map(c => [c.id, c])), [channels])
  const verticalName = (id?: string | null) => verticals.find(v => v.id === id)?.name || ''

  // Mine = assigned to me, or on a channel I own with no explicit owner.
  const myTasks = useMemo(() => (tasks || []).filter(t => {
    if (!me) return false
    if (t.assignments?.some(a => a.user_id === me.id)) return true
    if (t.pending_assignments?.some(p => !p.resolved_user_id && p.email.toLowerCase() === myEmail)) return true
    const hasOwner = (t.assignments?.length || 0) > 0 || (t.pending_assignments || []).some(p => !p.resolved_user_id)
    if (hasOwner) return false
    const ch = channelById.get(t.channel_id)
    return myChannelIds.has(t.channel_id) || (!!ch?.parent_channel_id && myChannelIds.has(ch.parent_channel_id))
  }), [tasks, me, myEmail, channelById, myChannelIds])

  const week = useMemo(() => bucketWeek(myTasks, currentWeek()), [myTasks])
  const today = startOfDay(new Date())
  const openMine = myTasks.filter(t => OPEN_STATUSES.has(t.status))

  const row = (t: Task) => {
    const cfg = STATUS_CONFIG[t.status]
    const late = t.due_date && isBefore(parseISO(t.due_date), today) && OPEN_STATUSES.has(t.status)
    return (
      <button key={t.id} onClick={() => setSelectedTaskId(t.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-zinc-800 truncate">{t.title}</span>
          <span className="block text-[11px] text-zinc-500 truncate">{verticalName(t.channel?.vertical_id)} · {t.channel?.name}</span>
        </span>
        {t.due_date && <span className={cn('text-[11px] shrink-0', late ? 'text-red-600 font-medium' : 'text-zinc-500')}>{format(parseISO(t.due_date), 'EEE d MMM')}</span>}
        <Badge className="text-[10px] border-0 shrink-0" style={{ backgroundColor: cfg.bgColor, color: cfg.color }}>{cfg.label}</Badge>
      </button>
    )
  }

  if (isLoading || !me) return <div className="p-8 animate-pulse space-y-4"><div className="h-8 w-1/3 bg-zinc-200 rounded" /><div className="h-40 bg-zinc-200 rounded-xl" /></div>

  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-5xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Hi {me.display_name?.split(' ')[0]}</h1>
          <p className="text-sm text-zinc-600 mt-1 inline-flex items-center gap-1"><InfoTip k="my_board" /> {openMine.length} open · {week.notDone.length} due this week · {week.overdueCarried.length} overdue</p>
        </div>
        <div className="flex items-center gap-2">
          {showFullWorkspaceLink && <Link href="/workspace/tasks/"><Button variant="outline" className="border-zinc-300 text-zinc-700"><Building2 className="w-4 h-4 mr-2" /> Full company view</Button></Link>}
          <Button onClick={() => { setCreateChannel(undefined); setCreateOpen(true) }} className="bg-gradient-to-r from-blue-600 to-violet-600 text-white border-0"><Plus className="w-4 h-4 mr-2" /> New task</Button>
        </div>
      </div>

      <CampaignBanner verticalId="all" compact canCreate={false} />

      <InboxCard />

      {/* My channels across verticals */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider flex items-center gap-2"><Layers className="w-4 h-4 text-blue-600" /> My channels <InfoTip k="channel_owner" /></h2>
        {myChannels.length === 0 ? (
          <Card className="bg-white border-zinc-200"><CardContent className="p-6 text-sm text-zinc-500">You are not a channel or function owner yet. Tasks assigned to you still show below.</CardContent></Card>
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

      {/* This week */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-white border-zinc-200">
          <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700">Due this week <span className="font-normal text-zinc-400">{week.notDone.length}</span> <InfoTip k="weekly" /></CardTitle></CardHeader>
          <CardContent className="p-0 divide-y divide-zinc-100">
            {week.notDone.length === 0 ? <p className="p-6 text-sm text-zinc-400 text-center">Nothing due. Nice.</p> : week.notDone.map(row)}
          </CardContent>
        </Card>
        <Card className="bg-white border-zinc-200">
          <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-700">Overdue <span className="font-normal text-zinc-400">{week.overdueCarried.length}</span></CardTitle></CardHeader>
          <CardContent className="p-0 divide-y divide-zinc-100">
            {week.overdueCarried.length === 0 ? <p className="p-6 text-sm text-zinc-400 text-center">Nothing overdue.</p> : week.overdueCarried.map(row)}
          </CardContent>
        </Card>
      </div>
      {week.done.length > 0 && (
        <Card className="bg-white border-zinc-200">
          <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-700">Done this week <span className="font-normal text-zinc-400">{week.done.length}</span></CardTitle></CardHeader>
          <CardContent className="p-0 divide-y divide-zinc-100">{week.done.map(row)}</CardContent>
        </Card>
      )}
      <p className="text-[11px] text-zinc-400 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Need something else? Use the assistant (top right) to create or find a task.</p>

      {createOpen && <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} defaultChannelId={createChannel} onSuccess={() => setCreateOpen(false)} />}
      {selectedTaskId && <TaskDetailDrawer taskId={selectedTaskId} open onOpenChange={o => { if (!o) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />}
    </div>
  )
}
