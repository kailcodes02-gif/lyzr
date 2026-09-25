'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronDown, ChevronRight, Plus, Pencil, Check, X, ArrowUp, ArrowDown, EyeOff, Eye, Folder, GitBranch, Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InfoTip } from '@/components/ui/info-tip'
import { useCategories, useChannels, useFunctions } from '@/lib/hooks/use-data'
import { createCategory, updateCategory, createChannel, updateChannel } from '@/lib/actions'
import { TIER_CONFIG, type Category, type Channel, type ChannelTier } from '@/lib/types/database'
import { cn } from '@/lib/utils'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

// Tree editor for one vertical's taxonomy:
//   Category
//   └─ Channel  [function] [tier]
//      └─ Sub-channel
// Everything is inline: rename in place, add a child from the row it belongs
// to, reorder with arrows, hide instead of delete (tasks keep their history).

type Node = Channel & { children: Channel[] }

export function TaxonomyManager({ verticalId }: { verticalId: string }) {
  const queryClient = useQueryClient()
  const { data: categories } = useCategories(verticalId)
  const { data: channels } = useChannels(verticalId)
  const { data: functions } = useFunctions()
  const [showHidden, setShowHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<{ kind: 'category' } | { kind: 'channel'; categoryId: string; parentId: string | null } | null>(null)
  const [newName, setNewName] = useState('')

  // useCategories/useChannels only return active rows; hidden ones come from a second, unfiltered read.
  const { data: allCategories } = useCategoriesAll(verticalId, showHidden)
  const { data: allChannels } = useChannelsAll(verticalId, showHidden)
  const cats = (showHidden ? allCategories : categories) || []
  const chans = (showHidden ? allChannels : channels) || []

  const tree = useMemo(() => {
    const byCat = new Map<string, Node[]>()
    const nodes = new Map<string, Node>()
    chans.forEach(c => nodes.set(c.id, { ...c, children: [] }))
    chans.forEach(c => {
      const n = nodes.get(c.id)!
      if (c.parent_channel_id && nodes.has(c.parent_channel_id)) nodes.get(c.parent_channel_id)!.children.push(n)
      else { if (!byCat.has(c.category_id)) byCat.set(c.category_id, []); byCat.get(c.category_id)!.push(n) }
    })
    for (const list of byCat.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    for (const n of nodes.values()) n.children.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    return byCat
  }, [chans])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] })
    queryClient.invalidateQueries({ queryKey: ['channels'] })
    queryClient.invalidateQueries({ queryKey: ['taxonomyAll'] })
  }
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); refresh(); if (ok) toast.success(ok) } catch (err) { toast.error(errMsg(err)) } finally { setBusy(false) }
  }
  const toggle = (id: string) => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const submitAdd = () => {
    if (!adding || !newName.trim()) return
    const name = newName.trim()
    if (adding.kind === 'category') {
      run(() => createCategory({ vertical_id: verticalId, name, sort_order: cats.length + 1 }), `Category "${name}" added`)
    } else {
      const siblings = adding.parentId ? (chans.find(c => c.id === adding.parentId) ? tree.get(adding.categoryId)?.find(n => n.id === adding.parentId)?.children || [] : []) : (tree.get(adding.categoryId) || [])
      run(() => createChannel({ category_id: adding.categoryId, parent_channel_id: adding.parentId, name, sort_order: siblings.length + 1 }), `${adding.parentId ? 'Sub-channel' : 'Channel'} "${name}" added`)
    }
    setAdding(null); setNewName('')
  }

  const move = (list: { id: string; sort_order: number }[], idx: number, dir: -1 | 1, kind: 'category' | 'channel') => {
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    const a = list[idx], b = list[j]
    // Swap positions; give distinct numbers if the seed left ties.
    const aOrder = b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order
    const bOrder = b.sort_order === a.sort_order ? a.sort_order : a.sort_order
    run(async () => {
      if (kind === 'category') {
        const ca = cats.find(c => c.id === a.id)!, cb = cats.find(c => c.id === b.id)!
        await updateCategory({ id: ca.id, name: ca.name, icon: ca.icon || undefined, sort_order: aOrder, is_active: ca.is_active })
        await updateCategory({ id: cb.id, name: cb.name, icon: cb.icon || undefined, sort_order: bOrder, is_active: cb.is_active })
      } else {
        const ca = chans.find(c => c.id === a.id)!, cb = chans.find(c => c.id === b.id)!
        await updateChannel({ id: ca.id, name: ca.name, parent_channel_id: ca.parent_channel_id, sort_order: aOrder, is_active: ca.is_active })
        await updateChannel({ id: cb.id, name: cb.name, parent_channel_id: cb.parent_channel_id, sort_order: bOrder, is_active: cb.is_active })
      }
    })
  }

  const AddRow = ({ placeholder, depth }: { placeholder: string; depth: number }) => (
    <div className={cn('flex items-center gap-2 py-1.5', depth === 1 && 'pl-8', depth === 2 && 'pl-16')}>
      <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') { setAdding(null); setNewName('') } }}
        className="h-8 text-xs bg-white border-blue-300 max-w-xs" />
      <Button size="sm" onClick={submitAdd} disabled={!newName.trim() || busy} className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white"><Check className="w-3.5 h-3.5 mr-1" /> Add</Button>
      <Button size="sm" variant="ghost" onClick={() => { setAdding(null); setNewName('') }} className="h-8 text-xs text-zinc-500"><X className="w-3.5 h-3.5" /></Button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Legend + actions */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
        <span className="inline-flex items-center gap-1"><Folder className="w-3.5 h-3.5 text-zinc-500" /> Group <InfoTip k="category" /></span>
        <span className="text-zinc-300">›</span>
        <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-blue-600" /> Channel <InfoTip k="channel" /></span>
        <span className="text-zinc-300">›</span>
        <span className="inline-flex items-center gap-1"><GitBranch className="w-3.5 h-3.5 text-violet-600" /> Sub-channel <InfoTip k="sub_channel" /></span>
        <span className="flex-1" />
        <button onClick={() => setShowHidden(v => !v)} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} {showHidden ? 'Hiding hidden items' : 'Show hidden items'}
        </button>
        <Button size="sm" onClick={() => { setAdding({ kind: 'category' }); setNewName('') }} className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white">
          <Plus className="w-3.5 h-3.5 mr-1" /> New group
        </Button>
      </div>
      {adding?.kind === 'category' && <AddRow placeholder="Group name (e.g. Paid)" depth={0} />}

      <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
        {cats.length === 0 && (
          <div className="p-8 text-center text-sm text-zinc-500 space-y-2">
            <p>No categories yet. A category is just a group for channels: start with one like &quot;Paid&quot; or &quot;Organic&quot;.</p>
            <p className="text-xs">Or clone a template from Admin › Verticals to get the standard tree.</p>
          </div>
        )}
        {cats.map((cat, ci) => {
          const list = tree.get(cat.id) || []
          const open = !collapsed.has(cat.id)
          return (
            <div key={cat.id} className={cn(!cat.is_active && 'opacity-50')}>
              <Row
                depth={0} icon={<Folder className="w-4 h-4 text-zinc-500" />}
                name={cat.name} hidden={!cat.is_active}
                open={open} onToggle={list.length ? () => toggle(cat.id) : undefined}
                count={`${list.length} channel${list.length === 1 ? '' : 's'}`}
                onRename={name => run(() => updateCategory({ id: cat.id, name, icon: cat.icon || undefined, sort_order: cat.sort_order, is_active: cat.is_active }), 'Renamed')}
                onUp={ci > 0 ? () => move(cats, ci, -1, 'category') : undefined}
                onDown={ci < cats.length - 1 ? () => move(cats, ci, 1, 'category') : undefined}
                onHide={() => run(() => updateCategory({ id: cat.id, name: cat.name, icon: cat.icon || undefined, sort_order: cat.sort_order, is_active: !cat.is_active }), cat.is_active ? 'Group hidden' : 'Group shown')}
                addLabel="Add channel"
                onAdd={() => { setAdding({ kind: 'channel', categoryId: cat.id, parentId: null }); setNewName(''); setCollapsed(s => { const n = new Set(s); n.delete(cat.id); return n }) }}
                busy={busy}
              />
              {adding?.kind === 'channel' && adding.categoryId === cat.id && adding.parentId === null && <AddRow placeholder="Channel name (e.g. Paid Ads)" depth={1} />}
              {open && list.map((ch, i) => (
                <ChannelRows key={ch.id} node={ch} depth={1} siblings={list} index={i}
                  functions={functions || []} busy={busy} run={run} move={move}
                  collapsed={collapsed} toggle={toggle}
                  adding={adding} setAdding={setAdding} setNewName={setNewName} AddRow={AddRow} categoryId={cat.id} />
              ))}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-zinc-500">
        Hiding keeps history: tasks on a hidden channel stay, the channel just leaves the sidebar and pickers. Channels cannot move between categories or verticals.
      </p>
    </div>
  )
}

function ChannelRows({ node, depth, siblings, index, functions, busy, run, move, collapsed, toggle, adding, setAdding, setNewName, AddRow, categoryId }: {
  node: Node; depth: 1 | 2; siblings: Node[]; index: number
  functions: { id: string; name: string }[]
  busy: boolean
  run: (fn: () => Promise<unknown>, ok?: string) => void
  move: (list: { id: string; sort_order: number }[], idx: number, dir: -1 | 1, kind: 'category' | 'channel') => void
  collapsed: Set<string>; toggle: (id: string) => void
  adding: { kind: 'category' } | { kind: 'channel'; categoryId: string; parentId: string | null } | null
  setAdding: (a: { kind: 'channel'; categoryId: string; parentId: string | null } | null) => void
  setNewName: (s: string) => void
  AddRow: (p: { placeholder: string; depth: number }) => React.ReactElement
  categoryId: string
}) {
  const open = !collapsed.has(node.id)
  const fnName = functions.find(f => f.id === node.function_id)?.name
  const base = { id: node.id, name: node.name, parent_channel_id: node.parent_channel_id, sort_order: node.sort_order, is_active: node.is_active }
  return (
    <div className={cn(!node.is_active && 'opacity-50')}>
      <Row
        depth={depth}
        icon={depth === 1 ? <Layers className="w-4 h-4 text-blue-600" /> : <GitBranch className="w-4 h-4 text-violet-600" />}
        name={node.name} hidden={!node.is_active}
        open={open} onToggle={node.children.length ? () => toggle(node.id) : undefined}
        count={depth === 1 ? `${node.children.length} sub-channel${node.children.length === 1 ? '' : 's'}` : undefined}
        badges={
          <>
            <select
              value={node.function_id || ''} disabled={busy}
              onChange={e => run(() => updateChannel({ ...base, function_id: e.target.value || null }), 'Function updated')}
              className="h-6 text-[11px] rounded-md border border-zinc-200 bg-zinc-50 px-1.5 text-zinc-600"
              title="Domain: the same discipline across verticals"
            >
              <option value="">{depth === 2 ? 'Domain: inherit' : 'Domain: none'}</option>
              {functions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {depth === 2 && !node.function_id && fnName === undefined && null}
            <select
              value={node.tier || ''} disabled={busy}
              onChange={e => run(() => updateChannel({ ...base, tier: e.target.value || null }), 'Tier updated')}
              className="h-6 text-[11px] rounded-md border border-zinc-200 bg-zinc-50 px-1.5 text-zinc-600"
              title="Tier: gold must win, silver important, bronze nice to have, hygiene keep running"
            >
              <option value="">Tier: none</option>
              {(Object.keys(TIER_CONFIG) as ChannelTier[]).map(t => <option key={t} value={t}>{TIER_CONFIG[t].emoji} {TIER_CONFIG[t].label}</option>)}
            </select>
          </>
        }
        onRename={name => run(() => updateChannel({ ...base, name }), 'Renamed')}
        onUp={index > 0 ? () => move(siblings, index, -1, 'channel') : undefined}
        onDown={index < siblings.length - 1 ? () => move(siblings, index, 1, 'channel') : undefined}
        onHide={() => run(() => updateChannel({ ...base, is_active: !node.is_active }), node.is_active ? 'Hidden' : 'Shown')}
        addLabel={depth === 1 ? 'Add sub-channel' : undefined}
        onAdd={depth === 1 ? () => { setAdding({ kind: 'channel', categoryId, parentId: node.id }); setNewName(''); if (collapsed.has(node.id)) toggle(node.id) } : undefined}
        busy={busy}
      />
      {adding?.kind === 'channel' && adding.parentId === node.id && <AddRow placeholder="Sub-channel name (e.g. LinkedIn Ads)" depth={2} />}
      {open && depth === 1 && node.children.map((c, i) => (
        <ChannelRows key={c.id} node={c as Node} depth={2} siblings={node.children as Node[]} index={i}
          functions={functions} busy={busy} run={run} move={move} collapsed={collapsed} toggle={toggle}
          adding={adding} setAdding={setAdding} setNewName={setNewName} AddRow={AddRow} categoryId={categoryId} />
      ))}
    </div>
  )
}

function Row({ depth, icon, name, hidden, open, onToggle, count, badges, onRename, onUp, onDown, onHide, addLabel, onAdd, busy }: {
  depth: number; icon: React.ReactNode; name: string; hidden: boolean
  open: boolean; onToggle?: () => void; count?: string; badges?: React.ReactNode
  onRename: (name: string) => void; onUp?: () => void; onDown?: () => void; onHide: () => void
  addLabel?: string; onAdd?: () => void; busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const commit = () => { const v = draft.trim(); setEditing(false); if (v && v !== name) onRename(v) }
  return (
    <div className={cn('group flex items-center gap-2 py-1.5 pr-2 hover:bg-zinc-50', depth === 0 && 'pl-2 bg-zinc-50/60', depth === 1 && 'pl-8', depth === 2 && 'pl-16')}>
      <button onClick={onToggle} disabled={!onToggle} className={cn('w-5 h-5 flex items-center justify-center text-zinc-400', !onToggle && 'opacity-0')} aria-label="Toggle">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {icon}
      {editing ? (
        <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false) } }}
          className="h-7 text-sm bg-white border-blue-300 max-w-xs" />
      ) : (
        <button onClick={() => { setDraft(name); setEditing(true) }} className={cn('text-left', depth === 0 ? 'text-sm font-semibold text-zinc-800' : 'text-sm text-zinc-800')} title="Click to rename">
          {name}
        </button>
      )}
      {hidden && <span className="text-[10px] uppercase tracking-wider text-zinc-400 border border-zinc-200 rounded px-1">hidden</span>}
      {count && <span className="text-[11px] text-zinc-400">{count}</span>}
      <span className="flex-1" />
      <div className="flex items-center gap-1.5">{badges}</div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {onAdd && (
          <Button size="sm" variant="ghost" onClick={onAdd} disabled={busy} className="h-7 text-xs text-blue-600 px-2"><Plus className="w-3.5 h-3.5 mr-1" />{addLabel}</Button>
        )}
        <Button size="icon" variant="ghost" onClick={() => { setDraft(name); setEditing(true) }} className="h-7 w-7 text-zinc-500" aria-label="Rename"><Pencil className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" onClick={onUp} disabled={!onUp || busy} className="h-7 w-7 text-zinc-500" aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" onClick={onDown} disabled={!onDown || busy} className="h-7 w-7 text-zinc-500" aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" onClick={onHide} disabled={busy} className="h-7 w-7 text-zinc-500" aria-label={hidden ? 'Show' : 'Hide'}>{hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</Button>
      </div>
    </div>
  )
}

// Unfiltered reads (including hidden rows) for the "show hidden" toggle.
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
function useCategoriesAll(verticalId: string, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['taxonomyAll', 'categories', verticalId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').eq('vertical_id', verticalId).order('sort_order')
      if (error) throw error
      return data as Category[]
    },
  })
}
function useChannelsAll(verticalId: string, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['taxonomyAll', 'channels', verticalId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('*').eq('vertical_id', verticalId).order('sort_order')
      if (error) throw error
      return data as Channel[]
    },
  })
}
