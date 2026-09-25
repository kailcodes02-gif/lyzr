'use client'

import { Suspense, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Check, Crown, ExternalLink, Pencil, Plus, Trash2, Users, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { InfoTip } from '@/components/ui/info-tip'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { CampaignDialog } from '@/components/campaigns/campaign-dialog'
import { campaignProgress } from '@/components/campaigns/campaign-banner'
import { useCampaign, useCurrentUser, useTasks, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { deleteCampaign, setParticipantDone, updateCampaign } from '@/lib/actions'
import { CAMPAIGN_KIND } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// The campaign tracker: linked tasks from any channel, the champions, and for
// thunderclaps who has done their bit.

function CampaignPageInner() {
  const id = useSearchParams().get('id')
  const router = useRouter()
  const qc = useQueryClient()
  const { data, isLoading } = useCampaign(id)
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: users } = useUsers()
  const { data: me } = useCurrentUser()
  const { isAdmin, ownedVerticalIds, verticals } = useVertical()
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [, start] = useTransition()

  const userByEmail = useMemo(() => new Map((users || []).map(u => [u.email.toLowerCase(), u])), [users])
  const linked = useMemo(() => (tasks || []).filter(t => t.campaign_id === id), [tasks, id])

  if (isLoading || !data) return <div className="p-8 animate-pulse"><div className="h-8 w-1/3 bg-zinc-200 rounded" /></div>
  const { campaign: c, owners, participants } = data
  const kind = CAMPAIGN_KIND[c.kind]
  const prog = campaignProgress(c, tasks || [])
  const isOwner = !!me && owners.some(o => o.email.toLowerCase() === me.email.toLowerCase())
  const canManage = isAdmin || isOwner || (!!c.vertical_id && ownedVerticalIds.has(c.vertical_id))
  const canDelete = isAdmin || (!!c.vertical_id && ownedVerticalIds.has(c.vertical_id))
  const partsDone = participants.filter(p => p.done_at).length
  const vertical = verticals.find(v => v.id === c.vertical_id)

  const tick = (email: string, done: boolean) => start(async () => {
    try {
      await setParticipantDone(c.id, email, done)
      qc.invalidateQueries({ queryKey: ['campaign', c.id] }); qc.invalidateQueries({ queryKey: ['campaignParticipants'] })
    } catch (e: any) { toast.error(e?.message || 'Could not update') }
  })
  const setStatus = (status: typeof c.status) => start(async () => {
    try { await updateCampaign(c.id, { status }); qc.invalidateQueries({ queryKey: ['campaigns'] }); qc.invalidateQueries({ queryKey: ['campaign', c.id] }) }
    catch (e: any) { toast.error(e?.message || 'Failed') }
  })
  const remove = () => {
    if (!confirm(`Delete "${c.name}"? Linked tasks stay, they just lose the link.`)) return
    start(async () => {
      try { await deleteCampaign(c.id); qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Deleted'); router.push('/campaigns/') }
      catch (e: any) { toast.error(e?.message || 'Failed') }
    })
  }

  const person = (email: string) => {
    const u = userByEmail.get(email.toLowerCase())
    return (
      <span className="inline-flex items-center gap-2">
        <Avatar className="w-6 h-6"><AvatarImage src={u?.avatar_url || undefined} /><AvatarFallback className="text-[10px]">{(u?.display_name || email).charAt(0).toUpperCase()}</AvatarFallback></Avatar>
        <span className="text-sm text-zinc-800">{u?.display_name || email.split('@')[0]}</span>
        {!u && <span className="text-[10px] text-amber-600">not signed in yet</span>}
      </span>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <Link href="/campaigns/" className="text-xs text-zinc-500 hover:text-zinc-800 inline-flex items-center gap-1 pl-12 lg:pl-0"><ArrowLeft className="w-3 h-3" /> All campaigns</Link>

      <div className={cn('rounded-2xl p-[1px] bg-gradient-to-r', kind.className)}>
        <div className="rounded-2xl bg-white p-5 lg:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">{kind.emoji} {kind.label} · {vertical ? vertical.name : 'Whole company'}</div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{c.name}</h1>
              {c.headline && <p className="text-sm text-zinc-600 mt-1">{c.headline}</p>}
              {c.description && <p className="text-sm text-zinc-700 mt-2 whitespace-pre-wrap">{c.description}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {canManage ? (
                <select value={c.status} onChange={e => setStatus(e.target.value as typeof c.status)} className="h-8 text-xs rounded-md border border-zinc-300 bg-white px-2">
                  {['upcoming', 'live', 'done', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : <Badge variant="outline">{c.status}</Badge>}
              {canManage && <Button size="sm" variant="outline" className="h-8 border-zinc-300" onClick={() => setEditOpen(true)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>}
              {canDelete && <Button size="sm" variant="ghost" className="h-8 text-red-600" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-600 flex-wrap">
            {(c.starts_on || c.ends_on) && <span>{c.starts_on && format(parseISO(c.starts_on), 'd MMM yyyy')}{c.ends_on && ` – ${format(parseISO(c.ends_on), 'd MMM yyyy')}`}</span>}
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-32 rounded-full bg-zinc-200 overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${prog.pct}%` }} /></span>
              {prog.done}/{prog.total} tasks done
            </span>
            {c.kind === 'thunderclap' && <span>{partsDone}/{participants.length} people done</span>}
            {c.cta_url && <a href={c.cta_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> {c.cta_label || 'Open'}</a>}
          </div>
          {c.kind === 'thunderclap' && c.ask && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900"><Zap className="w-4 h-4 inline mr-1" /><strong>Everyone:</strong> {c.ask}</div>
          )}
          <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-600">
            <Crown className="w-3.5 h-3.5 text-amber-500" /> Campaign leads <InfoTip k="champion" />:
            {owners.length ? owners.map(o => <span key={o.email}>{person(o.email)}</span>) : <span className="text-zinc-400">none yet</span>}
          </div>
        </div>
      </div>

      <Tabs defaultValue={c.kind === 'thunderclap' ? 'people' : 'tasks'}>
        <TabsList className="bg-zinc-100">
          <TabsTrigger value="tasks">Tasks ({linked.length})</TabsTrigger>
          {c.kind === 'thunderclap' && <TabsTrigger value="people"><Users className="w-3.5 h-3.5 mr-1" /> People ({partsDone}/{participants.length})</TabsTrigger>}
        </TabsList>
        <TabsContent value="tasks" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-blue-600 to-violet-600 text-white border-0"><Plus className="w-4 h-4 mr-1" /> New task in this campaign</Button>
          </div>
          {linked.length === 0
            ? <Card className="bg-white border-zinc-200"><CardContent className="p-8 text-center text-sm text-zinc-500">No tasks linked yet. Create one here, or pick this campaign in any task&apos;s drawer.</CardContent></Card>
            : <TaskView tasks={linked} onTaskClick={t => setSelectedTaskId(t.id)} showChannelColumn showVerticalColumn />}
        </TabsContent>
        {c.kind === 'thunderclap' && (
          <TabsContent value="people" className="mt-4">
            <Card className="bg-white border-zinc-200">
              <CardHeader className="py-3"><CardTitle className="text-sm">Who has done the ask</CardTitle></CardHeader>
              <CardContent className="p-0 divide-y divide-zinc-100">
                {participants.length === 0 && <p className="p-6 text-sm text-zinc-500 text-center">No participants yet. Edit the campaign to add them.</p>}
                {participants.map(p => {
                  const mine = !!me && p.email.toLowerCase() === me.email.toLowerCase()
                  return (
                    <div key={p.email} className="flex items-center justify-between px-4 py-2.5 gap-3">
                      {person(p.email)}
                      <div className="flex items-center gap-2">
                        {p.done_at && <span className="text-[11px] text-zinc-500">{format(new Date(p.done_at), 'd MMM, h:mm a')}</span>}
                        {(mine || canManage)
                          ? <Button size="sm" onClick={() => tick(p.email, !p.done_at)} className={cn('h-7 text-xs border-0', p.done_at ? 'bg-emerald-600 text-white' : 'bg-zinc-200 text-zinc-700 hover:bg-amber-400 hover:text-white')}><Check className="w-3.5 h-3.5 mr-1" /> {p.done_at ? 'Done' : 'Mark done'}</Button>
                          : <Badge className={p.done_at ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}>{p.done_at ? 'Done' : 'Pending'}</Badge>}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {editOpen && <CampaignDialog open={editOpen} onOpenChange={setEditOpen} campaign={c} owners={owners.map(o => o.email)} participants={participants.map(p => p.email)} />}
      {createOpen && <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} defaultVerticalId={c.vertical_id || undefined} defaultCampaignId={c.id} onSuccess={() => setCreateOpen(false)} />}
      {selectedTaskId && <TaskDetailDrawer taskId={selectedTaskId} open onOpenChange={o => { if (!o) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />}
    </div>
  )
}

export default function CampaignPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-zinc-500">Loading…</div>}><CampaignPageInner /></Suspense>
}
