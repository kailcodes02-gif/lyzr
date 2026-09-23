'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  Calendar, LayoutDashboard, ListTodo, ChevronDown, ChevronRight, ChevronsUpDown,
  Bell, LogOut, DollarSign, Upload, Menu, X, Settings, LineChart, UserCircle,
  CalendarRange, History, BookOpen, Layers, Building2, Crown, Table2, Workflow, Home,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useChannels, buildChannelTree, useCurrentUser, useNotifications, useFunctions, useAllFunctionOwners, useTasks,
} from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { signOut } from '@/lib/actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TIER_CONFIG, type Channel } from '@/lib/types/database'
import { purgePersisted, purgeLegacyKeys } from '@/lib/hooks/use-persisted'
import { OPEN_STATUSES } from '@/lib/week-logic'

const normalize = (p: string) => (p.replace(/\/$/, '') || '/')

function ChannelItem({ channel, depth, slug }: { channel: Channel; depth: number; slug: string }) {
  const pathname = usePathname()
  const activeId = useSearchParams().get('id')
  const [expanded, setExpanded] = useState(false)
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
              ? 'bg-zinc-200/70 text-zinc-900 font-medium'
              : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100',
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
            <ChannelItem key={child.id} channel={child} depth={depth + 1} slug={slug} />
          ))}
        </div>
      )}
    </div>
  )
}

type NavItem = { href: string; icon: React.ComponentType<{ className?: string }>; label: string; match: string }

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  const pathname = usePathname()
  return (
    <div className="space-y-1">
      {items.map(item => {
        const isActive = normalize(pathname) === item.match
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              isActive ? 'bg-zinc-200/70 text-zinc-900' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

// Vertical switcher (space mode) / "Workspace" badge (workspace mode).
function VerticalSwitcher() {
  const { mode, vertical, verticals, ownedVerticalIds, setVertical } = useVertical()
  const pathname = usePathname()
  const label = mode === 'space' && vertical ? vertical.name : 'Workspace'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-left transition-colors">
        {mode === 'space' ? <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" /> : <Home className="w-3.5 h-3.5 text-violet-600 shrink-0" />}
        <span className="flex-1 text-xs font-semibold text-zinc-800 truncate">{label}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 bg-white border-zinc-300">
        <DropdownMenuItem onClick={() => setVertical('all')} className="text-zinc-700">
          <Home className="w-4 h-4 mr-2 text-violet-600" /> Workspace (all verticals)
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-zinc-200/70" />
        {verticals.map(v => (
          <DropdownMenuItem
            key={v.id}
            onClick={() => setVertical(v.slug, mode === 'space' ? pathname : '/dashboard/')}
            className={cn('text-zinc-700', vertical?.id === v.id && 'bg-zinc-100 font-medium')}
          >
            <Building2 className="w-4 h-4 mr-2 text-blue-600" />
            <span className="flex-1 truncate">{v.name}</span>
            {ownedVerticalIds.has(v.id) && <Crown className="w-3.5 h-3.5 text-amber-500" aria-label="You own this vertical" />}
          </DropdownMenuItem>
        ))}
        {verticals.length === 0 && (
          <DropdownMenuItem disabled className="text-zinc-400 text-xs">No verticals yet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function VerticalRows({ onNavigate }: { onNavigate: () => void }) {
  const { verticals, ownedVerticalIds } = useVertical()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const counts = useMemo(() => {
    const byVertical = new Map<string, { open: number; overdue: number }>()
    const chVertical = new Map((channels || []).map(c => [c.id, c.vertical_id]))
    const today = new Date(); today.setHours(0, 0, 0, 0)
    for (const t of tasks || []) {
      const v = t.channel?.vertical_id || chVertical.get(t.channel_id)
      if (!v) continue
      const c = byVertical.get(v) || { open: 0, overdue: 0 }
      if (OPEN_STATUSES.has(t.status)) {
        c.open++
        if (t.due_date && new Date(t.due_date) < today) c.overdue++
      }
      byVertical.set(v, c)
    }
    return byVertical
  }, [tasks, channels])

  return (
    <div className="space-y-0.5">
      {verticals.map(v => {
        const c = counts.get(v.id)
        return (
          <Link
            key={v.id}
            href={withVertical('/dashboard/', v.slug)}
            onClick={onNavigate}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
          >
            <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate flex-1">{v.name}</span>
            {ownedVerticalIds.has(v.id) && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
            {c && c.open > 0 && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', c.overdue > 0 ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-500')}
                title={`${c.open} open, ${c.overdue} overdue`}>
                {c.overdue > 0 ? `${c.overdue}!` : c.open}
              </span>
            )}
          </Link>
        )
      })}
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
      <p className="px-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">My functions</p>
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
  const { mode, slug, verticalId, vertical, flags, canManage } = useVertical()
  const { data: spaceChannels } = useChannels(verticalId)
  const [mobileOpen, setMobileOpen] = useState(false)
  const close = () => setMobileOpen(false)

  const workspaceNav: NavItem[] = [
    { href: '/', icon: Home, label: 'Workspace Home', match: '/' },
    { href: withVertical('/calendar/', 'all'), icon: Calendar, label: 'Calendar', match: '/calendar' },
    { href: '/workspace/tasks/', icon: Table2, label: 'All Tasks', match: '/workspace/tasks' },
    { href: withVertical('/my-tasks/', 'all'), icon: ListTodo, label: 'My Tasks', match: '/my-tasks' },
    { href: withVertical('/owners/', 'all'), icon: UserCircle, label: 'Owners', match: '/owners' },
    { href: '/workspace/weekly/', icon: CalendarRange, label: 'Weekly', match: '/workspace/weekly' },
    { href: '/functions/', icon: Workflow, label: 'Functions', match: '/functions' },
    { href: withVertical('/history/', 'all'), icon: History, label: 'History', match: '/history' },
  ]

  const spaceNav: NavItem[] = [
    { href: withVertical('/dashboard/', slug), icon: LayoutDashboard, label: 'Dashboard', match: '/dashboard' },
    { href: withVertical('/calendar/', slug), icon: Calendar, label: 'Calendar', match: '/calendar' },
    { href: withVertical('/my-tasks/', slug), icon: ListTodo, label: 'My Tasks', match: '/my-tasks' },
    { href: withVertical('/tracker/', slug), icon: LineChart, label: 'Tracker', match: '/tracker' },
    { href: withVertical('/owners/', slug), icon: UserCircle, label: 'Owners', match: '/owners' },
    { href: withVertical('/weekly/', slug), icon: CalendarRange, label: 'Weekly Review', match: '/weekly' },
    { href: withVertical('/budgets/', slug), icon: DollarSign, label: 'Budgets', match: '/budgets' },
    ...(flags.leads_pipeline ? [{ href: withVertical('/leads/', slug), icon: Upload, label: 'Leads Pipeline', match: '/leads' }] : []),
    { href: withVertical('/history/', slug), icon: History, label: 'History', match: '/history' },
    ...(flags.resources ? [{ href: withVertical('/resources/', slug), icon: BookOpen, label: `${vertical?.name || ''} Resources`.trim(), match: '/resources' }] : []),
    ...(canManage ? [{ href: withVertical('/settings/', slug), icon: Settings, label: 'Vertical Settings', match: '/settings' }] : []),
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
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-900">Lyzr Marketing Tracker</h1>
            <p className="text-[11px] text-zinc-500">Marketing Ops</p>
          </div>
        </div>
        <VerticalSwitcher />
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {mode === 'workspace' ? (
          <>
            <NavList items={workspaceNav} onNavigate={close} />
            <div>
              <p className="px-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Verticals</p>
              <VerticalRows onNavigate={close} />
            </div>
            <MyFunctionRows onNavigate={close} />
          </>
        ) : (
          <>
            <NavList items={spaceNav} onNavigate={close} />
            <div>
              <p className="px-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Channels</p>
              <div className="space-y-0.5">
                {buildChannelTree(spaceChannels || []).map(channel => (
                  <ChannelItem key={channel.id} channel={channel} depth={0} slug={slug} />
                ))}
                {(spaceChannels || []).length === 0 && (
                  <p className="px-3 text-xs text-zinc-400">
                    No channels yet.{canManage ? ' Add them in Vertical Settings.' : ''}
                  </p>
                )}
              </div>
            </div>
            <MyFunctionRows onNavigate={close} />
          </>
        )}
      </div>

      {/* User */}
      <div className="px-3 py-3 border-t border-zinc-200">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-100 transition-colors">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user?.avatar_url || ''} />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-violet-600 text-white text-xs">
                {user?.display_name?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate">{user?.display_name}</p>
              <p className="text-[11px] text-zinc-500 truncate">{user?.email}</p>
            </div>
            {user?.role === 'admin' && (
              <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-600">
                Admin
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
                <Layers className="w-4 h-4 mr-2" /> Functions
              </Link>
            </DropdownMenuItem>
            {user?.role === 'admin' && (
              <DropdownMenuItem className="p-0">
                <Link href="/admin/" className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
                  <Settings className="w-4 h-4 mr-2" /> Admin
                </Link>
              </DropdownMenuItem>
            )}
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
          'fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-zinc-200 transition-transform duration-300 lg:translate-x-0 lg:static lg:z-0',
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
  const { data: notifications } = useNotifications()
  const { mode, vertical } = useVertical()
  const unreadCount = notifications?.length || 0

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-zinc-200 bg-white/85 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6">
      <div className="lg:hidden w-10" />
      <div className="flex-1 flex items-center gap-2 text-xs text-zinc-500 pl-2">
        {mode === 'space' && vertical ? (
          <>
            <Link href="/" className="hover:text-zinc-800">Workspace</Link>
            <span className="text-zinc-300">›</span>
            <span className="font-medium text-zinc-800">{vertical.name}</span>
          </>
        ) : (
          <span className="font-medium text-zinc-800">Workspace</span>
        )}
      </div>
      <div className="flex items-center gap-2">
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
  )
}
