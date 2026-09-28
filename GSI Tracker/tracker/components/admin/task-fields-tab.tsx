'use client'

import { useMemo, useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlignLeft, Calendar, CalendarRange, CheckSquare, ChevronDown, ChevronRight, DollarSign, GripVertical,
  Hash, Link2, List, ListChecks, Mail, Paperclip, Pencil, Phone, Plus, Trash2, Type, User, X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useChannels, useChannelFields, useVerticals } from '@/lib/hooks/use-data'
import { upsertChannelField, deleteChannelField } from '@/lib/actions'
import type { ChannelField } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { fieldCopy } from '@/lib/field-copy'
import { InfoTip } from '@/components/ui/info-tip'

// "Task fields" (stored as channel_fields): extra questions every task in a
// channel asks, beyond title/owner/due date. Built as a guided form with a
// live preview; order is set by dragging, never by typing numbers.

type FieldKind = {
  value: string
  label: string
  example: string
  icon: React.ComponentType<{ className?: string }>
  common?: boolean
}

const KINDS: FieldKind[] = [
  { value: 'text', label: 'Short text', example: 'e.g. Event city', icon: Type, common: true },
  { value: 'number', label: 'Number', example: 'e.g. 250 leads', icon: Hash, common: true },
  { value: 'currency', label: 'Money', example: 'e.g. $1,200 spend', icon: DollarSign, common: true },
  { value: 'date', label: 'Date', example: 'e.g. Launch day', icon: Calendar, common: true },
  { value: 'dropdown', label: 'Pick one', example: 'e.g. Region: NA / EU', icon: List, common: true },
  { value: 'multi_select', label: 'Pick several', example: 'e.g. Platforms', icon: ListChecks, common: true },
  { value: 'checkbox', label: 'Yes / no', example: 'e.g. Legal approved?', icon: CheckSquare, common: true },
  { value: 'url', label: 'Link', example: 'e.g. Landing page', icon: Link2, common: true },
  { value: 'long_text', label: 'Paragraph', example: 'e.g. Brief', icon: AlignLeft },
  { value: 'date_range', label: 'Date range', example: 'e.g. Campaign window', icon: CalendarRange },
  { value: 'person', label: 'Person', example: 'e.g. Reviewer', icon: User },
  { value: 'email', label: 'Email', example: 'e.g. Partner contact', icon: Mail },
  { value: 'phone', label: 'Phone', example: 'e.g. Venue phone', icon: Phone },
  { value: 'file', label: 'File', example: 'e.g. Signed contract', icon: Paperclip },
]
const kindOf = (v: string) => KINDS.find(k => k.value === v) || KINDS[0]
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

type Draft = {
  id: string | null
  channel_id: string
  name: string
  slug: string
  field_type: string
  surface: 'planning' | 'tracker'
  is_required: boolean
  cascades_to_children: boolean
  options: string[]
  description: string
  is_auto_calc: boolean
  formula: string
  sort_order: number
}

const EMPTY: Draft = {
  id: null, channel_id: '', name: '', slug: '', field_type: 'text', surface: 'planning',
  is_required: false, cascades_to_children: true, options: [], description: '',
  is_auto_calc: false, formula: '', sort_order: 0,
}

export function TaskFieldsTab() {
  const qc = useQueryClient()
  const { data: channels } = useChannels('all')
  const { data: verticals } = useVerticals(true)
  const { data: fields } = useChannelFields()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [slugTouched, setSlugTouched] = useState(false)
  const [showAllKinds, setShowAllKinds] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [optionDraft, setOptionDraft] = useState('')
  const [filter, setFilter] = useState('all')
  const [pending, start] = useTransition()

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const refresh = () => qc.invalidateQueries({ queryKey: ['channelFields'] })

  const vName = (id: string) => verticals?.find(v => v.id === id)?.name || ''
  const chLabel = (id: string) => {
    const c = channels?.find(x => x.id === id)
    if (!c) return 'Unknown channel'
    const p = c.parent_channel_id ? channels?.find(x => x.id === c.parent_channel_id) : null
    return `${vName(c.vertical_id)} · ${p ? `${p.name} › ` : ''}${c.name}`
  }
  const channelOptions = useMemo(
    () => (channels || []).filter(c => c.is_active).map(c => ({ id: c.id, label: chLabel(c.id) })).sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, verticals]
  )
  const selected = channels?.find(c => c.id === draft.channel_id)
  const hasSubChannels = !!selected && (channels || []).some(c => c.parent_channel_id === selected.id)

  // Group the saved fields by channel, each list in its drag order.
  const groups = useMemo(() => {
    const m = new Map<string, ChannelField[]>()
    for (const f of fields || []) {
      if (filter !== 'all' && f.channel_id !== filter) continue
      if (!m.has(f.channel_id)) m.set(f.channel_id, [])
      m.get(f.channel_id)!.push(f)
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order)
    return [...m.entries()].sort((a, b) => chLabel(a[0]).localeCompare(chLabel(b[0])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, filter, channels, verticals])

  const reset = () => { setDraft(EMPTY); setSlugTouched(false); setShowAdvanced(false); setOptionDraft('') }

  const edit = (f: ChannelField) => {
    setDraft({
      id: f.id, channel_id: f.channel_id, name: f.name, slug: f.slug, field_type: f.field_type,
      surface: f.surface === 'tracker' ? 'tracker' : 'planning', is_required: f.is_required,
      cascades_to_children: f.cascades_to_children, options: f.options || [], description: f.description || '',
      is_auto_calc: f.is_auto_calc, formula: f.formula || '', sort_order: f.sort_order,
    })
    setSlugTouched(true)
    setShowAllKinds(!kindOf(f.field_type).common)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addOption = () => {
    const o = optionDraft.trim()
    if (!o || draft.options.includes(o)) return
    set('options', [...draft.options, o]); setOptionDraft('')
  }

  const save = () => {
    if (!draft.channel_id) { toast.error('Pick which channel this field belongs to (step 1)'); return }
    if (!draft.name.trim()) { toast.error('Give the field a name (step 2)'); return }
    const needsOptions = draft.field_type === 'dropdown' || draft.field_type === 'multi_select'
    if (needsOptions && draft.options.length < 2) { toast.error('Add at least two choices for people to pick from'); return }
    const slug = draft.slug || slugify(draft.name)
    // New fields go to the bottom of their channel's list.
    const sort_order = draft.id ? draft.sort_order
      : Math.max(-1, ...(fields || []).filter(f => f.channel_id === draft.channel_id).map(f => f.sort_order)) + 1
    start(async () => {
      try {
        await upsertChannelField({
          id: draft.id || undefined, channel_id: draft.channel_id, name: draft.name.trim(), slug,
          field_type: draft.field_type, surface: draft.surface, is_required: draft.is_required,
          options: needsOptions ? draft.options : null, formula: draft.is_auto_calc ? draft.formula || null : null,
          is_auto_calc: draft.is_auto_calc, description: draft.description.trim() || null,
          sort_order, cascades_to_children: draft.cascades_to_children,
        })
        refresh()
        toast.success(draft.id ? `“${draft.name}” updated` : `“${draft.name}” added to ${chLabel(draft.channel_id)}`)
        reset()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save the field') }
    })
  }

  const remove = (f: ChannelField) => {
    if (!confirm(`Remove the “${f.name}” field? Values already filled in on tasks stay in their history.`)) return
    start(async () => {
      try { await deleteChannelField(f.id); refresh(); toast.success('Field removed'); if (draft.id === f.id) reset() }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove the field') }
    })
  }

  const reorder = (list: ChannelField[], from: number, to: number) => {
    const next = arrayMove(list, from, to)
    start(async () => {
      try {
        await Promise.all(next.map((f, i) => f.sort_order === i ? null : upsertChannelField({
          id: f.id, channel_id: f.channel_id, name: f.name, slug: f.slug, field_type: f.field_type,
          surface: f.surface, is_required: f.is_required, options: f.options, formula: f.formula,
          is_auto_calc: f.is_auto_calc, description: f.description, sort_order: i,
          cascades_to_children: f.cascades_to_children,
        })))
        refresh()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not reorder') }
    })
  }

  const kind = kindOf(draft.field_type)
  const visibleKinds = showAllKinds ? KINDS : KINDS.filter(k => k.common)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      {/* ---------- Builder ---------- */}
      <Card className="bg-white border-zinc-200 xl:col-span-3">
        <CardContent className="p-6 space-y-7">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-900">{draft.id ? `Editing “${draft.name}”` : 'Add a task field'}</h3>
            {draft.id && <Button variant="ghost" size="sm" className="text-xs text-zinc-500" onClick={reset}><X className="w-3.5 h-3.5 mr-1" /> Cancel edit</Button>}
          </div>

          <Step n={1} title="Which channel’s tasks should ask this?">
            <Select value={draft.channel_id} onValueChange={v => set('channel_id', String(v || ''))}>
              <SelectTrigger className="w-full h-10 bg-white border-zinc-300"><SelectValue placeholder="Choose a channel…" /></SelectTrigger>
              <SelectContent className="bg-white border-zinc-300 max-h-80">
                {channelOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasSubChannels && (
              <Toggle
                checked={draft.cascades_to_children} onChange={v => set('cascades_to_children', v)}
                label="Also ask it on this channel’s sub-channels"
                hint={`Tasks in the sub-channels under ${selected?.name} will get this field too. Turn off to keep it on ${selected?.name} only.`}
              />
            )}
          </Step>

          <Step n={2} title="What should the field be called?">
            <Input
              value={draft.name}
              onChange={e => { set('name', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)) }}
              placeholder="e.g. Leads generated"
              className="h-10 bg-white border-zinc-300"
            />
            <Input
              value={draft.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional hint for whoever fills it in — e.g. “Count from the HubSpot list”"
              className="h-9 bg-white border-zinc-300 text-sm"
            />
          </Step>

          <Step n={3} title="What kind of answer is it?">
            <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-2">
              {visibleKinds.map(k => (
                <button key={k.value} type="button" onClick={() => set('field_type', k.value)}
                  className={cn('text-left rounded-lg border px-3 py-2.5 transition-colors',
                    draft.field_type === k.value ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50')}>
                  <k.icon className={cn('w-4 h-4 mb-1', draft.field_type === k.value ? 'text-orange-600' : 'text-zinc-600')} />
                  <div className="text-[13px] font-medium text-zinc-900">{k.label}</div>
                  <div className="text-[11px] text-zinc-500 leading-tight">{k.example}</div>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowAllKinds(s => !s)} className="text-xs text-blue-600 hover:underline">
              {showAllKinds ? 'Show fewer types' : `More types (${KINDS.length - KINDS.filter(k => k.common).length})`}
            </button>
            {(draft.field_type === 'dropdown' || draft.field_type === 'multi_select') && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                <p className="text-xs font-medium text-zinc-700">Choices people can pick from</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.options.map(o => (
                    <span key={o} className="inline-flex items-center gap-1 rounded-full bg-white border border-zinc-300 px-2.5 py-0.5 text-xs">
                      {o}
                      <button type="button" aria-label={`Remove ${o}`} onClick={() => set('options', draft.options.filter(x => x !== o))} className="text-zinc-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {!draft.options.length && <span className="text-xs text-zinc-500">No choices yet.</span>}
                </div>
                <div className="flex gap-2">
                  <Input value={optionDraft} onChange={e => setOptionDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                    placeholder="Type a choice, press Enter" className="h-8 bg-white border-zinc-300 text-sm" />
                  <Button type="button" size="sm" variant="outline" className="h-8 border-zinc-300" onClick={addOption} disabled={!optionDraft.trim()}><Plus className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            )}
          </Step>

          <Step n={4} title="When is it filled in?">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Choice active={draft.surface === 'planning'} onClick={() => set('surface', 'planning')}
                title="While planning" desc="Before the work happens — targets, budgets, dates. Shown in the task’s Plan section." />
              <Choice active={draft.surface === 'tracker'} onClick={() => set('surface', 'tracker')}
                title="When reporting results" desc="After it goes live — actuals, spend, proof. Shown in the task’s Results section." />
            </div>
            <Toggle checked={draft.is_required} onChange={v => set('is_required', v)}
              label="People must fill this in"
              hint="The task can’t be saved at this stage until the field has a value." />
          </Step>

          <div className="border-t border-zinc-100 pt-4">
            <button type="button" onClick={() => setShowAdvanced(s => !s)} className="flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900">
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Advanced (most people never need this)
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-5">
                <Toggle checked={draft.is_auto_calc} onChange={v => set('is_auto_calc', v)}
                  label="Worked out automatically"
                  hint="Nobody types this value; it is calculated from other fields. Describe the rule below." />
                {draft.is_auto_calc && (
                  <Input value={draft.formula} onChange={e => set('formula', e.target.value)} placeholder="e.g. clicks / impressions × 100" className="h-9 bg-white border-zinc-300 text-sm" />
                )}
                <div>
                  <p className="text-xs text-zinc-700 font-medium">Internal key</p>
                  <p className="text-[11px] text-zinc-500 mb-1">How reports and exports refer to this field. Made from the name automatically.</p>
                  <Input value={draft.slug} onChange={e => { setSlugTouched(true); set('slug', slugify(e.target.value)) }} className="h-8 bg-white border-zinc-300 text-xs font-mono w-64" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            {draft.id && <Button variant="ghost" onClick={reset} className="text-zinc-600">Cancel</Button>}
            <Button onClick={save} disabled={pending} className="bg-orange-500 hover:bg-orange-600 text-white">
              {draft.id ? 'Save changes' : <><Plus className="w-4 h-4 mr-1.5" /> Add field</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Live preview ---------- */}
      <div className="xl:col-span-2 space-y-3">
        <p className="brand-label text-zinc-600">Preview — how it looks on a task</p>
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5 space-y-3">
            <div className="text-[11px] text-zinc-500">{draft.channel_id ? chLabel(draft.channel_id) : 'No channel picked yet'} · {draft.surface === 'planning' ? 'Plan section' : 'Results section'}</div>
            <div>
              <label className="text-sm font-medium text-zinc-900">
                {draft.name || 'Field name'}{draft.is_required && <span className="text-orange-600"> *</span>}
              </label>
              {draft.description && <p className="text-[11px] text-zinc-500">{draft.description}</p>}
              <div className="mt-1.5"><PreviewInput kind={draft.field_type} options={draft.options} auto={draft.is_auto_calc} /></div>
            </div>
          </CardContent>
        </Card>
        <div className="rounded-lg bg-zinc-100 px-4 py-3 text-[12px] leading-relaxed text-zinc-700">
          <strong>What is a task field?</strong> Every task already has a title, owner, due date and priority.
          A task field is an <em>extra</em> question that tasks in one channel need — e.g. Events tasks ask
          “Venue” and “Expected attendees”, Paid Ads tasks ask “Daily budget”. Add it once here and every
          task in that channel shows it.
        </div>
      </div>

      {/* ---------- Saved fields ---------- */}
      <div className="xl:col-span-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">Fields already set up</h3>
            <p className="text-xs text-zinc-500">Drag <GripVertical className="inline w-3 h-3" /> to change the order they appear on the task. Click the pencil to edit.</p>
          </div>
          <Select value={filter} onValueChange={v => setFilter(String(v || 'all'))}>
            <SelectTrigger className="w-72 h-9 bg-white border-zinc-300 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white border-zinc-300 max-h-80">
              <SelectItem value="all">All channels</SelectItem>
              {channelOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {groups.length === 0 && (
          <Card className="bg-white border-zinc-200"><CardContent className="p-10 text-center text-sm text-zinc-500">No task fields yet. Add the first one above.</CardContent></Card>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groups.map(([chId, list]) => (
            <FieldGroup key={chId} title={chLabel(chId)} list={list} editingId={draft.id}
              onEdit={edit} onRemove={remove} onReorder={(a, b) => reorder(list, a, b)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-4">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-medium text-white">{n}</span>
      <div className="flex-1 min-w-0 space-y-2.5">
        <h4 className="text-sm font-medium text-zinc-900">{title}</h4>
        {children}
      </div>
    </section>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 px-3 py-2.5 cursor-pointer hover:bg-zinc-50">
      <span>
        <span className="block text-[13px] font-medium text-zinc-900">{label}</span>
        <span className="block text-[11px] text-zinc-500 leading-snug">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={c => onChange(!!c)} className="mt-0.5" />
    </label>
  )
}

function Choice({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('text-left rounded-lg border px-3 py-2.5 transition-colors',
        active ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-zinc-200 hover:bg-zinc-50')}>
      <div className="text-[13px] font-medium text-zinc-900">{title}</div>
      <div className="text-[11px] text-zinc-500 leading-snug">{desc}</div>
    </button>
  )
}

function PreviewInput({ kind, options, auto }: { kind: string; options: string[]; auto: boolean }) {
  const box = 'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-400'
  if (auto) return <div className={cn(box, 'bg-zinc-50 italic')}>Calculated automatically</div>
  switch (kind) {
    case 'long_text': return <div className={cn(box, 'h-16')}>Type here…</div>
    case 'number': return <div className={box}>0</div>
    case 'currency': return <div className={box}>$ 0.00</div>
    case 'date': return <div className={box}>dd / mm / yyyy</div>
    case 'date_range': return <div className={box}>Start → End</div>
    case 'checkbox': return <div className="flex items-center gap-2 text-sm text-zinc-600"><span className="h-4 w-4 rounded border border-zinc-400" /> Yes</div>
    case 'dropdown': return <div className={cn(box, 'flex justify-between')}>{options[0] || 'Choose one…'} <ChevronDown className="w-4 h-4" /></div>
    case 'multi_select': return <div className="flex flex-wrap gap-1">{(options.length ? options : ['Choice A', 'Choice B']).map(o => <span key={o} className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600">{o}</span>)}</div>
    case 'person': return <div className={box}>Pick a teammate…</div>
    case 'file': return <div className={cn(box, 'border-dashed text-center')}>Drop a file or click to upload</div>
    case 'url': return <div className={box}>https://…</div>
    case 'email': return <div className={box}>name@company.com</div>
    case 'phone': return <div className={box}>+1 …</div>
    default: return <div className={box}>Type here…</div>
  }
}

function FieldGroup({ title, list, editingId, onEdit, onRemove, onReorder }: {
  title: string
  list: ChannelField[]
  editingId: string | null
  onEdit: (f: ChannelField) => void
  onRemove: (f: ChannelField) => void
  onReorder: (from: number, to: number) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = list.findIndex(f => f.id === e.active.id)
    const to = list.findIndex(f => f.id === e.over!.id)
    if (from >= 0 && to >= 0) onReorder(from, to)
  }
  return (
    <Card className="bg-white border-zinc-200">
      <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 truncate">{title}</span>
        <span className="brand-label text-zinc-500">{list.length} field{list.length === 1 ? '' : 's'}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map(f => f.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-zinc-100">
            {list.map(f => <FieldRow key={f.id} field={f} editing={editingId === f.id} onEdit={onEdit} onRemove={onRemove} />)}
          </div>
        </SortableContext>
      </DndContext>
    </Card>
  )
}

function FieldRow({ field, editing, onEdit, onRemove }: { field: ChannelField; editing: boolean; onEdit: (f: ChannelField) => void; onRemove: (f: ChannelField) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const k = kindOf(field.field_type)
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 px-2 py-2 bg-white', isDragging && 'relative z-10 shadow-lg', editing && 'bg-orange-50')}>
      <button {...attributes} {...listeners} aria-label={`Drag to reorder ${field.name}`} className="cursor-grab active:cursor-grabbing p-1 text-zinc-400 hover:text-zinc-700 touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <k.icon className="w-4 h-4 text-zinc-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-zinc-900 truncate flex items-center gap-1">{fieldCopy(field).label}{field.is_required && <span className="text-orange-600"> *</span>}{fieldCopy(field).help && <InfoTip text={fieldCopy(field).help} />}</div>
        <div className="text-[11px] text-zinc-500 truncate">
          {k.label} · {field.surface === 'tracker' ? 'filled in when reporting results' : 'filled in while planning'}
          {field.cascades_to_children && ' · also on sub-channels'}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-900" aria-label={`Edit ${field.name}`} onClick={() => onEdit(field)}><Pencil className="w-3.5 h-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-600" aria-label={`Remove ${field.name}`} onClick={() => onRemove(field)}><Trash2 className="w-3.5 h-3.5" /></Button>
    </div>
  )
}
