// Demographics export windows must never double count. LinkedIn exports one dimension per file
// for a date window; if the same window (or an overlapping one) of the same breakdown and tag
// is uploaded more than once, only the most recent upload covers those dates.
//
// activeWindows(uploads) -> the uploads to count, newest wins on overlap, 0-row uploads skipped.
// Group = platform + notes (notes holds the segments and the optional "(tag)", e.g. "Company (Anju)").
//
// LinkedIn API windows (file_name 'LinkedIn API', written by linkedin-api/sync) carry other notes than a
// CSV export, so they would sit in their own group and be added on top of a CSV window of the same days.
// Rule: a CSV window always wins. An API window that overlaps any untagged CSV demographics window of the
// same platform is dropped here, whatever its upload time. The sync itself only pulls the days no CSV
// window covers, so this rule only bites when a CSV is uploaded after the API pulled the same month
// (the next sync then re-pulls just the uncovered days).
export const API_FILE = 'LinkedIn API'
export const isApiUpload = (u) => !!u && u.file_name === API_FILE
export const isTagged = (u) => /\(([^)]+)\)\s*$/.test(String((u && u.notes) || ''))

export function activeWindows(uploads) {
  const all = (uploads || []).filter((u) => u && u.kind === 'demographics' && u.period_start && u.period_end && (u.row_count == null || u.row_count > 0))
  const csv = all.filter((u) => !isApiUpload(u) && !isTagged(u))
  const list = all.filter((u) => !isApiUpload(u) || !csv.some((c) => (c.platform || 'linkedin') === (u.platform || 'linkedin') && c.period_start <= u.period_end && u.period_start <= c.period_end))
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
