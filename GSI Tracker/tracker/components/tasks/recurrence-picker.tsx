'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IntervalUnit, RecurrenceEnd, RecurrenceRule } from '@/lib/task-logic'
import { recurrenceLabel } from '@/lib/task-logic'

// Google-Calendar-style recurrence builder: quick presets (Daily / Weekly /
// Bi-weekly / Monthly) plus a full Custom builder ("repeat every N day/week/
// month", specific weekdays for weekly, and an end condition — Never / On
// date / After N occurrences — exactly like the Calendar "Custom..." dialog.

export type RecurrenceValue = { rule: RecurrenceRule; end: RecurrenceEnd }

export const DEFAULT_RECURRENCE: RecurrenceValue = {
  rule: { interval_count: 1, interval_unit: 'week', by_weekdays: null },
  end: { type: 'never' },
}

const WEEKDAYS: { d: number; label: string }[] = [
  { d: 0, label: 'S' }, { d: 1, label: 'M' }, { d: 2, label: 'T' }, { d: 3, label: 'W' },
  { d: 4, label: 'T' }, { d: 5, label: 'F' }, { d: 6, label: 'S' },
]

type Preset = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom'

function presetOf(rule: RecurrenceRule): Preset {
  const noFilter = !rule.by_weekdays || rule.by_weekdays.length === 0
  if (rule.interval_unit === 'day' && rule.interval_count === 1) return 'daily'
  if (rule.interval_unit === 'week' && rule.interval_count === 1 && noFilter) return 'weekly'
  if (rule.interval_unit === 'week' && rule.interval_count === 2 && noFilter) return 'biweekly'
  if (rule.interval_unit === 'month' && rule.interval_count === 1) return 'monthly'
  return 'custom'
}

const UNIT_LABEL: Record<IntervalUnit, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
}

export function RecurrencePicker({ value, onChange, anchorWeekday }: {
  value: RecurrenceValue
  onChange: (next: RecurrenceValue) => void
  // The task's due date's weekday — used so switching TO "Custom" with no
  // weekday picked yet still has a sane default (today's/due date's weekday).
  anchorWeekday?: number
}) {
  const preset = presetOf(value.rule)
  const [showCustom, setShowCustom] = useState(preset === 'custom')

  const setRule = (rule: Partial<RecurrenceRule>) => onChange({ ...value, rule: { ...value.rule, ...rule } })
  const setEnd = (end: RecurrenceEnd) => onChange({ ...value, end })

  const onPresetChange = (p: Preset) => {
    if (p === 'custom') { setShowCustom(true); return }
    setShowCustom(false)
    const rule: RecurrenceRule =
      p === 'daily' ? { interval_count: 1, interval_unit: 'day', by_weekdays: null }
      : p === 'weekly' ? { interval_count: 1, interval_unit: 'week', by_weekdays: null }
      : p === 'biweekly' ? { interval_count: 2, interval_unit: 'week', by_weekdays: null }
      : { interval_count: 1, interval_unit: 'month', by_weekdays: null }
    onChange({ ...value, rule })
  }

  const toggleWeekday = (d: number) => {
    const cur = value.rule.by_weekdays && value.rule.by_weekdays.length
      ? value.rule.by_weekdays
      : [anchorWeekday ?? new Date().getDay()]
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]
    setRule({ by_weekdays: next.length ? next : [anchorWeekday ?? new Date().getDay()] })
  }

  const preview = useMemo(() => recurrenceLabel(value.rule, value.end), [value])

  return (
    <div className="space-y-2.5">
      <select
        value={showCustom ? 'custom' : preset}
        onChange={e => onPresetChange(e.target.value as Preset)}
        className="w-full text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-800"
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Bi-weekly</option>
        <option value="monthly">Monthly</option>
        <option value="custom">Custom…</option>
      </select>

      {showCustom && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600 shrink-0">Repeat every</span>
            <Input
              type="number"
              min={1}
              value={value.rule.interval_count}
              onChange={e => setRule({ interval_count: Math.max(1, Number(e.target.value) || 1) })}
              className="h-7 w-16 text-xs bg-white border-zinc-300 text-zinc-800"
            />
            <select
              value={value.rule.interval_unit}
              onChange={e => setRule({ interval_unit: e.target.value as IntervalUnit })}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-800"
            >
              <option value="day">{value.rule.interval_count === 1 ? 'day' : 'days'}</option>
              <option value="week">{value.rule.interval_count === 1 ? 'week' : 'weeks'}</option>
              <option value="month">{value.rule.interval_count === 1 ? 'month' : 'months'}</option>
            </select>
          </div>

          {value.rule.interval_unit === 'week' && (
            <div>
              <span className="text-[11px] text-zinc-500 block mb-1">Repeat on</span>
              <div className="flex gap-1">
                {WEEKDAYS.map(({ d, label }) => {
                  const on = (value.rule.by_weekdays && value.rule.by_weekdays.length
                    ? value.rule.by_weekdays
                    : [anchorWeekday ?? new Date().getDay()]).includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleWeekday(d)}
                      title={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}
                      className={`w-6 h-6 rounded-full text-[10px] font-semibold border transition-colors ${
                        on ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-zinc-300 text-zinc-500 hover:border-violet-400'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <span className="text-[11px] text-zinc-500 block mb-1">Ends</span>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                <input type="radio" checked={value.end.type === 'never'} onChange={() => setEnd({ type: 'never' })} className="accent-violet-600" />
                Never
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="radio"
                  checked={value.end.type === 'on_date'}
                  onChange={() => setEnd({ type: 'on_date', date: value.end.type === 'on_date' ? value.end.date : '' })}
                  className="accent-violet-600"
                />
                On
                <Input
                  type="date"
                  disabled={value.end.type !== 'on_date'}
                  value={value.end.type === 'on_date' ? value.end.date : ''}
                  onChange={e => setEnd({ type: 'on_date', date: e.target.value })}
                  className="h-7 w-36 text-xs bg-white border-zinc-300 text-zinc-800 disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="radio"
                  checked={value.end.type === 'after_count'}
                  onChange={() => setEnd({ type: 'after_count', total: value.end.type === 'after_count' ? value.end.total : 10 })}
                  className="accent-violet-600"
                />
                After
                <Input
                  type="number"
                  min={1}
                  disabled={value.end.type !== 'after_count'}
                  value={value.end.type === 'after_count' ? value.end.total : ''}
                  onChange={e => setEnd({ type: 'after_count', total: Math.max(1, Number(e.target.value) || 1) })}
                  className="h-7 w-16 text-xs bg-white border-zinc-300 text-zinc-800 disabled:opacity-50"
                />
                occurrence{value.end.type === 'after_count' && value.end.total === 1 ? '' : 's'}
              </label>
            </div>
          </div>
        </div>
      )}

      {!showCustom && (
        <div>
          <Label className="text-zinc-600 text-[10px]">Ends (optional)</Label>
          <Input
            type="date"
            value={value.end.type === 'on_date' ? value.end.date : ''}
            onChange={e => setEnd(e.target.value ? { type: 'on_date', date: e.target.value } : { type: 'never' })}
            className="mt-1 h-8 text-xs bg-white border-zinc-300 text-zinc-800"
          />
        </div>
      )}

      <p className="text-[11px] text-violet-700 font-medium">{preview}</p>
    </div>
  )
}
