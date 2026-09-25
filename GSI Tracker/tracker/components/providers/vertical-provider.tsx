'use client'

import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { VerticalContext, type VerticalMode } from '@/lib/hooks/use-vertical'
import { useCategories, useChannels, useCurrentUser, useMyVerticalIds, useVerticals } from '@/lib/hooks/use-data'
import { keyFor, usePersisted } from '@/lib/hooks/use-persisted'
import { withVertical } from '@/lib/hooks/use-space-href'
import { ALL_FLAGS_ON, resolveFlags } from '@/lib/vertical-flags'
import type { Vertical } from '@/lib/types/database'

// Routes that live at the workspace level and never need ?v=.
const WORKSPACE_PREFIXES = ['/workspace', '/functions', '/function', '/admin', '/notifications', '/guide', '/campaign', '/campaigns', '/my-board', '/members']
// Routes that only make sense inside one vertical (no ?v=all).
const SPACE_ONLY = ['/dashboard', '/weekly', '/budgets', '/leads', '/resources', '/settings', '/channel', '/category']

const normalize = (p: string) => (p.replace(/\/$/, '') || '/')

function isWorkspaceRoute(pathname: string) {
  const p = normalize(pathname)
  return p === '/' || WORKSPACE_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'))
}

function isSpaceOnly(pathname: string) {
  const p = normalize(pathname)
  return SPACE_ONLY.some(pre => p === pre || p.startsWith(pre + '/'))
}

// Before the verticals migration lands, or if the table is empty, behave
// like the single-vertical GSI tracker with every feature on.
const LEGACY_VERTICAL: Vertical = {
  id: 'all', name: 'GSI', slug: 'gsi', description: null, icon: null, color: null,
  sort_order: 0, is_active: true, settings: ALL_FLAGS_ON, created_by: null,
  created_at: '', updated_at: '',
}

export function VerticalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const params = useSearchParams()
  const vParam = params.get('v')

  const { data: user } = useCurrentUser()
  const { data: verticalsData, isLoading: verticalsLoading, isError: verticalsError } = useVerticals()
  const { data: myVerticalIds } = useMyVerticalIds()
  const { data: allChannels } = useChannels('all')
  const { data: allCategories } = useCategories('all')

  const verticals = useMemo<Vertical[]>(() => {
    if (verticalsError) return [LEGACY_VERTICAL]
    if (!verticalsData) return []
    return verticalsData.length ? verticalsData : [LEGACY_VERTICAL]
  }, [verticalsData, verticalsError])
  const legacy = verticals.length === 1 && verticals[0].id === 'all'

  const [lastSlug, setLastSlug] = usePersisted<string | null>(keyFor(user?.id, 'vertical:last'), null)

  const ownedVerticalIds = useMemo(() => new Set(myVerticalIds || []), [myVerticalIds])
  const isAdmin = user?.role === 'admin'

  // ---------- resolve the current scope ----------
  const known = vParam && vParam !== 'all' ? verticals.find(v => v.slug === vParam) || null : null
  let mode: VerticalMode
  let vertical: Vertical | null = null
  let resolving = false
  const ready = !verticalsLoading || verticalsError

  if (!ready) {
    mode = 'workspace'
    resolving = true
  } else if (vParam === 'all') {
    mode = 'workspace'
  } else if (known) {
    mode = 'space'
    vertical = known
  } else if (!vParam && isWorkspaceRoute(pathname)) {
    mode = 'workspace'
  } else {
    // No or unknown ?v= on a space route: we will redirect below.
    mode = 'space'
    resolving = true
  }

  // Persist the last visited vertical for v-less deep links.
  useEffect(() => {
    if (known && known.slug !== lastSlug && !legacy) setLastSlug(known.slug)
  }, [known, lastSlug, legacy, setLastSlug])

  // Canonicalise URLs that are missing or mis-stating the vertical.
  useEffect(() => {
    if (!ready) return
    if (vParam === 'all') {
      if (isSpaceOnly(pathname)) router.replace('/')
      return
    }
    if (known) return
    if (vParam) {
      toast.error(`Unknown vertical "${vParam}"`)
      router.replace('/')
      return
    }
    if (isWorkspaceRoute(pathname)) return

    // Deep links to a channel/category resolve their vertical from data.
    const p = normalize(pathname)
    let target: Vertical | undefined
    if (p === '/channel' || p === '/category') {
      if (!allChannels || !allCategories) return // wait for lookups
      const id = params.get('id')
      const slug = params.get('slug')
      const verticalId = p === '/channel'
        ? allChannels.find(c => c.id === id)?.vertical_id
        : allCategories.find(c => c.slug === slug)?.vertical_id
      target = verticals.find(v => v.id === verticalId)
    }
    if (!target) target = verticals.find(v => v.slug === lastSlug)
    if (!target) target = verticals.find(v => ownedVerticalIds.has(v.id))
    if (!target) target = verticals[0]
    if (!target) return
    const qs = params.toString()
    router.replace(withVertical(`${pathname}${qs ? `?${qs}` : ''}`, target.slug))
  }, [ready, vParam, known, pathname, params, router, verticals, allChannels, allCategories, lastSlug, ownedVerticalIds])

  const setVertical = useCallback((slug: string | 'all', path?: string) => {
    const dest = path ?? pathname
    if (slug === 'all') {
      router.push(isSpaceOnly(dest) || normalize(dest) === '/' ? '/' : withVertical(dest, 'all'))
      return
    }
    const target = isWorkspaceRoute(dest) && normalize(dest) !== '/' ? '/dashboard/' : (normalize(dest) === '/' ? '/dashboard/' : dest)
    router.push(withVertical(target, slug))
  }, [pathname, router])

  const value = useMemo(() => ({
    mode,
    verticalId: mode === 'space' && vertical ? vertical.id : 'all' as const,
    vertical,
    slug: mode === 'space' && vertical ? vertical.slug : 'all' as const,
    verticals,
    flags: vertical ? resolveFlags(vertical.settings) : (legacy ? ALL_FLAGS_ON : resolveFlags(null)),
    canManage: !!isAdmin || (!!vertical && ownedVerticalIds.has(vertical.id)),
    isAdmin: !!isAdmin,
    ownedVerticalIds,
    resolving,
    setVertical,
  }), [mode, vertical, verticals, legacy, isAdmin, ownedVerticalIds, resolving, setVertical])

  return <VerticalContext.Provider value={value}>{children}</VerticalContext.Provider>
}
