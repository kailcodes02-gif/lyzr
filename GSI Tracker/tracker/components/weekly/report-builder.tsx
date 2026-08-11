'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  FileText, Download, Eye, Loader2, Plus, Trash2, DollarSign, Mail,
  Users as UsersIcon, GitBranch, CheckSquare,
} from 'lucide-react'
import { buildReportHtml, type ReportData, type DealRow } from '@/lib/report-logic'

// The "Create Weekly Report" builder: assembles done-tasks (tracker + free-
// form), a live HubSpot lead pull, manually entered ad spend (no ads
// platform is connected), a live Instantly emails-sent pull, and a live
// HubSpot Deals pipeline into one styled HTML report matching the
// hand-authored reports under repo-root reports/*.html.

type DoneTrackerItem = { title: string; channel: string | null }

export function ReportBuilder({ weekKey, weekStart, weekEnd, weekLabel, trackerDone }: {
  weekKey: string // yyyy-MM-dd, Monday of the ISO week — matches weekly_snapshots.week_starting
  weekStart: Date
  weekEnd: Date
  weekLabel: string
  trackerDone: DoneTrackerItem[]
}) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()

  // ---------- custom "done" items (report-only — never a tasks row) ----------
  const { data: customDone } = useQuery({
    queryKey: ['reportDoneItems', weekKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_done_items')
        .select('*').eq('week_starting', weekKey).order('sort_order')
      if (error) throw error
      return data as { id: string; task_title: string; subtask_title: string | null }[]
    },
  })
  const [taskDraft, setTaskDraft] = useState('')
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const addDoneItem = async () => {
    if (!taskDraft.trim()) return
    const { error } = await supabase.from('report_done_items').insert({
      week_starting: weekKey,
      task_title: taskDraft.trim(),
      subtask_title: subtaskDraft.trim() || null,
      sort_order: (customDone?.length || 0),
      added_by: me?.id,
    })
    if (error) { toast.error(error.message); return }
    setTaskDraft(''); setSubtaskDraft('')
    queryClient.invalidateQueries({ queryKey: ['reportDoneItems', weekKey] })
  }
  const removeDoneItem = async (id: string) => {
    await supabase.from('report_done_items').delete().eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['reportDoneItems', weekKey] })
  }

  // ---------- ad spend (manual — no ads-platform integration exists) ----------
  const { data: adRows } = useQuery({
    queryKey: ['reportAdSpend', weekKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_ad_spend')
        .select('*').eq('week_starting', weekKey).order('created_at')
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
      week_starting: weekKey,
      platform: adPlatform.trim(),
      campaign: adCampaign.trim() || null,
      spend: Number(adSpendVal) || 0,
      leads: adLeads.trim() ? Number(adLeads) : null,
      notes: adNotes.trim() || null,
      added_by: me?.id,
    })
    if (error) { toast.error(error.message); return }
    setAdPlatform(''); setAdCampaign(''); setAdSpendVal(''); setAdLeads(''); setAdNotes('')
    queryClient.invalidateQueries({ queryKey: ['reportAdSpend', weekKey] })
  }
  const removeAdRow = async (id: string) => {
    await supabase.from('report_ad_spend').delete().eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['reportAdSpend', weekKey] })
  }
  const adTotal = (adRows || []).reduce((s, r) => s + (Number(r.spend) || 0), 0)

  // ---------- leads pull (live, scoped to this week's date range) ----------
  type PulledLead = { name: string; email: string; company: string; via?: string[] }
  const [leads, setLeads] = useState<PulledLead[] | null>(null)
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
            from: format(weekStart, 'yyyy-MM-dd'),
            to: format(weekEnd, 'yyyy-MM-dd'),
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
            cursor,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        for (const l of (data.leads || []) as PulledLead[]) merged.set(l.email || l.name, l)
        cursor = data.nextCursor ?? null
      } while (cursor && ++rounds < 20)
      setLeads([...merged.values()])
      toast.success(`Pulled ${merged.size} leads for ${weekLabel}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPullingLeads(false)
    }
  }

  // ---------- emails-sent pull (live, Instantly) ----------
  type EmailCampaign = { name: string; sent: number; opens: number; replies: number }
  const [emailData, setEmailData] = useState<{ total: number; rows: EmailCampaign[] } | null>(null)
  const [pullingEmails, setPullingEmails] = useState(false)
  const pullEmails = async () => {
    setPullingEmails(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in required')
      const from = format(weekStart, 'yyyy-MM-dd')
      const to = format(weekEnd, 'yyyy-MM-dd')
      const res = await fetch(`/api/instantly-report?start=${from}&end=${to}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setEmailData({ total: data.totalSent || 0, rows: data.campaigns || [] })
      toast.success(`Pulled ${(data.totalSent || 0).toLocaleString()} emails sent for ${weekLabel}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPullingEmails(false)
    }
  }

  // ---------- pipeline pull (live, HubSpot Deals — full pipeline snapshot) ----------
  const [pipeline, setPipeline] = useState<DealRow[] | null>(null)
  const [pullingPipeline, setPullingPipeline] = useState(false)
  const pullPipeline = async () => {
    setPullingPipeline(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in required')
      const res = await fetch('/api/hubspot-deals', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setPipeline(data.rows || [])
      toast.success(`Pulled ${(data.rows || []).length} pipeline deals`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setPullingPipeline(false)
    }
  }

  // ---------- existing generated report for this week ----------
  const { data: existingReport } = useQuery({
    queryKey: ['weeklyReport', weekKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('weekly_reports')
        .select('id, html, generated_at').eq('week_starting', weekKey).maybeSingle()
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
    a.download = `gsi-report-${weekKey}.html`
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
        weekLabel,
        weekStartLabel: format(weekStart, 'd MMM yyyy'),
        weekEndLabel: format(weekEnd, 'd MMM yyyy'),
        generatedLabel: format(new Date(), 'd MMM yyyy, h:mm a'),
        doneItems: done,
        leads: {
          total: (leads || []).length,
          byVia,
          rows: (leads || []).map(l => ({ name: l.name, email: l.email, company: l.company, via: l.via || [] })),
        },
        adSpend: { total: adTotal, rows: (adRows || []).map(r => ({ platform: r.platform, campaign: r.campaign, spend: Number(r.spend), leads: r.leads, notes: r.notes })) },
        emails: emailData || { total: 0, rows: [] },
        pipeline: pipeline || [],
      }
      const html = buildReportHtml(data)

      const { error } = await supabase.from('weekly_reports').upsert({
        week_starting: weekKey,
        week_ending: format(weekEnd, 'yyyy-MM-dd'),
        html,
        summary: data as unknown as Record<string, unknown>,
        generated_by: me?.id,
        generated_at: new Date().toISOString(),
      }, { onConflict: 'week_starting' })
      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['weeklyReport', weekKey] })
      toast.success('Weekly report created')
      openHtml(html)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create report')
    } finally {
      setGenerating(false)
    }
  }

  const pulledCount = [leads, emailData, pipeline].filter(x => x !== null).length

  return (
    <Card className="bg-white border-zinc-200">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-rose-600" />
            <h3 className="text-base font-semibold text-zinc-900">Weekly Report — {weekLabel}</h3>
          </div>
          {existingReport && (
            <span className="text-[11px] text-zinc-500">
              Last generated {format(new Date(existingReport.generated_at), 'd MMM, h:mm a')}
            </span>
          )}
        </div>

        {/* Done this week */}
        <section className="space-y-2">
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
              Pull leads for this week
            </Button>
            {leads !== null && <span className="text-xs text-zinc-600">{leads.length} leads · {format(weekStart, 'd MMM')}–{format(weekEnd, 'd MMM')}</span>}
          </div>
        </section>

        {/* Ad spend */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-amber-600" /> Ads spend & data
          </p>
          <p className="text-[11px] text-zinc-500">No ads-platform is connected yet, so this is entered manually — it&apos;s saved and stays here every time you open this week.</p>
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
            <Input value={adPlatform} onChange={e => setAdPlatform(e.target.value)} placeholder="Platform (e.g. LinkedIn)" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-36" />
            <Input value={adCampaign} onChange={e => setAdCampaign(e.target.value)} placeholder="Campaign" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-36" />
            <Input type="number" value={adSpendVal} onChange={e => setAdSpendVal(e.target.value)} placeholder="Spend $" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-24" />
            <Input type="number" value={adLeads} onChange={e => setAdLeads(e.target.value)} placeholder="Leads" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-20" />
            <Input value={adNotes} onChange={e => setAdNotes(e.target.value)} placeholder="Notes" className="h-8 text-xs bg-zinc-50 border-zinc-300 text-zinc-800 w-32" />
            <Button size="sm" onClick={addAdRow} className="h-8 bg-zinc-800 hover:bg-zinc-700 text-white text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
        </section>

        {/* Emails sent */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-emerald-600" /> Total emails sent
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={pullEmails} disabled={pullingEmails} className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
              {pullingEmails ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1.5" />}
              Pull emails for this week
            </Button>
            {emailData !== null && <span className="text-xs text-zinc-600">{emailData.total.toLocaleString()} sent across {emailData.rows.length} campaigns</span>}
          </div>
        </section>

        {/* Pipeline */}
        <section className="space-y-2 pt-3 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-rose-600" /> GSI / SI pipeline widget
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={pullPipeline} disabled={pullingPipeline} className="h-8 bg-rose-600 hover:bg-rose-500 text-white text-xs">
              {pullingPipeline ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5 mr-1.5" />}
              Pull pipeline from HubSpot
            </Button>
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
