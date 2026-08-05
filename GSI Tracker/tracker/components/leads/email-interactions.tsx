'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpDown, ChevronDown, ChevronRight, FileUp, Filter, Loader2, MousePointerClick, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { useLeadTracking, TrackCells, TrackCellHeaders, type Tracking } from './track-cells'

// Email Interactions dashboard: upload the book-a-demo clickers CSV (same format
// every time — see Sample CSV). Rows persist forever; re-uploads merge by email.
// Statuses use the same dropdown system as the HubSpot dashboard, keyed
// `email:<address>`. Click details live in an expandable panel per row.

type EmailLead = {
  id: string; email: string; name: string | null; company: string | null
  demo_click_date: string | null; extra: Record<string, string>
  source_file: string | null; uploaded_at: string
}

// Canonical CSV format — the exact headers of the recurring report.
// Keep in sync with the Download Sample button and the parser below.
const SAMPLE_HEADERS = [
  'Email', 'Company', 'Sequence/Account', 'Book a Demo Clicks',
  'Latest Book a Demo Click Date (IST)', 'All Book a Demo Click Dates (IST)',
  'Other Links Clicked', 'Total Clicks (all links)',
]
const SAMPLE_ROWS = [
  ['jane.doe@tcs.com', 'TCS', 'TCS US July', '3', 'Jul 31, 02:15', 'Jul 30, 09:33; Jul 30, 12:45; Jul 31, 02:15', 'Case Study: NTT Data x2; Lyzr.ai Homepage x1', '6'],
  ['erik.l@bearingpoint.com', 'bearingpoint.com', 'Agent Roadmap ClusterB', '1', 'Jul 29, 03:10', 'Jul 29, 03:10', '', '1'],
]

function downloadSample() {
  const csv = [SAMPLE_HEADERS.join(','), ...SAMPLE_ROWS.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'book-a-demo-clickers-sample.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Classify a header into a known slot, or null → preserved as a generic extra
function classify(header: string):
  | 'email' | 'name' | 'first' | 'last' | 'sequence' | 'company'
  | 'demo_clicks' | 'latest_click' | 'all_clicks' | 'other_links' | 'total_clicks'
  | 'st_linkedin' | 'st_whatsapp' | 'st_email' | null {
  const n = norm(header)
  if (n.includes('email') && (n.includes('status') || n.includes('stage') || n.includes('sent'))) return 'st_email'
  if (n.includes('email')) return 'email'
  if (n.includes('linkedin')) return 'st_linkedin'
  if (n.includes('whatsapp') || n === 'wa') return 'st_whatsapp'
  if (n.includes('sequence')) return 'sequence'
  if (n.includes('company') || n === 'account' || n.includes('organisation') || n.includes('organization')) return 'company'
  if (n.includes('firstname') || n === 'first') return 'first'
  if (n.includes('lastname') || n === 'last') return 'last'
  if (n.includes('name') || n === 'contact') return 'name'
  if (n.includes('otherlink')) return 'other_links'
  if (n.includes('totalclick')) return 'total_clicks'
  if (n.includes('click') && n.includes('date')) return n.includes('all') ? 'all_clicks' : 'latest_click'
  if (n.includes('bookademo') || n.includes('bookdemo')) return n.includes('date') ? 'latest_click' : 'demo_clicks'
  if (n.includes('demodate') || n.includes('clickdate')) return 'latest_click'
  return null
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const pad = (n: number) => String(n).padStart(2, '0')

// Handles the report's "Jul 31, 02:15" style (no year — inferred, never future)
// as well as full dates like "2026-07-31" or "Jul 31, 2026".
function parseClickDate(v: string): string | null {
  if (!v) return null
  const m = v.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/)
  const mon = m ? MONTHS[m[1].slice(0, 3).toLowerCase()] : undefined
  if (m && mon !== undefined) {
    const day = Number(m[2])
    let year = m[3] ? Number(m[3]) : new Date().getFullYear()
    if (!m[3] && new Date(year, mon, day).getTime() > Date.now() + 86400000) year -= 1
    return `${year}-${pad(mon + 1)}-${pad(day)}`
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : format(d, 'yyyy-MM-dd')
}

// Optional status columns in the CSV seed the shared tracking dropdowns
function seedStatuses(li: string, wa: string, em: string): Partial<Tracking> {
  const out: Partial<Tracking> = {}
  const l = li.toLowerCase()
  if (l) {
    if (/m(?:sg|essage)?\s*2\b|^2$/.test(l)) out.li_stage = 'm2'
    else if (/m(?:sg|essage)?\s*1\b|^1$/.test(l)) out.li_stage = 'm1'
    else if (/conn|request|yes|true|sent/.test(l)) out.li_stage = 'conn'
  }
  const w = wa.toLowerCase()
  if (w) {
    if (/not.*demo/.test(w)) out.wa_status = 'not_demo'
    else if (/yes|true|sent/.test(w)) out.wa_status = 'sent'
  }
  const e = em.toLowerCase()
  if (e) {
    if (/e(?:mail)?\s*3\b|^3$/.test(e)) out.email_stage = 'e3'
    else if (/e(?:mail)?\s*2\b|^2$/.test(e)) out.email_stage = 'e2'
    else if (/e(?:mail)?\s*1\b|^1$|yes|true|sent/.test(e)) out.email_stage = 'e1'
  }
  return out
}

const splitList = (v: string) => v.split(';').map(s => s.trim()).filter(Boolean)

// Union semicolon lists, preserving order, deduping exact entries
function unionList(oldV: string, newV: string): string {
  const seen = new Set<string>()
  return [...splitList(oldV), ...splitList(newV)].filter(i => !seen.has(i) && (seen.add(i), true)).join('; ')
}

// "Case Study: NTT Data x13" -> { label, count }
function parseLink(item: string): { label: string; count: number } {
  const m = item.match(/^(.*?)\s+x(\d+)$/)
  return m ? { label: m[1], count: Number(m[2]) } : { label: item, count: 1 }
}

// Union link lists by label; the newer report's count wins on collision
function unionLinks(oldV: string, newV: string): string {
  const map = new Map<string, string>()
  for (const item of splitList(oldV)) map.set(parseLink(item).label, item)
  for (const item of splitList(newV)) map.set(parseLink(item).label, item)
  return [...map.values()].join('; ')
}

export function EmailInteractions() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const { byRef, save } = useLeadTracking()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const { data: rows, isLoading, error: loadError } = useQuery({
    queryKey: ['emailLeads'],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_leads').select('*').order('demo_click_date', { ascending: false })
      if (error) throw error
      return data as EmailLead[]
    },
  })

  const importFiles = async (files: FileList) => {
    setImporting(true)
    let ok = 0, invalid = 0, failed = 0
    let firstError = ''
    try {
      for (const file of Array.from(files)) {
        const text = await file.text()
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })

        // Pass 1: classify every row
        type ParsedRow = {
          email: string; name: string; company: string; demoDate: string | null
          extra: Record<string, string>; seeded: Partial<Tracking>
        }
        const parsedRows: ParsedRow[] = []
        for (const row of parsed.data) {
          const slots: Record<string, string> = {}
          const generic: Record<string, string> = {}
          for (const key of Object.keys(row)) {
            const v = String(row[key] ?? '').trim()
            if (!v) continue
            const slot = classify(key)
            if (slot) { if (!slots[slot]) slots[slot] = v }
            else generic[key.trim()] = v
          }
          const email = (slots.email || '').toLowerCase()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { invalid++; continue }
          parsedRows.push({
            email,
            name: slots.name || [slots.first, slots.last].filter(Boolean).join(' '),
            company: slots.company || '',
            demoDate: parseClickDate(slots.latest_click || ''),
            extra: {
              ...(slots.sequence ? { sequence: slots.sequence } : {}),
              ...(slots.demo_clicks ? { demo_clicks: slots.demo_clicks } : {}),
              ...(slots.latest_click ? { latest_click: slots.latest_click } : {}),
              ...(slots.all_clicks ? { all_clicks: slots.all_clicks } : {}),
              ...(slots.other_links ? { other_links: slots.other_links } : {}),
              ...(slots.total_clicks ? { total_clicks: slots.total_clicks } : {}),
              ...generic,
            },
            seeded: seedStatuses(slots.st_linkedin || '', slots.st_whatsapp || '', slots.st_email || ''),
          })
        }

        // Pass 2: fetch previously saved extras so re-uploads merge click history
        const prevExtra = new Map<string, Record<string, string>>()
        const emails = parsedRows.map(r => r.email)
        for (let i = 0; i < emails.length; i += 200) {
          const { data: prev } = await supabase.from('email_leads')
            .select('email, extra').in('email', emails.slice(i, i + 200))
          for (const r of prev || []) prevExtra.set(r.email, (r.extra || {}) as Record<string, string>)
        }

        for (const pr of parsedRows) {
          const old = prevExtra.get(pr.email) || {}
          const merged = { ...old, ...pr.extra }
          if (old.all_clicks && pr.extra.all_clicks) merged.all_clicks = unionList(old.all_clicks, pr.extra.all_clicks)
          if (old.other_links && pr.extra.other_links) merged.other_links = unionLinks(old.other_links, pr.extra.other_links)
          const { error } = await supabase.from('email_leads').upsert({
            email: pr.email,
            ...(pr.name ? { name: pr.name } : {}),
            ...(pr.company ? { company: pr.company } : {}),
            ...(pr.demoDate ? { demo_click_date: pr.demoDate } : {}),
            ...(Object.keys(merged).length ? { extra: merged } : {}),
            source_file: file.name,
            uploaded_by: me?.id,
            uploaded_at: new Date().toISOString(),
          }, { onConflict: 'email' })
          if (error) { failed++; if (!firstError) firstError = error.message; continue }
          ok++
          if (Object.keys(pr.seeded).length) await save(`email:${pr.email}`, pr.seeded)
        }
      }
      queryClient.invalidateQueries({ queryKey: ['emailLeads'] })
      if (failed) {
        const missingTable = /could not find the table|schema cache/i.test(firstError)
        toast.error(missingTable
          ? 'Nothing saved — the lead tables are missing in Supabase. Run supabase/migrations/011_lead_tracking.sql in the SQL Editor, then re-upload.'
          : `Saved ${ok}, failed ${failed}: ${firstError}`,
          { duration: 12000 })
      } else {
        toast.success(`Imported/updated ${ok} contact${ok === 1 ? '' : 's'}${invalid ? ` · ${invalid} rows skipped (no valid email)` : ''}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeLead = async (lead: EmailLead) => {
    if (!confirm(`Remove ${lead.email} from the dashboard? (Its saved statuses remain if re-imported.)`)) return
    await supabase.from('email_leads').delete().eq('id', lead.id)
    queryClient.invalidateQueries({ queryKey: ['emailLeads'] })
  }

  // --- date range on the latest book-a-demo click date ---
  const [range, setRange] = useState<'all' | 'month' | 'custom'>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // --- filters ---
  const [fCompany, setFCompany] = useState('')
  const [fSequence, setFSequence] = useState('')
  const [fSearch, setFSearch] = useState('')
  const hasFilters = !!(fCompany || fSequence || fSearch)
  const clearFilters = () => { setFCompany(''); setFSequence(''); setFSearch('') }

  const opts = useMemo(() => {
    const distinct = (get: (r: EmailLead) => string | undefined) =>
      [...new Set((rows || []).map(get).map(v => (v || '').trim()).filter(Boolean))].sort()
    return {
      companies: distinct(r => r.company || ''),
      sequences: distinct(r => (r.extra || {}).sequence),
    }
  }, [rows])

  const filtered = useMemo(() => {
    let arr = rows || []
    if (range === 'month') {
      const start = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
      arr = arr.filter(r => r.demo_click_date && r.demo_click_date >= start)
    } else if (range === 'custom') {
      if (customFrom) arr = arr.filter(r => r.demo_click_date && r.demo_click_date >= customFrom)
      if (customTo) arr = arr.filter(r => r.demo_click_date && r.demo_click_date <= customTo)
    }
    if (fCompany) arr = arr.filter(r => (r.company || '').trim() === fCompany)
    if (fSequence) arr = arr.filter(r => ((r.extra || {}).sequence || '').trim() === fSequence)
    if (fSearch) {
      const q = fSearch.toLowerCase()
      arr = arr.filter(r => [r.name, r.email, r.company, (r.extra || {}).sequence].some(v => (v || '').toLowerCase().includes(q)))
    }
    return arr
  }, [rows, range, customFrom, customTo, fCompany, fSequence, fSearch])

  // --- sorting ---
  const [sortKey, setSortKey] = useState<'demo_click_date' | 'company' | 'clicks' | 'total'>('demo_click_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp: number
      if (sortKey === 'clicks' || sortKey === 'total') {
        const field = sortKey === 'clicks' ? 'demo_clicks' : 'total_clicks'
        cmp = (Number((a.extra || {})[field]) || 0) - (Number((b.extra || {})[field]) || 0)
      } else {
        cmp = String(a[sortKey] || '').toLowerCase().localeCompare(String(b[sortKey] || '').toLowerCase())
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggleOpen = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const KNOWN_EXTRAS = ['sequence', 'demo_clicks', 'latest_click', 'all_clicks', 'other_links', 'total_clicks']

  const Th = ({ label, k }: { label: string; k?: typeof sortKey }) => (
    <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">
      {k ? (
        <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-zinc-900">
          {label} <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? 'text-blue-600' : 'text-zinc-400'}`} />
        </button>
      ) : label}
    </th>
  )

  return (
    <div className="space-y-4">
      {loadError && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-3 text-xs text-red-700">
            Couldn&apos;t load saved contacts: {(loadError as Error).message}. If this mentions a
            missing table, run supabase/migrations/011_lead_tracking.sql in the Supabase SQL Editor.
          </CardContent>
        </Card>
      )}
      {/* CSV format reference — always visible */}
      <Card className="bg-blue-50/50 border-blue-200">
        <CardContent className="p-3">
          <p className="text-[11px] font-semibold text-blue-900 uppercase tracking-wider mb-1">CSV format (same every upload)</p>
          <div className="flex flex-wrap gap-1">
            {SAMPLE_HEADERS.map(h => (
              <span key={h} className="rounded bg-white border border-blue-200 px-1.5 py-0.5 text-[10px] font-mono text-blue-800">{h}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Upload + range */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef} type="file" accept=".csv" multiple className="hidden"
          onChange={e => e.target.files?.length && importFiles(e.target.files)}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={importing}
          className="bg-blue-600 hover:bg-blue-500 text-white h-8 text-xs">
          {importing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5 mr-1.5" />}
          Upload CSV(s)
        </Button>
        <Button variant="outline" onClick={downloadSample}
          className="h-8 text-xs border-zinc-300 text-zinc-700 hover:bg-zinc-100">
          Download Sample CSV
        </Button>
        <select value={range} onChange={e => setRange(e.target.value as typeof range)}
          className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-2 text-zinc-700">
          <option value="all">All time</option>
          <option value="month">This month (latest click)</option>
          <option value="custom">Custom range (latest click)…</option>
        </select>
        {range === 'custom' && (
          <>
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="h-8 w-36 text-xs bg-white border-zinc-300 text-zinc-800" />
            <span className="text-xs text-zinc-500">to</span>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="h-8 w-36 text-xs bg-white border-zinc-300 text-zinc-800" />
          </>
        )}
        <span className="text-[11px] text-zinc-500">
          {rows?.length || 0} saved contact{(rows?.length || 0) === 1 ? '' : 's'} · uploads merge by email and are kept forever
        </span>
      </div>

      {/* Filters */}
      {(rows?.length || 0) > 0 && (
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600">
              <Filter className="w-3.5 h-3.5 text-blue-600" /> Filter
            </span>
            <Input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="Search email / company / sequence…"
              className="h-8 w-56 text-xs bg-zinc-50 border-zinc-300 text-zinc-800" />
            <select value={fCompany} onChange={e => setFCompany(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 max-w-[180px]">
              <option value="">Company: all</option>
              {opts.companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={fSequence} onChange={e => setFSequence(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 max-w-[200px]">
              <option value="">Sequence/Account: all</option>
              {opts.sequences.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-500 font-medium">Clear ✕</button>
            )}
            <span className="ml-auto text-[11px] text-zinc-500">{sorted.length} of {rows?.length || 0} contacts</span>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <p className="text-center text-sm text-zinc-500 py-14">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-14">
              {rows?.length ? 'Nothing matches the current filters / date range.' : 'No contacts yet — upload the book-a-demo clickers CSV (Download Sample CSV shows the exact format).'}
            </p>
          ) : (
            <table className="w-full text-xs min-w-[1250px]">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <Th label="" />
                  <Th label="Contact" />
                  <Th label="Company" k="company" />
                  <Th label="Sequence / Account" />
                  <Th label="Demo clicks" k="clicks" />
                  <Th label="Latest click" k="demo_click_date" />
                  <Th label="Total clicks" k="total" />
                  <TrackCellHeaders />
                  <Th label="" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map(lead => {
                  const x = lead.extra || {}
                  const isOpen = open.has(lead.id)
                  const otherExtras = Object.entries(x).filter(([k]) => !KNOWN_EXTRAS.includes(k))
                  return (
                    <Fragment key={lead.id}>
                      <tr className="hover:bg-zinc-50">
                        <td className="py-2 pl-3">
                          <button onClick={() => toggleOpen(lead.id)} className="text-zinc-400 hover:text-blue-600" title="Show click details">
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="py-2 px-3">
                          {lead.name && <p className="font-medium text-zinc-800">{lead.name}</p>}
                          <p className={lead.name ? 'text-[10px] text-zinc-500' : 'font-medium text-zinc-800'}>{lead.email}</p>
                        </td>
                        <td className="py-2 px-3 text-zinc-700">{lead.company || '—'}</td>
                        <td className="py-2 px-3 text-zinc-600 max-w-[160px] truncate" title={x.sequence || ''}>{x.sequence || '—'}</td>
                        <td className="py-2 px-3">
                          {x.demo_clicks ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 font-semibold text-blue-700">
                              <MousePointerClick className="w-3 h-3" /> {x.demo_clicks}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <p className="text-zinc-700">{lead.demo_click_date ? format(new Date(lead.demo_click_date), 'd MMM yyyy') : '—'}</p>
                          {x.latest_click && <p className="text-[10px] text-zinc-500">{x.latest_click} IST</p>}
                        </td>
                        <td className="py-2 px-3 text-zinc-700 font-medium">{x.total_clicks || '—'}</td>
                        <TrackCells refId={`email:${lead.email}`} byRef={byRef} save={save} />
                        <td className="py-2 px-3">
                          <button onClick={() => removeLead(lead)} className="text-zinc-500 hover:text-red-600" title="Remove contact">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-zinc-50/60">
                          <td />
                          <td colSpan={11} className="py-3 px-3 space-y-2.5">
                            {x.all_clicks && (
                              <div>
                                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">All book-a-demo clicks (IST)</p>
                                <div className="flex flex-wrap gap-1">
                                  {splitList(x.all_clicks).map((c, i) => (
                                    <span key={i} className="rounded bg-white border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600">{c}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {x.other_links && (
                              <div>
                                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Other links clicked</p>
                                <div className="flex flex-wrap gap-1">
                                  {splitList(x.other_links).map((item, i) => {
                                    const { label, count } = parseLink(item)
                                    return (
                                      <span key={i} className="inline-flex items-center gap-1 rounded bg-white border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-700">
                                        {label}
                                        {count > 1 && <span className="rounded-full bg-zinc-100 px-1 font-semibold text-zinc-500">×{count}</span>}
                                      </span>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            {otherExtras.length > 0 && (
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {otherExtras.map(([k, v]) => (
                                  <p key={k} className="text-[10px] text-zinc-600"><span className="font-semibold text-zinc-500">{k}:</span> {v}</p>
                                ))}
                              </div>
                            )}
                            {lead.source_file && (
                              <p className="text-[10px] text-zinc-500">From {lead.source_file} · uploaded {format(new Date(lead.uploaded_at), 'd MMM yyyy')}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="text-[11px] text-zinc-500">
        Every column from the CSV is kept: the row shows the key facts, and the arrow expands all
        click dates, other links clicked, and any additional columns. Statuses (Email / Call /
        LinkedIn / WhatsApp) are dashboard-level — shared with the HubSpot dashboard and never lost
        on re-upload (contacts merge by email).
      </p>
    </div>
  )
}
