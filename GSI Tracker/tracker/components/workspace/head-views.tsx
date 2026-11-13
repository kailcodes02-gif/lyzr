'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Building2, CalendarRange, CheckSquare, Crown, Home, Layers, Package, Radio, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { KpiTile } from '@/components/ui/kpi-tile'
import { InfoTip } from '@/components/ui/info-tip'
import { QuickAdd } from '@/components/tasks/quick-add'
import { CampaignBanner } from '@/components/campaigns/campaign-banner'
import { verticalStats } from '@/components/workspace/vertical-card'
import { useAllChannelOwners, useChannels, useCurrentUser, useMyBadges, useTasks } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { mergeChannelsByName, taskChannelIds } from '@/lib/task-channels'
import type { Channel, Product, Task, Vertical } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// Home views by designation (migration 036). One board underneath; each view
// is the same tasks cut the way that person works:
//   Company home  — admins and leadership: lanes by vertical and by product
//   Vertical home — vertical heads: lanes by product inside the vertical
//   Product home  — product heads: lanes by channel and by vertical
//   My channels   — channel heads: one lane per channel they head, across everything
//   My Board      — everyone: just their own tasks

export type HomeViewKind = 'company' | 'board' | 'channels' | 'vertical' | 'product'
export interface HomeView { key: string; kind: HomeViewKind; label: string; id?: string }

export function useHomeViews() {
  const badges = useMyBadges()
  const { verticals, products } = useVertical()
  const views: HomeView[] = []
  const canCompany = badges.isAdmin || badges.isLeadership
  if (canCompany) views.push({ key: 'company', kind: 'company', label: 'Company home' })
  const vs = verticals.filter(v => v.slug !== 'lyzr' && (badges.isAdmin || badges.ownedVerticalIds.has(v.id)))
  for (const v of vs) views.push({ key: `vertical:${v.id}`, kind: 'vertical', label: v.name, id: v.id })
  const ps = products.filter(p => p.slug !== 'lyzr' && badges.ownedProductIds.has(p.id))
  for (const p of ps) views.push({ key: `product:${p.id}`, kind: 'product', label: p.name, id: p.id })
  if (badges.effectiveChannelIds.size > 0 || badges.ownedFunctionIds.size > 0) views.push({ key: 'channels', kind: 'channels', label: 'My channels' })
  views.push({ key: 'board', kind: 'board', label: 'My Board' })
  // Default: the widest view this person is entitled to.
  const defaultKey = canCompany ? 'company'
    : vs.length && !badges.isAdmin ? `vertical:${vs[0].id}`
    : ps.length ? `product:${ps[0].id}`
    : badges.effectiveChannelIds.size > 0 || badges.ownedFunctionIds.size > 0 ? 'channels'
    : 'board'
  return { views, defaultKey, isAdmin: badges.isAdmin, products }
}

const ICONS: Record<HomeViewKind, React.ComponentType<{ className?: string }>> = {
  company: Home, board: Sparkles, channels: Layers, vertical: Building2, product: Package,
}

export function HomeViewChips({ views, current, onPick, allProducts }: {
  views: HomeView[]; current: string; onPick: (key: string) => void; allProducts?: Product[]
}) {
  // Admins can open any product's home without heading it.
  const extraProducts = (allProducts || []).filter(p => p.slug !== 'lyzr' && !views.some(v => v.key === `product:${p.id}`))
  if (views.length <= 1 && !extraProducts.length) return null
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-tour="home-views">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-1 inline-flex items-center gap-1">Your views <InfoTip k="home_views" /></span>
      {views.map(v => {
        const Icon = ICONS[v.kind]
        const active = v.key === current
        return (
          <button key={v.key} onClick={() => onPick(v.key)}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
              active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100')}>
            <Icon className="w-3.5 h-3.5" /> {v.label}
          </button>
        )
      })}
      {extraProducts.length > 0 && (
        <select value={current.startsWith('product:') && !views.some(v => v.key === current) ? current : ''}
          onChange={e => e.target.value && onPick(e.target.value)}
          className="h-7 rounded-full border border-zinc-200 bg-white px-2 text-xs text-zinc-700" aria-label="Open a product home">
          <option value="">Product home…</option>
          {extraProducts.map(p => <option key={p.id} value={`product:${p.id}`}>{p.name}</option>)}
        </select>
      )}
    </div>
  )
}

// ---------- lanes ----------

export interface Lane { key: string; label: string; sub?: string; href: string; tasks: Task[]; tone?: 'amber' | 'blue' | 'violet' | 'zinc'; chips?: { label: string; n: number }[] }

export function LaneGrid({ title, icon, lanes, empty, tip }: { title: string; icon?: React.ReactNode; lanes: Lane[]; empty?: string; tip?: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider flex items-center gap-2">{icon} {title} {tip && <InfoTip k={tip} />}</h2>
      {lanes.length === 0 ? (
        <Card className="bg-white border-zinc-200"><CardContent className="p-5 text-sm text-zinc-500">{empty || 'Nothing here yet.'}</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {lanes.map(l => <LaneCard key={l.key} lane={l} />)}
        </div>
      )}
    </section>
  )
}

function LaneCard({ lane }: { lane: Lane }) {
  const s = verticalStats(lane.tasks)
  const planned = s.weekDone + s.weekNotDone
  const tone = lane.tone === 'amber' ? 'bg-amber-50 text-amber-700' : lane.tone === 'violet' ? 'bg-violet-50 text-violet-700' : lane.tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-zinc-100 text-zinc-600'
  return (
    <Link href={lane.href} className="block group">
      <Card className="bg-white border-zinc-200 group-hover:border-blue-300 transition-all h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 truncate group-hover:text-blue-700">{lane.label}</div>
              {lane.sub && <div className={cn('inline-block mt-0.5 rounded px-1.5 py-px text-[10px] font-medium', tone)}>{lane.sub}</div>}
            </div>
            <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-blue-500 shrink-0" />
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center">
            <Stat n={s.open} label="Open" icon={<CheckSquare className="w-3 h-3" />} />
            <Stat n={s.overdue} label="Overdue" icon={<AlertCircle className="w-3 h-3" />} red={s.overdue > 0} />
            <Stat n={s.live} label="Live" icon={<Radio className="w-3 h-3" />} green />
            <Stat n={`${s.weekDone}/${planned}`} label="Week" icon={<CalendarRange className="w-3 h-3" />} />
          </div>
          {lane.chips && lane.chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {lane.chips.slice(0, 6).map(c => <span key={c.label} className="rounded-full bg-zinc-100 px-2 py-px text-[10px] text-zinc-600">{c.label} · {c.n}</span>)}
              {lane.chips.length > 6 && <span className="text-[10px] text-zinc-400">+{lane.chips.length - 6}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function Stat({ n, label, icon, red, green }: { n: number | string; label: string; icon: React.ReactNode; red?: boolean; green?: boolean }) {
  return (
    <div className={cn('rounded-lg py-1.5', red ? 'bg-red-50' : 'bg-zinc-50')}>
      <p className={cn('text-base font-bold', red ? 'text-red-600' : green ? 'text-emerald-600' : 'text-zinc-900')}>{n}</p>
      <p className="text-[9px] uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-0.5">{icon}{label}</p>
    </div>
  )
}

// ---------- shared helpers ----------

function useLyzrIds() {
  const { verticals, products } = useVertical()
  const lyzrVertical = verticals.find(v => v.slug === 'lyzr')
  const lyzrProduct = products.find(p => p.slug === 'lyzr')
  return { lyzrVertical, lyzrProduct, verticals, products }
}

const productOf = (t: Task, lyzrProductId?: string) => (t.product_ids?.length ? t.product_ids : lyzrProductId ? [lyzrProductId] : [])
const topLevel = (t: Task) => !t.parent_task_id

function chipsFor(tasks: Task[], verticals: Vertical[], products: Product[], lyzrProductId?: string) {
  const vCount = new Map<string, number>(); const pCount = new Map<string, number>()
  for (const t of tasks) {
    for (const v of t.vertical_ids || []) vCount.set(v, (vCount.get(v) || 0) + 1)
    for (const p of productOf(t, lyzrProductId)) pCount.set(p, (pCount.get(p) || 0) + 1)
  }
  const chips: { label: string; n: number }[] = []
  for (const [id, n] of vCount) { const v = verticals.find(x => x.id === id); if (v) chips.push({ label: v.slug === 'lyzr' ? 'Lyzr brand' : v.name, n }) }
  for (const [id, n] of pCount) { const p = products.find(x => x.id === id); if (p && p.slug !== 'lyzr') chips.push({ label: p.name, n }) }
  return chips.sort((a, b) => b.n - a.n)
}

function Header({ title, kicker, children }: { title: string; kicker: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-600 mt-1 inline-flex items-center gap-1">{kicker}</p>
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  )
}

function Kpis({ tasks }: { tasks: Task[] }) {
  const s = verticalStats(tasks.filter(topLevel))
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiTile label="Open tasks" value={s.open} icon={<CheckSquare className="w-5 h-5" />} accent="blue" />
      <KpiTile label="Overdue" value={s.overdue} icon={<AlertCircle className="w-5 h-5" />} accent="red" valueClassName={s.overdue ? 'text-red-600' : undefined} />
      <KpiTile label="Live now" value={s.live} icon={<Radio className="w-5 h-5" />} accent="emerald" />
      <KpiTile label="This week" value={`${s.weekDone} / ${s.weekDone + s.weekNotDone}`} hint="done of planned" icon={<CalendarRange className="w-5 h-5" />} accent="violet" />
    </div>
  )
}

// ---------- Company lanes (used inside Company home) ----------

export function CompanyLanes({ tasks }: { tasks: Task[] }) {
  const { lyzrVertical, lyzrProduct, verticals, products } = useLyzrIds()
  const top = tasks.filter(topLevel)
  const byVertical: Lane[] = verticals.map(v => ({
    key: v.id, label: v.slug === 'lyzr' ? 'Lyzr brand' : v.name, sub: v.slug === 'lyzr' ? 'no specific vertical' : 'vertical', tone: (v.slug === 'lyzr' ? 'amber' : 'blue') as Lane['tone'],
    href: withVertical('/dashboard/', v.slug, { p: 'all' }),
    tasks: top.filter(t => (t.vertical_ids || []).includes(v.id)),
  })).filter(l => l.tasks.length || l.sub === 'no specific vertical')
  const byProduct: Lane[] = products.map(p => ({
    key: p.id, label: p.slug === 'lyzr' ? 'Lyzr brand' : p.name, sub: p.slug === 'lyzr' ? 'no specific product' : p.group_name, tone: (p.slug === 'lyzr' ? 'amber' : 'violet') as Lane['tone'],
    href: withVertical('/dashboard/', lyzrVertical?.slug || 'lyzr', { p: p.slug }),
    tasks: top.filter(t => productOf(t, lyzrProduct?.id).includes(p.id)),
  })).filter(l => l.tasks.length)
  return (
    <>
      <LaneGrid title="By vertical" icon={<Building2 className="w-4 h-4 text-blue-600" />} lanes={byVertical} tip="vertical" />
      <LaneGrid title="By product" icon={<Package className="w-4 h-4 text-violet-600" />} lanes={byProduct} tip="product" empty="No task is tagged with a product yet. Tag one in its drawer and the lane appears here." />
    </>
  )
}

// ---------- Vertical home ----------

export function VerticalHome({ vertical }: { vertical: Vertical }) {
  const { data: user } = useCurrentUser()
  const { data: tasks, isLoading } = useTasks({ verticalId: vertical.id })
  const { lyzrProduct, products } = useLyzrIds()
  const { ownedVerticalIds, isAdmin } = useMyBadges()
  const all = useMemo(() => (tasks || []).filter(topLevel), [tasks])
  const lanes: Lane[] = products.map(p => ({
    key: p.id,
    label: p.slug === 'lyzr' ? `${vertical.name} line items` : p.name,
    sub: p.slug === 'lyzr' ? 'vertical work, no specific product' : p.group_name,
    tone: (p.slug === 'lyzr' ? 'amber' : 'violet') as Lane['tone'],
    href: withVertical('/dashboard/', vertical.slug, { p: p.slug }),
    tasks: all.filter(t => productOf(t, lyzrProduct?.id).includes(p.id)),
  })).filter(l => l.tasks.length || l.tone === 'amber')
  if (isLoading) return <div className="p-8 animate-pulse space-y-4"><div className="h-8 w-1/3 bg-zinc-200 rounded" /><div className="h-40 bg-zinc-200 rounded-xl" /></div>
  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <Header title={`${vertical.name} home`} kicker={<><InfoTip k="vertical_home" /> Everything tagged {vertical.name}, {user?.display_name?.split(' ')[0] ? `for ${user.display_name.split(' ')[0]}` : ''}{(ownedVerticalIds.has(vertical.id) || isAdmin) && <Crown className="w-3.5 h-3.5 text-amber-500 ml-1" aria-label="You head this vertical" />}</>}>
        <Link href={withVertical('/dashboard/', vertical.slug)} className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">Open board <ArrowRight className="w-3.5 h-3.5" /></Link>
        <Link href={withVertical('/weekly/', vertical.slug)} className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100"><CalendarRange className="w-4 h-4" /> Weekly</Link>
        {(ownedVerticalIds.has(vertical.id) || isAdmin) && <Link href={withVertical('/settings/', vertical.slug)} className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">Settings</Link>}
      </Header>
      <QuickAdd />
      <Kpis tasks={all} />
      <CampaignBanner verticalId={vertical.id} compact canCreate={false} />
      <LaneGrid title={`Products inside ${vertical.name}`} icon={<Package className="w-4 h-4 text-violet-600" />} lanes={lanes} tip="product" />
    </div>
  )
}

// ---------- Product home ----------

export function ProductHome({ product }: { product: Product }) {
  const { data: user } = useCurrentUser()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all', product })
  const { data: channels } = useChannels('all')
  const { lyzrVertical, verticals } = useLyzrIds()
  const { ownedProductIds, isAdmin } = useMyBadges()
  const all = useMemo(() => (tasks || []).filter(topLevel), [tasks])
  const lyzrSlug = lyzrVertical?.slug || 'lyzr'
  const merged = useMemo(() => mergeChannelsByName((channels || []).filter(c => c.is_active), lyzrVertical?.id || ''), [channels, lyzrVertical?.id])
  const byChannel: Lane[] = useMemo(() => {
    const keptOf = new Map<string, string>()
    for (const [kept, ids] of merged.twins) for (const id of ids) keptOf.set(id, kept)
    const byId = new Map(merged.channels.map(c => [c.id, c]))
    const rootOf = (id: string): Channel | undefined => { let c = byId.get(keptOf.get(id) || id); while (c?.parent_channel_id && byId.get(c.parent_channel_id)) c = byId.get(c.parent_channel_id); return c }
    const m = new Map<string, Task[]>()
    for (const t of all) { const seen = new Set<string>(); for (const raw of taskChannelIds(t)) { const r = rootOf(raw); if (r && !seen.has(r.id)) { seen.add(r.id); m.set(r.id, [...(m.get(r.id) || []), t]) } } }
    return merged.channels.filter(c => !c.parent_channel_id && m.has(c.id)).map(c => ({
      key: c.id, label: c.name, sub: 'channel', tone: 'blue' as const,
      href: withVertical('/channel/', lyzrSlug, { id: c.id, p: product.slug }),
      tasks: m.get(c.id) || [],
    }))
  }, [all, merged, lyzrSlug, product.slug])
  const byVertical: Lane[] = verticals.map(v => ({
    key: v.id, label: v.slug === 'lyzr' ? 'Lyzr brand' : v.name, sub: v.slug === 'lyzr' ? 'no specific vertical' : 'vertical', tone: v.slug === 'lyzr' ? 'amber' as const : 'blue' as const,
    href: withVertical('/dashboard/', v.slug, { p: product.slug }),
    tasks: all.filter(t => (t.vertical_ids || []).includes(v.id)),
  })).filter(l => l.tasks.length)
  if (isLoading) return <div className="p-8 animate-pulse space-y-4"><div className="h-8 w-1/3 bg-zinc-200 rounded" /><div className="h-40 bg-zinc-200 rounded-xl" /></div>
  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <Header title={`${product.name} home`} kicker={<><InfoTip k="product_home" /> Every task tagged {product.name}, across every vertical and channel{user ? '' : ''}{(ownedProductIds.has(product.id) || isAdmin) && <Crown className="w-3.5 h-3.5 text-amber-500 ml-1" aria-label="You head this product" />}</>}>
        <Link href={withVertical('/dashboard/', lyzrSlug, { p: product.slug })} className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">Open board <ArrowRight className="w-3.5 h-3.5" /></Link>
        <Link href={withVertical('/calendar/', 'all', { p: product.slug })} className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100"><CalendarRange className="w-4 h-4" /> Calendar</Link>
        {product.url && <a href={product.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">lyzr.ai page</a>}
      </Header>
      <QuickAdd />
      <Kpis tasks={all} />
      <LaneGrid title="By channel" icon={<Layers className="w-4 h-4 text-blue-600" />} lanes={byChannel} tip="channel" empty={`No ${product.name} task yet. Press N, pick ${product.name} as the product, and its channel shows up here.`} />
      <LaneGrid title="By vertical" icon={<Building2 className="w-4 h-4 text-blue-600" />} lanes={byVertical} tip="vertical" />
    </div>
  )
}

// ---------- My channels (channel heads) ----------

export function MyChannelsHome() {
  const { data: me } = useCurrentUser()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const { data: owners } = useAllChannelOwners()
  const { lyzrVertical, verticals, products, lyzrProduct } = useLyzrIds()
  const lyzrSlug = lyzrVertical?.slug || 'lyzr'
  const email = me?.email.toLowerCase()
  const headed = useMemo(() => new Set((owners || []).filter(o => (me && o.user_id === me.id) || (email && o.email.toLowerCase() === email)).map(o => o.channel_id)), [owners, me, email])
  const lanes: Lane[] = (() => {
    const list = (channels || []).filter(c => c.is_active)
    const byId = new Map(list.map(c => [c.id, c]))
    const descendants = (id: string): Set<string> => { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const c of list) if (c.parent_channel_id && out.has(c.parent_channel_id) && !out.has(c.id)) { out.add(c.id); grew = true } } return out }
    // Show each headed channel once: skip ones whose ancestor is also headed.
    const roots = list.filter(c => headed.has(c.id) && !(c.parent_channel_id && (() => { let p = byId.get(c.parent_channel_id!); while (p) { if (headed.has(p.id)) return true; p = p.parent_channel_id ? byId.get(p.parent_channel_id) : undefined } return false })()))
    const top = (tasks || []).filter(topLevel)
    return roots.map(c => {
      const ids = descendants(c.id)
      const mine = top.filter(t => taskChannelIds(t).some(id => ids.has(id)))
      const parent = c.parent_channel_id ? byId.get(c.parent_channel_id) : undefined
      return {
        key: c.id, label: c.name, sub: parent ? `under ${parent.name}` : 'channel', tone: 'blue' as const,
        href: withVertical('/channel/', lyzrSlug, { id: c.id }),
        tasks: mine, chips: chipsFor(mine, verticals, products, lyzrProduct?.id),
      }
    })
  })()
  const all = (() => { const seen = new Set<string>(); const out: Task[] = []; for (const l of lanes) for (const t of l.tasks) if (!seen.has(t.id)) { seen.add(t.id); out.push(t) } return out })()
  if (isLoading || !me) return <div className="p-8 animate-pulse space-y-4"><div className="h-8 w-1/3 bg-zinc-200 rounded" /><div className="h-40 bg-zinc-200 rounded-xl" /></div>
  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <Header title="My channels" kicker={<><InfoTip k="channel_owner" /> Every task in the channels you head, across every vertical and product</>}>
        <Link href="/my-tasks/?v=all" className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">My Tasks <ArrowRight className="w-3.5 h-3.5" /></Link>
        <Link href="/history/?v=all" className="inline-flex items-center gap-1 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">History</Link>
      </Header>
      <QuickAdd />
      <Kpis tasks={all} />
      <CampaignBanner verticalId="all" compact canCreate={false} />
      <LaneGrid title="Channels you head" icon={<Layers className="w-4 h-4 text-blue-600" />} lanes={lanes} tip="channel_owner"
        empty="You are not a channel head yet. Tasks assigned to you are on My Board and My Tasks." />
    </div>
  )
}
