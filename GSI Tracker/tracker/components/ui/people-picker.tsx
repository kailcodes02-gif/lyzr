'use client'

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useKnownEmails, useUsers } from '@/lib/hooks/use-data'
import { cn } from '@/lib/utils'

// Type-ahead people picker: chips for the chosen people, suggestions as you
// type (by name or email), Enter/click to add, Backspace to remove the last.
// Knows everyone signed in plus teammates referenced but not signed in yet.

type Person = { email: string; name: string; pending: boolean }

export function usePeople(): Person[] {
  const { data: users } = useUsers()
  const { data: known } = useKnownEmails()
  return useMemo(() => {
    const m = new Map<string, Person>()
    for (const u of users || []) {
      if (u.email === 'preview@lyzr.ai') continue
      m.set(u.email.toLowerCase(), { email: u.email.toLowerCase(), name: u.display_name || u.email.split('@')[0], pending: false })
    }
    for (const e of known || []) {
      if (!m.has(e)) m.set(e, { email: e, name: e.split('@')[0].split(/[._]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), pending: true })
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [users, known])
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function PeoplePicker({ value, onChange, placeholder = 'Type a name…', className }: {
  value: string[]
  onChange: (emails: string[]) => void
  placeholder?: string
  className?: string
}) {
  const people = usePeople()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const nameOf = (e: string) => people.find(p => p.email === e)?.name || e
  const q = text.trim().toLowerCase()
  const matches = people
    .filter(p => !value.includes(p.email) && (!q || p.name.toLowerCase().includes(q) || p.email.includes(q)))
    .slice(0, 8)

  const add = (email: string) => {
    const e = email.trim().toLowerCase()
    if (!e || value.includes(e)) return
    onChange([...value, e]); setText(''); setActive(0)
    inputRef.current?.focus()
  }

  const onKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (ev.key === 'Enter' || ev.key === ',' || ev.key === 'Tab') {
      if (matches[active] && q) { ev.preventDefault(); add(matches[active].email) }
      else if (EMAIL.test(q)) { ev.preventDefault(); add(q) }
      else if (ev.key !== 'Tab' && q) ev.preventDefault()
    } else if (ev.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
    else if (ev.key === 'Escape') setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      <div onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 min-h-9 rounded-md border border-zinc-300 bg-white px-2 py-1 focus-within:ring-2 focus-within:ring-orange-500/30 focus-within:border-orange-500 cursor-text">
        {value.map(e => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 border border-zinc-200 pl-2 pr-1 py-0.5 text-xs text-zinc-800" title={e}>
            {nameOf(e)}
            <button type="button" aria-label={`Remove ${nameOf(e)}`} onClick={() => onChange(value.filter(x => x !== e))} className="rounded-full p-0.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-200"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input ref={inputRef} value={text}
          onChange={e => { setText(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey} placeholder={value.length ? '' : placeholder}
          className="flex-1 min-w-[8rem] border-0 bg-transparent py-0.5 text-sm outline-none placeholder:text-zinc-400" />
      </div>
      {open && (matches.length > 0 || EMAIL.test(q)) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-zinc-200 bg-white shadow-lg py-1 max-h-64 overflow-y-auto">
          {matches.map((p, i) => (
            <button key={p.email} type="button" onMouseDown={e => { e.preventDefault(); add(p.email) }} onMouseEnter={() => setActive(i)}
              className={cn('w-full flex items-center gap-2.5 px-3 py-1.5 text-left', i === active && 'bg-zinc-100')}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-medium text-white">{p.name.charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-zinc-900 truncate">{p.name}</span>
                <span className="block text-[11px] text-zinc-500 truncate">{p.email}{p.pending && ' · hasn’t signed in yet'}</span>
              </span>
            </button>
          ))}
          {!matches.length && EMAIL.test(q) && (
            <button type="button" onMouseDown={e => { e.preventDefault(); add(q) }} className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 bg-zinc-100">Add {q}</button>
          )}
        </div>
      )}
    </div>
  )
}
