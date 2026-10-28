import { addDays, format, nextDay, startOfDay, type Day } from 'date-fns'
import type { TaskPriority } from './types/database'

// One-line task capture: "Send ICP sequence @priya #instantly !p1 fri".
// Pure parsing, no React or Supabase: unit-tested in quick-add.test.ts.
//
//   @name      owner (first one is the main owner); email prefix or first name
//   #channel   channel, by slug or name prefix
//   !p0..!p4   priority (also !urgent !high !medium !low)
//   dates      today, tomorrow, mon..sun, next week, eow, in 3 days, 12 nov,
//              nov 12. Only taken from the END of the line or right after
//              "by" / "due" / "on", so "Monday newsletter" stays a title.

export interface QuickAddParse {
  title: string
  owners: string[]
  channel: string | null
  priority: TaskPriority | null
  dueDate: string | null
  dueLabel: string | null
}

const PRIORITY_WORDS: Record<string, TaskPriority> = {
  p0: 'P0', p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4',
  urgent: 'P0', critical: 'P0', high: 'P1', medium: 'P2', low: 'P3', backlog: 'P4',
}

const WEEKDAYS: Record<string, Day> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

const ISO = 'yyyy-MM-dd'

// Reads a date phrase from the start of `words`. Returns the date and how many
// words it used, or null.
function readDate(words: string[], today: Date): { date: Date; used: number } | null {
  const w = words.map(x => x.toLowerCase().replace(/[,.]$/, ''))
  const [a, b, c] = w
  if (!a) return null
  if (a === 'today' || a === 'tod') return { date: today, used: 1 }
  if (a === 'tomorrow' || a === 'tmrw' || a === 'tmr') return { date: addDays(today, 1), used: 1 }
  if (a === 'eow') return { date: today.getDay() === 5 ? today : nextDay(today, 5), used: 1 }
  if (a === 'next' && b === 'week') return { date: nextDay(today, 1), used: 2 }
  if (a === 'next' && b && b in WEEKDAYS) return { date: addDays(nextDay(today, WEEKDAYS[b]), 7), used: 2 }
  if (a in WEEKDAYS) return { date: nextDay(today, WEEKDAYS[a]), used: 1 }
  if (a === 'in' && b && /^\d+$/.test(b) && c && /^(day|days|week|weeks)$/.test(c)) {
    const n = Number(b) * (c.startsWith('week') ? 7 : 1)
    return { date: addDays(today, n), used: 3 }
  }
  // 12 nov / 12th nov / nov 12 / nov 12th
  const day = (s?: string) => (s && /^\d{1,2}(st|nd|rd|th)?$/.test(s) ? parseInt(s, 10) : null)
  const month = (s?: string) => (s && s in MONTHS ? MONTHS[s] : null)
  let d: number | null = null, m: number | null = null
  if (day(a) !== null && month(b) !== null) { d = day(a); m = month(b) }
  else if (month(a) !== null && day(b) !== null) { m = month(a); d = day(b) }
  if (d !== null && m !== null && d >= 1 && d <= 31) {
    let date = new Date(today.getFullYear(), m, d)
    if (date.getMonth() !== m) return null
    // A date already past this year means next year ("5 jan" said in November).
    if (date < today) date = new Date(today.getFullYear() + 1, m, d)
    return { date, used: 2 }
  }
  return null
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddParse {
  const today = startOfDay(now)
  const owners: string[] = []
  let channel: string | null = null
  let priority: TaskPriority | null = null
  const kept: string[] = []

  for (const word of input.trim().split(/\s+/).filter(Boolean)) {
    if (/^@[\w.+-]+$/.test(word)) { owners.push(word.slice(1).toLowerCase()); continue }
    if (/^#[\w-]+$/.test(word)) { channel = word.slice(1).toLowerCase(); continue }
    const p = /^!(\w+)$/.exec(word)
    if (p && PRIORITY_WORDS[p[1].toLowerCase()]) { priority = PRIORITY_WORDS[p[1].toLowerCase()]; continue }
    kept.push(word)
  }

  let due: Date | null = null
  // 1) "by / due / on <date>" anywhere.
  for (let i = 0; i < kept.length - 1 && !due; i++) {
    if (!/^(by|due|on)$/i.test(kept[i])) continue
    const hit = readDate(kept.slice(i + 1), today)
    if (hit) { due = hit.date; kept.splice(i, hit.used + 1) }
  }
  // 2) A date phrase that ends the line (try the longest first).
  for (let n = 3; n >= 1 && !due; n--) {
    if (kept.length <= n) continue // never eat the whole title
    const tail = kept.slice(-n)
    const hit = readDate(tail, today)
    if (hit && hit.used === n) { due = hit.date; kept.splice(-n, n) }
  }

  return {
    title: kept.join(' ').trim(),
    owners,
    channel,
    priority,
    dueDate: due ? format(due, ISO) : null,
    dueLabel: due ? format(due, 'EEE d MMM') : null,
  }
}

// Owner token -> email. Matches the email's local part, then a name's first
// word. Ambiguous or unknown tokens return null so the UI can say so.
// `alias` is a person's second address (one person, two emails): it matches
// like their main one but resolves to the main email.
export function resolveOwner(
  token: string,
  people: { email: string; name?: string | null; alias?: string }[],
): string | null {
  const t = token.toLowerCase()
  if (t.includes('@')) {
    const known = people.find(p => p.email.toLowerCase() === t || p.alias?.toLowerCase() === t)
    return known ? known.email.toLowerCase() : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
  }
  const local = (e: string) => e.toLowerCase().split('@')[0]
  const locals = (p: { email: string; alias?: string }) => [p.email, p.alias].filter(Boolean).map(e => local(e!))
  const exact = people.filter(p => locals(p).some(l => l === t || l.split('.')[0] === t))
  const pick = (list: typeof people) => {
    const emails = [...new Set(list.map(p => p.email.toLowerCase()))]
    return emails.length === 1 ? emails[0] : null
  }
  if (exact.length) return pick(exact)
  const byName = people.filter(p => (p.name || '').toLowerCase().split(/\s+/)[0] === t)
  if (byName.length) return pick(byName)
  return pick(people.filter(p => locals(p).some(l => l.startsWith(t))))
}

// Channel token -> channel id. Exact slug or name first, then a unique prefix.
export function resolveChannel<C extends { id: string; slug: string; name: string }>(
  token: string,
  channels: C[],
): C | null {
  const t = token.toLowerCase()
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const exact = channels.filter(c => c.slug === t || norm(c.name) === t)
  if (exact.length) return exact[0]
  const prefix = channels.filter(c => c.slug.startsWith(t) || norm(c.name).startsWith(t))
  return prefix.length === 1 ? prefix[0] : null
}
