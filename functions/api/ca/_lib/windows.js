// Demographics export windows must never double count. LinkedIn exports one dimension per file
// for a date window; if the same window (or an overlapping one) of the same breakdown and tag
// is uploaded more than once, only the most recent upload covers those dates.
//
// activeWindows(uploads) -> the uploads to count, newest wins on overlap, 0-row uploads skipped.
// Group = platform + notes (notes holds the segments and the optional "(tag)", e.g. "Company (Anju)").
export function activeWindows(uploads) {
  const list = (uploads || []).filter((u) => u && u.kind === 'demographics' && u.period_start && u.period_end && (u.row_count == null || u.row_count > 0))
  const byGroup = new Map()
  for (const u of list) { const k = `${u.platform || 'linkedin'}|${u.notes || ''}`; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(u) }
  const keep = []
  for (const group of byGroup.values()) {
    group.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : 0))
    const kept = []
    for (const u of group) {
      const clash = kept.some((k) => u.period_start <= k.period_end && k.period_start <= u.period_end)
      if (!clash) kept.push(u)
    }
    keep.push(...kept)
  }
  const ids = new Set(keep.map((u) => u.id))
  return (uploads || []).filter((u) => ids.has(u.id))
}
