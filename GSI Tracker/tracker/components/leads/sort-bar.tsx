'use client'

import { ArrowDown, ArrowUp, ArrowUpDown, X } from 'lucide-react'

// Excel-style multi-level sorting shared by both lead dashboards:
// "sort by Lead score, then by Company, then by Status". Levels apply in
// order — each one only breaks ties left by the level above it.

export type SortLevel = { key: string; dir: 'asc' | 'desc' }
export type SortColumn = { key: string; label: string }

// Apply the levels in order; the first non-zero comparison wins.
export function applySorts<T>(
  rows: T[],
  sorts: SortLevel[],
  compare: (a: T, b: T, key: string) => number,
): T[] {
  if (!sorts.length) return rows
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const c = compare(a, b, s.key)
      if (c !== 0) return s.dir === 'asc' ? c : -c
    }
    return 0
  })
}

// Header-click behaviour: plain click sorts by this column alone; the caller
// passes additive=true (shift-click) to append it as a further level.
export function toggleSortLevel(sorts: SortLevel[], key: string, additive: boolean): SortLevel[] {
  const at = sorts.findIndex(s => s.key === key)
  if (additive) {
    if (at === -1) return [...sorts, { key, dir: 'desc' }]
    const next = [...sorts]
    next[at] = { key, dir: next[at].dir === 'asc' ? 'desc' : 'asc' }
    return next
  }
  if (sorts.length === 1 && at === 0) {
    return [{ key, dir: sorts[0].dir === 'asc' ? 'desc' : 'asc' }]
  }
  return [{ key, dir: 'desc' }]
}

export function SortBar({ columns, sorts, setSorts }: {
  columns: SortColumn[]
  sorts: SortLevel[]
  setSorts: (next: SortLevel[]) => void
}) {
  const unused = columns.filter(c => !sorts.some(s => s.key === c.key))

  const setKey = (i: number, key: string) => {
    const next = [...sorts]
    next[i] = { ...next[i], key }
    setSorts(next)
  }
  const flip = (i: number) => {
    const next = [...sorts]
    next[i] = { ...next[i], dir: next[i].dir === 'asc' ? 'desc' : 'asc' }
    setSorts(next)
  }
  const remove = (i: number) => setSorts(sorts.filter((_, j) => j !== i))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600">
        <ArrowUpDown className="w-3.5 h-3.5 text-blue-600" /> Sort
      </span>

      {sorts.length === 0 && (
        <span className="text-[11px] text-zinc-400 italic">No sorting — add a level, or click any column header</span>
      )}

      {sorts.map((s, i) => (
        <span key={`${s.key}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white pl-1.5 pr-1 py-0.5">
          <span className="text-[10px] font-bold text-blue-600 tabular-nums">{i === 0 ? 'by' : 'then'}</span>
          <select
            value={s.key}
            onChange={e => setKey(i, e.target.value)}
            className="text-xs bg-transparent text-zinc-800 max-w-[150px] focus:outline-none"
          >
            {/* the level's own column plus any not already used */}
            {[...columns.filter(c => c.key === s.key), ...unused].map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => flip(i)}
            title={s.dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
            className="text-zinc-500 hover:text-blue-600"
          >
            {s.dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => remove(i)} title="Remove this level" className="text-zinc-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      ))}

      {unused.length > 0 && (
        <select
          value=""
          onChange={e => e.target.value && setSorts([...sorts, { key: e.target.value, dir: 'desc' }])}
          className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700"
        >
          <option value="">+ Add level…</option>
          {unused.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      )}

      {sorts.length > 0 && (
        <button onClick={() => setSorts([])} className="text-xs text-blue-600 hover:text-blue-500 font-medium">
          Clear sorting
        </button>
      )}
      {sorts.length > 1 && (
        <span className="text-[11px] text-zinc-500">
          Applied in order — shift-click a column header to add it as a level
        </span>
      )}
    </div>
  )
}

// Shared sortable column header: shows its position when several levels are active.
export function SortableTh({ label, k, sorts, onSort }: {
  label: string
  k?: string
  sorts: SortLevel[]
  onSort: (key: string, additive: boolean) => void
}) {
  const at = k ? sorts.findIndex(s => s.key === k) : -1
  const level = at === -1 ? null : sorts[at]
  return (
    <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">
      {k ? (
        <button
          onClick={e => onSort(k, e.shiftKey)}
          title="Click to sort · shift-click to add as another level"
          className="inline-flex items-center gap-1 hover:text-zinc-900"
        >
          {label}
          {level ? (
            <span className="inline-flex items-center gap-0.5 text-blue-600">
              {level.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {sorts.length > 1 && <span className="text-[9px] font-bold tabular-nums">{at + 1}</span>}
            </span>
          ) : (
            <ArrowUpDown className="w-3 h-3 text-zinc-400" />
          )}
        </button>
      ) : label}
    </th>
  )
}
