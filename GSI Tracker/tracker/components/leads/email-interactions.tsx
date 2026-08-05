'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpDown, FileUp, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { useLeadTracking, TrackCells, TrackCellHeaders, type Tracking } from './track-cells'

// Email Interactions dashboard: upload CSVs of contacts (email, name, company,
// book-a-demo click date, optional channel statuses). Rows persist forever;
// re-uploads merge by email. Statuses use the same dropdown system as the
// HubSpot dashboard, keyed `email:<address>`.

type EmailLead = {
  id: string; email: string; name: string | null; company: string | null
  demo_click_date: string | null; extra: Record<string, string>
  source_file: string | null; uploaded_at: string
}

// Canonical CSV format — keep in sync with the Download Sample button
const SAMPLE_HEADERS = ['Email', 'Name', 'Company', 'Book a Demo Date', 'LinkedIn Status', 'WhatsApp Status', 'Email Status']
const SAMPLE_ROWS = [
  ['jane.doe@accenture.com', 'Jane Doe', 'Accenture', '2026-08-01', 'Connection request sent', 'Message sent', 'Email 1 sent'],
  ['ken.tanaka@fujitsu.com', 'Ken Tanaka', 'Fujitsu', '2026-08-03', '', '', ''],
]
const CANONICAL = ['email', 'name', 'firstname', 'first', 'lastname', 'last', 'contact', 'company', 'account', 'organisation', 'organization', 'demo', 'bookademo', 'bookdemo', 'clickdate', 'date', 'linkedin', 'whatsapp', 'wa', 'emailsent', 'emailstatus', 'emailstage']

function downloadSample() {
  const csv = [SAMPLE_HEADERS.join(','), ...SAMPLE_ROWS.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'email-interactions-sample.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function pickField(row: Record<string, string>, aliases: string[]): string {
  for (const key of Object.keys(row)) {
    const n = norm(key)
    if (aliases.some(a => n.includes(a))) {
      const v = String(row[key] ?? '').trim()
      if (v) return v
    }
  }
  return ''
}

function parseDateOnly(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  if (isNaN(d.getTime())) return null
  return format(d, 'yyyy-MM-dd')
}

// Optional status columns in the CSV seed the shared tracking dropdowns
function statusesFromRow(row: Record<string, string>): Partial<Tracking> {
  const out: Partial<Tracking> = {}
  const li = pickField(row, ['linkedin']).toLowerCase()
  if (li) {
    if (/m(sg|essage)?\s*2|2/.test(li)) out.li_stage = 'm2'
    else if (/m(sg|essage)?\s*1|1/.test(li)) out.li_stage = 'm1'
    else if (/conn|request|yes|true|sent/.test(li)) out.li_stage = 'conn'
  }
  const wa = pickField(row, ['whatsapp', 'wa']).toLowerCase()
  if (wa) {
    if (/not.*demo/.test(wa)) out.wa_status = 'not_demo'
    else if (/yes|true|sent/.test(wa)) out.wa_status = 'sent'
    else if (/no|false/.test(wa)) out.wa_status = 'not_sent'
  }
  const em = pickField(row, ['emailsent', 'emailstatus', 'emailstage']).toLowerCase()
  if (em) {
    if (/3/.test(em)) out.email_stage = 'e3'
    else if (/2/.test(em)) out.email_stage = 'e2'
    else if (/1|yes|true|sent/.test(em)) out.email_stage = 'e1'
  }
  return out
}

export function EmailInteractions() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const { byRef, save } = useLeadTracking()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const { data: rows, isLoading } = useQuery({
    queryKey: ['emailLeads'],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_leads').select('*').order('demo_click_date', { ascending: false })
      if (error) throw error
      return data as EmailLead[]
    },
  })

  const importFiles = async (files: FileList) => {
    setImporting(true)
    let ok = 0, skipped = 0
    try {
      for (const file of Array.from(files)) {
        const text = await file.text()
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
        for (const row of parsed.data) {
          const email = pickField(row, ['email']).toLowerCase()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { skipped++; continue }
          const name = pickField(row, ['name', 'contact']) ||
            [pickField(row, ['firstname', 'first']), pickField(row, ['lastname', 'last'])].filter(Boolean).join(' ')
          const company = pickField(row, ['company', 'account', 'organisation', 'organization'])
          const demoDate = parseDateOnly(pickField(row, ['demo', 'bookademo', 'bookdemo', 'clickdate', 'date']))
          // Preserve every non-canonical column verbatim for display
          const extra: Record<string, string> = {}
          for (const key of Object.keys(row)) {
            const n = norm(key)
            if (!CANONICAL.some(c => n.includes(c)) && String(row[key] ?? '').trim()) {
              extra[key.trim()] = String(row[key]).trim()
            }
          }
          const { error } = await supabase.from('email_leads').upsert({
            email,
            ...(name ? { name } : {}),
            ...(company ? { company } : {}),
            ...(demoDate ? { demo_click_date: demoDate } : {}),
            ...(Object.keys(extra).length ? { extra } : {}),
            source_file: file.name,
            uploaded_by: me?.id,
            uploaded_at: new Date().toISOString(),
          }, { onConflict: 'email' })
          if (error) { skipped++; continue }
          ok++
          const seeded = statusesFromRow(row)
          if (Object.keys(seeded).length) await save(`email:${email}`, seeded)
        }
      }
      queryClient.invalidateQueries({ queryKey: ['emailLeads'] })
      toast.success(`Imported/updated ${ok} contact${ok === 1 ? '' : 's'}${skipped ? ` · ${skipped} rows skipped (no valid email)` : ''}`)
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

  // --- date range on the book-a-demo click date ---
  const [range, setRange] = useState<'all' | 'month' | 'custom'>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const filtered = useMemo(() => {
    let arr = rows || []
    if (range === 'month') {
      const start = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
      arr = arr.filter(r => r.demo_click_date && r.demo_click_date >= start)
    } else if (range === 'custom') {
      if (customFrom) arr = arr.filter(r => r.demo_click_date && r.demo_click_date >= customFrom)
      if (customTo) arr = arr.filter(r => r.demo_click_date && r.demo_click_date <= customTo)
    }
    return arr
  }, [rows, range, customFrom, customTo])

  // --- sorting ---
  const [sortKey, setSortKey] = useState<'demo_click_date' | 'name' | 'company'>('demo_click_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = String(a[sortKey] || '').toLowerCase()
      const vb = String(b[sortKey] || '').toLowerCase()
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  // Union of extra-column names across visible rows, in first-seen order
  const extraCols = useMemo(() => {
    const cols: string[] = []
    for (const r of sorted) for (const key of Object.keys(r.extra || {})) if (!cols.includes(key)) cols.push(key)
    return cols
  }, [sorted])

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
          <option value="month">This month (demo date)</option>
          <option value="custom">Custom range (demo date)…</option>
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

      {/* Table */}
      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <p className="text-center text-sm text-zinc-500 py-14">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-14">
              {rows?.length ? 'Nothing in this date range.' : 'No contacts yet — upload one or more CSVs (columns: email, name, company, book-a-demo date; LinkedIn/WhatsApp/email status columns are picked up too).'}
            </p>
          ) : (
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <Th label="Contact" k="name" />
                  <Th label="Company" k="company" />
                  <Th label="Book-a-demo date" k="demo_click_date" />
                  {extraCols.map(c => <Th key={c} label={c} />)}
                  <Th label="From file" />
                  <TrackCellHeaders />
                  <Th label="" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map(lead => (
                  <tr key={lead.id} className="hover:bg-zinc-50">
                    <td className="py-2 px-3">
                      <p className="font-medium text-zinc-800">{lead.name || '—'}</p>
                      <p className="text-[10px] text-zinc-500">{lead.email}</p>
                    </td>
                    <td className="py-2 px-3 text-zinc-700">{lead.company || '—'}</td>
                    <td className="py-2 px-3 text-zinc-600 whitespace-nowrap">
                      {lead.demo_click_date ? format(new Date(lead.demo_click_date), 'd MMM yyyy') : '—'}
                    </td>
                    {extraCols.map(c => (
                      <td key={c} className="py-2 px-3 text-zinc-600 max-w-[140px] truncate" title={(lead.extra || {})[c] || ''}>
                        {(lead.extra || {})[c] || '—'}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-zinc-400 max-w-[120px] truncate" title={lead.source_file || ''}>
                      {lead.source_file || '—'}
                    </td>
                    <TrackCells refId={`email:${lead.email}`} byRef={byRef} save={save} />
                    <td className="py-2 px-3">
                      <button onClick={() => removeLead(lead)} className="text-zinc-300 hover:text-red-600" title="Remove contact">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="text-[11px] text-zinc-500">
        Standard format (see Sample CSV): Email · Name · Company · Book a Demo Date · LinkedIn Status ·
        WhatsApp Status · Email Status. Any additional columns in your CSV are shown as extra columns.
        Statuses share the same system as the HubSpot dashboard. Re-uploading a CSV updates existing
        contacts (matched by email) without losing their saved statuses.
      </p>
    </div>
  )
}
