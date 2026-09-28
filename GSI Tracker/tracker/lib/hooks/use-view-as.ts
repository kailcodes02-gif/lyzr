'use client'

import { useEffect, useState } from 'react'

// Admin-only role preview ("View as"). Lets an admin see the tracker exactly
// as a leadership member, vertical owner, channel owner or plain member sees
// it, so navigation can be designed for each. It masks what the UI shows;
// writes still run as the real signed-in user (RLS is the security boundary).

export const VIEW_AS_OPTIONS = [
  { value: 'admin', label: 'Admin (everything)' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'vertical_owner', label: 'Vertical owner' },
  { value: 'channel_owner', label: 'Channel owner' },
  { value: 'member', label: 'Member' },
] as const

export type ViewAs = (typeof VIEW_AS_OPTIONS)[number]['value']

export const viewAsLabel = (v: ViewAs) => VIEW_AS_OPTIONS.find(o => o.value === v)?.label || v

const KEY = 'gsi:view-as'
let current: ViewAs = 'admin'
let loaded = false
const subs = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const v = window.localStorage.getItem(KEY)
    if (v && VIEW_AS_OPTIONS.some(o => o.value === v)) current = v as ViewAs
  } catch { /* storage unavailable — stay on admin */ }
}

export function setViewAs(v: ViewAs) {
  current = v
  try { window.localStorage.setItem(KEY, v) } catch { /* in-memory only */ }
  subs.forEach(f => f())
}

// The raw preview value. Callers must gate on the REAL role being admin —
// use maskForPreview below rather than reading this directly where possible.
export function useViewAs(): ViewAs {
  const [v, setV] = useState<ViewAs>('admin')
  useEffect(() => {
    load()
    setV(current)
    const f = () => setV(current)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return v
}

const EMPTY = new Set<string>()

// What each preview role keeps. Real non-admins always get 'admin' passed in
// (i.e. no masking).
export function maskForPreview(va: ViewAs) {
  return {
    isAdmin: va === 'admin',
    isLeadership: va === 'admin' || va === 'leadership',
    verticalOwnership: va === 'admin' || va === 'vertical_owner',
    channelOwnership: va === 'admin' || va === 'vertical_owner' || va === 'channel_owner',
  }
}

export { EMPTY as EMPTY_ID_SET }
