'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Crown, ShieldCheck, Eye, Users, Building2, Workflow, Layers, Plus, X, Search } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { OwnersEditor } from '@/components/vertical/owners-editor'
import { PeopleMap } from '@/components/members/people-map'
import {
  useAllChannelOwners, useAllFunctionOwners, useAllVerticalMembers, useAllVerticalOwners, useBadgeEmails, useChannels,
  useFunctions, useKnownEmails, useMyBadges, useUsers,
} from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import {
  addChannelOwner, addFunctionOwner, addVerticalMember, addVerticalOwner, removeChannelOwner, removeFunctionOwner,
  removeVerticalMember, removeVerticalOwner, setBadge, setPrimaryChannelOwner, setPrimaryFunctionOwner, setPrimaryVerticalOwner,
} from '@/lib/actions'
import { cn } from '@/lib/utils'

// Roles & members. Admins assign anything; vertical owners manage their
// vertical's members and channel owners; channel owners set owners below them.

export default function MembersPage() {
  const badges = useMyBadges()
  const { verticals } = useVertical()
  const { data: users } = useUsers()
  const { data: admins } = useBadgeEmails('admin')
  const { data: leaders } = useBadgeEmails('leadership')
  const { data: vOwners } = useAllVerticalOwners()
  const { data: members } = useAllVerticalMembers()
  const { data: chOwners } = useAllChannelOwners()
  const { data: fnOwners } = useAllFunctionOwners()
  const { data: functions } = useFunctions()
  const { data: channels } = useChannels('all')
  const { data: knownEmails } = useKnownEmails()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [badgeEmail, setBadgeEmail] = useState('')
  const isAdmin = badges.isAdmin

  const refresh = () => ['users', 'badgeEmails', 'verticalOwners', 'verticalMembers', 'channelOwners', 'functionOwners', 'myVerticalIds', 'knownEmails'].forEach(k => qc.invalidateQueries({ queryKey: [k] }))
  const nameOf = (e: string) => users?.find(u => u.email.toLowerCase() === e.toLowerCase())?.display_name || e.split('@')[0]
  const chName = (id: string) => { const c = channels?.find(x => x.id === id); if (!c) return id; const p = c.parent_channel_id ? channels?.find(x => x.id === c.parent_channel_id) : null; return p ? `${p.name} › ${c.name}` : c.name }
  const vName = (id: string) => verticals.find(v => v.id === id)?.name || ''

  // Every person we know about: signed in or referenced anywhere.
  const people = useMemo(() => {
    const set = new Set<string>()
    users?.forEach(u => u.email !== 'preview@lyzr.ai' && set.add(u.email.toLowerCase()))
    ;[...(admins || []), ...(leaders || [])].forEach(e => set.add(e))
    ;[...(vOwners || []), ...(members || []), ...(chOwners || []), ...(fnOwners || [])].forEach(r => set.add(r.email.toLowerCase()))
    // name@lyzr.ai and name@lyzr.com are one person: keep the signed-in spelling, else the .ai one
    const twin = (x: string) => x.endsWith('@lyzr.ai') ? x.replace(/@lyzr\.ai$/, '@lyzr.com') : x.endsWith('@lyzr.com') ? x.replace(/@lyzr\.com$/, '@lyzr.ai') : x
    const signedIn = new Set((users || []).map(u => u.email.toLowerCase()))
    for (const e of [...set]) { const t = twin(e); if (t !== e && set.has(t)) { if (signedIn.has(t) || (!signedIn.has(e) && t.endsWith('@lyzr.ai'))) set.delete(e) } }
    return [...set].sort().filter(e => !q || e.includes(q.toLowerCase()) || nameOf(e).toLowerCase().includes(q.toLowerCase()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, admins, leaders, vOwners, members, chOwners, fnOwners, q])

  const toggleBadge = (kind: 'admin' | 'leadership', email: string, on: boolean) => setBadge(kind, email, on).then(refresh).then(() => toast.success('Updated')).catch(e => toast.error(e?.message || 'Failed'))

  const canManageVertical = (vId: string) => isAdmin || badges.ownedVerticalIds.has(vId)
  const canManageChannel = (chId: string) => {
    const c = channels?.find(x => x.id === chId); if (!c) return false
    if (canManageVertical(c.vertical_id)) return true
    if (badges.ownedChannelIds.has(chId)) return true
    return !!c.parent_channel_id && badges.ownedChannelIds.has(c.parent_channel_id)
  }

  const Badge = ({ children, tone }: { children: React.ReactNode; tone: string }) => <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium', tone)}>{children}</span>

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Users className="w-6 h-6 text-blue-600" /> Members &amp; roles</h1>
        <p className="text-sm text-zinc-500 mt-1">One person can hold several badges. Admins assign anything; vertical owners manage their vertical; channel owners set owners below them.</p>
      </div>

      <Tabs defaultValue="people">
        <TabsList className="bg-zinc-100 border border-zinc-200">
          <TabsTrigger value="people" className="text-xs">People</TabsTrigger>
          <TabsTrigger value="map" className="text-xs">People map</TabsTrigger>
          <TabsTrigger value="verticals" className="text-xs">Verticals</TabsTrigger>
          <TabsTrigger value="domains" className="text-xs">Domains</TabsTrigger>
          <TabsTrigger value="channels" className="text-xs">Channels</TabsTrigger>
        </TabsList>

        {/* ---- People: one row per person, every badge ---- */}
        <TabsContent value="people" className="mt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative"><Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person" className="h-8 pl-8 text-xs bg-white border-zinc-300 w-56" /></div>
            {isAdmin && (
              <form onSubmit={e => { e.preventDefault(); if (!badgeEmail.trim()) return; toggleBadge('leadership', badgeEmail, true).then(() => setBadgeEmail('')) }} className="flex items-center gap-2 ml-auto">
                <Input value={badgeEmail} onChange={e => setBadgeEmail(e.target.value)} list="members-emails" placeholder="Give Leadership to name@lyzr.ai" className="h-8 text-xs bg-white border-zinc-300 w-64" />
                <datalist id="members-emails">{(knownEmails || []).map(e => <option key={e} value={e} />)}</datalist>
                <Button type="submit" size="sm" className="h-8 text-xs bg-blue-600 text-white"><Plus className="w-3 h-3 mr-1" /> Leadership</Button>
              </form>
            )}
          </div>
          <Card className="bg-white border-zinc-200">
            <CardContent className="p-0 divide-y divide-zinc-100">
              {people.map(e => {
                const same = (x: string) => { const y = x.toLowerCase(); return y === e || y === (e.endsWith('@lyzr.ai') ? e.replace(/@lyzr\.ai$/, '@lyzr.com') : e.replace(/@lyzr\.com$/, '@lyzr.ai')) }
                const u = users?.find(x => same(x.email) || (x.alt_email ? same(x.alt_email) : false))
                const isA = (admins || []).some(same) || u?.role === 'admin'
                const isL = (leaders || []).some(same)
                const vo = (vOwners || []).filter(r => same(r.email))
                const vm = (members || []).filter(r => same(r.email) && !vo.some(o => o.vertical_id === r.vertical_id))
                const fo = (fnOwners || []).filter(r => same(r.email))
                const co = (chOwners || []).filter(r => same(r.email) && r.source === 'channel')
                return (
                  <div key={e} className="px-4 py-2.5 flex items-start gap-3">
                    <div className="w-40 shrink-0">
                      <div className="text-sm font-medium text-zinc-900 truncate">{nameOf(e)}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{e}{u?.alt_email && ` · ${u.alt_email}`}{!u && <span className="text-amber-600"> · not signed in</span>}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 flex-1 min-w-0 items-center">
                      {isA && <Badge tone="bg-red-50 border-red-200 text-red-700"><ShieldCheck className="w-3 h-3" /> Admin {isAdmin && <button onClick={() => toggleBadge('admin', e, false)} className="hover:text-red-900"><X className="w-3 h-3" /></button>}</Badge>}
                      {isL && <Badge tone="bg-violet-50 border-violet-200 text-violet-700"><Eye className="w-3 h-3" /> Leadership {isAdmin && <button onClick={() => toggleBadge('leadership', e, false)} className="hover:text-violet-900"><X className="w-3 h-3" /></button>}</Badge>}
                      {vo.map(r => <Badge key={r.vertical_id} tone="bg-amber-50 border-amber-200 text-amber-800"><Crown className="w-3 h-3" /> {vName(r.vertical_id)} owner</Badge>)}
                      {fo.map(r => <Badge key={r.function_id} tone="bg-emerald-50 border-emerald-200 text-emerald-800"><Workflow className="w-3 h-3" /> {functions?.find(f => f.id === r.function_id)?.name} domain</Badge>)}
                      {co.map(r => <Badge key={r.channel_id} tone="bg-blue-50 border-blue-200 text-blue-800"><Layers className="w-3 h-3" /> {vName(channels?.find(c => c.id === r.channel_id)?.vertical_id || '')} › {chName(r.channel_id)}</Badge>)}
                      {vm.map(r => <Badge key={r.vertical_id} tone="bg-zinc-100 border-zinc-200 text-zinc-600"><Building2 className="w-3 h-3" /> {vName(r.vertical_id)} member</Badge>)}
                      {!isA && !isL && !vo.length && !fo.length && !co.length && !vm.length && <span className="text-[11px] text-zinc-400">member only</span>}
                      {isAdmin && !isA && <button onClick={() => toggleBadge('admin', e, true)} className="text-[10px] text-zinc-400 hover:text-red-700">+ admin</button>}
                      {isAdmin && !isL && <button onClick={() => toggleBadge('leadership', e, true)} className="text-[10px] text-zinc-400 hover:text-violet-700">+ leadership</button>}
                    </div>
                  </div>
                )
              })}
              {people.length === 0 && <p className="p-6 text-sm text-zinc-500 text-center">Nobody matches.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map" className="mt-4"><PeopleMap /></TabsContent>

        {/* ---- Verticals: owners + members ---- */}
        <TabsContent value="verticals" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {verticals.map(v => (
            <Card key={v.id} className="bg-white border-zinc-200">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" /> {v.name}</CardTitle>
                <CardDescription className="text-xs">Owners manage the vertical. Members can create tasks in it. <InfoTip k="vertical_member" /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Owners <InfoTip k="vertical_owner" /></p>
                  <OwnersEditor owners={(vOwners || []).filter(o => o.vertical_id === v.id)} canEdit={isAdmin}
                    queryKeys={[['verticalOwners'], ['myVerticalIds'], ['knownEmails']]}
                    onAdd={(email, primary) => addVerticalOwner(v.id, email, primary)} onRemove={email => removeVerticalOwner(v.id, email)} onPromote={email => setPrimaryVerticalOwner(v.id, email)} />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Members</p>
                  <OwnersEditor owners={(members || []).filter(m => m.vertical_id === v.id).map((m, i) => ({ email: m.email, user_id: m.user_id, sort_order: i + 1 }))} canEdit={canManageVertical(v.id)}
                    queryKeys={[['verticalMembers']]} emptyText="No explicit members (owners of channels here count automatically)"
                    onAdd={email => addVerticalMember(v.id, email)} onRemove={email => removeVerticalMember(v.id, email)} onPromote={async () => {}} />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ---- Domains ---- */}
        <TabsContent value="domains" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(functions || []).map(f => (
            <Card key={f.id} className="bg-white border-zinc-200">
              <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Workflow className="w-4 h-4 text-emerald-600" /> {f.name} <InfoTip k="function_owner" /></CardTitle></CardHeader>
              <CardContent>
                <OwnersEditor owners={(fnOwners || []).filter(o => o.function_id === f.id)} canEdit={isAdmin}
                  queryKeys={[['functionOwners'], ['channelOwners'], ['knownEmails']]}
                  onAdd={(email, primary) => addFunctionOwner(f.id, email, primary)} onRemove={email => removeFunctionOwner(f.id, email)} onPromote={email => setPrimaryFunctionOwner(f.id, email)} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ---- Channels: only the ones the viewer may manage ---- */}
        <TabsContent value="channels" className="mt-4 space-y-4">
          {verticals.map(v => {
            const list = (channels || []).filter(c => c.vertical_id === v.id && c.is_active && canManageChannel(c.id))
            if (!list.length) return null
            const top = list.filter(c => !c.parent_channel_id)
            return (
              <Card key={v.id} className="bg-white border-zinc-200">
                <CardHeader className="py-3"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" /> {v.name}</CardTitle></CardHeader>
                <CardContent className="divide-y divide-zinc-100">
                  {[...top, ...list.filter(c => c.parent_channel_id && !top.some(t => t.id === c.parent_channel_id))].map(ch => (
                    <div key={ch.id} className="py-2">
                      <div className="flex items-start gap-3">
                        <div className="w-44 shrink-0 text-sm text-zinc-800">{chName(ch.id)}</div>
                        <OwnersEditor owners={(chOwners || []).filter(o => o.channel_id === ch.id && o.source === 'channel')} canEdit
                          queryKeys={[['channelOwners'], ['knownEmails']]} emptyText="inherits domain owner"
                          onAdd={(email, primary) => addChannelOwner(ch.id, email, primary)} onRemove={email => removeChannelOwner(ch.id, email)} onPromote={email => setPrimaryChannelOwner(ch.id, email)} />
                      </div>
                      {list.filter(c => c.parent_channel_id === ch.id).map(sub => (
                        <div key={sub.id} className="flex items-start gap-3 mt-1.5 pl-6">
                          <div className="w-[152px] shrink-0 text-xs text-zinc-600">› {sub.name}</div>
                          <OwnersEditor owners={(chOwners || []).filter(o => o.channel_id === sub.id && o.source === 'channel')} canEdit
                            queryKeys={[['channelOwners'], ['knownEmails']]} emptyText="inherits parent"
                            onAdd={(email, primary) => addChannelOwner(sub.id, email, primary)} onRemove={email => removeChannelOwner(sub.id, email)} onPromote={email => setPrimaryChannelOwner(sub.id, email)} />
                        </div>
                      ))}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })}
          {!isAdmin && badges.ownedVerticalIds.size === 0 && badges.ownedChannelIds.size === 0 && <p className="text-sm text-zinc-500">You do not own a vertical or channel, so there is nothing to arrange here.</p>}
        </TabsContent>
      </Tabs>
    </div>
  )
}
