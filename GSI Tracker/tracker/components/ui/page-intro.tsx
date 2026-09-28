'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { HelpCircle, X } from 'lucide-react'

// Short, dismissible "what is this page?" card shown under a page title.
// Dismissal is remembered per page; a small link brings it back any time.

export function PageIntro({ k, children }: { k: string; children: ReactNode }) {
  const storageKey = `gsi:intro:${k}`
  // null = not resolved yet (avoids a dismiss/show flash on load)
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    try { setOpen(window.localStorage.getItem(storageKey) !== '1') } catch { setOpen(true) }
  }, [storageKey])

  const dismiss = () => {
    setOpen(false)
    try { window.localStorage.setItem(storageKey, '1') } catch { /* session only */ }
  }

  if (open === null) return null
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-blue-700">
        <HelpCircle className="w-3 h-3" /> What is this page?
      </button>
    )
  }
  return (
    <div className="relative rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 pr-9 text-[13px] leading-relaxed text-blue-900">
      {children}
      <button onClick={dismiss} aria-label="Got it, hide this" className="absolute top-2.5 right-2.5 text-blue-400 hover:text-blue-800">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
