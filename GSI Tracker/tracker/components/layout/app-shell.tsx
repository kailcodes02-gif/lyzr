'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Calendar, LayoutDashboard, ListTodo, ChevronDown, ChevronRight,
  Bell, LogOut, Zap, Sparkles, Link2, GitBranch, DollarSign, Menu, X, Settings, LineChart, UserCircle,
  CalendarRange, History, BookOpen, Layers, Building2, Table2, Workflow, Home, Eye, FolderOpen, FolderKanban,
  MoreHorizontal, Plus, Search, Package,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useChannels, buildChannelTree, useCurrentUser, useNotifications, useFunctions, useAllFunctionOwners, useTasks, useMyBadges,
} from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { signOut } from '@/lib/actions'
import { AssistantDialog } from '@/components/assistant/assistant-dialog'
import { LyzrSail } from '@/components/ui/lyzr-logo'
import { setViewAs, useViewAs, viewAsLabel, VIEW_AS_OPTIONS } from '@/lib/hooks/use-view-as'
import { startTour } from '@/components/workspace/welcome-tour'
import { QuickAddDialog, isTypingTarget } from '@/components/tasks/quick-add'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CAMPAIGN_KIND, TIER_CONFIG, type Channel } from '@/lib/types/database'
import { purgePersisted, purgeLegacyKeys } from '@/lib/hooks/use-persisted'
import { OPEN_STATUSES } from '@/lib/week-logic'
import { mergeChannelsByName, taskChannelIds } from '@/lib/task-channels'

const normalize = (p: string) => (p.replace(/\/$/, '') || '/')

function ChannelItem({ channel, depth, slug, forceOpen }: { channel: Channel; depth: number; slug: string; forceOpen?: boolean }) {
  const pathname = usePathname()
  const activeId = useSearchParams().get('id')
  const [expandedState, setExpanded] = useState(false)
  const expanded = expandedState || !!forceOpen
  const hasChildren = channel.children && channel.children.length > 0
  const isActive = normalize(pathname) === '/channel' && activeId === channel.id

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={withVertical('/channel/', slug, { id: channel.id })}
          className={cn(
            'flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] transition-all duration-150',
            isActive
              ? 'bg-white text-zinc-900 font-medium ring-1 ring-zinc-200'
              : 'text-zinc-600 hover:text-zinc-800 hover:bg-zinc-100',
            depth > 0 && 'pl-4'
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 shrink-0" />
          <span className="truncate">
            {channel.tier && <span className="mr-1" title={channel.tier} aria-hidden>{TIER_CONFIG[channel.tier].emoji}</span>}
            {channel.name}
          </span>
        </Link>
        {hasChildren && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-zinc-500 hover:text-zinc-700"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="ml-3 space-y-0.5">
          {channel.children!.map(child => (
            <ChannelItem key={child.id} channel={child} depth={depth + 1} slug={slug} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

type NavItem = { href: string; icon: React.ComponentType<{ className?: string }>; label: string; match: string }

// Sidebar state that survives reloads. Storage can be missing (private
// windows, blocked site data), so every access is guarded.
// The in-memory copy keeps toggles working when storage throws.
const flagMemory = new Map<string, boolean>()
const flagListeners = new Set<() => void>()
function readFlag(key: string, initial: boolean) {
  if (flagMemory.has(key)) return flagMemory.get(key)!
  try { const v = localStorage.getItem(key); return v === null ? initial : v === '1' } catch { return initial }
}
function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    cb => { flagListeners.add(cb); return () => { flagListeners.delete(cb) } },
    () => readFlag(key, initial),
    () => initial,
  )
  const set = (v: boolean) => {
    flagMemory.set(key, v)
    try { localStorage.setItem(key, v ? '1' : '0') } catch {}
    flagListeners.forEach(l => l())
  }
  return [value, set]
}

// Everyday pages first; the rest fold under "More" (opened automatically
// when you are on one of them). Nothing is removed, only tucked away.
function NavList({ items, more = [], onNavigate }: { items: NavItem[]; more?: NavItem[]; onNavigate: () => void }) {
  const pathname = usePathname()
  const [open, setOpen] = useStoredFlag('nav-more-open', false)
  const onMorePage = more.some(i => normalize(pathname) === i.match)
  const showMore = open || onMorePage
  return (
    <div className="space-y-1">
      {[...items, ...(showMore ? more : [])].map(item => {
        const isActive = normalize(pathname) === item.match
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              isActive ? 'bg-white text-zinc-900 ring-1 ring-zinc-200' : 'text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100'
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        )
      })}
      {more.length > 0 && !onMorePage && (
        <button onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100">
          <MoreHorizontal className="w-4 h-4" />
          {open ? 'Less' : `More (${more.length})`}
        </button>
      )}
    </div>
  )
}

// Channel list with a filter once it gets long, and a fold.
function ChannelList({ channels, slug, empty, title = 'Channels' }: { channels: Channel[]; slug: string; empty: React.ReactNode; title?: string }) {
  const [open, setOpen] = useStoredFlag('nav-channels-open', true)
  const [q, setQ] = useState('')
  const tree = buildChannelTree(channels)
  const query = q.trim().toLowerCase()
  const matches = (c: Channel): boolean => c.name.toLowerCase().includes(query) || (c.children || []).some(matches)
  const shown = query ? tree.filter(matches) : tree
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 mb-2 brand-label text-zinc-600 hover:text-zinc-900">
        <span>{title}{channels.length ? ` (${tree.length})` : ''}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="space-y-0.5">
          {tree.length > 8 && (
            <div className="relative mx-1 mb-1.5">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a channel" aria-label="Find a channel"
                className="w-full h-7 rounded-md border border-zinc-200 bg-white pl-6 pr-2 text-xs outline-none focus:border-zinc-400" />
            </div>
          )}
          {shown.map(channel => (
            <ChannelItem key={channel.id} channel={channel} depth={0} slug={slug} forceOpen={!!query} />
          ))}
          {channels.length === 0 && empty}
          {channels.length > 0 && shown.length === 0 && <p className="px-3 text-xs text-zinc-400">No channel matches “{q}”.</p>}
        </div>
      )}
    </div>
  )
}

// Open / overdue counts per vertical, product and campaign, for the view menus.
function useViewCounts() {
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { products } = useVertical()
  return useMemo(() => {
    const byVertical = new Map<string, { open: number; overdue: number }>()
    const byProduct = new Map<string, { open: number; overdue: number }>()
    const byCampaign = new Map<string, { open: number; overdue: number }>()
    const lyzrProduct = products.find(p => p.slug === 'lyzr')?.id
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const bump = (m: Map<string, { open: number; overdue: number }>, k: string | undefined, overdue: boolean) => {
      if (!k) return
      const c = m.get(k) || { open: 0, overdue: 0 }
      c.open++; if (overdue) c.overdue++
      m.set(k, c)
    }
    for (const t of tasks || []) {
      if (!OPEN_STATUSES.has(t.status) || t.parent_task_id) continue
      const overdue = !!t.due_date && new Date(t.due_date) < today
      for (const v of t.vertical_ids || []) bump(byVertical, v, overdue)
      for (const p of t.product_ids?.length ? t.product_ids : [lyzrProduct]) bump(byProduct, p, overdue)
      if (t.campaign_id) bump(byCampaign, t.campaign_id, overdue)
    }
    return { byVertical, byProduct, byCampaign }
  }, [tasks, products])
}

function CountPill({ c }: { c?: { open: number; overdue: number } }) {
  if (!c || c.open === 0) return null
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full shrink-0', c.overdue > 0 ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-500')}
      title={`${c.open} open, ${c.overdue} overdue`}>
      {c.overdue > 0 ? `${c.overdue}!` : c.open}
    </span>
  )
}

// The board's three filters, in the top bar: which vertical, which product,
// which campaign. Lyzr in the first two means "brand-level / not specific";
// "All" shows everything.
function ViewFilters() {
  const { mode, vertical, verticals, setVertical, products, product, setProduct, ownedVerticalIds, campaigns, campaign, setCampaign } = useVertical()
  const { ownedProductIds } = useMyBadges()
  const pathname = usePathname()
  const { byVertical, byProduct, byCampaign } = useViewCounts()
  const openCampaigns = campaigns.filter(c => c.status === 'live' || c.status === 'upcoming')
  const closedCampaigns = campaigns.filter(c => c.status !== 'live' && c.status !== 'upcoming')
  const lyzr = verticals.find(v => v.slug === 'lyzr')
  const onBoard = mode === 'space' && !!vertical
  const vLabel = !onBoard || vertical?.slug === 'lyzr' ? 'All verticals' : vertical!.name
  const groups = [...new Set(products.filter(p => p.slug !== 'lyzr').map(p => p.group_name))]
  const lyzrProduct = products.find(p => p.slug === 'lyzr')
  const pickVertical = (slug: string) => setVertical(slug, onBoard ? pathname : '/dashboard/')
  const trigger = 'h-8 inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors max-w-[11rem]'
  return (
    <div className="flex items-center gap-1.5 min-w-0" data-tour="view-filters">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(trigger, onBoard && vertical?.slug !== 'lyzr' ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50')}
          aria-label="Vertical view">
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate font-medium">{vLabel}</span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 bg-white border-zinc-300">
          <p className="px-2 pt-1.5 pb-1 brand-label text-[10px] text-zinc-500">Vertical</p>
          {lyzr && (
            <DropdownMenuItem onClick={() => pickVertical('lyzr')} className={cn('text-zinc-700', onBoard && vertical?.slug === 'lyzr' && 'bg-zinc-100 font-medium')}>
              <Layers className="w-4 h-4 mr-2 text-zinc-500" />
              <span className="flex-1">All verticals</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-zinc-200/70" />
          {verticals.map(v => (
            <DropdownMenuItem key={v.id} onClick={() => pickVertical(v.slug)}
              className={cn('text-zinc-700', onBoard && vertical?.id === v.id && v.slug !== 'lyzr' && 'bg-zinc-100 font-medium')}>
              <Building2 className={cn('w-4 h-4 mr-2', v.slug === 'lyzr' ? 'text-amber-500' : 'text-blue-600')} />
              <span className="flex-1 truncate">
                {v.slug === 'lyzr' ? 'Lyzr' : v.name}
                {v.slug === 'lyzr' && <span className="ml-1.5 text-[10px] text-zinc-400">brand, no vertical</span>}
              </span>
              {ownedVerticalIds.has(v.id) && <span className="text-[9px] rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-px mr-1">head</span>}
              <CountPill c={byVertical.get(v.id)} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {products.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(trigger, product ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50')}
            aria-label="Product view">
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-medium">{product ? product.name : 'All products'}</span>
            <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 max-h-[70vh] overflow-y-auto bg-white border-zinc-300">
            <DropdownMenuItem onClick={() => setProduct('all')} className={cn('text-zinc-700', !product && 'bg-zinc-100 font-medium')}>
              <Layers className="w-4 h-4 mr-2 text-zinc-500" /> <span className="flex-1">All products</span>
            </DropdownMenuItem>
            {lyzrProduct && (
              <DropdownMenuItem onClick={() => setProduct('lyzr')} className={cn('text-zinc-700', product?.slug === 'lyzr' && 'bg-zinc-100 font-medium')}>
                <Package className="w-4 h-4 mr-2 text-amber-500" />
                <span className="flex-1">Lyzr <span className="ml-1 text-[10px] text-zinc-400">brand, no product</span></span>
                <CountPill c={byProduct.get(lyzrProduct.id)} />
              </DropdownMenuItem>
            )}
            {groups.map(g => (
              <div key={g}>
                <DropdownMenuSeparator className="bg-zinc-200/70" />
                <p className="px-2 pt-1 pb-0.5 brand-label text-[10px] text-zinc-500">{g}</p>
                {products.filter(p => p.group_name === g).map(p => (
                  <DropdownMenuItem key={p.id} onClick={() => setProduct(p.slug)}
                    className={cn('text-zinc-700', product?.id === p.id && 'bg-zinc-100 font-medium')}>
                    <Package className="w-4 h-4 mr-2 text-violet-500" />
                    <span className="flex-1 truncate">{p.name}</span>
                    {ownedProductIds.has(p.id) && <span className="text-[9px] rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-px mr-1">head</span>}
                    <CountPill c={byProduct.get(p.id)} />
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {campaigns.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(trigger, campaign ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50')}
            aria-label="Campaign view">
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-medium">{campaign ? campaign.name : 'All campaigns'}</span>
            <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-h-[70vh] overflow-y-auto bg-white border-zinc-300">
            <DropdownMenuItem onClick={() => setCampaign('all')} className={cn('text-zinc-700', !campaign && 'bg-zinc-100 font-medium')}>
              <Layers className="w-4 h-4 mr-2 text-zinc-500" /> <span className="flex-1">All campaigns</span>
            </DropdownMenuItem>
            {openCampaigns.length > 0 && <DropdownMenuSeparator className="bg-zinc-200/70" />}
            {openCampaigns.map(c => (
              <DropdownMenuItem key={c.id} onClick={() => setCampaign(c.id)} className={cn('text-zinc-700', campaign?.id === c.id && 'bg-zinc-100 font-medium')}>
                <span className="mr-2 text-sm" aria-hidden>{CAMPAIGN_KIND[c.kind].emoji}</span>
                <span className="flex-1 truncate">{c.name}<span className="ml-1.5 text-[10px] text-zinc-400">{c.status}</span></span>
                <CountPill c={byCampaign.get(c.id)} />
              </DropdownMenuItem>
            ))}
            {closedCampaigns.length > 0 && (
              <>
                <DropdownMenuSeparator className="bg-zinc-200/70" />
                <p className="px-2 pt-1 pb-0.5 brand-label text-[10px] text-zinc-500">Finished</p>
                {closedCampaigns.slice(0, 12).map(c => (
                  <DropdownMenuItem key={c.id} onClick={() => setCampaign(c.id)} className={cn('text-zinc-500', campaign?.id === c.id && 'bg-zinc-100 font-medium')}>
                    <span className="mr-2 text-sm opacity-60" aria-hidden>{CAMPAIGN_KIND[c.kind].emoji}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator className="bg-zinc-200/70" />
            <DropdownMenuItem className="p-0">
              <Link href="/campaigns/" className="flex items-center w-full px-2 py-1.5 text-xs text-blue-600">Open Campaigns and Thunderclaps</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {(product || campaign) && (
        <button onClick={() => { setProduct('all'); setCampaign('all') }} className="text-[11px] text-zinc-400 hover:text-zinc-700 px-1" title="Show every product and campaign again">
          Clear
        </button>
      )}
    </div>
  )
}

// "My functions": functions the signed-in user owns, across all verticals.
function MyFunctionRows({ onNavigate }: { onNavigate: () => void }) {
  const { data: user } = useCurrentUser()
  const { data: functions } = useFunctions()
  const { data: owners } = useAllFunctionOwners()
  const mine = useMemo(() => {
    if (!user || !functions || !owners) return []
    const email = user.email.toLowerCase()
    const ids = new Set(owners.filter(o => o.user_id === user.id || o.email.toLowerCase() === email).map(o => o.function_id))
    return functions.filter(f => ids.has(f.id))
  }, [user, functions, owners])
  if (!mine.length) return null
  return (
    <div>
      <p className="px-3 brand-label text-zinc-600 mb-2">My domains</p>
      <div className="space-y-0.5">
        {mine.map(f => (
          <Link key={f.id} href={`/function/?id=${f.id}`} onClick={onNavigate}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100">
            <Workflow className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">{f.name}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function AppSidebar() {
  const router = useRouter()
  const { data: user } = useCurrentUser()
  const viewAs = useViewAs()
  const realAdmin = user?.role === 'admin'
  const { isLeadership } = useMyBadges()
  const { mode, slug, verticalId, vertical, verticals, flags, canManage, taskScope, product, campaign } = useVertical()
  // One board. Board pages carry the current vertical view; from company-level
  // pages they open the whole board (Lyzr). Every view lists every channel,
  // same-named channels merged into one.
  const lyzrSlug = verticals.find(v => v.slug === 'lyzr')?.slug || verticals[0]?.slug || 'all'
  const boardSlug = mode === 'space' ? slug : lyzrSlug
  const listSlug = mode === 'space' ? slug : 'all'
  const homeVerticalId = mode === 'space' ? verticalId : (verticals.find(v => v.slug === 'lyzr')?.id || '')
  const { data: allChannels } = useChannels('all')
  const merged = useMemo(
    () => mergeChannelsByName((allChannels || []).filter(c => c.is_active), homeVerticalId),
    [allChannels, homeVerticalId])
  // With a vertical, product or campaign picked, the list narrows to the
  // channels that hold tasks in that view (parents stay so the tree still
  // reads). With no filter, every channel shows.
  const filtered = (mode === 'space' && vertical?.slug !== 'lyzr') || !!product || !!campaign
  const { data: viewTasks } = useTasks({ verticalId: taskScope, product, campaign })
  const boardChannels = useMemo(() => {
    if (!filtered) return merged.channels
    const keptOf = new Map<string, string>()
    for (const [kept, ids] of merged.twins) for (const id of ids) keptOf.set(id, kept)
    const parentOf = new Map(merged.channels.map(c => [c.id, c.parent_channel_id]))
    const show = new Set<string>()
    for (const t of viewTasks || []) {
      for (const raw of taskChannelIds(t)) {
        let id: string | null | undefined = keptOf.get(raw) || raw
        while (id && !show.has(id)) { show.add(id); id = parentOf.get(id) }
      }
    }
    return merged.channels.filter(c => show.has(c.id))
  }, [filtered, merged, viewTasks])
  const [mobileOpen, setMobileOpen] = useState(false)
  const close = () => setMobileOpen(false)

  const mainNav: NavItem[] = [
    { href: '/', icon: Home, label: isLeadership ? 'Company home' : 'My Board', match: '/' },
    ...(isLeadership ? [{ href: '/my-board/', icon: Sparkles, label: 'My Board', match: '/my-board' }] : []),
    { href: withVertical('/dashboard/', boardSlug), icon: LayoutDashboard, label: 'Board', match: '/dashboard' },
    { href: withVertical('/my-tasks/', listSlug), icon: ListTodo, label: 'My Tasks', match: '/my-tasks' },
    { href: withVertical('/calendar/', listSlug), icon: Calendar, label: 'Calendar', match: '/calendar' },
    { href: withVertical('/weekly/', boardSlug), icon: CalendarRange, label: 'Weekly review', match: '/weekly' },
    { href: '/campaigns/', icon: Zap, label: 'Campaigns', match: '/campaigns' },
    { href: '/leads/', icon: LineChart, label: 'Sales pipeline', match: '/leads' },
  ]
  const moreNav: NavItem[] = [
    { href: '/projects/', icon: FolderKanban, label: 'Projects', match: '/projects' },
    { href: withVertical('/tracker/', boardSlug), icon: Table2, label: 'Tracker', match: '/tracker' },
    { href: withVertical('/overview/', listSlug), icon: GitBranch, label: 'Overview', match: '/overview' },
    { href: withVertical('/owners/', listSlug), icon: UserCircle, label: 'Owners', match: '/owners' },
    { href: withVertical('/budgets/', boardSlug), icon: DollarSign, label: 'Budgets', match: '/budgets' },
    { href: withVertical('/history/', listSlug), icon: History, label: 'History', match: '/history' },
    ...(isLeadership ? [
      { href: '/workspace/tasks/', icon: Table2, label: 'All tasks', match: '/workspace/tasks' },
      { href: '/workspace/weekly/', icon: CalendarRange, label: 'Company weekly', match: '/workspace/weekly' },
      { href: '/functions/', icon: Workflow, label: 'Domains', match: '/functions' },
      { href: '/members/', icon: UserCircle, label: 'Members', match: '/members' },
    ] : []),
    ...(mode === 'space' && flags.resources ? [{ href: withVertical('/resources/', slug), icon: FolderOpen, label: `${vertical?.name || ''} Resources`.trim(), match: '/resources' }] : []),
    ...(mode === 'space' && canManage ? [{ href: withVertical('/settings/', slug), icon: Settings, label: 'Vertical settings', match: '/settings' }] : []),
    { href: '/guide/', icon: BookOpen, label: 'Guide', match: '/guide' },
  ]

  // Clear lead data written by the earlier, un-scoped version of persistence.
  useEffect(() => { purgeLegacyKeys() }, [])

  const handleSignOut = async () => {
    // Pulled lead data is customer PII — it must not outlive the session on a
    // shared browser profile, where the next person to sign in would see it.
    purgePersisted()
    await signOut()
    router.push('/login')
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo + switcher */}
      <div className="px-4 py-4 border-b border-zinc-200 space-y-3">
        <div className="flex items-center gap-3">
          <LyzrSail className="w-8 h-[20px] shrink-0" />
          <div>
            <h1 className="text-sm font-semibold text-zinc-900">Lyzr Marketing Tracker</h1>
            <p className="brand-label text-[10px] text-zinc-600">Marketing Ops</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <NavList items={mainNav} more={moreNav} onNavigate={close} />
        <ChannelList channels={boardChannels} slug={boardSlug} title={filtered ? 'Channels with tasks here' : 'Channels'} empty={
          filtered
            ? <p className="px-3 text-xs text-zinc-400">No tasks in this view yet, so no channels to show. Add one with <kbd className="rounded border border-zinc-200 bg-white px-1 text-[10px]">N</kbd> and its channel appears here.</p>
            : <p className="px-3 text-xs text-zinc-400">No channels yet.{realAdmin ? ' Add them in Admin.' : ''}</p>
        } />
        <MyFunctionRows onNavigate={close} />
      </div>

      {/* User */}
      <div className="px-3 py-3 border-t border-zinc-200">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-100 transition-colors">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user?.avatar_url || ''} />
              <AvatarFallback className="bg-zinc-900 text-white text-xs">
                {user?.display_name?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate">{user?.display_name}</p>
              <p className="text-[11px] text-zinc-500 truncate">{user?.email}</p>
            </div>
            {realAdmin && (
              <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-600">
                {viewAs === 'admin' ? 'Admin' : `Viewing: ${viewAsLabel(viewAs)}`}
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-white border-zinc-300">
            <DropdownMenuItem className="p-0">
              <Link href={withVertical('/my-tasks/', slug)} className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
                <ListTodo className="w-4 h-4 mr-2" /> My Tasks
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="p-0">
              <Link href="/functions/" className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
                <Layers className="w-4 h-4 mr-2" /> Domains
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="p-0">
              <Link href="/me/accounts/" className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
                <Link2 className="w-4 h-4 mr-2" /> Linked accounts
              </Link>
            </DropdownMenuItem>
            {realAdmin && viewAs === 'admin' && (
              <DropdownMenuItem className="p-0">
                <Link href="/admin/" className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
                  <Settings className="w-4 h-4 mr-2" /> Admin
                </Link>
              </DropdownMenuItem>
            )}
            {realAdmin && (
              <>
                <DropdownMenuSeparator className="bg-zinc-200/70" />
                <p className="px-2 pt-1.5 pb-1 brand-label text-[10px] text-zinc-500 flex items-center gap-1"><Eye className="w-3 h-3" /> View as</p>
                {VIEW_AS_OPTIONS.map(o => (
                  <DropdownMenuItem key={o.value} onClick={() => setViewAs(o.value)}
                    className={cn('text-zinc-700 text-xs', viewAs === o.value && 'bg-zinc-100 font-medium text-zinc-900')}>
                    <span className={cn('w-1.5 h-1.5 rounded-full mr-2', viewAs === o.value ? 'bg-orange-500' : 'bg-zinc-300')} />
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator className="bg-zinc-200/70" />
            <DropdownMenuItem onClick={startTour} className="text-zinc-700 text-xs">
              <BookOpen className="w-4 h-4 mr-2" /> Replay the welcome tour
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-200/70" />
            <DropdownMenuItem onClick={handleSignOut} className="text-red-600 hover:text-red-700">
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-white border border-zinc-300 text-zinc-900 lg:hidden"
        aria-label="Toggle navigation"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 bg-zinc-50 border-r border-zinc-200 transition-transform duration-300 lg:translate-x-0 lg:static lg:z-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  )
}

export function AppHeader() {
  const router = useRouter()
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [openedTaskId, setOpenedTaskId] = useState<string | null>(null)
  const { data: notifications } = useNotifications()

  // N opens quick add from anywhere, unless you are typing or a dialog is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setQuickOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const { data: user } = useCurrentUser()
  const pathname = usePathname()
  const viewAs = useViewAs()
  const unreadCount = notifications?.length || 0
  const previewing = user?.role === 'admin' && viewAs !== 'admin'

  return (
    <>
    {previewing && (
      <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-600 px-4 py-1.5 text-xs text-white">
        <Eye className="w-3.5 h-3.5" />
        Previewing the tracker as <strong>{viewAsLabel(viewAs)}</strong> — this is what that role sees.
        <button onClick={() => setViewAs('admin')} className="underline underline-offset-2 hover:opacity-80 font-medium">
          Back to admin view
        </button>
      </div>
    )}
    <header className="sticky top-0 z-30 h-14 border-b border-zinc-200 bg-white/85 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6">
      <div className="lg:hidden w-10" />
      <div className="flex-1 flex items-center gap-2 pl-2 min-w-0">
        {/* The Sales pipeline picks its own vertical / product, so the board filters stay off there. */}
        {normalize(pathname) === '/leads'
          ? <span className="text-xs font-medium text-zinc-800">Sales pipeline</span>
          : <ViewFilters />}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 bg-orange-500 hover:bg-orange-600 text-white border-0" onClick={() => setQuickOpen(true)} aria-label="New task" title="New task (N)">
          <Plus className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline text-xs">New task</span>
          <kbd className="hidden md:inline ml-1.5 text-[10px] rounded bg-white/20 px-1">N</kbd>
        </Button>
        <QuickAddDialog open={quickOpen} onOpenChange={setQuickOpen} onCreated={setOpenedTaskId} />
        {openedTaskId && (
          <TaskDetailDrawer taskId={openedTaskId} open onOpenChange={o => { if (!o) setOpenedTaskId(null) }} onTaskIdChange={setOpenedTaskId} />
        )}
        <Button variant="outline" size="sm" className="h-8 border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => setAssistantOpen(true)} aria-label="Assistant">
          <Sparkles className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline text-xs">Assistant</span>
        </Button>
        {assistantOpen && <AssistantDialog open={assistantOpen} onOpenChange={setAssistantOpen} />}
        <Button
          variant="ghost"
          size="icon"
          className="relative text-zinc-600 hover:text-zinc-900"
          onClick={() => router.push('/notifications/')}
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </div>
    </header>
    </>
  )
}
