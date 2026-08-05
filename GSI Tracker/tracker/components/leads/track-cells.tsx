'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { toast } from 'sonner'

// Shared outreach-status system for BOTH lead dashboards (HubSpot + CSV).
// ref_id = HubSpot contact id, or `email:<address>` for CSV leads.
// Saved in OUR database only — never written back to HubSpot.

export type Tracking = {
  ref_id: string
  email_stage: 'e1' | 'e2' | 'e3' | null
  call_status: 'yes' | 'no' | 'declined' | 'no_response' | 'scheduled' | 'done' | 'no_show' | null
  li_stage: 'conn' | 'm1' | 'm2' | null
  wa_status: 'sent' | 'not_demo' | null
}

export const EMPTY_TRACKING = (ref: string): Tracking => ({
  ref_id: ref, email_stage: null, call_status: null, li_stage: null, wa_status: null,
})

export const STAGE_OPTIONS = {
  email_stage: [
    { v: '', label: '—' },
    { v: 'e1', label: 'Email 1 sent' },
    { v: 'e2', label: 'Email 2 sent' },
    { v: 'e3', label: 'Email 3 sent' },
  ],
  call_status: [
    { v: '', label: '—' },
    { v: 'yes', label: 'Yes' },
    { v: 'no', label: 'No' },
    { v: 'declined', label: 'Declined' },
    { v: 'no_response', label: 'No response' },
    { v: 'scheduled', label: 'Call scheduled' },
    { v: 'done', label: 'Call done' },
    { v: 'no_show', label: 'Call no-show' },
  ],
  li_stage: [
    { v: '', label: '—' },
    { v: 'conn', label: 'Connection request sent' },
    { v: 'm1', label: 'Message 1 sent' },
    { v: 'm2', label: 'Message 2 sent' },
  ],
  wa_status: [
    { v: '', label: '—' },
    { v: 'sent', label: 'Message sent' },
    { v: 'not_demo', label: 'Not a demo lead' },
  ],
} as const

export function useLeadTracking() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()

  const { data: rows } = useQuery({
    queryKey: ['leadTracking'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_tracking').select('*')
      if (error) throw error
      return data as Tracking[]
    },
  })
  const byRef = useMemo(() => new Map((rows || []).map(t => [t.ref_id, t])), [rows])

  const save = async (ref: string, patch: Partial<Tracking>) => {
    const stamp = { updated_by: me?.id, updated_at: new Date().toISOString() }
    const next = { ...(byRef.get(ref) || EMPTY_TRACKING(ref)), ...patch, ...stamp }
    queryClient.setQueryData(['leadTracking'], (old: Tracking[] | undefined) =>
      [...(old || []).filter(t => t.ref_id !== ref), next])
    // Patch-only upsert: on conflict only these columns are updated, so a stale
    // local cache can never null out statuses saved by someone else.
    const { error } = await supabase.from('lead_tracking').upsert({ ref_id: ref, ...patch, ...stamp }, { onConflict: 'ref_id' })
    if (error) {
      toast.error(`Save failed: ${error.message}`)
    }
    queryClient.invalidateQueries({ queryKey: ['leadTracking'] })
  }

  return { byRef, save }
}

export function StageSelect({ refId, field, tracking, save, width = 'w-[150px]' }: {
  refId: string
  field: keyof typeof STAGE_OPTIONS
  tracking: Tracking
  save: (ref: string, patch: Partial<Tracking>) => void
  width?: string
}) {
  return (
    <select
      value={(tracking[field] as string) || ''}
      onChange={e => save(refId, { [field]: e.target.value || null } as Partial<Tracking>)}
      className={`text-[11px] rounded border border-zinc-300 bg-white px-1 py-1 text-zinc-700 ${width}`}
    >
      {STAGE_OPTIONS[field].map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  )
}

// How far along a lead is in one channel — the sort order of the dropdown
// options themselves ('—' = 0, then each stage in sequence).
export function stageRank(field: keyof typeof STAGE_OPTIONS, t?: Tracking): number {
  const v = (t?.[field] as string) || ''
  const idx = (STAGE_OPTIONS[field] as readonly { v: string }[]).findIndex(o => o.v === v)
  return idx < 0 ? 0 : idx
}

export const TRACK_COLUMNS: { label: string; field: keyof typeof STAGE_OPTIONS }[] = [
  { label: 'Email sent', field: 'email_stage' },
  { label: 'Call booked', field: 'call_status' },
  { label: 'LinkedIn', field: 'li_stage' },
  { label: 'WhatsApp', field: 'wa_status' },
]

// Table cells shared by both dashboards. Pass renderTh to make the four
// outreach columns sortable using the caller's own header component.
export function TrackCellHeaders({ renderTh }: {
  renderTh?: (label: string, field: keyof typeof STAGE_OPTIONS) => ReactNode
}) {
  return (
    <>
      {TRACK_COLUMNS.map(({ label, field }) =>
        renderTh
          ? <Fragment key={field}>{renderTh(label, field)}</Fragment>
          : <th key={field} className="text-left font-medium py-2.5 px-3 whitespace-nowrap">{label}</th>
      )}
    </>
  )
}

export function TrackCells({ refId, byRef, save }: {
  refId: string
  byRef: Map<string, Tracking>
  save: (ref: string, patch: Partial<Tracking>) => void
}) {
  const t = byRef.get(refId) || EMPTY_TRACKING(refId)
  return (
    <>
      <td className="py-2 px-3"><StageSelect refId={refId} field="email_stage" tracking={t} save={save} width="w-[120px]" /></td>
      <td className="py-2 px-3"><StageSelect refId={refId} field="call_status" tracking={t} save={save} width="w-[130px]" /></td>
      <td className="py-2 px-3"><StageSelect refId={refId} field="li_stage" tracking={t} save={save} width="w-[170px]" /></td>
      <td className="py-2 px-3"><StageSelect refId={refId} field="wa_status" tracking={t} save={save} width="w-[160px]" /></td>
    </>
  )
}
