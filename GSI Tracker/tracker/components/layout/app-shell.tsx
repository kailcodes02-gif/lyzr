'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Calendar,
  LayoutDashboard, ListTodo, ChevronDown, ChevronRight,
  Bell, LogOut, DollarSign, Upload, Menu, X, Settings,
  LineChart, UserCircle, CalendarRange, History, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChannels, buildChannelTree, useCurrentUser, useNotifications } from '@/lib/hooks/use-data'
import { signOut } from '@/lib/actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TIER_CONFIG, type Channel } from '@/lib/types/database'

function ChannelItem({ channel, depth }: { channel: Channel; depth: number }) {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const hasChildren = channel.children && channel.children.length > 0
  const isActive = pathname === `/channel/?id=${channel.id}`

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={`/channel/?id=${channel.id}`}
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
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="ml-3 space-y-0.5">
          {channel.children!.map(child => (
            <ChannelItem key={child.id} channel={child} depth={depth + 1} />
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
    { href: '/history', icon: History, label: 'History' },
    { href: '/resources', icon: BookOpen, label: 'GSI Resources' },
  ]

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-zinc-200">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-900">GSI Tracker</h1>
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
                    ? 'bg-zinc-200/70 text-zinc-900'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            )
          })}
        </div>

        <div>
          <p className="px-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Channels
          </p>
          <div className="space-y-0.5">
            {buildChannelTree(allChannels || []).map(channel => (
              <ChannelItem key={channel.id} channel={channel} depth={0} />
            ))}
          </div>
        </div>
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
            <div className="flex-1 text-left">
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
              <Link href="/my-tasks" className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
                <ListTodo className="w-4 h-4 mr-2" /> My Tasks
              </Link>
            </DropdownMenuItem>
            {user?.role === 'admin' && (
              <DropdownMenuItem className="p-0">
                <Link href="/admin" className="flex items-center w-full px-2 py-1.5 text-zinc-700 hover:text-zinc-900 select-none outline-none">
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
  const unreadCount = notifications?.length || 0

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-zinc-200 bg-white/85 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6">
      <div className="lg:hidden w-10" />
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative text-zinc-600 hover:text-zinc-900"
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
