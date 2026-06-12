'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Share2, FileText, Calendar, Handshake, Zap, Send, Users,
  LayoutDashboard, ListTodo, ChevronDown, ChevronRight,
  Bell, LogOut, DollarSign, Upload, Menu, X, Settings,
  LineChart, UserCircle, CalendarRange,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCategories, useChannels, buildChannelTree, useCurrentUser, useNotifications } from '@/lib/hooks/use-data'
import { signOut } from '@/lib/actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Category, Channel } from '@/lib/types/database'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'share-2': Share2,
  'file-text': FileText,
  'calendar': Calendar,
  'handshake': Handshake,
  'zap': Zap,
  'send': Send,
  'users': Users,
}

function CategoryItem({ category, channels }: { category: Category; channels: Channel[] }) {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(true)
  const Icon = ICON_MAP[category.icon || ''] || FileText
  const channelTree = buildChannelTree(channels)
  const isActive = pathname.startsWith(`/category/${category.slug}`)

  return (
    <div>
      <Link
        href={`/category/${category.slug}`}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
          isActive
            ? 'bg-white/10 text-white'
            : 'text-zinc-400 hover:text-white hover:bg-white/5'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">{category.name}</span>
        <button
          onClick={(e) => { e.preventDefault(); setExpanded(!expanded) }}
          className="p-0.5 hover:bg-white/10 rounded"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </Link>
      {expanded && channelTree.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {channelTree.map(channel => (
            <ChannelItem key={channel.id} channel={channel} categorySlug={category.slug} depth={0} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelItem({ channel, categorySlug, depth }: { channel: Channel; categorySlug: string; depth: number }) {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const hasChildren = channel.children && channel.children.length > 0
  const isActive = pathname === `/channel/${channel.id}`

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={`/channel/${channel.id}`}
          className={cn(
            'flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] transition-all duration-150',
            isActive
              ? 'bg-white/10 text-white font-medium'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5',
            depth > 0 && 'pl-4'
          )}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 shrink-0" />
          <span className="truncate">{channel.name}</span>
        </Link>
        {hasChildren && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-zinc-500 hover:text-zinc-300"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="ml-3 space-y-0.5">
          {channel.children!.map(child => (
            <ChannelItem key={child.id} channel={child} categorySlug={categorySlug} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: user } = useCurrentUser()
  const { data: categories } = useCategories()
  const { data: allChannels } = useChannels()
  const { data: notifications } = useNotifications()
  const [mobileOpen, setMobileOpen] = useState(false)
  const unreadCount = notifications?.length || 0

  const navItems = [
    { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/calendar', icon: Calendar, label: 'Calendar' },
    { href: '/my-tasks', icon: ListTodo, label: 'My Tasks' },
    { href: '/tracker', icon: LineChart, label: 'Tracker' },
    { href: '/owners', icon: UserCircle, label: 'Owners' },
    { href: '/weekly', icon: CalendarRange, label: 'Weekly Review' },
    { href: '/budgets', icon: DollarSign, label: 'Budgets' },
    { href: '/leads', icon: Upload, label: 'Leads Pipeline' },
  ]

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">GSI Tracker</h1>
            <p className="text-[11px] text-zinc-500">Lyzr Marketing Ops</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div className="space-y-1">
          {navItems.map(item => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            )
          })}
        </div>

        <div>
          <p className="px-3 text-[11px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">
            Categories
          </p>
          <div className="space-y-1">
            {categories?.map(cat => (
              <CategoryItem
                key={cat.id}
                category={cat}
                channels={allChannels?.filter(ch => ch.category_id === cat.id) || []}
              />
            ))}
          </div>
        </div>
      </div>

      {/* User */}
      <div className="px-3 py-3 border-t border-white/5">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user?.avatar_url || ''} />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-violet-600 text-white text-xs">
                {user?.display_name?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-white truncate">{user?.display_name}</p>
              <p className="text-[11px] text-zinc-500 truncate">{user?.email}</p>
            </div>
            {user?.role === 'admin' && (
              <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400">
                Admin
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-zinc-900 border-white/10">
            <DropdownMenuItem className="p-0">
              <Link href="/my-tasks" className="flex items-center w-full px-2 py-1.5 text-zinc-300 hover:text-white select-none outline-none">
                <ListTodo className="w-4 h-4 mr-2" /> My Tasks
              </Link>
            </DropdownMenuItem>
            {user?.role === 'admin' && (
              <DropdownMenuItem className="p-0">
                <Link href="/admin" className="flex items-center w-full px-2 py-1.5 text-zinc-300 hover:text-white select-none outline-none">
                  <Settings className="w-4 h-4 mr-2" /> Admin
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem onClick={handleSignOut} className="text-red-400 hover:text-red-300">
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
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-zinc-900 border border-white/10 text-white lg:hidden"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-[#0c0c12] border-r border-white/5 transition-transform duration-300 lg:translate-x-0 lg:static lg:z-0',
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
  const unreadCount = notifications?.length || 0

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6">
      <div className="lg:hidden w-10" />
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative text-zinc-400 hover:text-white"
          onClick={() => router.push('/notifications')}
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
