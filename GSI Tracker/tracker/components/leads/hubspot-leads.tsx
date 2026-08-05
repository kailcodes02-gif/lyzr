'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Building2, Download, Filter, Loader2, Plus, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { format, startOfWeek, startOfMonth } from 'date-fns'
import { useLeadTracking, TrackCells, TrackCellHeaders } from './track-cells'

// READ-ONLY pull from HubSpot via the Pages Function (token stays server-side).
// The pull rule (built into the server): ~90 GSI/SI companies + leads owned by
// the 5 GSI owner emails + anything with "GSI" in source/searchable properties.

type Lead = {
  id: string; name: string; email: string; company: string; source: string
  created: string; status: string; lifecycle: string; lastActivity: string; owner: string
  leadScore?: string | number; scoreCategory?: string
  leadSource?: string; sourceCategory?: string
  via?: string[]
}

// Lead Score Category (Lead Scoring Agent) → chip color
function scoreChipClass(cat: string) {
  const c = cat.toLowerCase()
  if (c.includes('high') || c.includes('hot')) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (c.includes('med') || c.includes('warm')) return 'bg-amber-50 text-amber-700 border-amber-200'
  if (c.includes('low') || c.includes('cold')) return 'bg-zinc-100 text-zinc-600 border-zinc-200'
  return 'bg-blue-50 text-blue-700 border-blue-200'
}

export function HubSpotLeads() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const { byRef, save } = useLeadTracking()

  // --- extra companies (stored in our DB, extend the built-in rule) ---
  const { data: companies, error: companiesError } = useQuery({
    queryKey: ['leadCompanies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_companies').select('*').order('name')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })
  const [newCompany, setNewCompany] = useState('')

  const addCompany = async () => {
    const name = newCompany.trim()
    if (!name) return
    const { error } = await supabase.from('lead_companies').insert({ name, added_by: me?.id })
    if (error) toast.error(error.message.includes('duplicate') ? 'Already in the list' : error.message)
    else { setNewCompany(''); queryClient.invalidateQueries({ queryKey: ['leadCompanies'] }) }
  }
  const removeCompany = async (id: string) => {
    await supabase.from('lead_companies').delete().eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['leadCompanies'] })
  }

  // --- date range + pull ---
  const [range, setRange] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [pulling, setPulling] = useState(false)
  const [pulledAt, setPulledAt] = useState<string | null>(null)

  const rangeDates = (): { from?: string; to?: string } => {
    const today = new Date()
    if (range === 'today') return { from: format(today, 'yyyy-MM-dd') }
    if (range === 'week') return { from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
    if (range === 'month') return { from: format(startOfMonth(today), 'yyyy-MM-dd') }
    if (range === 'custom') return { from: customFrom || undefined, to: customTo || undefined }
    return {}
  }

  const pull = async () => {
    setPulling(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in required')
      const res = await fetch('/api/hubspot-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ extraCompanies: (companies || []).map(c => c.name), ...rangeDates() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setLeads(data.leads || [])
      setPulledAt(new Date().toLocaleTimeString())
      toast.success(`Pulled ${data.count} leads from HubSpot (read-only)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPulling(false)
    }
  }

  // --- filters (applied to whatever was pulled) ---
  const [fVia, setFVia] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fSource, setFSource] = useState('')
  const [fScoreCat, setFScoreCat] = useState('')
  const [fOwner, setFOwner] = useState('')
  const [fMinScore, setFMinScore] = useState('')
  const [fSearch, setFSearch] = useState('')
  const hasFilters = !!(fVia || fCompany || fSource || fScoreCat || fOwner || fMinScore || fSearch)
  const clearFilters = () => { setFVia(''); setFCompany(''); setFSource(''); setFScoreCat(''); setFOwner(''); setFMinScore(''); setFSearch('') }

  const opts = useMemo(() => {
    const distinct = (get: (l: Lead) => string | number | undefined) =>
      [...new Set(leads.map(get).map(v => String(v ?? '').trim()).filter(Boolean))].sort()
    return {
      companies: distinct(l => l.company),
      sources: distinct(l => l.leadSource),
      scoreCats: distinct(l => l.scoreCategory),
      owners: distinct(l => l.owner),
    }
  }, [leads])

  const filtered = useMemo(() => leads.filter(l => {
    if (fVia && !(l.via || []).includes(fVia)) return false
    if (fCompany && (l.company || '').trim() !== fCompany) return false
    if (fSource && (l.leadSource || '').trim() !== fSource) return false
    if (fScoreCat && (l.scoreCategory || '').trim() !== fScoreCat) return false
    if (fOwner && (l.owner || '').trim() !== fOwner) return false
    if (fMinScore && (Number(l.leadScore) || 0) < Number(fMinScore)) return false
    if (fSearch) {
      const q = fSearch.toLowerCase()
      if (![l.name, l.email, l.company, l.leadSource, l.owner].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [leads, fVia, fCompany, fSource, fScoreCat, fOwner, fMinScore, fSearch])

  // --- sorting ---
  type SortKey = 'created' | 'company' | 'name' | 'score' | 'source' | 'owner' | 'activity'
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp: number
      if (sortKey === 'score') {
        cmp = (Number(a.leadScore) || 0) - (Number(b.leadScore) || 0)
      } else {
        const field = sortKey === 'source' ? 'leadSource' : sortKey === 'activity' ? 'lastActivity' : sortKey
        cmp = String(a[field] || '').toLowerCase().localeCompare(String(b[field] || '').toLowerCase())
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const Th = ({ label, k }: { label: string; k?: SortKey }) => (
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
      {/* Companies */}
      <Card className="bg-white border-zinc-200">
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-blue-600" /> Extra companies (on top of the built-in rule)
          </p>
          <p className="text-[11px] text-zinc-500">
            The pull always includes: the built-in ~90 GSI/SI target companies, every lead owned by
            anju · praveen · bharath · kaushik · pooja, and any lead with &quot;GSI&quot; in its source
            properties or searchable text. Add companies here only to extend that rule.
          </p>
          {companiesError && (
            <p className="text-[11px] text-red-600">
              Couldn&apos;t load: {(companiesError as Error).message}. If this mentions a missing
              table, run supabase/migrations/011_lead_tracking.sql in the Supabase SQL Editor.
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {companies?.map(c => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700">
                {c.name}
                <button onClick={() => removeCompany(c.id)} className="text-zinc-400 hover:text-red-600" title="Remove">×</button>
              </span>
            ))}
            {!companies?.length && <span className="text-xs text-zinc-400 italic">None — the built-in rule alone applies</span>}
          </div>
          <div className="flex items-center gap-2">
            <Input value={newCompany} onChange={e => setNewCompany(e.target.value)}
              placeholder="e.g. Slalom" onKeyDown={e => e.key === 'Enter' && addCompany()}
              className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-64" />
            <Button size="sm" onClick={addCompany} disabled={!newCompany.trim()}
              className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Range + pull */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={range} onChange={e => setRange(e.target.value as typeof range)}
          className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-2 text-zinc-700">
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
          <option value="custom">Custom range…</option>
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
        <Button onClick={pull} disabled={pulling} className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 text-xs">
          {pulling ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
          Pull from HubSpot
        </Button>
        {pulledAt && <span className="text-[11px] text-zinc-500">Last pulled {pulledAt} · read-only, nothing is written to HubSpot</span>}
      </div>

      {/* Filters */}
      {leads.length > 0 && (
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600">
              <Filter className="w-3.5 h-3.5 text-blue-600" /> Filter
            </span>
            <Input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="Search name / email / company…"
              className="h-8 w-56 text-xs bg-zinc-50 border-zinc-300 text-zinc-800" />
            <select value={fVia} onChange={e => setFVia(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700">
              <option value="">Via: all</option>
              <option value="company">Via company</option>
              <option value="owner">Via owner</option>
              <option value="gsi">Via GSI</option>
            </select>
            <select value={fCompany} onChange={e => setFCompany(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 max-w-[180px]">
              <option value="">Company: all</option>
              {opts.companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={fSource} onChange={e => setFSource(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 max-w-[170px]">
              <option value="">Lead source: all</option>
              {opts.sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={fScoreCat} onChange={e => setFScoreCat(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700">
              <option value="">Score category: all</option>
              {opts.scoreCats.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={fOwner} onChange={e => setFOwner(e.target.value)}
              className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 max-w-[160px]">
              <option value="">HS owner: all</option>
              {opts.owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <Input type="number" value={fMinScore} onChange={e => setFMinScore(e.target.value)} placeholder="Min score"
              className="h-8 w-24 text-xs bg-zinc-50 border-zinc-300 text-zinc-800" />
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-500 font-medium">Clear ✕</button>
            )}
            <span className="ml-auto text-[11px] text-zinc-500">{sorted.length} of {leads.length} leads</span>
          </CardContent>
        </Card>
      )}

      {/* Leads table */}
      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 overflow-x-auto">
          {sorted.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-14">
              {leads.length ? 'No leads match the current filters.' : 'No leads pulled yet — pick a date range and hit “Pull from HubSpot”. The built-in GSI rule applies automatically.'}
            </p>
          ) : (
            <table className="w-full text-xs min-w-[1500px]">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <Th label="Via" />
                  <Th label="Lead" k="name" />
                  <Th label="Company" k="company" />
                  <Th label="Lead score" k="score" />
                  <Th label="Lead source" k="source" />
                  <Th label="Created" k="created" />
                  <Th label="Status / activity" k="activity" />
                  <Th label="HS owner" k="owner" />
                  <TrackCellHeaders />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map(lead => (
                  <tr key={lead.id} className="hover:bg-zinc-50">
                    <td className="py-2 px-3">
                      <div className="flex flex-col gap-0.5">
                        {(lead.via || []).map(v => (
                          <span key={v} className={`inline-flex w-fit rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                            v === 'company' ? 'bg-blue-50 text-blue-700' : v === 'owner' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                          }`}>{v}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <p className="font-medium text-zinc-800">{lead.name}</p>
                      <p className="text-[10px] text-zinc-500">{lead.email}</p>
                    </td>
                    <td className="py-2 px-3 text-zinc-700">{lead.company}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <p className="font-semibold text-zinc-800">{lead.leadScore !== '' && lead.leadScore != null ? lead.leadScore : '—'}</p>
                      {lead.scoreCategory && (
                        <span className={`inline-flex rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${scoreChipClass(lead.scoreCategory)}`}>
                          {lead.scoreCategory}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-zinc-600 max-w-[150px]">
                      <p className="truncate" title={lead.leadSource}>{lead.leadSource || '—'}</p>
                      {lead.sourceCategory && <p className="text-[10px] text-zinc-400 truncate" title={lead.sourceCategory}>{lead.sourceCategory}</p>}
                    </td>
                    <td className="py-2 px-3 text-zinc-600 whitespace-nowrap">
                      {lead.created ? format(new Date(lead.created), 'd MMM yyyy') : '—'}
                    </td>
                    <td className="py-2 px-3 text-zinc-600 max-w-[130px]">
                      <p className="truncate">{lead.status || lead.lifecycle || '—'}</p>
                      {lead.lastActivity && (
                        <p className="text-[10px] text-zinc-400 truncate">act: {format(new Date(lead.lastActivity), 'd MMM')}</p>
                      )}
                    </td>
                    <td className="py-2 px-3 text-zinc-600">{lead.owner || '—'}</td>
                    <TrackCells refId={lead.id} byRef={byRef} save={save} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {leads.length > 0 && (
        <p className="text-[11px] text-zinc-500">
          Dropdowns save instantly to the tracker&apos;s own database and are shared with the Email
          Interactions dashboard (matched by contact). HubSpot is never written to.
        </p>
      )}
    </div>
  )
}
