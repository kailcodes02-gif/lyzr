'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Building2, Download, Loader2, Plus, X, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { format, startOfWeek, startOfMonth } from 'date-fns'

// READ-ONLY pull from HubSpot via the Pages Function (token stays server-side).
// Outreach state (emails/LinkedIn/WhatsApp/call) is saved in OUR database only
// — nothing is ever written back to HubSpot.

type Lead = {
  id: string; name: string; email: string; company: string; source: string
  created: string; status: string; lifecycle: string; lastActivity: string; owner: string
  via?: string[]
}
type Tracking = {
  hubspot_contact_id: string
  email_1_sent: boolean; email_2_sent: boolean; email_3_sent: boolean
  call_status: 'yes' | 'no' | 'declined' | 'no_response' | null
  li_connection_sent: boolean; li_msg_1_sent: boolean; li_msg_2_sent: boolean
  wa_sent: boolean; not_book_demo: boolean
}

const EMPTY_TRACKING = (id: string): Tracking => ({
  hubspot_contact_id: id,
  email_1_sent: false, email_2_sent: false, email_3_sent: false,
  call_status: null,
  li_connection_sent: false, li_msg_1_sent: false, li_msg_2_sent: false,
  wa_sent: false, not_book_demo: false,
})

export function HubSpotLeads() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()

  // --- companies list (stored in our DB) ---
  const { data: companies } = useQuery({
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

  // --- tracking rows (our DB) ---
  const { data: trackingRows } = useQuery({
    queryKey: ['leadTracking'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_tracking').select('*')
      if (error) throw error
      return data as Tracking[]
    },
  })
  const trackingById = useMemo(
    () => new Map((trackingRows || []).map(t => [t.hubspot_contact_id, t])),
    [trackingRows]
  )

  const saveTracking = async (id: string, patch: Partial<Tracking>) => {
    const current = trackingById.get(id) || EMPTY_TRACKING(id)
    const next = { ...current, ...patch, updated_by: me?.id, updated_at: new Date().toISOString() }
    // optimistic
    queryClient.setQueryData(['leadTracking'], (old: Tracking[] | undefined) => {
      const rest = (old || []).filter(t => t.hubspot_contact_id !== id)
      return [...rest, next]
    })
    const { error } = await supabase.from('lead_tracking').upsert(next, { onConflict: 'hubspot_contact_id' })
    if (error) {
      toast.error(`Save failed: ${error.message}`)
      queryClient.invalidateQueries({ queryKey: ['leadTracking'] })
    }
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

  // --- sorting ---
  const [sortKey, setSortKey] = useState<'created' | 'company' | 'name'>('created')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const sorted = useMemo(() => {
    const arr = [...leads]
    arr.sort((a, b) => {
      const va = (a[sortKey] || '').toLowerCase?.() ?? a[sortKey]
      const vb = (b[sortKey] || '').toLowerCase?.() ?? b[sortKey]
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
    return arr
  }, [leads, sortKey, sortDir])

  const toggleSort = (key: 'created' | 'company' | 'name') => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const Th = ({ label, k }: { label: string; k?: 'created' | 'company' | 'name' }) => (
    <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">
      {k ? (
        <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-zinc-900">
          {label} <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? 'text-blue-600' : 'text-zinc-400'}`} />
        </button>
      ) : label}
    </th>
  )

  const Tick = ({ id, field, t }: { id: string; field: keyof Tracking; t: Tracking }) => (
    <Checkbox
      checked={!!t[field]}
      onCheckedChange={c => saveTracking(id, { [field]: !!c } as Partial<Tracking>)}
      className="border-zinc-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 w-3.5 h-3.5"
    />
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
              placeholder="e.g. Accenture" onKeyDown={e => e.key === 'Enter' && addCompany()}
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
        <select value={range} onChange={e => setRange(e.target.value as any)}
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

      {/* Leads table */}
      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 overflow-x-auto">
          {leads.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-14">
              No leads pulled yet — pick a date range and hit “Pull from HubSpot”. The built-in GSI rule applies automatically.
            </p>
          ) : (
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <Th label="Via" />
                  <Th label="Lead" k="name" />
                  <Th label="Company" k="company" />
                  <Th label="Source" />
                  <Th label="Created" k="created" />
                  <Th label="Status / activity" />
                  <Th label="HS owner" />
                  <Th label="Email 1·2·3" />
                  <Th label="Call booked" />
                  <Th label="LinkedIn C·1·2" />
                  <Th label="WA" />
                  <Th label="Not demo" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map(lead => {
                  const t = trackingById.get(lead.id) || EMPTY_TRACKING(lead.id)
                  return (
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
                      <td className="py-2 px-3 text-zinc-600">{lead.source || '—'}</td>
                      <td className="py-2 px-3 text-zinc-600 whitespace-nowrap">
                        {lead.created ? format(new Date(lead.created), 'd MMM yyyy') : '—'}
                      </td>
                      <td className="py-2 px-3 text-zinc-600 max-w-[140px]">
                        <p className="truncate">{lead.status || lead.lifecycle || '—'}</p>
                        {lead.lastActivity && (
                          <p className="text-[10px] text-zinc-400 truncate">
                            act: {format(new Date(lead.lastActivity), 'd MMM')}
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-3 text-zinc-600">{lead.owner || '—'}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <Tick id={lead.id} field="email_1_sent" t={t} />
                          <Tick id={lead.id} field="email_2_sent" t={t} />
                          <Tick id={lead.id} field="email_3_sent" t={t} />
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={t.call_status || ''}
                          onChange={e => saveTracking(lead.id, { call_status: (e.target.value || null) as Tracking['call_status'] })}
                          className="text-[11px] rounded border border-zinc-300 bg-white px-1 py-0.5 text-zinc-700"
                        >
                          <option value="">—</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                          <option value="declined">Declined</option>
                          <option value="no_response">No response</option>
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <Tick id={lead.id} field="li_connection_sent" t={t} />
                          <Tick id={lead.id} field="li_msg_1_sent" t={t} />
                          <Tick id={lead.id} field="li_msg_2_sent" t={t} />
                        </div>
                      </td>
                      <td className="py-2 px-3"><Tick id={lead.id} field="wa_sent" t={t} /></td>
                      <td className="py-2 px-3"><Tick id={lead.id} field="not_book_demo" t={t} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {leads.length > 0 && (
        <p className="text-[11px] text-zinc-500">
          Ticks & call status save instantly to the tracker&apos;s own database. HubSpot is never written to.
          Columns: Email 1·2·3 = sequence sends · LinkedIn C·1·2 = connection request, message 1, message 2 · WA = WhatsApp message sent.
        </p>
      )}
    </div>
  )
}
