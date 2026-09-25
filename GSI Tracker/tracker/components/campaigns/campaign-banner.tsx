'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { ArrowRight, Check, Crown, ExternalLink, Plus, Zap } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { useCampaigns, useAllCampaignParticipants, useCurrentUser, useTasks, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { setParticipantDone } from '@/lib/actions'
import { CAMPAIGN_KIND, type Campaign, type Task } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { CampaignDialog } from './campaign-dialog'
import { useCampaignOwnersInline } from './use-campaign-owners'

// The hero strip: launches, thunderclaps and big campaigns that are live or
// coming up. Shown at the top of every home / dashboard.

export function campaignProgress(c: Campaign, tasks: Task[]) {
  const linked = tasks.filter(t => t.campaign_id === c.id)
  const done = linked.filter(t => t.status === 'done').length
  return { total: linked.length, done, pct: linked.length ? Math.round((done / linked.length) * 100) : 0 }
}

function daysLabel(c: Campaign) {
  const today = new Date()
  if (c.starts_on && differenceInCalendarDays(parseISO(c.starts_on), today) > 0) {
    const d = differenceInCalendarDays(parseISO(c.starts_on), today)
    return `starts in ${d} day${d === 1 ? '' : 's'}`
  }
  if (c.ends_on) {
    const d = differenceInCalendarDays(parseISO(c.ends_on), today)
    if (d < 0) return 'ended'
    if (d === 0) return 'ends today'
    return `${d} day${d === 1 ? '' : 's'} left`
  }
  return c.status === 'live' ? 'live now' : 'upcoming'
}

export function CampaignBanner({ verticalId, compact, canCreate }: {
  verticalId?: string | 'all'
  compact?: boolean
  canCreate?: boolean
}) {
  const { verticalId: ctxVertical, isAdmin, canManage } = useVertical()
  const scope = verticalId ?? ctxVertical
  const { data: campaigns } = useCampaigns(scope)
  const { data: participants } = useAllCampaignParticipants()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: users } = useUsers()
  const { data: me } = useCurrentUser()
  const [createOpen, setCreateOpen] = useState(false)
  const qc = useQueryClient()
  const [, start] = useTransition()

  const pinned = useMemo(() => (campaigns || []).filter(c => c.is_pinned), [campaigns])
  const userByEmail = useMemo(() => new Map((users || []).map(u => [u.email.toLowerCase(), u])), [users])
  const allowCreate = canCreate ?? (isAdmin || canManage)

  if (!pinned.length && !allowCreate) return null

  const tick = (c: Campaign, done: boolean) => start(async () => {
    try {
      await setParticipantDone(c.id, me!.email, done)
      qc.invalidateQueries({ queryKey: ['campaignParticipants'] })
      qc.invalidateQueries({ queryKey: ['campaign', c.id] })
      toast.success(done ? 'Marked done. Thanks for showing up!' : 'Un-ticked')
    } catch (e: any) { toast.error(e?.message || 'Could not update') }
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" /> Hero campaigns <InfoTip k="campaign" />
        </h2>
        <div className="flex items-center gap-3">
          <Link href="/campaigns/" className="text-xs text-blue-600 hover:underline">All campaigns</Link>
          {allowCreate && (
            <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-300" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New
            </Button>
          )}
        </div>
      </div>
      {pinned.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-xs text-zinc-500">
          No launch, thunderclap or campaign is pinned right now. Create one and it shows up on every dashboard.
        </div>
      ) : (
        <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}>
          {pinned.map(c => {
            const kind = CAMPAIGN_KIND[c.kind]
            const prog = campaignProgress(c, tasks || [])
            const parts = (participants || []).filter(p => p.campaign_id === c.id)
            const partsDone = parts.filter(p => p.done_at).length
            const mine = me ? parts.find(p => p.email.toLowerCase() === me.email.toLowerCase()) : undefined
            return (
              <div key={c.id} className={cn('rounded-2xl p-[1px] bg-gradient-to-r shadow-sm', kind.className)}>
                <div className="rounded-2xl bg-white p-4 space-y-3 h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
                        <span>{kind.emoji} {kind.label}</span>
                        <span className={cn('rounded-full px-1.5 py-0.5', c.status === 'live' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600')}>{daysLabel(c)}</span>
                      </div>
                      <Link href={`/campaign/?id=${c.id}`} className="block text-base font-bold text-zinc-900 hover:text-blue-700 truncate mt-0.5">{c.name}</Link>
                      {c.headline && <p className="text-xs text-zinc-600 line-clamp-2">{c.headline}</p>}
                    </div>
                    {(c.starts_on || c.ends_on) && (
                      <div className="text-[11px] text-zinc-500 text-right shrink-0">
                        {c.starts_on && format(parseISO(c.starts_on), 'd MMM')}{c.ends_on && ` – ${format(parseISO(c.ends_on), 'd MMM')}`}
                      </div>
                    )}
                  </div>

                  {c.kind === 'thunderclap' && c.ask && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                      <strong>Everyone:</strong> {c.ask}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-[11px] text-zinc-600 flex-wrap">
                    {prog.total > 0 && (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-1.5 w-24 rounded-full bg-zinc-200 overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${prog.pct}%` }} /></span>
                        {prog.done}/{prog.total} tasks
                      </span>
                    )}
                    {parts.length > 0 && <span>{partsDone}/{parts.length} people done</span>}
                    <Champions campaignId={c.id} userByEmail={userByEmail} />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {mine && (
                      <Button size="sm" onClick={() => tick(c, !mine.done_at)}
                        className={cn('h-7 text-xs border-0', mine.done_at ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-amber-500 hover:bg-amber-400 text-white')}>
                        <Check className="w-3.5 h-3.5 mr-1" /> {mine.done_at ? 'You did it' : 'I did my part'}
                      </Button>
                    )}
                    {c.cta_url && (
                      <a href={c.cta_url} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-300"><ExternalLink className="w-3.5 h-3.5 mr-1" /> {c.cta_label || 'Open'}</Button>
                      </a>
                    )}
                    <Link href={`/campaign/?id=${c.id}`} className="ml-auto text-xs text-blue-600 hover:underline inline-flex items-center gap-1">Tracker <ArrowRight className="w-3 h-3" /></Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {createOpen && <CampaignDialog open={createOpen} onOpenChange={setCreateOpen} defaultVerticalId={scope === 'all' ? null : scope} />}
    </div>
  )
}

// Owners of a campaign = its champions, shown as small avatars + names.
export function Champions({ campaignId, userByEmail }: { campaignId: string; userByEmail: Map<string, { display_name: string | null; email: string }> }) {
  const owners = useCampaignOwnersInline(campaignId)
  if (!owners.length) return null
  return (
    <span className="inline-flex items-center gap-1">
      <Crown className="w-3 h-3 text-amber-500" />
      {owners.slice(0, 3).map(o => userByEmail.get(o.email)?.display_name || o.email.split('@')[0]).join(', ')}
      {owners.length > 3 && ` +${owners.length - 3}`}
    </span>
  )
}
