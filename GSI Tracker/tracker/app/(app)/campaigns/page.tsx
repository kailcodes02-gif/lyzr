'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ArrowRight, Filter, Plus, Users, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InfoTip } from '@/components/ui/info-tip'
import { CampaignDialog } from '@/components/campaigns/campaign-dialog'
import { campaignProgress } from '@/components/campaigns/campaign-banner'
import { useCampaigns, useAllCampaignParticipants, useChannels, useMyBadges, useTasks } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { mergeChannelsByName, taskChannelIds } from '@/lib/task-channels'
import { CAMPAIGN_KIND, STATUS_CONFIG, type Campaign, type Task, type TaskStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// Campaigns are a tag on tasks, not a board: a task keeps its channel, vertical
// and product and links to one campaign. The Thunderclaps tab reads those links
// month by month; "Show on board" applies the campaign as the third board filter.

const STATUS_ORDER: TaskStatus[] = ['not_started', 'in_progress', 'live', 'blocked', 'done']

export default function CampaignsPage() {
  const router = useRouter()
  const { isAdmin, ownedVerticalIds, verticals, setCampaign } = useVertical()
  const { ownedProductIds } = useMyBadges()
  const { data: campaigns, isLoading } = useCampaigns('all', { includeClosed: true })
  const { data: participants } = useAllCampaignParticipants()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = isAdmin || ownedVerticalIds.size > 0 || ownedProductIds.size > 0
  const lyzr = verticals.find(v => v.slug === 'lyzr')
  const lyzrSlug = lyzr?.slug || 'lyzr'

  const showOnBoard = (c: Campaign) => { setCampaign(c.id); router.push(withVertical('/dashboard/', lyzrSlug)) }

  const groups = useMemo(() => {
    const all = campaigns || []
    return [
      { title: 'Live', items: all.filter(c => c.status === 'live') },
      { title: 'Upcoming', items: all.filter(c => c.status === 'upcoming') },
      { title: 'Done', items: all.filter(c => c.status === 'done') },
      { title: 'Cancelled', items: all.filter(c => c.status === 'cancelled') },
    ].filter(g => g.items.length)
  }, [campaigns])

  // Thunderclaps by month (start date, else creation date), newest first.
  const months = useMemo(() => {
    const tc = (campaigns || []).filter(c => c.kind === 'thunderclap')
    const m = new Map<string, Campaign[]>()
    for (const c of tc) { const k = (c.starts_on || c.created_at).slice(0, 7); m.set(k, [...(m.get(k) || []), c]) }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [campaigns])

  // Channel coverage: which top-level channels have a task linked to the campaign.
  const merged = useMemo(() => mergeChannelsByName((channels || []).filter(c => c.is_active), lyzr?.id || ''), [channels, lyzr?.id])
  const keptOf = new Map<string, string>(); for (const [kept, ids] of merged.twins) for (const id of ids) keptOf.set(id, kept)
  const chById = new Map(merged.channels.map(c => [c.id, c]))
  const rootOf = (id: string) => { let c = chById.get(keptOf.get(id) || id); while (c?.parent_channel_id && chById.get(c.parent_channel_id)) c = chById.get(c.parent_channel_id); return c }
  const coverage = (campaignTasks: Task[]) => {
    const m = new Map<string, number>()
    for (const t of campaignTasks) { const seen = new Set<string>(); for (const raw of taskChannelIds(t)) { const r = rootOf(raw); if (r && !seen.has(r.id)) { seen.add(r.id); m.set(r.id, (m.get(r.id) || 0) + 1) } } }
    return merged.channels.filter(c => !c.parent_channel_id && m.has(c.id)).map(c => ({ id: c.id, name: c.name, n: m.get(c.id)! }))
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex items-center justify-between gap-3">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Zap className="w-6 h-6 text-amber-500" /> Campaigns <InfoTip k="campaign" /></h1>
          <p className="text-sm text-zinc-500 mt-1">Launches, thunderclaps and big campaigns. A campaign is a tag on tasks: pick one in the Campaign menu at the top to filter the whole board to it.</p>
        </div>
        {canCreate && <Button onClick={() => setCreateOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white border-0"><Plus className="w-4 h-4 mr-2" /> New campaign</Button>}
      </div>

      <Tabs defaultValue="all">
        <TabsList className="bg-zinc-100 border border-zinc-200">
          <TabsTrigger value="all" className="text-xs">All campaigns</TabsTrigger>
          <TabsTrigger value="thunderclaps" className="text-xs">Thunderclaps by month</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 space-y-6">
          {isLoading ? <div className="h-40 bg-zinc-200 rounded-xl animate-pulse" /> : groups.length === 0 ? (
            <Card className="bg-white border-zinc-200"><CardContent className="p-10 text-center text-sm text-zinc-500">No campaigns yet.</CardContent></Card>
          ) : groups.map(g => (
            <section key={g.title} className="space-y-2">
              <h2 className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">{g.title} · {g.items.length}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {g.items.map(c => {
                  const kind = CAMPAIGN_KIND[c.kind]
                  const prog = campaignProgress(c, tasks || [])
                  const parts = (participants || []).filter(p => p.campaign_id === c.id)
                  const v = verticals.find(x => x.id === c.vertical_id)
                  return (
                    <Card key={c.id} className={cn('bg-white border-zinc-200 hover:border-blue-300 transition-all', c.status !== 'live' && c.status !== 'upcoming' && 'opacity-70')}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">{kind.emoji} {kind.label} · {v?.name || 'Whole company'}</span>
                          {(c.starts_on || c.ends_on) && <span className="text-[11px] text-zinc-500">{c.starts_on && format(parseISO(c.starts_on), 'd MMM')}{c.ends_on && ` – ${format(parseISO(c.ends_on), 'd MMM')}`}</span>}
                        </div>
                        <Link href={`/campaign/?id=${c.id}`} className="font-semibold text-zinc-900 hover:text-blue-700 block">{c.name}</Link>
                        {c.headline && <p className="text-xs text-zinc-600 line-clamp-1">{c.headline}</p>}
                        <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                          <span>{prog.done}/{prog.total} tasks</span>
                          {parts.length > 0 && <span>{parts.filter(p => p.done_at).length}/{parts.length} people</span>}
                          {!c.is_pinned && <Badge variant="outline" className="text-[10px]">not on banner</Badge>}
                          <button onClick={() => showOnBoard(c)} className="ml-auto inline-flex items-center gap-1 text-blue-600 hover:underline"><Filter className="w-3 h-3" /> Show on board</button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </TabsContent>

        <TabsContent value="thunderclaps" className="mt-4 space-y-6">
          <p className="text-xs text-zinc-500 inline-flex items-center gap-1"><InfoTip k="thunderclap" /> One thunderclap a month: everyone posts, shares or comments on the same day. Each card shows who has done their bit and which channels carry a task for it.</p>
          {months.length === 0 ? (
            <Card className="bg-white border-zinc-200"><CardContent className="p-10 text-center text-sm text-zinc-500">No thunderclaps yet. Create one with New campaign and pick the Thunderclap kind.</CardContent></Card>
          ) : months.map(([month, items]) => (
            <section key={month} className="space-y-2">
              <h2 className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">{format(parseISO(`${month}-01`), 'MMMM yyyy')} · {items.length}</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {items.map(c => {
                  const linked = (tasks || []).filter(t => t.campaign_id === c.id)
                  const parts = (participants || []).filter(p => p.campaign_id === c.id)
                  const done = parts.filter(p => p.done_at).length
                  const pct = parts.length ? Math.round((done / parts.length) * 100) : 0
                  const byStatus = STATUS_ORDER.map(s => ({ s, n: linked.filter(t => t.status === s).length })).filter(x => x.n)
                  const cov = coverage(linked)
                  const v = verticals.find(x => x.id === c.vertical_id)
                  return (
                    <Card key={c.id} className={cn('bg-white border-zinc-200', c.status === 'cancelled' && 'opacity-60')}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">⚡ Thunderclap · {v?.name || 'Whole company'} · {c.status}</div>
                            <Link href={`/campaign/?id=${c.id}`} className="font-semibold text-zinc-900 hover:text-blue-700 block truncate">{c.name}</Link>
                            {c.ask && <p className="text-xs text-zinc-600 line-clamp-2 mt-0.5">{c.ask}</p>}
                          </div>
                          <span className="text-[11px] text-zinc-500 shrink-0">{c.starts_on && format(parseISO(c.starts_on), 'EEE d MMM')}{c.ends_on && c.ends_on !== c.starts_on && ` – ${format(parseISO(c.ends_on), 'd MMM')}`}</span>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-zinc-600 mb-1"><span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> People done</span><span>{done}/{parts.length}</span></div>
                          <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${pct}%` }} /></div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="text-zinc-500">{linked.length} task{linked.length === 1 ? '' : 's'}</span>
                          {byStatus.map(x => <span key={x.s} className="rounded-full px-2 py-px" style={{ backgroundColor: STATUS_CONFIG[x.s].bgColor, color: STATUS_CONFIG[x.s].color }}>{STATUS_CONFIG[x.s].label} {x.n}</span>)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-1">Channels</span>
                          {cov.length === 0 ? <span className="text-[11px] text-zinc-400">none yet: link tasks to this thunderclap from their drawer</span>
                            : cov.map(x => <span key={x.id} className="rounded-full bg-blue-50 text-blue-700 px-2 py-px text-[10px]">{x.name} · {x.n}</span>)}
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <button onClick={() => showOnBoard(c)} className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Filter className="w-3 h-3" /> Show on board</button>
                          <Link href={`/campaign/?id=${c.id}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline ml-auto">Open <ArrowRight className="w-3 h-3" /></Link>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </TabsContent>
      </Tabs>

      {createOpen && <CampaignDialog open={createOpen} onOpenChange={setCreateOpen} defaultVerticalId={isAdmin ? null : [...ownedVerticalIds][0]} />}
    </div>
  )
}
