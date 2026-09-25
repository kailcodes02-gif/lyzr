'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Plus, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { CampaignDialog } from '@/components/campaigns/campaign-dialog'
import { campaignProgress } from '@/components/campaigns/campaign-banner'
import { useCampaigns, useAllCampaignParticipants, useTasks } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { CAMPAIGN_KIND } from '@/lib/types/database'
import { cn } from '@/lib/utils'

export default function CampaignsPage() {
  const { isAdmin, ownedVerticalIds, verticals } = useVertical()
  const { data: campaigns, isLoading } = useCampaigns('all', { includeClosed: true })
  const { data: participants } = useAllCampaignParticipants()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const [createOpen, setCreateOpen] = useState(false)
  const canCreate = isAdmin || ownedVerticalIds.size > 0

  const groups = useMemo(() => {
    const all = campaigns || []
    return [
      { title: 'Live', items: all.filter(c => c.status === 'live') },
      { title: 'Upcoming', items: all.filter(c => c.status === 'upcoming') },
      { title: 'Done', items: all.filter(c => c.status === 'done') },
      { title: 'Cancelled', items: all.filter(c => c.status === 'cancelled') },
    ].filter(g => g.items.length)
  }, [campaigns])

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex items-center justify-between gap-3">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Zap className="w-6 h-6 text-amber-500" /> Campaigns <InfoTip k="campaign" /></h1>
          <p className="text-sm text-zinc-500 mt-1">Launches, thunderclaps and big campaigns. Pinned ones show as a banner on every dashboard.</p>
        </div>
        {canCreate && <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-blue-600 to-violet-600 text-white border-0"><Plus className="w-4 h-4 mr-2" /> New campaign</Button>}
      </div>

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
                <Link key={c.id} href={`/campaign/?id=${c.id}`} className="block group">
                  <Card className={cn('bg-white border-zinc-200 group-hover:border-blue-300 transition-all', c.status !== 'live' && c.status !== 'upcoming' && 'opacity-70')}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">{kind.emoji} {kind.label} · {v?.name || 'Whole company'}</span>
                        {(c.starts_on || c.ends_on) && <span className="text-[11px] text-zinc-500">{c.starts_on && format(parseISO(c.starts_on), 'd MMM')}{c.ends_on && ` – ${format(parseISO(c.ends_on), 'd MMM')}`}</span>}
                      </div>
                      <div className="font-semibold text-zinc-900 group-hover:text-blue-700">{c.name}</div>
                      {c.headline && <p className="text-xs text-zinc-600 line-clamp-1">{c.headline}</p>}
                      <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                        <span>{prog.done}/{prog.total} tasks</span>
                        {parts.length > 0 && <span>{parts.filter(p => p.done_at).length}/{parts.length} people</span>}
                        {!c.is_pinned && <Badge variant="outline" className="text-[10px]">not on banner</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
      {createOpen && <CampaignDialog open={createOpen} onOpenChange={setCreateOpen} defaultVerticalId={isAdmin ? null : [...ownedVerticalIds][0]} />}
    </div>
  )
}
