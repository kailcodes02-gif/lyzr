'use client'

import { useMemo, useState } from 'react'
import {
  useAllChannelOwners, useAllProductOwners, useAllVerticalOwners, useChannels, useRecentActivity, useUsers,
} from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { InfoTip } from '@/components/ui/info-tip'
import { ALL_TIME, inRange, resolveRange, type DateRangeValue } from '@/lib/date-range'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { History as HistoryIcon, Layers, Package, Building2, Zap, Crown, UserCircle } from 'lucide-react'
import { format } from 'date-fns'
import type { ActivityLog } from '@/lib/types/database'

// Every logged change, filterable by who did it, who it concerns, which
// channel, vertical, product or campaign it touched, and which head's remit
// it falls in. Rows carry a snapshot of those tags (migration 036).

const ACTION_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'edited',
  edited: 'edited',
  status_changed: 'changed status of',
  commented: 'commented on',
  imported_leads: 'imported leads via',
  deleted: 'deleted',
  channel_created: 'created channel',
  channel_edited: 'edited channel',
  channel_archived: 'archived channel',
  channel_restored: 'restored channel',
  channel_merged: 'merged a channel into',
  campaign_created: 'created campaign',
  campaign_edited: 'edited campaign',
  campaign_status: 'changed the status of campaign',
}

const who = (log: ActivityLog) => ((log.to_value || log.from_value || {}) as { email?: string }).email || 'someone'

function verb(log: ActivityLog): string {
  switch (log.action) {
    case 'head_added': return `made ${who(log)}`
    case 'head_removed': return `removed ${who(log)} as`
    case 'member_added': return `added ${who(log)} as`
    case 'member_removed': return `removed ${who(log)} as`
    case 'badge_added': return `gave ${who(log)} the badge`
    case 'badge_removed': return `took the badge from ${who(log)}:`
    case 'thunderclap_done': return `ticked ${who(log)} as done on`
    case 'thunderclap_undone': return `unticked ${who(log)} on`
    default: return ACTION_LABELS[log.action] || log.action.replace(/_/g, ' ')
  }
}

const ENTITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  channel: Layers, vertical: Building2, product: Package, campaign: Zap, function: Crown, member: Building2, badge: UserCircle,
}

// A deleted task's title and place survive in its 'deleted' entry.
const deletedTitle = (log: ActivityLog) => log.action === 'deleted' ? ((log.from_value as { title?: string } | null)?.title || null) : null
function deletedSummary(log: ActivityLog) {
  const f = (log.from_value || {}) as { status?: string; priority?: string; parent_task_id?: string | null }
  return [f.parent_task_id ? 'sub-task' : 'task', f.priority, f.status?.replace(/_/g, ' ')].filter(Boolean).join(' · ') + ' · deleted'
}

// Compact human summary of a from→to change payload
function changeSummary(from: unknown, to: unknown): string | null {
  if (!to || typeof to !== 'object') return null
  const t = to as Record<string, unknown>
  const f = (from || {}) as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(t)) {
    if (key === 'title' && !f.title) continue
    if (key === 'email') continue
    const before = f[key]
    const after = t[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    const fmt = (v: unknown) => v == null ? '—' : typeof v === 'object' ? ((v as { path?: string }).path || '(fields)') : String(v).slice(0, 40)
    parts.push(before !== undefined ? `${key}: ${fmt(before)} → ${fmt(after)}` : `${key}: ${fmt(after)}`)
  }
  return parts.length ? parts.slice(0, 4).join(' · ') : null
}

const sel = 'text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 max-w-[11rem]'

export default function HistoryPage() {
  const { verticals, products, campaigns } = useVertical()
  const { data: activities, isLoading } = useRecentActivity(400, 'all')
  const { data: users } = useUsers()
  const { data: channels } = useChannels('all')
  const { data: chOwners } = useAllChannelOwners()
  const { data: vOwners } = useAllVerticalOwners()
  const { data: pOwners } = useAllProductOwners()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [actor, setActor] = useState('')
  const [person, setPerson] = useState('')
  const [head, setHead] = useState('')
  const [channel, setChannel] = useState('')
  const [vertical, setVertical] = useState('')
  const [product, setProduct] = useState('')
  const [campaign, setCampaign] = useState('')
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME)
  const rr = resolveRange(range)

  const people = useMemo(() => (users || []).filter(u => u.email !== 'preview@lyzr.ai').sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email)), [users])
  const channelList = useMemo(() => {
    const list = (channels || []).filter(c => c.is_active)
    const byParent = new Map<string | null, typeof list>()
    for (const c of list) byParent.set(c.parent_channel_id, [...(byParent.get(c.parent_channel_id) || []), c])
    const out: { id: string; label: string; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => { for (const c of (byParent.get(parent) || []).sort((a, b) => a.sort_order - b.sort_order)) { out.push({ id: c.id, label: c.name, depth }); walk(c.id, depth + 1) } }
    walk(null, 0)
    return out
  }, [channels])
  // Channel filter includes the channel's sub-channels.
  const channelScope = useMemo(() => {
    if (!channel) return null
    const list = channels || []
    const out = new Set([channel]); let grew = true
    while (grew) { grew = false; for (const c of list) if (c.parent_channel_id && out.has(c.parent_channel_id) && !out.has(c.id)) { out.add(c.id); grew = true } }
    return out
  }, [channel, channels])
  // Head filter: everything in the remit of one person (their channels, verticals, products).
  const headScope = useMemo(() => {
    if (!head) return null
    const u = people.find(p => p.id === head); if (!u) return null
    const mine = <T extends { email: string; user_id: string | null }>(rows?: T[]) => (rows || []).filter(r => r.user_id === u.id || r.email.toLowerCase() === u.email.toLowerCase())
    return {
      channels: new Set(mine(chOwners).map(r => r.channel_id)),
      verticals: new Set(mine(vOwners).map(r => r.vertical_id)),
      products: new Set(mine(pOwners).map(r => r.product_id)),
    }
  }, [head, people, chOwners, vOwners, pOwners])

  const rowChannel = (a: ActivityLog) => a.channel_id || a.task?.channel_id || (a.from_value as { channel_id?: string } | null)?.channel_id || null
  const rowVerticals = (a: ActivityLog) => a.vertical_ids?.length ? a.vertical_ids : (a.task?.vertical_ids || [])
  const rowProducts = (a: ActivityLog) => a.product_ids?.length ? a.product_ids : (a.task?.product_ids || [])
  const rowCampaign = (a: ActivityLog) => a.campaign_id || a.task?.campaign_id || null

  const filtered = useMemo(() => (activities || []).filter(a => {
    if (!inRange(a.created_at, rr)) return false
    if (actor && a.actor_id !== actor) return false
    if (person && !(a.actor_id === person || (a.people || []).includes(person))) return false
    if (channelScope) { const c = rowChannel(a); if (!c || !channelScope.has(c)) return false }
    if (vertical && !rowVerticals(a).includes(vertical)) return false
    if (product && !rowProducts(a).includes(product)) return false
    if (campaign && rowCampaign(a) !== campaign) return false
    if (headScope) {
      const c = rowChannel(a)
      const inRemit = (c && headScope.channels.has(c)) || rowVerticals(a).some(v => headScope.verticals.has(v)) || rowProducts(a).some(p => headScope.products.has(p))
      if (!inRemit) return false
    }
    return true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activities, rr, actor, person, channelScope, vertical, product, campaign, headScope])

  const anyFilter = actor || person || head || channel || vertical || product || campaign
  const clear = () => { setActor(''); setPerson(''); setHead(''); setChannel(''); setVertical(''); setProduct(''); setCampaign('') }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex flex-col gap-3">
        <div className="pl-12 lg:pl-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <HistoryIcon className="w-6 h-6 text-blue-600" /> History <InfoTip k="history" />
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Everything logged across the tracker: task changes, heads and members, channels, campaigns. Filter it any way you need.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker label="When" value={range} onChange={setRange} />
          <select value={actor} onChange={e => setActor(e.target.value)} className={sel} aria-label="Done by">
            <option value="">Done by anyone</option>
            {people.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
          </select>
          <select value={person} onChange={e => setPerson(e.target.value)} className={sel} aria-label="Involving">
            <option value="">Involving anyone</option>
            {people.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
          </select>
          <select value={head} onChange={e => setHead(e.target.value)} className={sel} aria-label="In the remit of">
            <option value="">Any head&apos;s remit</option>
            {people.map(u => <option key={u.id} value={u.id}>Remit of {u.display_name || u.email}</option>)}
          </select>
          <select value={channel} onChange={e => setChannel(e.target.value)} className={sel} aria-label="Channel">
            <option value="">All channels</option>
            {channelList.map(c => <option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.depth ? '› ' : ''}{c.label}</option>)}
          </select>
          <select value={vertical} onChange={e => setVertical(e.target.value)} className={sel} aria-label="Vertical">
            <option value="">All verticals</option>
            {verticals.map(v => <option key={v.id} value={v.id}>{v.slug === 'lyzr' ? 'Lyzr (brand)' : v.name}</option>)}
          </select>
          <select value={product} onChange={e => setProduct(e.target.value)} className={sel} aria-label="Product">
            <option value="">All products</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.slug === 'lyzr' ? 'Lyzr (brand)' : p.name}</option>)}
          </select>
          {campaigns.length > 0 && (
            <select value={campaign} onChange={e => setCampaign(e.target.value)} className={sel} aria-label="Campaign">
              <option value="">All campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {anyFilter && <button onClick={clear} className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2">Clear</button>}
          <span className="text-[11px] text-zinc-400 ml-auto">{filtered.length} of {(activities || []).length} entries</span>
        </div>
      </div>

      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 divide-y divide-zinc-200 max-h-[75vh] overflow-y-auto">
          {isLoading && <p className="p-8 text-center text-sm text-zinc-500">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="p-8 text-center text-sm text-zinc-500">{anyFilter ? 'Nothing matches these filters.' : 'No activity logged yet.'}</p>
          )}
          {filtered.map(log => {
            const isTask = !log.entity_type || log.entity_type === 'task'
            const summary = log.action === 'deleted' ? deletedSummary(log) : changeSummary(log.from_value, log.to_value)
            const Icon = !isTask ? ENTITY_ICON[log.entity_type || ''] : null
            const chName = (() => { const c = rowChannel(log); return c ? (channels || []).find(x => x.id === c)?.name : null })()
            const tags = [
              ...rowVerticals(log).map(v => verticals.find(x => x.id === v)).filter(v => v && v.slug !== 'lyzr').map(v => v!.name),
              ...rowProducts(log).map(p => products.find(x => x.id === p)).filter(p => p && p.slug !== 'lyzr').map(p => p!.name),
            ]
            return (
              <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50">
                <Avatar className="w-7 h-7 border border-zinc-200 shrink-0 mt-0.5">
                  <AvatarImage src={log.actor?.avatar_url || ''} />
                  <AvatarFallback className="bg-zinc-200 text-zinc-700 text-[10px]">
                    {(log.actor?.display_name || 'S').charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-700">
                    <span className="font-medium text-zinc-900">{log.actor?.display_name || 'System'}</span>{' '}
                    {verb(log)}{' '}
                    {isTask && log.task ? (
                      <button onClick={() => setSelectedTaskId(log.task!.id)} className="text-blue-600 hover:underline font-medium">{log.task.title}</button>
                    ) : isTask && deletedTitle(log) ? (
                      <span className="font-medium text-zinc-500 line-through" title="This task was deleted">{deletedTitle(log)}</span>
                    ) : !isTask ? (
                      <span className="font-medium text-zinc-900 inline-flex items-center gap-1">{Icon && <Icon className="w-3.5 h-3.5 text-zinc-400" />}{log.label || log.entity_type}</span>
                    ) : (
                      <span className="text-zinc-500">a task</span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                    {[chName, ...tags].filter(Boolean).join(' · ')}{summary ? `${chName || tags.length ? ' — ' : ''}${summary}` : ''}
                  </p>
                </div>
                <span className="text-[11px] text-zinc-400 shrink-0 mt-1">
                  {format(new Date(log.created_at), 'd MMM · h:mm a')}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={open => { if (!open) setSelectedTaskId(null) }}
          onTaskIdChange={setSelectedTaskId}
        />
      )}
    </div>
  )
}
