'use client'

import { useMemo } from 'react'
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
  call_status: 'yes' | 'no' | 'declined' | 'no_response' | null
  li_stage: 'conn' | 'm1' | 'm2' | null
  wa_status: 'sent' | 'not_sent' | 'not_demo' | null
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
    { v: 'not_sent', label: 'Not sent' },
    { v: 'not_demo', label: 'Not a book-a-demo lead' },
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
    const next = { ...(byRef.get(ref) || EMPTY_TRACKING(ref)), ...patch, updated_by: me?.id, updated_at: new Date().toISOString() }
    queryClient.setQueryData(['leadTracking'], (old: Tracking[] | undefined) =>
      [...(old || []).filter(t => t.ref_id !== ref), next])
    const { error } = await supabase.from('lead_tracking').upsert(next, { onConflict: 'ref_id' })
    if (error) {
      toast.error(`Save failed: ${error.message}`)
      queryClient.invalidateQueries({ queryKey: ['leadTracking'] })
    }
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

// Table cells shared by both dashboards
export function TrackCellHeaders() {
  return (
    <>
      <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">Email sent</th>
      <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">Call booked</th>
      <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">LinkedIn</th>
      <th className="text-left font-medium py-2.5 px-3 whitespace-nowrap">WhatsApp</th>
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
      <td className="py-2 px-3"><StageSelect refId={refId} field="call_status" tracking={t} save={save} width="w-[110px]" /></td>
      <td className="py-2 px-3"><StageSelect refId={refId} field="li_stage" tracking={t} save={save} width="w-[170px]" /></td>
      <td className="py-2 px-3"><StageSelect refId={refId} field="wa_status" tracking={t} save={save} width="w-[160px]" /></td>
    </>
  )
}
