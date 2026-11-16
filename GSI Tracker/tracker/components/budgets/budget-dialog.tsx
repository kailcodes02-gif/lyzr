'use client'

// Set or change one budget. Opens from the Budgets page ("New budget"), and
// from a campaign or channel page with that thing already picked.
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, Layers, Loader2, Package, Trash2, Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAllCampaignOwners, useCampaigns, useChannels, useMyBadges, useProducts, useVerticals } from '@/lib/hooks/use-data'
import { deleteBudget, saveBudget } from '@/lib/actions'
import { CADENCE_LABEL, SCOPE_LABEL } from '@/lib/budgets'
import { CAMPAIGN_KIND, type Budget, type BudgetCadence, type BudgetScope } from '@/lib/types/database'
import { cn } from '@/lib/utils'

export const SCOPE_ICON: Record<BudgetScope, React.ComponentType<{ className?: string }>> = {
  campaign: Zap, channel: Layers, product: Package, vertical: Building2,
}

type Option = { id: string; label: string; group?: string; starts_on?: string | null; ends_on?: string | null }

// What the signed-in person may set budgets for. Admins and leadership:
// everything. Heads: the things they head.
export function useBudgetScopes() {
  const badges = useMyBadges()
  const { data: campaigns } = useCampaigns('all', { includeClosed: true })
  const { data: channels } = useChannels('all')
  const { data: products } = useProducts()
  const { data: verticals } = useVerticals()
  const { data: campaignOwners } = useAllCampaignOwners()
  const all = badges.isAdmin || badges.isLeadership
  const myId = badges.me?.id
  const myEmail = badges.me?.email.toLowerCase()

  return useMemo(() => {
    const myCampaigns = new Set((campaignOwners || []).filter(o => (myId && o.user_id === myId) || (myEmail && o.email.toLowerCase() === myEmail)).map(o => o.campaign_id))
    const live = (channels || []).filter(c => c.is_active && c.slug !== 'no-channel')
    const byId = new Map(live.map(c => [c.id, c]))
    const can = (scope: BudgetScope, id: string) => {
      if (all) return true
      if (scope === 'vertical') return badges.ownedVerticalIds.has(id)
      if (scope === 'product') return badges.ownedProductIds.has(id)
      if (scope === 'campaign') return myCampaigns.has(id)
      const c = byId.get(id)
      return badges.effectiveChannelIds.has(id) || (!!c?.parent_channel_id && badges.effectiveChannelIds.has(c.parent_channel_id))
    }
    const options: Record<BudgetScope, Option[]> = {
      campaign: (campaigns || []).map(c => ({ id: c.id, label: `${CAMPAIGN_KIND[c.kind]?.emoji || ''} ${c.name}`.trim(), group: CAMPAIGN_KIND[c.kind]?.label, starts_on: c.starts_on, ends_on: c.ends_on })),
      channel: live.sort((a, b) => a.sort_order - b.sort_order).filter(c => !c.parent_channel_id).flatMap(top => [
        { id: top.id, label: top.name, group: top.name },
        ...live.filter(k => k.parent_channel_id === top.id).flatMap(k => [
          { id: k.id, label: `${top.name} › ${k.name}`, group: top.name },
          ...live.filter(g => g.parent_channel_id === k.id).map(g => ({ id: g.id, label: `${top.name} › ${k.name} › ${g.name}`, group: top.name })),
        ]),
      ]),
      product: (products || []).map(p => ({ id: p.id, label: p.name, group: p.group_name })),
      vertical: (verticals || []).map(v => ({ id: v.id, label: v.name })),
    }
    const nameOf = (scope: BudgetScope, id: string) => options[scope].find(o => o.id === id)?.label || (scope === 'channel' ? (channels || []).find(c => c.id === id)?.name : undefined) || 'Removed'
    const mine: Record<BudgetScope, Option[]> = {
      campaign: options.campaign.filter(o => can('campaign', o.id)), channel: options.channel.filter(o => can('channel', o.id)),
      product: options.product.filter(o => can('product', o.id)), vertical: options.vertical.filter(o => can('vertical', o.id)),
    }
    const canAny = all || Object.values(mine).some(l => l.length > 0)
    return { can, options, mine, nameOf, canAny, all }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, myId, myEmail, campaigns, channels, products, verticals, campaignOwners, badges.ownedVerticalIds.size, badges.ownedProductIds.size, badges.effectiveChannelIds.size])
}

const SCOPES: BudgetScope[] = ['campaign', 'channel', 'product', 'vertical']
const CADENCES: BudgetCadence[] = ['one_time', 'monthly', 'quarterly', 'yearly']
const inputCls = 'h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900'

export function BudgetDialog({ open, onOpenChange, budget, preset }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Editing this one. */
  budget?: Budget | null
  /** New budget for this thing (opened from its own page). */
  preset?: { scope_type: BudgetScope; scope_id: string }
}) {
  const qc = useQueryClient()
  const { mine, nameOf, all } = useBudgetScopes()
  const locked = !!budget || !!preset
  const [scope, setScope] = useState<BudgetScope>(budget?.scope_type || preset?.scope_type || 'campaign')
  const [scopeId, setScopeId] = useState(budget?.scope_id || preset?.scope_id || '')
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '')
  const [cadence, setCadence] = useState<BudgetCadence>(budget?.cadence || (preset?.scope_type === 'campaign' || !preset ? 'one_time' : 'monthly'))
  const [startsOn, setStartsOn] = useState(budget?.starts_on || '')
  const [endsOn, setEndsOn] = useState(budget?.ends_on || '')
  const [name, setName] = useState(budget?.name || '')
  const [notes, setNotes] = useState(budget?.notes || '')
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)

  const firstScope = SCOPES.find(s => mine[s].length > 0)
  // New budget from the Budgets page: start on a kind this person can use.
  useEffect(() => {
    if (!locked && firstScope && !mine[scope].length) setScope(firstScope) // eslint-disable-line react-hooks/set-state-in-effect
  }, [locked, firstScope, mine, scope])

  const pickScope = (s: BudgetScope) => { setScope(s); setScopeId(''); setCadence(s === 'campaign' ? 'one_time' : 'monthly') }
  const pickItem = (id: string) => {
    setScopeId(id)
    // A campaign's budget covers the campaign's own dates unless changed.
    const o = mine.campaign.find(x => x.id === id)
    if (scope === 'campaign' && o && !startsOn && !endsOn) { setStartsOn(o.starts_on || ''); setEndsOn(o.ends_on || '') }
  }

  const amt = Number(amount)
  const ok = !!scopeId && amount.trim() !== '' && Number.isFinite(amt) && amt >= 0 && (!startsOn || !endsOn || endsOn >= startsOn)
  const groups = [...new Set(mine[scope].map(o => o.group).filter(Boolean))] as string[]

  const save = async () => {
    setBusy('save')
    try {
      await saveBudget({ id: budget?.id, scope_type: scope, scope_id: scopeId, name, amount: amt, cadence, starts_on: startsOn, ends_on: endsOn, notes })
      toast.success(budget ? 'Budget updated' : `Budget set for ${nameOf(scope, scopeId)}`)
      qc.invalidateQueries({ queryKey: ['budgets'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      onOpenChange(false)
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }
  const remove = async () => {
    if (!budget || !window.confirm('Remove this budget? Tasks and their own amounts are not touched.')) return
    setBusy('delete')
    try {
      await deleteBudget(budget.id)
      toast.success('Budget removed')
      qc.invalidateQueries({ queryKey: ['budgets'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      onOpenChange(false)
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border border-zinc-200 text-zinc-900 sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-zinc-100">
          <DialogTitle className="text-base font-semibold">{budget ? 'Edit budget' : locked ? `Budget for ${nameOf(scope, scopeId)}` : 'New budget'}</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-5 space-y-5">
          {!locked && (
            <div>
              <p className="text-sm font-medium mb-1.5">What is this budget for?<span className="text-orange-500 ml-0.5">*</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2.5">
                {SCOPES.map(s => {
                  const Icon = SCOPE_ICON[s]; const none = !mine[s].length
                  return (
                    <button key={s} type="button" disabled={none} onClick={() => pickScope(s)} title={none ? (all ? `No ${SCOPE_LABEL[s].many.toLowerCase()} yet` : `You do not head any ${SCOPE_LABEL[s].many.toLowerCase()}`) : undefined}
                      className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                        scope === s ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 hover:bg-zinc-50')}>
                      <Icon className="w-4 h-4 mb-1" />
                      <span className="text-sm font-medium block">{SCOPE_LABEL[s].one}</span>
                    </button>
                  )
                })}
              </div>
              <select value={scopeId} onChange={e => pickItem(e.target.value)} className={inputCls} aria-label={SCOPE_LABEL[scope].one}>
                <option value="">Pick a {SCOPE_LABEL[scope].one.toLowerCase()}{scope === 'campaign' ? ' or thunderclap' : ''}…</option>
                {groups.length > 1
                  ? groups.map(g => <optgroup key={g} label={g}>{mine[scope].filter(o => o.group === g).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)
                  : mine[scope].map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-4">
            <div>
              <p className="text-sm font-medium mb-1.5">Amount (USD)<span className="text-orange-500 ml-0.5">*</span></p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
                <input type="number" min="0" step="50" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" autoFocus={locked}
                  className={cn(inputCls, 'pl-7')} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">How often</p>
              <div className="flex flex-wrap gap-1.5">
                {CADENCES.map(c => (
                  <button key={c} type="button" onClick={() => setCadence(c)}
                    className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors cursor-pointer', cadence === c ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100')}>
                    {CADENCE_LABEL[c].pick}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium mb-1.5">{cadence === 'one_time' ? 'From' : 'Starts'}</p>
              <input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} className={inputCls} />
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">{cadence === 'one_time' ? 'To' : 'Ends'}</p>
              <input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} className={inputCls} />
            </div>
            <p className="col-span-2 -mt-2 text-xs text-zinc-500">
              {cadence === 'one_time'
                ? 'Optional. With dates, only tasks due in that stretch count. Without, every task counts.'
                : `That is the amount for each ${cadence === 'monthly' ? 'month' : cadence === 'quarterly' ? 'quarter' : 'year'}. Leave Ends empty to keep it running.`}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-1.5">Label <span className="font-normal text-zinc-500">optional</span></p>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Booth and travel" className={inputCls} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Note <span className="font-normal text-zinc-500">optional</span></p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything people should know about this money"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900" />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3">
          {budget && (
            <Button type="button" variant="ghost" disabled={!!busy} onClick={remove} className="text-red-600 hover:text-red-700 hover:bg-red-50">
              {busy === 'delete' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />} Remove
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-600">Cancel</Button>
          <Button type="button" disabled={!ok || !!busy} onClick={save} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
            {busy === 'save' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{budget ? 'Save' : 'Set budget'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
