'use client'

import { useState } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  ALL_TIME, ISO, PRESET_GROUPS, resolveRange, shiftRange, type DateRangeValue, type RangePreset,
} from '@/lib/date-range'

// Google-Calendar-style range control: [<] [ label ▾ ] [>]
// The popover has preset shortcuts on the left and a two-month range
// calendar on the right; picking two days or typing from/to and pressing
// Apply sets a custom range. Arrows step the current range by its length.
export function DateRangePicker({ value, onChange, label, allowAll = true, className, compact }: {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  label?: string           // small caption shown before the control, e.g. "Due"
  allowAll?: boolean       // whether "All time" is offered
  className?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const resolved = resolveRange(value)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')

  // Seed the custom editor from the current value whenever the popover opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      const r = resolveRange(value)
      setDraft(r.from || r.to ? { from: r.from || undefined, to: r.to || undefined } : undefined)
      setFromText(r.from ? format(r.from, ISO) : '')
      setToText(r.to ? format(r.to, ISO) : '')
    }
    setOpen(next)
  }

  const pick = (preset: RangePreset) => {
    if (preset === 'custom') return
    onChange({ preset })
    setOpen(false)
  }

  const applyCustom = () => {
    const f = fromText ? parseISO(fromText) : null
    const t = toText ? parseISO(toText) : null
    const from = f && isValid(f) ? format(f, ISO) : undefined
    const to = t && isValid(t) ? format(t, ISO) : undefined
    if (!from && !to) { onChange(ALL_TIME); setOpen(false); return }
    onChange({ preset: 'custom', from: from && to && from > to ? to : from, to: from && to && from > to ? from : to })
    setOpen(false)
  }

  const onCalendarSelect = (r: DateRange | undefined) => {
    setDraft(r)
    setFromText(r?.from ? format(r.from, ISO) : '')
    setToText(r?.to ? format(r.to, ISO) : '')
  }

  const steppable = !!resolved.unit
  const active = value.preset !== 'all'

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      {label && <span className="text-[10px] text-zinc-500 font-medium mr-1">{label}</span>}
      <button
        type="button"
        onClick={() => onChange(shiftRange(value, -1))}
        disabled={!steppable}
        className="p-1.5 rounded-md border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
        aria-label="Previous period"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium min-w-[150px] justify-between',
            compact ? 'h-7' : 'h-8',
            active ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-zinc-300 bg-white text-zinc-700',
          )}
        >
          <CalendarDays className="w-3.5 h-3.5 shrink-0 opacity-70" />
          <span className="truncate">{resolved.label}</span>
          {active && allowAll && (
            <X className="w-3.5 h-3.5 text-blue-500 hover:text-red-600 shrink-0" onClick={e => { e.stopPropagation(); onChange(ALL_TIME) }} />
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0 bg-white border-zinc-200">
          <div className="flex">
            <div className="w-40 border-r border-zinc-100 py-2 max-h-[420px] overflow-y-auto">
              {PRESET_GROUPS.map(g => (
                <div key={g.title || 'misc'} className="px-1.5 mb-1">
                  {g.title && <p className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-400">{g.title}</p>}
                  {g.items.filter(i => allowAll || i.value !== 'all').map(i => (
                    <button
                      key={i.value}
                      onClick={() => pick(i.value)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-md text-xs',
                        value.preset === i.value ? 'bg-blue-50 text-blue-800 font-medium' : 'text-zinc-700 hover:bg-zinc-100',
                        i.value === 'custom' && 'cursor-default text-zinc-400',
                      )}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="p-3 space-y-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={draft}
                onSelect={onCalendarSelect}
                defaultMonth={draft?.from || resolved.from || new Date()}
                weekStartsOn={1}
                className="p-0"
              />
              <div className="flex items-center gap-2 pt-2 border-t border-zinc-100">
                <Input type="date" value={fromText} onChange={e => setFromText(e.target.value)} className="h-8 w-36 text-xs bg-zinc-50 border-zinc-300" aria-label="From" />
                <span className="text-xs text-zinc-500">to</span>
                <Input type="date" value={toText} onChange={e => setToText(e.target.value)} className="h-8 w-36 text-xs bg-zinc-50 border-zinc-300" aria-label="To" />
                <span className="flex-1" />
                {allowAll && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-zinc-600" onClick={() => { onChange(ALL_TIME); setOpen(false) }}>Clear</Button>
                )}
                <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={applyCustom}>Apply</Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={() => onChange(shiftRange(value, 1))}
        disabled={!steppable}
        className="p-1.5 rounded-md border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
        aria-label="Next period"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
