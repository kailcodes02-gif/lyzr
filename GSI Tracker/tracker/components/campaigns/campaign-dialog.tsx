'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Loader2, Plus, Rocket, Target, Trash2, Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { PeoplePicker } from '@/components/ui/people-picker'
import { useChannels, useCurrentUser, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { createCampaign, createTask, updateCampaign, setCampaignPeople } from '@/lib/actions'
import type { Campaign, CampaignKind, CampaignStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// Create or edit a campaign. Leads = owners. Participants only matter for
// thunderclaps (everyone who has to do the ask). New campaigns can carry
// their first tasks, created in the chosen projects once the campaign exists.

const KINDS: { value: CampaignKind; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { value: 'launch', label: 'Launch', icon: Rocket, desc: 'A product or feature release everyone rallies behind.' },
  { value: 'thunderclap', label: 'Thunderclap', icon: Zap, desc: 'One day, one ask — everyone posts or shares at the same time.' },
  { value: 'campaign', label: 'Campaign', icon: Target, desc: 'A multi-week push across several channels or teams.' },
]

const STAGES: { value: CampaignStatus; label: string }[] = [
  { value: 'upcoming', label: 'Planned — not started yet' },
  { value: 'live', label: 'Running now' },
  { value: 'done', label: 'Finished' },
  { value: 'cancelled', label: 'Cancelled' },
]

const field = 'bg-white border-zinc-300 h-9 text-sm'

export function CampaignDialog({ open, onOpenChange, campaign, defaultVerticalId, owners = [], participants = [] }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  campaign?: Campaign
  defaultVerticalId?: string | null
  owners?: string[]
  participants?: string[]
}) {
  const qc = useQueryClient()
  const { verticals, isAdmin, ownedVerticalIds } = useVertical()
  const { data: users } = useUsers()
  const { data: me } = useCurrentUser()
  const { data: channels } = useChannels('all')
  const [pending, start] = useTransition()

  const [kind, setKind] = useState<CampaignKind>(campaign?.kind || 'launch')
  const [verticalId, setVerticalId] = useState<string>(campaign ? (campaign.vertical_id || '') : (defaultVerticalId || (isAdmin ? '' : [...ownedVerticalIds][0] || '')))
  const [name, setName] = useState(campaign?.name || '')
  const [headline, setHeadline] = useState(campaign?.headline || '')
  const [description, setDescription] = useState(campaign?.description || '')
  const [ask, setAsk] = useState(campaign?.ask || '')
  const [ctaLabel, setCtaLabel] = useState(campaign?.cta_label || '')
  const [ctaUrl, setCtaUrl] = useState(campaign?.cta_url || '')
  const [showLink, setShowLink] = useState(!!(campaign?.cta_label || campaign?.cta_url))
  const [startsOn, setStartsOn] = useState(campaign?.starts_on || '')
  const [endsOn, setEndsOn] = useState(campaign?.ends_on || '')
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status || 'upcoming')
  const [leads, setLeads] = useState<string[]>(owners.length ? owners : me?.email ? [me.email.toLowerCase()] : [])
  const [people, setPeople] = useState<string[]>(participants)
  const [tasks, setTasks] = useState<{ title: string; channelId: string }[]>([])

  // Projects a new task can go into: within the campaign's vertical, or all.
  const projectOptions = (channels || [])
    .filter(c => c.is_active && (!verticalId || c.vertical_id === verticalId))
    .map(c => {
      const parent = c.parent_channel_id ? channels?.find(p => p.id === c.parent_channel_id) : null
      const v = verticals.find(x => x.id === c.vertical_id)?.name
      return { id: c.id, label: `${verticalId ? '' : `${v} · `}${parent ? `${parent.name} › ` : ''}${c.name}` }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  // New campaigns take their stage from the dates; editing can override it.
  const autoStatus = (): CampaignStatus => {
    const today = new Date().toISOString().slice(0, 10)
    if (endsOn && endsOn < today) return 'done'
    if (!startsOn || startsOn <= today) return 'live'
    return 'upcoming'
  }

  const submit = () => start(async () => {
    try {
      if (!name.trim()) throw new Error('Give the campaign a name')
      if (kind === 'thunderclap' && !ask.trim()) throw new Error('Say what everyone should do')
      const orphan = tasks.find(t => t.title.trim() && !t.channelId)
      if (orphan) throw new Error(`Pick a project for “${orphan.title}”`)
      if (campaign) {
        await updateCampaign(campaign.id, {
          kind, name: name.trim(), headline: headline || null, description: description || null, ask: ask || null,
          cta_label: ctaLabel || null, cta_url: ctaUrl || null, starts_on: startsOn || null, ends_on: endsOn || null, status,
        })
        await setCampaignPeople(campaign.id, 'owners', leads)
        await setCampaignPeople(campaign.id, 'participants', kind === 'thunderclap' ? people : [])
        toast.success('Campaign updated')
      } else {
        const row = await createCampaign({
          vertical_id: verticalId || null, kind, name: name.trim(), headline, description, ask,
          cta_label: ctaLabel, cta_url: ctaUrl, starts_on: startsOn || null, ends_on: endsOn || null,
          status: autoStatus(), ownerEmails: leads, participantEmails: kind === 'thunderclap' ? people : [],
        })
        const todo = tasks.filter(t => t.title.trim())
        let made = 0
        for (const t of todo) {
          try {
            await createTask({
              channel_id: t.channelId, title: t.title.trim(), priority: 'P2', campaign_id: (row as { id: string }).id,
              due_date: endsOn || undefined, assignments: me ? [{ user_id: me.id, role: 'primary' }] : [],
            })
            made++
          } catch (e) { console.error('campaign task failed', t, e) }
        }
        if (made < todo.length) toast.error(`${todo.length - made} task(s) could not be created — add them from the campaign page`)
        toast.success(made ? `Campaign created with ${made} task${made === 1 ? '' : 's'}` : 'Campaign created')
        qc.invalidateQueries({ queryKey: ['tasks'] })
      }
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['campaign'] })
      qc.invalidateQueries({ queryKey: ['campaignOwners'] })
      qc.invalidateQueries({ queryKey: ['campaignParticipants'] })
      onOpenChange(false)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  })

  const scopeChoices = [
    ...(isAdmin ? [{ id: '', label: 'Everyone in the company' }] : []),
    ...verticals.filter(v => isAdmin || ownedVerticalIds.has(v.id)).map(v => ({ id: v.id, label: `Only people in ${v.name}` })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-zinc-100">
          <DialogTitle className="text-base font-semibold">{campaign ? 'Edit campaign' : 'New campaign'}</DialogTitle>
          <p className="text-xs text-zinc-500">A big push that shows as a banner on home pages and groups the tasks that make it happen.</p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">
          <Section title="What kind is it?">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {KINDS.map(k => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors',
                    kind === k.value ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-zinc-200 hover:bg-zinc-50')}>
                  <k.icon className={cn('w-4 h-4 mb-1', kind === k.value ? 'text-orange-600' : 'text-zinc-500')} />
                  <div className="text-sm font-medium">{k.label}</div>
                  <div className="text-[11px] leading-snug text-zinc-500">{k.desc}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Name and summary">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lyzr Agents 3.0 launch" className={cn(field, 'h-10 text-base')} />
            <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="One line for the banner — e.g. “Ship the biggest release of the year”" className={field} />
            {kind === 'thunderclap' && (
              <Input value={ask} onChange={e => setAsk(e.target.value)} placeholder="What should everyone do? — e.g. “Repost the launch post on LinkedIn by Friday”" className={cn(field, 'border-orange-300')} />
            )}
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Details (optional)" className="bg-white border-zinc-300 text-sm" />
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Section title="When does it run?">
              <div className="flex items-center gap-2">
                <Input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} className={field} aria-label="Starts" />
                <span className="text-xs text-zinc-500">to</span>
                <Input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} className={field} aria-label="Ends" />
              </div>
              {campaign ? (
                <select value={status} onChange={e => setStatus(e.target.value as CampaignStatus)} className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm">
                  {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              ) : (
                <p className="text-[11px] text-zinc-500">It shows as “running” between these dates automatically.</p>
              )}
            </Section>
            <Section title="Who sees the banner?">
              <select value={verticalId} onChange={e => { setVerticalId(e.target.value); setTasks(ts => ts.map(t => ({ ...t, channelId: '' }))) }} disabled={!!campaign}
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm disabled:opacity-60">
                {scopeChoices.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <p className="text-[11px] text-zinc-500">The banner appears on these people&apos;s home pages until the campaign ends.</p>
            </Section>
          </div>

          <Section title="Who is leading it?">
            <PeoplePicker value={leads} onChange={setLeads} placeholder="Type a name…" />
          </Section>

          {kind === 'thunderclap' && (
            <Section title="Who takes part?" action={
              <button type="button" onClick={() => setPeople((users || []).filter(u => u.email !== 'preview@lyzr.ai').map(u => u.email.toLowerCase()))} className="text-xs text-blue-600 hover:underline">Add everyone who has signed in</button>
            }>
              <PeoplePicker value={people} onChange={setPeople} placeholder="Type names, or add everyone" />
              <p className="text-[11px] text-zinc-500">Each person gets the ask and ticks it off when they&apos;ve done it.</p>
            </Section>
          )}

          {!campaign && (
            <Section title="Tasks in this campaign" hint="Optional — add the first pieces of work now; more can be added later from the campaign page.">
              <div className="space-y-2">
                {tasks.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="h-4 w-4 shrink-0 rounded-full border-2 border-zinc-300" />
                    <Input value={t.title} autoFocus={i === tasks.length - 1} onChange={e => setTasks(ts => ts.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                      placeholder="Task name" className={cn(field, 'flex-1')} />
                    <select value={t.channelId} onChange={e => setTasks(ts => ts.map((x, j) => j === i ? { ...x, channelId: e.target.value } : x))}
                      className="h-9 w-48 rounded-md border border-zinc-300 bg-white px-2 text-xs">
                      <option value="">Which project?</option>
                      {projectOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <button type="button" aria-label="Remove task" onClick={() => setTasks(ts => ts.filter((_, j) => j !== i))} className="p-1 text-zinc-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setTasks(ts => [...ts, { title: '', channelId: ts[ts.length - 1]?.channelId || '' }])}
                  className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-orange-600">
                  <Plus className="w-4 h-4" /> Add a task
                </button>
              </div>
            </Section>
          )}

          <div>
            <button type="button" onClick={() => setShowLink(s => !s)} className="flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900">
              {showLink ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Add a button to the banner (optional)
            </button>
            {showLink && (
              <div className="mt-2 pl-5 space-y-2">
                <p className="text-[11px] text-zinc-500">Puts one clickable button on the banner — e.g. “Open the launch doc” linking to the brief.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Button text" className={field} />
                  <Input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://…" className={field} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-600">Cancel</Button>
          <Button onClick={submit} disabled={pending} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
            {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {campaign ? 'Save changes' : 'Create campaign'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-900">{title}</h3>
        {action}
      </div>
      {hint && <p className="text-[11px] text-zinc-500 -mt-1">{hint}</p>}
      {children}
    </section>
  )
}
