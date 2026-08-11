'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, startOfISOWeek, endOfISOWeek, subWeeks, parseISO, isWithinInterval } from 'date-fns'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser, useTasks } from '@/lib/hooks/use-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  FileText, Download, Eye, Loader2, Plus, Trash2, DollarSign, Mail,
  Users as UsersIcon, GitBranch, CheckSquare, Upload,
} from 'lucide-react'
import { buildReportHtml, type ReportData, type DealRow, type EmailsSummary } from '@/lib/report-logic'

// The "Create Weekly Report" builder: assembles done-tasks (tracker + free-
// form), a live HubSpot lead pull, ad spend (manual entry or CSV/XLS
// upload), a live Instantly emails-sent pull (GSI-tagged campaigns), and a
// live HubSpot Deals pipeline into one styled HTML report matching the
// hand-authored reports under repo-root reports/*.html.
//
// Reports are normally written for the week that JUST ended, so the date
// range defaults to "Last week" rather than the week in progress.

type Preset = 'this_week' | 'last_week' | 'two_weeks_ago' | 'custom'

function presetRange(preset: Preset, customFrom: string, customTo: string): { start: Date; end: Date } {
  const now = new Date()
  if (preset === 'this_week') return { start: startOfISOWeek(now), end: endOfISOWeek(now) }
  if (preset === 'two_weeks_ago') return { start: startOfISOWeek(subWeeks(now, 2)), end: endOfISOWeek(subWeeks(now, 2)) }
  if (preset === 'custom' && customFrom && customTo) return { start: parseISO(customFrom), end: parseISO(customTo) }
  return { start: startOfISOWeek(subWeeks(now, 1)), end: endOfISOWeek(subWeeks(now, 1)) } // last_week (default)
}

export function ReportBuilder() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const { data: allTasks } = useTasks()

  // ---------- date range: presets + custom, defaults to last week ----------
  const [preset, setPreset] = useState<Preset>('last_week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => presetRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )
  const rangeKeyStart = format(rangeStart, 'yyyy-MM-dd')
  const rangeKeyEnd = format(rangeEnd, 'yyyy-MM-dd')
  const rangeLabel = `${format(rangeStart, 'd MMM')} – ${format(rangeEnd, 'd MMM yyyy')}`

  // Any pulled/entered data is scoped to a specific range — reset it the
  // moment the range changes so a stale pull can never get baked into the
  // wrong week's report.
  const [leads, setLeads] = useState<PulledLead[] | null>(null)
  const [emailData, setEmailData] = useState<EmailsSummary | null>(null)
  const [pipeline, setPipeline] = useState<DealRow[] | null>(null)
  const [pipelineNote, setPipelineNote] = useState('')
  const resetPulls = () => { setLeads(null); setEmailData(null); setPipeline(null); setPipelineNote('') }
  const changeRange = (next: Preset) => { setPreset(next); resetPulls() }

  // ---------- done this week: real completed tracker tasks in range ----------
  const trackerDone = useMemo(() => {
    if (!allTasks) return []
    return allTasks
      .filter(t => t.completed_at && isWithinInterval(parseISO(t.completed_at), { start: rangeStart, end: rangeEnd }))
      .map(t => ({ title: t.title, channel: t.channel?.name || null }))
  }, [allTasks, rangeStart, rangeEnd])

  // ---------- custom "done" items (report-only — never a tasks row) ----------
  const { data: customDone } = useQuery({
    queryKey: ['reportDoneItems', rangeKeyStart],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_done_items')
        .select('*').eq('week_starting', rangeKeyStart).order('sort_order')
      if (error) throw error
      return data as { id: string; task_title: string; subtask_title: string | null }[]
    },
  })
  const [taskDraft, setTaskDraft] = useState('')
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const addDoneItem = async () => {
    if (!taskDraft.trim()) return
    const { error } = await supabase.from('report_done_items').insert({
      week_starting: rangeKeyStart,
      task_title: taskDraft.trim(),
      subtask_title: subtaskDraft.trim() || null,
      sort_order: (customDone?.length || 0),
      added_by: me?.id,
    })
    if (error) { toast.error(error.message); return }
    setTaskDraft(''); setSubtaskDraft('')
    queryClient.invalidateQueries({ queryKey: ['reportDoneItems', rangeKeyStart] })
  }
  const removeDoneItem = async (id: string) => {
    await supabase.from('report_done_items').delete().eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['reportDoneItems', rangeKeyStart] })
  }

  // ---------- ad spend: manual entry OR CSV/XLS upload (replaces this week's rows) ----------
  const { data: adRows } = useQuery({
    queryKey: ['reportAdSpend', rangeKeyStart],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_ad_spend')
        .select('*').eq('week_starting', rangeKeyStart).order('created_at')
      if (error) throw error
      return data as { id: string; platform: string; campaign: string | null; spend: number; leads: number | null; notes: string | null }[]
    },
  })
  const [adPlatform, setAdPlatform] = useState('')
  const [adCampaign, setAdCampaign] = useState('')
  const [adSpendVal, setAdSpendVal] = useState('')
  const [adLeads, setAdLeads] = useState('')
  const [adNotes, setAdNotes] = useState('')
  const addAdRow = async () => {
    if (!adPlatform.trim() || !adSpendVal.trim()) { toast.error('Platform and spend are required'); return }
    const { error } = await supabase.from('report_ad_spend').insert({
      week_starting: rangeKeyStart,
      platform: adPlatform.trim(),
      campaign: adCampaign.trim() || null,
      spend: Number(adSpendVal) || 0,
      leads: adLeads.trim() ? Number(adLeads) : null,
      notes: adNotes.trim() || null,
      added_by: me?.id,
    })
    if (error) { toast.error(error.message); return }
    setAdPlatform(''); setAdCampaign(''); setAdSpendVal(''); setAdLeads(''); setAdNotes('')
    queryClient.invalidateQueries({ queryKey: ['reportAdSpend', rangeKeyStart] })
  }
  const removeAdRow = async (id: string) => {
    await supabase.from('report_ad_spend').delete().eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['reportAdSpend', rangeKeyStart] })
  }
  const adTotal = (adRows || []).reduce((s, r) => s + (Number(r.spend) || 0), 0)

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const pickField = (row: Record<string, string>, aliases: string[]): string => {
    for (const key of Object.keys(row)) {
      const n = norm(key)
      if (aliases.some(a => n.includes(a))) {
        const v = String(row[key] ?? '').trim()
        if (v) return v
      }
    }
    return ''
  }
  const adFileRef = useRef<HTMLInputElement>(null)
  const [importingAds, setImportingAds] = useState(false)
  const importAdFile = async (file: File) => {
    setImportingAds(true)
    try {
      let rows: Record<string, string>[] = []
      if (/\.xlsx?$/i.test(file.name)) {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
      } else {
        const text = await file.text()
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
        rows = parsed.data
      }

      const parsedRows = rows.map(row => ({
        platform: pickField(row, ['platform', 'channel', 'network']),
        campaign: pickField(row, ['campaign', 'ad', 'adname', 'adsetname']),
        spend: Number(pickField(row, ['spend', 'cost', 'amountspent', 'budget'])) || 0,
        leadsN: (() => { const v = pickField(row, ['leads', 'conversions', 'results']); return v ? Number(v) || 0 : null })(),
        notes: pickField(row, ['notes', 'note', 'remarks']),
      })).filter(r => r.platform || r.campaign)

      if (!parsedRows.length) { toast.error('No usable rows found — expected columns like Platform, Campaign, Spend, Leads'); return }

      // The file is the source of truth for this week: replace, don't append.
      await supabase.from('report_ad_spend').delete().eq('week_starting', rangeKeyStart)
      const { error } = await supabase.from('report_ad_spend').insert(
        parsedRows.map(r => ({
          week_starting: rangeKeyStart,
          platform: r.platform || 'Unknown',
          campaign: r.campaign || null,
          spend: r.spend,
          leads: r.leadsN,
          notes: r.notes || null,
          added_by: me?.id,
        }))
      )
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['reportAdSpend', rangeKeyStart] })
      toast.success(`Ads data updated from ${file.name} — ${parsedRows.length} rows for ${rangeLabel}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImportingAds(false)
      if (adFileRef.current) adFileRef.current.value = ''
    }
  }

  // ---------- leads pull (live, scoped to the selected range) ----------
  type PulledLead = { id: string; name: string; email: string; company: string; via?: string[] }
  const [pullingLeads, setPullingLeads] = useState(false)
  const pullLeads = async () => {
    setPullingLeads(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in required')
      const merged = new Map<string, PulledLead>()
      let cursor: unknown = null
      let rounds = 0
      do {
        const res = await fetch('/api/hubspot-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            from: rangeKeyStart,
            to: rangeKeyEnd,
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
            cursor,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        for (const l of (data.leads || []) as PulledLead[]) merged.set(l.id || l.email || l.name, l)
        cursor = data.nextCursor ?? null
      } while (cursor && ++rounds < 20)
      setLeads([...merged.values()])
      toast.success(`Pulled ${merged.size} leads for ${rangeLabel}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPullingLeads(false)
    }
  }

  // ---------- emails-sent pull (live, Instantly — GSI-tagged campaigns) ----------
  const [pullingEmails, setPullingEmails] = useState(false)
  const pullEmails = async () => {
    setPullingEmails(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in required')
      const res = await fetch(`/api/instantly-report?start=${rangeKeyStart}&end=${rangeKeyEnd}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setEmailData({
        totalSent: data.totalSent || 0,
        totalOpens: data.totalOpens || 0,
        totalReplies: data.totalReplies || 0,
        totalCampaigns: data.totalCampaigns || 0,
        totalUniqueSends: data.totalUniqueSends || 0,
        rows: data.campaigns || [],
      })
      toast.success(`Pulled ${(data.totalSent || 0).toLocaleString()} emails sent across ${data.totalCampaigns || 0} GSI campaigns for ${rangeLabel}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPullingEmails(false)
    }
  }

  // ---------- pipeline pull (live, HubSpot Deals — resumable, gsi property + company match) ----------
  const [pullingPipeline, setPullingPipeline] = useState(false)
  const pullPipeline = async () => {
    setPullingPipeline(true)
    setPipelineNote('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in required')
      const merged = new Map<string, DealRow>()
      let cursor: unknown = null
      let rounds = 0
      do {
        const res = await fetch('/api/hubspot-deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ cursor }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        for (const d of (data.rows || []) as DealRow[]) {
          const prev = merged.get(d.id)
          if (prev) {
            const via = new Set([...(prev.via || []), ...(d.via || [])])
            merged.set(d.id, { ...d, via: [...via] })
          } else {
            merged.set(d.id, d)
          }
        }
        cursor = data.nextCursor ?? null
        if (cursor) setPipelineNote(`${merged.size} deals so far · matched ${data.progress?.companiesMatched ?? 0} companies…`)
      } while (cursor && ++rounds < 15)
      setPipeline([...merged.values()])
      toast.success(`Pulled ${merged.size} GSI/SI pipeline deals`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPullingPipeline(false)
      setPipelineNote('')
    }
  }

  // ---------- existing generated report for this exact range ----------
  const { data: existingReport } = useQuery({
    queryKey: ['weeklyReport', rangeKeyStart, rangeKeyEnd],
    queryFn: async () => {
      const { data, error } = await supabase.from('weekly_reports')
        .select('id, html, generated_at').eq('week_starting', rangeKeyStart).eq('week_ending', rangeKeyEnd).maybeSingle()
      if (error) throw error
      return data as { id: string; html: string; generated_at: string } | null
    },
  })

  const [generating, setGenerating] = useState(false)
  const readyToGenerate = leads !== null && emailData !== null && pipeline !== null

  const openHtml = (html: string) => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }
  const downloadHtml = (html: string) => {
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gsi-report-${rangeKeyStart}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const createReport = async () => {
    setGenerating(true)
    try {
      const done: ReportData['doneItems'] = [
        ...trackerDone.map(t => ({ title: t.title, subtitle: t.channel, source: 'tracker' as const })),
        ...(customDone || []).map(c => ({ title: c.task_title, subtitle: c.subtask_title, source: 'custom' as const })),
      ]
      const byVia: Record<string, number> = {}
      for (const l of leads || []) for (const v of l.via || ['direct']) byVia[v] = (byVia[v] || 0) + 1

      const data: ReportData = {
        weekLabel: rangeLabel,
        weekStartLabel: format(rangeStart, 'd MMM yyyy'),
        weekEndLabel: format(rangeEnd, 'd MMM yyyy'),
        generatedLabel: format(new Date(), 'd MMM yyyy, h:mm a'),
        doneItems: done,
        leads: {
          total: (leads || []).length,
          byVia,
          rows: (leads || []).map(l => ({ name: l.name, email: l.email, company: l.company, via: l.via || [] })),
        },
        adSpend: { total: adTotal, rows: (adRows || []).map(r => ({ platform: r.platform, campaign: r.campaign, spend: Number(r.spend), leads: r.leads, notes: r.notes })) },
        emails: emailData || { totalSent: 0, totalOpens: 0, totalReplies: 0, totalCampaigns: 0, totalUniqueSends: 0, rows: [] },
        pipeline: pipeline || [],
      }
      const html = buildReportHtml(data)

      const { error } = await supabase.from('weekly_reports').upsert({
        week_starting: rangeKeyStart,
        week_ending: rangeKeyEnd,
        html,
        summary: data as unknown as Record<string, unknown>,
        generated_by: me?.id,
        generated_at: new Date().toISOString(),
      }, { onConflict: 'week_starting,week_ending' })
      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['weeklyReport', rangeKeyStart, rangeKeyEnd] })
      toast.success('Weekly report created')
      openHtml(html)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create report')
    } finally {
      setGenerating(false)
    }
  }

  const pulledCount = [leads, emailData, pipeline].filter(x => x !== null).length

  const PresetBtn = ({ p, label }: { p: Preset; label: string }) => (
    <button
      onClick={() => changeRange(p)}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        preset === p ? 'bg-white shadow text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Card className="bg-white border-zinc-200">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-rose-600" />
            <h3 className="text-base font-semibold text-zinc-900">Weekly Report</h3>
          </div>
          {existingReport && (
            <span className="text-[11px] text-zinc-500">
              Last generated {format(new Date(existingReport.generated_at), 'd MMM, h:mm a')}
            </span>
          )}
        </div>

        {/* Date range: presets + custom */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-zinc-100 border border-zinc-200 rounded-lg p-0.5">
            <PresetBtn p="last_week" label="Last week" />
            <PresetBtn p="this_week" label="This week" />
            <PresetBtn p="two_weeks_ago" label="2 weeks ago" />
            <PresetBtn p="custom" label="Custom" />
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <Input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); resetPulls() }}
                className="h-8 w-36 text-xs bg-white border-zinc-300 text-zinc-800" />
              <span className="text-xs text-zinc-500">to</span>
              <Input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); resetPulls() }}
                className="h-8 w-36 text-xs bg-white border-zinc-300 text-zinc-800" />
            </div>
          )}
          <span className="text-xs font-medium text-zinc-700">{rangeLabel}</span>
        </div>

        {/* Done this week */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5 text-emerald-600" /> Done this week
          </p>
          <p className="text-[11px] text-zinc-500">
            {trackerDone.length} completed tracker task{trackerDone.length === 1 ? '' : 's'} are pulled in automatically.
            Add anything else that got done but doesn&apos;t belong on the tracker board — these are report-only and never create a real task.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(customDone || []).map(c => (
              <span key={c.id} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700">
                {c.task_title}{c.subtask_title ? ` — ${c.subtask_title}` : ''}
                <button onClick={() => removeDoneItem(c.id)} className="text-zinc-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={taskDraft} onChange={e => setTaskDraft(e.target.value)} placeholder="Task" onKeyDown={e => e.key === 'Enter' && addDoneItem()}
              className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-48" />
            <Input value={subtaskDraft} onChange={e => setSubtaskDraft(e.target.value)} placeholder="Subtask (optional)" onKeyDown={e => e.key === 'Enter' && addDoneItem()}
              className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-48" />
            <Button size="sm" onClick={addDoneItem} disabled={!taskDraft.trim()} className="h-8 bg-zinc-800 hover:bg-zinc-700 text-white text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
        </section>

        {/* Leads */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <UsersIcon className="w-3.5 h-3.5 text-blue-600" /> Total leads brought in
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={pullLeads} disabled={pullingLeads} className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs">
              {pullingLeads ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <UsersIcon className="w-3.5 h-3.5 mr-1.5" />}
              Pull leads for {rangeLabel}
            </Button>
            {leads !== null && <span className="text-xs text-zinc-600">{leads.length} leads</span>}
          </div>
        </section>

        {/* Ad spend */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-amber-600" /> Ads spend & data
          </p>
          <p className="text-[11px] text-zinc-500">No ads-platform is connected, so this comes from you — upload the downloaded CSV/XLS report (columns are matched by name automatically) or add rows by hand. Uploading replaces this week&apos;s ad data.</p>
          {(adRows || []).length > 0 && (
            <div className="rounded-md border border-zinc-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="bg-zinc-50 text-zinc-500"><th className="text-left px-2 py-1.5">Platform</th><th className="text-left px-2 py-1.5">Campaign</th><th className="text-left px-2 py-1.5">Spend</th><th className="text-left px-2 py-1.5">Leads</th><th /></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {(adRows || []).map(r => (
                    <tr key={r.id}>
                      <td className="px-2 py-1.5">{r.platform}</td>
                      <td className="px-2 py-1.5">{r.campaign || '—'}</td>
                      <td className="px-2 py-1.5">${Number(r.spend).toLocaleString()}</td>
                      <td className="px-2 py-1.5">{r.leads ?? '—'}</td>
                      <td className="px-2 py-1.5"><button onClick={() => removeAdRow(r.id)} className="text-zinc-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={adFileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => e.target.files?.[0] && importAdFile(e.target.files[0])} />
            <Button size="sm" onClick={() => adFileRef.current?.click()} disabled={importingAds}
              className="h-8 bg-amber-600 hover:bg-amber-500 text-white text-xs">
              {importingAds ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
              Upload CSV/XLS
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={adPlatform} onChange={e => setAdPlatform(e.target.value)} placeholder="Platform (e.g. LinkedIn)" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-36" />
            <Input value={adCampaign} onChange={e => setAdCampaign(e.target.value)} placeholder="Campaign" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-36" />
            <Input type="number" value={adSpendVal} onChange={e => setAdSpendVal(e.target.value)} placeholder="Spend $" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-24" />
            <Input type="number" value={adLeads} onChange={e => setAdLeads(e.target.value)} placeholder="Leads" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-20" />
            <Input value={adNotes} onChange={e => setAdNotes(e.target.value)} placeholder="Notes" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-32" />
            <Button size="sm" onClick={addAdRow} className="h-8 bg-zinc-800 hover:bg-zinc-700 text-white text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add row
            </Button>
          </div>
        </section>

        {/* Emails sent */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-emerald-600" /> Total emails sent
          </p>
          <p className="text-[11px] text-zinc-500">Scoped to campaigns tagged &quot;GSI&quot; in Instantly.</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={pullEmails} disabled={pullingEmails} className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
              {pullingEmails ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1.5" />}
              Pull emails for {rangeLabel}
            </Button>
            {emailData !== null && (
              <span className="text-xs text-zinc-600">
                {emailData.totalSent.toLocaleString()} sent · {emailData.totalUniqueSends.toLocaleString()} unique · {emailData.totalOpens.toLocaleString()} opens · {emailData.totalReplies.toLocaleString()} replies · {emailData.totalCampaigns} campaigns
              </span>
            )}
          </div>
        </section>

        {/* Pipeline */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-rose-600" /> GSI / SI pipeline widget
          </p>
          <p className="text-[11px] text-zinc-500">Every open/won/lost deal tagged &quot;GSI&quot; or associated with a company on the target list — a live snapshot, not scoped to the date range above.</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={pullPipeline} disabled={pullingPipeline} className="h-8 bg-rose-600 hover:bg-rose-500 text-white text-xs">
              {pullingPipeline ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5 mr-1.5" />}
              Pull pipeline from HubSpot
            </Button>
            {pullingPipeline && pipelineNote && <span className="text-[11px] text-zinc-600 font-medium">{pipelineNote}</span>}
            {pipeline !== null && <span className="text-xs text-zinc-600">{pipeline.length} GSI/SI deals</span>}
          </div>
        </section>

        {/* Generate */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-zinc-100">
          <Button onClick={createReport} disabled={!readyToGenerate || generating} className="h-9 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium">
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            Create Weekly Report
          </Button>
          {existingReport && (
            <>
              <Button variant="outline" size="sm" onClick={() => openHtml(existingReport.html)} className="h-9 text-xs border-zinc-300">
                <Eye className="w-3.5 h-3.5 mr-1.5" /> View
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadHtml(existingReport.html)} className="h-9 text-xs border-zinc-300">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Download .html
              </Button>
            </>
          )}
          {!readyToGenerate && (
            <span className="text-[11px] text-zinc-500">Pull leads, emails and pipeline above first ({pulledCount}/3 done) — ad spend and custom done-items are optional.</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
