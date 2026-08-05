'use client'

import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Check, ChevronDown, X } from 'lucide-react'

// Filter control that accepts any number of values at once — "Company:
// Accenture, TCS, Wipro" — with a search box for long option lists.
// An empty selection means "all", which is the no-filter state.

export function MultiSelect({ label, options, selected, onChange, width = 'w-[190px]' }: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? options.filter(o => o.toLowerCase().includes(needle)) : options
  }, [options, q])

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])

  const summary =
    selected.length === 0 ? `${label}: all`
    : selected.length === 1 ? `${label}: ${selected[0]}`
    : `${label}: ${selected.length} selected`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`${width} inline-flex items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-xs ${
          selected.length ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-zinc-300 bg-white text-zinc-700'
        }`}
        title={selected.length > 1 ? selected.join(', ') : undefined}
      >
        <span className="truncate">{summary}</span>
        <span className="flex items-center gap-0.5 shrink-0">
          {selected.length > 0 && (
            <X
              className="w-3.5 h-3.5 text-blue-500 hover:text-red-600"
              onClick={e => { e.stopPropagation(); onChange([]) }}
            />
          )}
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0 bg-white border-zinc-200">
        <div className="p-2 border-b border-zinc-100">
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="h-7 text-xs bg-zinc-50 border-zinc-300 text-zinc-800"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">No matches</p>}
          {shown.map(o => {
            const on = selected.includes(o)
            return (
              <button
                key={o}
                onClick={() => toggle(o)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-zinc-700 hover:bg-zinc-50"
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                  on ? 'bg-blue-600 border-blue-600' : 'border-zinc-300'
                }`}>
                  {on && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className="truncate">{o}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-100 px-2 py-1.5">
          <span className="text-[10px] text-zinc-500">{selected.length} selected</span>
          <div className="flex gap-2">
            <button onClick={() => onChange(shown)} className="text-[11px] text-blue-600 hover:text-blue-500">Select shown</button>
            <button onClick={() => onChange([])} className="text-[11px] text-zinc-500 hover:text-red-600">Clear</button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
