'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2, Mail, Unlink, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'

// One person, one account, several ways to sign in (Google @lyzr.ai,
// Microsoft @lyzr.com, Slack). Linking needs "manual linking" switched on in
// Supabase › Authentication › Settings.

type Identity = { id: string; provider: string; identity_data?: Record<string, unknown> }
const PROVIDERS: { id: 'google' | 'azure' | 'slack_oidc'; label: string; hint: string }[] = [
  { id: 'google', label: 'Google', hint: 'name@lyzr.ai' },
  { id: 'azure', label: 'Microsoft', hint: 'name@lyzr.com' },
  { id: 'slack_oidc', label: 'Slack', hint: 'Lyzr workspace' },
]

export default function LinkedAccountsPage() {
  const supabase = createClient()
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState<{ emails?: string[]; linked_rows?: number } | null>(null)
  const { data: identities = [] } = useQuery({
    queryKey: ['myIdentities'],
    queryFn: async () => { const { data } = await supabase.auth.getUserIdentities(); return (data?.identities || []) as Identity[] },
  })
  const load = () => qc.invalidateQueries({ queryKey: ['myIdentities'] })

  const sync = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('link_my_emails')
      if (error) throw error
      setLinked(data as { emails?: string[]; linked_rows?: number })
      qc.invalidateQueries({ queryKey: ['currentUser'] }); qc.invalidateQueries({ queryKey: ['channelOwners'] }); qc.invalidateQueries({ queryKey: ['verticalOwners'] }); qc.invalidateQueries({ queryKey: ['verticalMembers'] })
      toast.success('Emails synced')
    } catch (e: any) { toast.error(e?.message || 'Sync failed') } finally { setBusy(false) }
  }

  const link = async (provider: 'google' | 'azure' | 'slack_oidc') => {
    setBusy(true)
    const redirectTo = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/me/accounts/?linked=1`
    const opts: Record<string, unknown> = { redirectTo }
    if (provider === 'azure') opts.scopes = 'openid profile email User.Read'
    const { error } = await supabase.auth.linkIdentity({ provider, options: opts })
    if (error) { toast.error(error.message.includes('Manual linking') ? 'Ask an admin to enable manual linking in Supabase (Authentication › Settings).' : error.message); setBusy(false) }
  }

  const unlink = async (idn: Identity) => {
    if (identities.length < 2) { toast.error('Keep at least one way to sign in'); return }
    if (!confirm(`Remove ${idn.provider} sign-in from your account?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.auth.unlinkIdentity(idn as any)
      if (error) throw error
      load(); toast.success('Removed')
    } catch (e: any) { toast.error(e?.message || 'Failed') } finally { setBusy(false) }
  }

  // After coming back from a link redirect, re-attach rows under the new email.
  useEffect(() => {
    if (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('linked') !== '1') return
    window.history.replaceState(null, '', window.location.pathname)
    const t = setTimeout(() => { sync().then(load) }, 0)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const has = (p: string) => identities.find(i => i.provider === p)
  const emailOf = (i: Identity) => String(i.identity_data?.email || '')

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-3xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Link2 className="w-6 h-6 text-blue-600" /> Linked accounts <InfoTip k="linked_accounts" /></h1>
        <p className="text-sm text-zinc-500 mt-1">One tracker account, several ways in. Your lyzr.ai and lyzr.com addresses count as the same person.</p>
      </div>

      <Card className="bg-white border-zinc-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Mail className="w-4 h-4 text-zinc-500" /> Your emails</CardTitle>
          <CardDescription className="text-xs">Anything assigned to either address lands on this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-zinc-800">{me?.email}{me?.alt_email && <span className="text-zinc-500"> · also {me.alt_email}</span>}</div>
          <Button size="sm" variant="outline" className="h-8 text-xs border-zinc-300" disabled={busy} onClick={sync}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-sync ownership for both addresses</Button>
          {linked && <p className="text-[11px] text-zinc-500">Known addresses: {(linked.emails || []).join(', ')}. Rows attached: {linked.linked_rows ?? 0}.</p>}
        </CardContent>
      </Card>

      <Card className="bg-white border-zinc-200">
        <CardHeader className="py-3"><CardTitle className="text-sm font-semibold">Sign-in methods</CardTitle></CardHeader>
        <CardContent className="divide-y divide-zinc-100">
          {PROVIDERS.map(p => {
            const idn = has(p.id)
            return (
              <div key={p.id} className="py-2.5 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-900">{p.label}</div>
                  <div className="text-[11px] text-zinc-500">{idn ? emailOf(idn) || 'linked' : p.hint}</div>
                </div>
                {idn
                  ? <Button size="sm" variant="ghost" className="h-8 text-xs text-zinc-500 hover:text-red-600" disabled={busy} onClick={() => unlink(idn)}><Unlink className="w-3.5 h-3.5 mr-1" /> Remove</Button>
                  : <Button size="sm" className="h-8 text-xs bg-blue-600 text-white" disabled={busy} onClick={() => link(p.id)}><Link2 className="w-3.5 h-3.5 mr-1" /> Link {p.label}</Button>}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
