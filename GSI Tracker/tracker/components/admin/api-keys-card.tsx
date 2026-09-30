'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { cn } from '@/lib/utils'

// API keys for the tracker's REST API (/api/v1, a Pages Function). A key acts
// as the admin who creates it. Only a SHA-256 hash is stored; the key itself
// is shown once, right after it is made.

type ApiKey = { id: string; name: string; prefix: string; scope: 'read' | 'write'; created_at: string; last_used_at: string | null; revoked_at: string | null; user_id: string }

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(30))
  return 'lzt_' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}
const when = (s: string | null) => s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never'

export function ApiKeysCard() {
  const supabase = createClient()
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const { data: keys, error } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: async () => {
      const { data, error } = await supabase.from('api_keys').select('id,name,prefix,scope,created_at,last_used_at,revoked_at,user_id').order('created_at', { ascending: false })
      if (error) throw error
      return data as ApiKey[]
    },
  })
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const base = typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1'

  const create = async () => {
    if (!me || !name.trim()) return
    setBusy(true)
    try {
      const key = newKey()
      const { error } = await supabase.from('api_keys').insert({ name: name.trim(), prefix: key.slice(0, 12), key_hash: await sha256Hex(key), user_id: me.id, scope })
      if (error) throw error
      setFresh(key); setCopied(false); setName('')
      qc.invalidateQueries({ queryKey: ['apiKeys'] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create the key') }
    finally { setBusy(false) }
  }
  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`)) return
    const { error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', k.id)
    if (error) toast.error(error.message); else { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['apiKeys'] }) }
  }
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { toast.error('Copy failed — select the key and copy it manually') } }

  const notInstalled = error && /api_keys|schema cache|does not exist/i.test(String((error as Error).message))

  return (
    <Card className="bg-white border-zinc-200">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2"><KeyRound className="w-4 h-4 text-orange-500" /> API keys</CardTitle>
        <CardDescription className="text-zinc-500 text-xs leading-relaxed">
          Let other tools — Lyzr agents, Slack bots, scripts, reports — read and update the tracker through its API.
          A key acts as <strong>you</strong>: it can do exactly what you can, and every change it makes shows in History under your name.
          <strong> Read</strong> keys can only look; <strong>write</strong> keys can also create, change and delete.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {notInstalled ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">API keys need database update <strong>029</strong> first (supabase/migrations/029_api_keys.sql).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create() }}
                placeholder="What is it for? e.g. Weekly report agent" className="h-9 bg-white border-zinc-300 text-sm w-72" />
              <div className="inline-flex rounded-md border border-zinc-300 overflow-hidden text-xs">
                {(['read', 'write'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setScope(s)}
                    className={cn('h-9 px-3', scope === s ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50')}>
                    {s === 'read' ? 'Read only' : 'Read & write'}
                  </button>
                ))}
              </div>
              <Button onClick={create} disabled={busy || !name.trim()} className="h-9 bg-orange-500 hover:bg-orange-600 text-white"><Plus className="w-4 h-4 mr-1" /> Create key</Button>
            </div>

            {fresh && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                <p className="text-xs font-medium text-emerald-900">Copy this key now — it won’t be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded bg-white border border-emerald-200 px-2 py-1.5 text-xs text-zinc-900 select-all">{fresh}</code>
                  <Button size="sm" variant="outline" className="h-8 border-emerald-300" onClick={() => copy(fresh)}>
                    {copied ? <><Check className="w-3.5 h-3.5 mr-1" /> Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" /> Copy</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setFresh(null)}>Done</Button>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
              {(keys || []).length === 0 && <p className="px-3 py-4 text-xs text-zinc-500">No keys yet.</p>}
              {(keys || []).map(k => (
                <div key={k.id} className={cn('flex items-center gap-3 px-3 py-2.5', k.revoked_at && 'opacity-50')}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-900 truncate">{k.name}
                      <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium', k.scope === 'write' ? 'bg-orange-50 text-orange-700' : 'bg-zinc-100 text-zinc-600')}>{k.scope === 'write' ? 'read & write' : 'read only'}</span>
                      {k.revoked_at && <span className="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">revoked</span>}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">{k.prefix}… · created {when(k.created_at)} · last used {when(k.last_used_at)}</div>
                  </div>
                  {!k.revoked_at && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500 hover:text-red-600" onClick={() => revoke(k)}><Trash2 className="w-3.5 h-3.5 mr-1" /> Revoke</Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-900">Quick start</p>
          <pre className="text-[11px] leading-relaxed text-zinc-700 overflow-x-auto whitespace-pre">{`# What's overdue in GSI?
curl -H "Authorization: Bearer lzt_…" "${base}/tasks?vertical=gsi&overdue=true"

# Create a task (goes to Lyzr's "No channel" unless you give channel_id)
curl -X POST -H "Authorization: Bearer lzt_…" -H "Content-Type: application/json" \\
  -d '{"title":"Draft Q4 newsletter","owners":["anju.menon@lyzr.com"],"due_date":"2026-10-15","priority":"high"}' \\
  "${base}/tasks"`}</pre>
          <p className="text-[11px] text-zinc-500">
            Every endpoint is described in <a href={`${base}/openapi.json`} target="_blank" rel="noopener" className="text-blue-600 hover:underline">openapi.json</a> — import it into Postman, an agent builder or a GPT action.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
