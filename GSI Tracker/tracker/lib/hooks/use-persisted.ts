'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

// Persisted UI state for the lead dashboards.
//
// Keys holding anything lead-related MUST be scoped to the signed-in user
// (see keyFor) and are purged on sign-out — a pulled lead list is customer PII
// and must not outlive the session on a shared browser profile.

const PREFIX = 'gsi:'

// Session-lifetime fallback for private mode / blocked site data, so state
// still survives tab switches even when localStorage throws.
const memory = new Map<string, string>()

function readRaw(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    // storage unavailable — fall through to the in-memory copy
  }
  return memory.get(key) ?? null
}

export function writeRaw(key: string, raw: string) {
  memory.set(key, raw)
  try {
    window.localStorage.setItem(key, raw)
  } catch {
    // over quota or blocked — the in-memory copy still serves this session
  }
}

// Namespace a key to one user. Returns null while the identity is unknown,
// which tells usePersisted to touch nothing yet.
export function keyFor(userId: string | undefined, name: string): string | null {
  return userId ? `${PREFIX}${userId}:${name}` : null
}

// Called on sign-out: no dashboard state (least of all lead PII) may survive.
export function purgePersisted() {
  for (const k of [...memory.keys()]) if (k.startsWith(PREFIX)) memory.delete(k)
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith(PREFIX)) window.localStorage.removeItem(k)
    }
  } catch {
    // nothing readable to purge
  }
}

// The first version of this feature stored lead data under keys that were not
// scoped to a user (gsi:hs:v1:*, gsi:csv:v1:*). Those entries are already in
// people's browsers, so clear them once on load.
const LEGACY = ['gsi:hs:v1:', 'gsi:csv:v1:']
export function purgeLegacyKeys() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (LEGACY.some(p => k.startsWith(p))) window.localStorage.removeItem(k)
    }
  } catch {
    // storage unavailable — nothing to clean up
  }
}

// Drop-in useState that survives navigation, refresh and reopening the tab.
// Restoration happens in an effect (not lazy init) so the statically exported
// HTML and the first client render match — no hydration mismatch.
export function usePersisted<T>(key: string | null, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)
  // Which key `value` was restored for; null means "not restored yet".
  const [restoredKey, setRestoredKey] = useState<string | null>(null)

  useEffect(() => {
    if (key === null) return // identity unknown — do not read or write
    let next = initial
    const raw = readRaw(key)
    if (raw !== null) {
      try {
        next = JSON.parse(raw) as T
      } catch {
        // corrupt entry — fall back to the initial value
      }
    }
    setValue(next) // also resets state when the key changes (user switch)
    setRestoredKey(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a fresh literal each render
  }, [key])

  useEffect(() => {
    // Never write one user's value under another user's key.
    if (key === null || restoredKey !== key) return
    const raw = JSON.stringify(value)
    if (readRaw(key) === raw) return // skip the redundant write right after restore
    writeRaw(key, raw)
  }, [key, value, restoredKey])

  return [value, setValue]
}
