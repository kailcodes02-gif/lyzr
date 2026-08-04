'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useChannelOwners, useChannelResources, useChannelLearnings, useChannelTargets,
  useCurrentUser, useUsers, useKnownEmails,
} from '@/lib/hooks/use-data'
import {
  addChannelResource, deleteChannelResource,
  addChannelLearning, deleteChannelLearning,
  addChannelTarget, deleteChannelTarget,
  addChannelOwner, removeChannelOwner, setPrimaryChannelOwner,
  updateChannelDescription,
} from '@/lib/actions'
import { TIER_CONFIG, type ChannelTier } from '@/lib/types/database'
import { Crown, Link2, Lightbulb, Pencil, Plus, Target, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

export function TierBadge({ tier, className = '' }: { tier: ChannelTier | null | undefined; className?: string }) {
  if (!tier) return null
  const cfg = TIER_CONFIG[tier]
  return (
    <Badge variant="outline" className={`border-zinc-300 bg-zinc-100/70 text-zinc-700 gap-1 font-medium ${className}`}>
      <span aria-hidden>{cfg.emoji}</span> {cfg.label}
    </Badge>
  )
}

// Owner chips with explicit Primary / Secondary callout. The first owner
// (lowest sort_order) is the channel's primary. Admins get a manage editor:
// add by email, promote to primary, remove.
export function ChannelOwnerChips({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient()
  const { data: owners } = useChannelOwners(channelId)
  const { data: users } = useUsers()
  const { data: me } = useCurrentUser()
  const { data: knownEmails } = useKnownEmails()
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['channelOwners', channelId] })
  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); refresh() } catch (err) { toast.error(`${failMsg}: ${errMsg(err)}`) } finally { setBusy(false) }
  }

  const isAdmin = me?.role === 'admin'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Users className="w-3.5 h-3.5 text-zinc-500" />
        {!owners?.length && <span className="text-xs text-zinc-400">No owners assigned</span>}
        {owners?.map((o, idx) => {
          const user = users?.find(u => u.id === o.user_id)
          const label = user?.display_name || o.email.split('@')[0]
          const isPrimary = idx === 0
          return (
            <Badge
              key={o.email}
              variant="outline"
              className={`text-[11px] gap-1 ${
                isPrimary
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : o.user_id ? 'border-zinc-300 bg-zinc-100 text-zinc-700' : 'border-zinc-300 bg-zinc-100/50 text-zinc-500'
              }`}
              title={`${o.email}${o.user_id ? '' : ' — has not signed in yet'}`}
            >
              {isPrimary && <Crown className="w-3 h-3" />}
              {label}
              <span className="text-[9px] uppercase tracking-wide opacity-70">{isPrimary ? 'Primary' : 'Secondary'}</span>
              {isAdmin && editing && (
                <span className="flex items-center gap-0.5 ml-0.5">
                  {!isPrimary && (
                    <button
                      title="Make primary"
                      onClick={() => run(() => setPrimaryChannelOwner(channelId, o.email), 'Failed to set primary')}
                      className="hover:text-amber-600"
                    >
                      <Crown className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    title="Remove owner"
                    onClick={() => run(() => removeChannelOwner(channelId, o.email), 'Failed to remove owner')}
                    className="hover:text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </Badge>
          )
        })}
        {isAdmin && (
          <button
            onClick={() => setEditing(e => !e)}
            className="text-[11px] text-blue-600 hover:text-blue-700 font-medium ml-1"
          >
            {editing ? 'Done' : 'Manage'}
          </button>
        )}
      </div>
      {isAdmin && editing && (
        <div className="flex items-center gap-2">
          <Input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="email@lyzr.ai"
            list="known-owner-emails-channel"
            className="h-7 w-56 text-xs bg-white border-zinc-300 text-zinc-800"
            onKeyDown={e => {
              if (e.key === 'Enter' && email.trim()) {
                run(() => addChannelOwner(channelId, email, false).then(() => setEmail('')), 'Failed to add owner')
              }
            }}
          />
          <datalist id="known-owner-emails-channel">
            {knownEmails?.map(e => <option key={e} value={e} />)}
          </datalist>
          <Button
            size="sm" disabled={busy || !email.trim()}
            onClick={() => run(() => addChannelOwner(channelId, email, false).then(() => setEmail('')), 'Failed to add owner')}
            className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs"
          >
            Add secondary
          </Button>
          <Button
            size="sm" variant="outline" disabled={busy || !email.trim()}
            onClick={() => run(() => addChannelOwner(channelId, email, true).then(() => setEmail('')), 'Failed to add owner')}
            className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <Crown className="w-3 h-3 mr-1" /> Add as primary
          </Button>
        </div>
      )}
    </div>
  )
}

// Inline, always-visible target chips for the channel header
export function ChannelTargetChips({ channelId }: { channelId: string }) {
  const { data: targets } = useChannelTargets(channelId)
  if (!targets?.length) return null
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {targets.map(t => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">
          <Target className="w-3 h-3 shrink-0" />{t.body}
        </span>
      ))}
    </div>
  )
}

// Channel/sub-channel description (the `goal` column) with admin inline edit
export function ChannelDescription({ channelId, goal }: { channelId: string; goal: string | null }) {
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal || '')
  const [busy, setBusy] = useState(false)
  const isAdmin = me?.role === 'admin'

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await updateChannelDescription(channelId, draft)
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['channels'] })
    } catch (err) {
      toast.error(`Failed to save description: ${errMsg(err)}`)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-start gap-2 max-w-2xl mt-1">
        <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          className="text-sm bg-white border-zinc-300 text-zinc-800 resize-none" />
        <div className="flex flex-col gap-1">
          <Button size="sm" onClick={save} disabled={busy} className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(goal || '') }} className="h-7 text-xs text-zinc-500">Cancel</Button>
        </div>
      </div>
    )
  }
  if (!goal && !isAdmin) return null
  return (
    <p className="text-sm text-zinc-600 mt-1 max-w-2xl group/desc">
      {goal || <span className="italic text-zinc-400">No description yet</span>}
      {isAdmin && (
        <button onClick={() => { setDraft(goal || ''); setEditing(true) }}
          className="ml-2 text-zinc-400 hover:text-blue-600 align-middle" title="Edit description">
          <Pencil className="w-3.5 h-3.5 inline" />
        </button>
      )}
    </p>
  )
}

export function ChannelTargetsCard({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient()
  const { data: targets } = useChannelTargets(channelId)
  const { data: me } = useCurrentUser()
  const [ttype, setTtype] = useState('')
  const [tvalue, setTvalue] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['channelTargets', channelId] })

  const submit = async () => {
    if (!ttype.trim() || !tvalue.trim() || busy) return
    setBusy(true)
    try {
      await addChannelTarget(channelId, `${ttype.trim()}: ${tvalue.trim()}`)
      setTtype(''); setTvalue('')
      refresh()
    } catch (err) {
      toast.error(`Failed to add target: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="bg-white border-zinc-200 backdrop-blur-xl">
      <CardHeader className="py-4">
        <CardTitle className="text-sm text-zinc-700 flex items-center gap-2">
          <Target className="w-4 h-4 text-emerald-600" /> Targets
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div className="flex gap-2">
          <Input value={ttype} onChange={e => setTtype(e.target.value)} placeholder="Type (e.g. Attendees)"
            className="h-8 text-xs bg-white border-zinc-300 text-zinc-800 w-36" />
          <Input value={tvalue} onChange={e => setTvalue(e.target.value)} placeholder="Value (e.g. 100/webinar)"
            onKeyDown={e => e.key === 'Enter' && submit()}
            className="h-8 text-xs bg-white border-zinc-300 text-zinc-800" />
          <Button size="sm" onClick={submit} disabled={busy || !ttype.trim() || !tvalue.trim()}
            className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs">Add</Button>
        </div>
        {!targets?.length && <p className="text-xs text-zinc-500 py-1">No targets set yet.</p>}
        {targets?.map(t => (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100/50 border border-zinc-200 px-3 py-1.5 group">
            <p className="text-xs text-zinc-700">{t.body}</p>
            {(me?.role === 'admin' || me?.id === t.added_by) && (
              <button
                onClick={async () => {
                  try { await deleteChannelTarget(t.id); refresh() }
                  catch (err) { toast.error(`Failed to delete target: ${err instanceof Error ? err.message : 'unknown error'}`) }
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-600 transition-opacity shrink-0"
                title="Delete target"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ChannelResourcesCard({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient()
  const { data: resources } = useChannelResources(channelId)
  const { data: me } = useCurrentUser()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['channelResources', channelId] })

  const submit = async () => {
    if (!name.trim() || !url.trim() || busy) return
    setBusy(true)
    try {
      await addChannelResource(channelId, name, url.startsWith('http') ? url : `https://${url}`)
      setName(''); setUrl(''); setAdding(false)
      refresh()
    } catch (err) {
      toast.error(`Failed to add resource: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="bg-white border-zinc-200 backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-sm text-zinc-700 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-blue-600" /> Resources
        </CardTitle>
        <Button size="sm" variant="ghost" className="text-xs text-blue-600 hover:text-blue-700 h-7 px-2"
          onClick={() => setAdding(a => !a)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {adding && (
          <div className="flex flex-col sm:flex-row gap-2 pb-2">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name"
              className="h-8 text-xs bg-white border-zinc-300 text-zinc-800" />
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="h-8 text-xs bg-white border-zinc-300 text-zinc-800" />
            <Button size="sm" onClick={submit} disabled={busy || !name.trim() || !url.trim()}
              className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs">Save</Button>
          </div>
        )}
        {!resources?.length && !adding && (
          <p className="text-xs text-zinc-500 py-2">No resources yet.</p>
        )}
        {resources?.map(r => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-100 group">
            <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline truncate">
              {r.name}
            </a>
            {(me?.role === 'admin' || me?.id === r.added_by) && (
              <button
                onClick={async () => {
                  try { await deleteChannelResource(r.id); refresh() }
                  catch (err) { toast.error(`Failed to delete resource: ${err instanceof Error ? err.message : 'unknown error'}`) }
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-600 transition-opacity"
                title="Delete resource"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ChannelLearningsCard({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient()
  const { data: learnings } = useChannelLearnings(channelId)
  const { data: me } = useCurrentUser()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['channelLearnings', channelId] })

  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    try {
      await addChannelLearning(channelId, body)
      setBody('')
      refresh()
    } catch (err) {
      toast.error(`Failed to add learning: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="bg-white border-zinc-200 backdrop-blur-xl">
      <CardHeader className="py-4">
        <CardTitle className="text-sm text-zinc-700 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-600" /> Learnings
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex gap-2">
          <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="What did this channel teach us?"
            rows={2} className="text-xs bg-white border-zinc-300 text-zinc-800 resize-none" />
          <Button size="sm" onClick={submit} disabled={busy || !body.trim()}
            className="self-end h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs">Add</Button>
        </div>
        {!learnings?.length && <p className="text-xs text-zinc-500">No learnings recorded yet.</p>}
        {learnings?.map(l => (
          <div key={l.id} className="flex items-start justify-between gap-2 rounded-lg bg-zinc-100/50 border border-zinc-200 px-3 py-2 group">
            <p className="text-xs text-zinc-700 whitespace-pre-wrap">{l.body}</p>
            {(me?.role === 'admin' || me?.id === l.added_by) && (
              <button
                onClick={async () => {
                  try { await deleteChannelLearning(l.id); refresh() }
                  catch (err) { toast.error(`Failed to delete learning: ${err instanceof Error ? err.message : 'unknown error'}`) }
                }}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-600 transition-opacity shrink-0"
                title="Delete learning"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
