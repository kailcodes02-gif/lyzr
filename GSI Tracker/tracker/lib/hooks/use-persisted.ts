'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

// Drop-in useState that survives navigation, refresh and reopening the tab.
// Restoration happens in an effect (not lazy init) so the statically exported
// HTML and the first client render match — no hydration mismatch.
export function usePersisted<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      // corrupt or unavailable storage — fall back to the initial value
    }
    setRestored(true)
  }, [key])

  useEffect(() => {
    if (!restored) return // never write the initial value over a saved one
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // over quota / private mode — persistence is best-effort
    }
  }, [key, value, restored])

  return [value, setValue]
}
