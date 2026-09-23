'use client'

import { createContext, useContext } from 'react'
import type { Vertical, VerticalSettings } from '@/lib/types/database'
import { DEFAULT_FLAGS } from '@/lib/vertical-flags'

export type VerticalMode = 'workspace' | 'space'

export interface VerticalContextValue {
  mode: VerticalMode
  // Vertical id, or 'all' in workspace mode. Pass straight to the data hooks.
  verticalId: string | 'all'
  vertical: Vertical | null
  slug: string | 'all'
  verticals: Vertical[]
  flags: VerticalSettings
  // Admin, or explicit owner of the current vertical.
  canManage: boolean
  isAdmin: boolean
  ownedVerticalIds: Set<string>
  resolving: boolean
  setVertical: (slug: string | 'all', path?: string) => void
}

export const VerticalContext = createContext<VerticalContextValue>({
  mode: 'workspace',
  verticalId: 'all',
  vertical: null,
  slug: 'all',
  verticals: [],
  flags: DEFAULT_FLAGS,
  canManage: false,
  isAdmin: false,
  ownedVerticalIds: new Set(),
  resolving: true,
  setVertical: () => {},
})

export function useVertical() {
  return useContext(VerticalContext)
}
