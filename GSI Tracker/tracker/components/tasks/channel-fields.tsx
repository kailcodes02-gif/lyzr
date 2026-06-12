'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useChannels, useChannelFields, useUsers } from '@/lib/hooks/use-data'
import type { ChannelField, Channel } from '@/lib/types/database'

// Get fields for a channel, including inherited parent fields
export function getFieldsForChannel(
  channelSlug: string,
  parentSlug?: string,
  surface?: 'planning' | 'tracker',
  allFields: ChannelField[] = [],
  channels: Channel[] = []
): ChannelField[] {
  let fields: ChannelField[] = []
  
  const currentChannel = channels.find(c => c.slug === channelSlug)
  if (!currentChannel) return []

  const parentChannel = parentSlug ? channels.find(c => c.slug === parentSlug) : null

  // 1. Inherit parent fields
  if (parentChannel) {
    const parentFields = allFields.filter(
      f => f.channel_id === parentChannel.id && f.cascades_to_children
    )
    fields = [...parentFields]
  }

  // 2. Add own fields
  const ownFields = allFields.filter(f => f.channel_id === currentChannel.id)
  fields = [...fields, ...ownFields]

  // 3. Add universal tracker fields
  if (!surface || surface === 'tracker') {
    const UNIVERSAL_TRACKER: ChannelField[] = [
      {
        id: 'insights',
        channel_id: '',
        name: 'Insights',
        slug: 'insights',
        field_type: 'long_text',
        surface: 'tracker',
        is_required: false,
        options: null,
        formula: null,
        is_auto_calc: false,
        description: null,
        sort_order: 9999,
        cascades_to_children: false,
        created_at: '',
      },
      {
        id: 'result_url',
        channel_id: '',
        name: 'Result URL',
        slug: 'result_url',
        field_type: 'url',
        surface: 'tracker',
        is_required: false,
        options: null,
        formula: null,
        is_auto_calc: false,
        description: null,
        sort_order: 10000,
        cascades_to_children: false,
        created_at: '',
      },
    ]
    fields = [...fields, ...UNIVERSAL_TRACKER]
  }

  // 4. Filter by surface
  if (surface) {
    fields = fields.filter(f => f.surface === surface)
  }

  // 5. Deduplicate by slug (child overrides parent)
  const seen = new Set<string>()
  // Process in reverse to keep child override (child fields come later in the array)
  fields = fields.reverse().filter(f => {
    if (seen.has(f.slug)) return false
    seen.add(f.slug)
    return true
  }).reverse()

  // 6. Sort by sort_order
  fields.sort((a, b) => a.sort_order - b.sort_order)

  return fields
}

// Auto-calculate fields
function computeAutoCalc(fields: ChannelField[], values: Record<string, unknown>): Record<string, number | null> {
  const computed: Record<string, number | null> = {}

  for (const field of fields) {
    if (!field.is_auto_calc) continue

    try {
      const numVal = (slug: string) => Number(values[slug]) || 0

      if (field.slug === 'engagement_rate') {
        const r = numVal('reactions'), c = numVal('comments'), rs = numVal('reshares'), imp = numVal('total_impressions')
        computed[field.slug] = imp > 0 ? +((r + c + rs) / imp * 100).toFixed(2) : null
      } else if (field.slug === 'ctr') {
        const clicks = numVal('clicks'), imp = numVal('impressions') || numVal('opens')
        computed[field.slug] = imp > 0 ? +(clicks / imp * 100).toFixed(2) : null
      } else if (field.slug === 'cpc') {
        const spend = numVal('total_spend'), clicks = numVal('clicks')
        computed[field.slug] = clicks > 0 ? +(spend / clicks).toFixed(2) : null
      } else if (field.slug === 'cpm') {
        const spend = numVal('total_spend'), imp = numVal('impressions')
        computed[field.slug] = imp > 0 ? +(spend / imp * 1000).toFixed(2) : null
      } else if (field.slug === 'cpa') {
        const spend = numVal('total_spend'), cta = numVal('cta_clicks')
        computed[field.slug] = cta > 0 ? +(spend / cta).toFixed(2) : null
      } else if (field.slug === 'cost_per_lead_actual') {
        const spend = numVal('total_spend'), leads = numVal('leads_generated')
        computed[field.slug] = leads > 0 ? +(spend / leads).toFixed(2) : null
      } else if (field.slug === 'open_rate') {
        const opens = numVal('opens'), sends = numVal('total_sends') || numVal('enrolled')
        computed[field.slug] = sends > 0 ? +(opens / sends * 100).toFixed(2) : null
      } else if (field.slug === 'attendance_rate') {
        const att = numVal('attendees'), reg = numVal('registrations')
        computed[field.slug] = reg > 0 ? +(att / reg * 100).toFixed(2) : null
      } else if (field.slug === 'response_rate') {
        const resp = numVal('responses_received'), target = numVal('target_responses')
        computed[field.slug] = target > 0 ? +(resp / target * 100).toFixed(2) : null
      } else if (field.slug === 'reply_rate') {
        const replies = numVal('replies'), enrolled = numVal('enrolled')
        computed[field.slug] = enrolled > 0 ? +(replies / enrolled * 100).toFixed(2) : null
      }
    } catch {
      computed[field.slug] = null
    }
  }
  return computed
}

interface ChannelFieldsProps {
  channelSlug: string
  parentChannelSlug?: string
  surface: 'planning' | 'tracker'
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
}

export function ChannelFields({
  channelSlug,
  parentChannelSlug,
  surface,
  values,
  onChange,
  disabled,
}: ChannelFieldsProps) {
  const { data: channels } = useChannels()
  const { data: allFields } = useChannelFields()
  const { data: users } = useUsers()

  const fields = getFieldsForChannel(
    channelSlug,
    parentChannelSlug,
    surface,
    allFields || [],
    channels || []
  )
  const autoCalcValues = computeAutoCalc(fields, values)

  if (fields.length === 0) {
    return <p className="text-xs text-zinc-600 py-2 col-span-2">No {surface} fields defined for this channel</p>
  }

  const handleChange = (slug: string, value: unknown) => {
    onChange({ ...values, [slug]: value })
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {fields.map(field => {
        const isAutoCalc = !!field.is_auto_calc
        const displayValue = isAutoCalc
          ? (autoCalcValues[field.slug] ?? '-')
          : (values[field.slug] ?? '')

        return (
          <div key={field.slug} className={field.field_type === 'long_text' ? 'col-span-2' : ''}>
            <Label className="text-[11px] text-zinc-500 mb-1 block">
              {field.name}
              {field.is_required && <span className="text-red-400 ml-1">*</span>}
              {isAutoCalc && <span className="ml-1 text-violet-400 font-medium">(auto)</span>}
            </Label>

            {isAutoCalc ? (
              <div className="bg-white/[0.03] border border-white/5 rounded-md px-3 py-2 text-sm text-zinc-300">
                {displayValue !== null && displayValue !== '-' ? String(displayValue) : '-'}
              </div>
            ) : field.field_type === 'long_text' ? (
              <Textarea
                value={displayValue as string}
                onChange={e => handleChange(field.slug, e.target.value)}
                disabled={disabled}
                className="bg-white/5 border-white/10 text-sm min-h-[60px] disabled:opacity-50"
                placeholder={field.name}
              />
            ) : field.field_type === 'dropdown' ? (
              <Select
                value={displayValue as string}
                onValueChange={v => handleChange(field.slug, v)}
                disabled={disabled}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-sm h-9 disabled:opacity-50">
                  <SelectValue placeholder={`Select ${field.name}`} />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-white/10 text-white">
                  {field.options?.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.field_type === 'multi_select' ? (
              <div className="flex flex-wrap gap-1.5">
                {field.options?.map(opt => {
                  const selected = Array.isArray(values[field.slug]) && (values[field.slug] as string[]).includes(opt)
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const current = (Array.isArray(values[field.slug]) ? values[field.slug] : []) as string[]
                        const next = selected ? current.filter(v => v !== opt) : [...current, opt]
                        handleChange(field.slug, next)
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors disabled:opacity-50 ${
                        selected
                          ? 'bg-blue-500/20 border-blue-500/30 text-blue-300'
                          : 'bg-white/5 border-white/10 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {opt.replace(/_/g, ' ')}
                    </button>
                  )
                })}
              </div>
            ) : field.field_type === 'checkbox' ? (
              <div className="flex items-center space-x-2 h-9">
                <input
                  type="checkbox"
                  checked={!!values[field.slug]}
                  onChange={e => handleChange(field.slug, e.target.checked)}
                  disabled={disabled}
                  className="rounded border-zinc-700 bg-white/5 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs text-zinc-400">Toggle {field.name}</span>
              </div>
            ) : field.field_type === 'date_range' ? (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={(displayValue as any)?.start || ''}
                  onChange={e => {
                    const prev = (values[field.slug] as any) || {}
                    handleChange(field.slug, { ...prev, start: e.target.value })
                  }}
                  disabled={disabled}
                  className="bg-white/5 border-white/10 text-xs h-9 disabled:opacity-50"
                />
                <Input
                  type="date"
                  value={(displayValue as any)?.end || ''}
                  onChange={e => {
                    const prev = (values[field.slug] as any) || {}
                    handleChange(field.slug, { ...prev, end: e.target.value })
                  }}
                  disabled={disabled}
                  className="bg-white/5 border-white/10 text-xs h-9 disabled:opacity-50"
                />
              </div>
            ) : field.field_type === 'person' ? (
              <Select
                value={displayValue as string}
                onValueChange={v => handleChange(field.slug, v)}
                disabled={disabled}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-sm h-9 disabled:opacity-50">
                  <SelectValue placeholder={`Select ${field.name}`} />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-white/10 text-white">
                  {users?.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.display_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="relative flex items-center">
                {field.field_type === 'currency' && (
                  <span className="absolute left-3 text-zinc-500 text-xs">$</span>
                )}
                <Input
                  type={
                    field.field_type === 'number' || field.field_type === 'currency'
                      ? 'number'
                      : field.field_type === 'date'
                      ? 'date'
                      : field.field_type === 'url'
                      ? 'url'
                      : field.field_type === 'email'
                      ? 'email'
                      : 'text'
                  }
                  value={displayValue as string}
                  onChange={e =>
                    handleChange(
                      field.slug,
                      field.field_type === 'number' || field.field_type === 'currency'
                        ? e.target.value === ''
                          ? ''
                          : Number(e.target.value)
                        : e.target.value
                    )
                  }
                  disabled={disabled}
                  className={`bg-white/5 border-white/10 text-sm h-9 disabled:opacity-50 ${
                    field.field_type === 'currency' ? 'pl-7' : ''
                  }`}
                  placeholder={field.name}
                  step={field.field_type === 'currency' ? '0.01' : undefined}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
