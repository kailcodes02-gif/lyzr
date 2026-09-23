'use client'

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Crown, Plus, X } from 'lucide-react'
import { useKnownEmails, useUsers } from '@/lib/hooks/use-data'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

export interface OwnerRow { email: string; user_id: string | null; sort_order: number }

// Generic owner chip editor shared by vertical owners and function owners.
// Primary = lowest sort_order (<= 0), same convention as channel owners.
export function OwnersEditor({ owners, canEdit, queryKeys, onAdd, onRemove, onPromote, emptyText = 'No owners yet' }: {
  owners: OwnerRow[]
  canEdit: boolean
  queryKeys: unknown[][]
  onAdd: (email: string, makePrimary: boolean) => Promise<unknown>
  onRemove: (email: string) => Promise<unknown>
  onPromote: (email: string) => Promise<unknown>
  emptyText?: string
}) {
  const queryClient = useQueryClient()
  const { data: users } = useUsers()
  const { data: knownEmails } = useKnownEmails()
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => queryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }))
  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); refresh() } catch (err) { toast.error(`${failMsg}: ${errMsg(err)}`) } finally { setBusy(false) }
  }
  const nameOf = (e: string) => users?.find(u => u.email.toLowerCase() === e.toLowerCase())?.display_name || e.split('@')[0]
  const sorted = [...owners].sort((a, b) => a.sort_order - b.sort_order)
  const listId = useId()

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {sorted.map(o => {
          const primary = o.sort_order <= 0
          return (
            <span key={o.email} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${primary ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-zinc-100 border-zinc-200 text-zinc-700'}`} title={o.email}>
              {primary && <Crown className="w-3 h-3" />}
              {nameOf(o.email)}
              {!o.user_id && <span className="text-[9px] text-zinc-400">(not signed in)</span>}
              {editing && canEdit && (
                <>
                  {!primary && <button onClick={() => run(() => onPromote(o.email), 'Promote failed')} className="text-zinc-400 hover:text-amber-600" title="Make primary"><Crown className="w-3 h-3" /></button>}
                  <button onClick={() => run(() => onRemove(o.email), 'Remove failed')} className="text-zinc-400 hover:text-red-600" title="Remove"><X className="w-3 h-3" /></button>
                </>
              )}
            </span>
          )
        })}
        {sorted.length === 0 && <span className="text-xs text-zinc-400">{emptyText}</span>}
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600" onClick={() => setEditing(e => !e)}>
            {editing ? 'Done' : 'Manage'}
          </Button>
        )}
      </div>
      {editing && canEdit && (
        <form
          onSubmit={e => { e.preventDefault(); if (!email.trim()) return; run(() => onAdd(email, sorted.length === 0), 'Add failed').then(() => setEmail('')) }}
          className="flex items-center gap-2"
        >
          <Input value={email} onChange={e => setEmail(e.target.value)} list={listId} placeholder="name@lyzr.ai" className="h-8 text-xs bg-zinc-50 border-zinc-300 max-w-xs" />
          <datalist id={listId}>{(knownEmails || []).map(e => <option key={e} value={e} />)}</datalist>
          <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white"><Plus className="w-3 h-3 mr-1" />Add</Button>
        </form>
      )}
    </div>
  )
}
