'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { useKnownEmails, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { createCampaign, updateCampaign, setCampaignPeople } from '@/lib/actions'
import { CAMPAIGN_KIND, type Campaign, type CampaignKind, type CampaignStatus } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// Create or edit a hero campaign. Owners = champions. Participants only
// matter for thunderclaps (everyone who has to do the ask).

const inputCls = 'mt-1 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm'

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
  const { data: knownEmails } = useKnownEmails()
  const [pending, start] = useTransition()

  const [kind, setKind] = useState<CampaignKind>(campaign?.kind || 'launch')
  const [verticalId, setVerticalId] = useState<string>(campaign ? (campaign.vertical_id || '') : (defaultVerticalId || ''))
  const [name, setName] = useState(campaign?.name || '')
  const [headline, setHeadline] = useState(campaign?.headline || '')
  const [description, setDescription] = useState(campaign?.description || '')
  const [ask, setAsk] = useState(campaign?.ask || '')
  const [ctaLabel, setCtaLabel] = useState(campaign?.cta_label || '')
  const [ctaUrl, setCtaUrl] = useState(campaign?.cta_url || '')
  const [startsOn, setStartsOn] = useState(campaign?.starts_on || '')
  const [endsOn, setEndsOn] = useState(campaign?.ends_on || '')
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status || 'upcoming')
  const [ownerText, setOwnerText] = useState(owners.join(', '))
  const [partText, setPartText] = useState(participants.join(', '))

  const emails = (t: string) => t.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean)
  const allEmails = Array.from(new Set([...(users || []).map(u => u.email), ...(knownEmails || [])])).sort()
  const everyone = () => setPartText((users || []).filter(u => u.email !== 'preview@lyzr.ai').map(u => u.email).join(', '))

  const submit = () => start(async () => {
    try {
      if (!name.trim()) throw new Error('Give it a name')
      const vid = verticalId || null
      if (campaign) {
        await updateCampaign(campaign.id, {
          kind, name: name.trim(), headline: headline || null, description: description || null, ask: ask || null,
          cta_label: ctaLabel || null, cta_url: ctaUrl || null, starts_on: startsOn || null, ends_on: endsOn || null, status,
        })
        await setCampaignPeople(campaign.id, 'owners', emails(ownerText))
        await setCampaignPeople(campaign.id, 'participants', kind === 'thunderclap' ? emails(partText) : [])
        toast.success('Campaign updated')
      } else {
        await createCampaign({
          vertical_id: vid, kind, name, headline, description, ask, cta_label: ctaLabel, cta_url: ctaUrl,
          starts_on: startsOn || null, ends_on: endsOn || null, status,
          ownerEmails: emails(ownerText), participantEmails: kind === 'thunderclap' ? emails(partText) : [],
        })
        toast.success('Campaign created. It is now on every dashboard.')
      }
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['campaign'] })
      qc.invalidateQueries({ queryKey: ['campaignOwners'] })
      qc.invalidateQueries({ queryKey: ['campaignParticipants'] })
      onOpenChange(false)
    } catch (e: any) { toast.error(e?.message || 'Failed') }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{campaign ? 'Edit campaign' : 'New hero campaign'} <InfoTip k="campaign" /></DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-zinc-600 text-xs">Kind</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(Object.keys(CAMPAIGN_KIND) as CampaignKind[]).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={cn('rounded-xl border p-3 text-left transition-all', kind === k ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' : 'border-zinc-200 hover:border-zinc-300')}>
                  <div className="text-lg">{CAMPAIGN_KIND[k].emoji}</div>
                  <div className="text-sm font-semibold">{CAMPAIGN_KIND[k].label} <InfoTip k={k} /></div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-600 text-xs">Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Lyzr Agents 3.0 launch" className={inputCls} />
            </div>
            <div>
              <Label className="text-zinc-600 text-xs">Scope</Label>
              <select value={verticalId} onChange={e => setVerticalId(e.target.value)} disabled={!!campaign}
                className="mt-1 w-full text-sm rounded-lg border border-zinc-300 bg-zinc-100 px-3 h-9 text-zinc-900 disabled:opacity-60">
                {isAdmin && <option value="">Whole company (every vertical)</option>}
                {verticals.filter(v => isAdmin || ownedVerticalIds.has(v.id)).map(v => <option key={v.id} value={v.id}>{v.name} only</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label className="text-zinc-600 text-xs">Headline (one line on the banner)</Label>
            <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Ship the biggest release of the year" className={inputCls} />
          </div>

          {kind === 'thunderclap' && (
            <div>
              <Label className="text-zinc-600 text-xs">The ask: what every participant must do *</Label>
              <Input value={ask} onChange={e => setAsk(e.target.value)} placeholder="Repost the launch post from your LinkedIn by Friday" className={inputCls} />
            </div>
          )}

          <div>
            <Label className="text-zinc-600 text-xs">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1 bg-zinc-100 border-zinc-300 text-sm" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-zinc-600 text-xs">Starts</Label><Input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} className={inputCls} /></div>
            <div><Label className="text-zinc-600 text-xs">Ends</Label><Input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} className={inputCls} /></div>
            <div>
              <Label className="text-zinc-600 text-xs">Status</Label>
              <select value={status} onChange={e => setStatus(e.target.value as CampaignStatus)} className="mt-1 w-full text-sm rounded-lg border border-zinc-300 bg-zinc-100 px-3 h-9">
                {['upcoming', 'live', 'done', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-zinc-600 text-xs">Button label</Label><Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Open the launch doc" className={inputCls} /></div>
            <div><Label className="text-zinc-600 text-xs">Button link</Label><Input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://" className={inputCls} /></div>
          </div>

          <div>
            <Label className="text-zinc-600 text-xs">Champions (emails, comma separated) <InfoTip k="champion" /></Label>
            <Input value={ownerText} onChange={e => setOwnerText(e.target.value)} list="campaign-emails" placeholder="anju@lyzr.ai, praveen@lyzr.ai" className={inputCls} />
          </div>

          {kind === 'thunderclap' && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-zinc-600 text-xs">Participants (who must do the ask) <InfoTip k="thunderclap" /></Label>
                <button type="button" onClick={everyone} className="text-xs text-blue-600 hover:underline">Everyone who signed in</button>
              </div>
              <Textarea value={partText} onChange={e => setPartText(e.target.value)} rows={3} placeholder="Comma-separated emails" className="mt-1 bg-zinc-100 border-zinc-300 text-sm" />
            </div>
          )}
          <datalist id="campaign-emails">{allEmails.map(e => <option key={e} value={e} />)}</datalist>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={pending} className="bg-gradient-to-r from-blue-600 to-violet-600 text-white border-0">
              {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {campaign ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
