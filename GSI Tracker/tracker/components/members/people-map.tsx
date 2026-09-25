'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Crown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { useAllChannelOwners, useAllFunctionOwners, useAllVerticalOwners, useChannels, useFunctions, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { cn } from '@/lib/utils'

// Who is where: rows = domains (and the channels under them), columns =
// verticals, cells = the people. Inherited domain owners are dimmed.

export function PeopleMap({ verticalId, compact }: { verticalId?: string | 'all'; compact?: boolean }) {
  const { verticals } = useVertical()
  const { data: channels } = useChannels('all')
  const { data: functions } = useFunctions()
  const { data: chOwners } = useAllChannelOwners()
  const { data: fnOwners } = useAllFunctionOwners()
  const { data: vOwners } = useAllVerticalOwners()
  const { data: users } = useUsers()

  const cols = useMemo(() => verticals.filter(v => !verticalId || verticalId === 'all' || v.id === verticalId), [verticals, verticalId])
  const nameOf = (email: string) => users?.find(u => u.email.toLowerCase() === email.toLowerCase())?.display_name?.split(' ')[0] || email.split('@')[0]

  // Rows: each domain, then channels grouped by domain (unlinked channels last).
  const rows = useMemo(() => {
    const active = (channels || []).filter(c => c.is_active)
    const top = active.filter(c => !c.parent_channel_id)
    const out: { key: string; label: string; depth: number; fnId: string | null; channelIds: Map<string, string[]> }[] = []
    const byFn = new Map<string | null, typeof top>()
    top.forEach(c => { const k = c.function_id; if (!byFn.has(k)) byFn.set(k, []); byFn.get(k)!.push(c) })
    const fns = [...(functions || []).filter(f => byFn.has(f.id)), null as null]
    for (const f of fns) {
      const list = byFn.get(f ? f.id : null) || []
      if (!list.length) continue
      // one row per distinct channel name inside the domain, cell = that vertical's instance(s)
      const names = [...new Set(list.map(c => c.name))].sort()
      if (f) out.push({ key: `fn:${f.id}`, label: f.name, depth: 0, fnId: f.id, channelIds: new Map() })
      for (const n of names) {
        const m = new Map<string, string[]>()
        list.filter(c => c.name === n).forEach(c => { if (!m.has(c.vertical_id)) m.set(c.vertical_id, []); m.get(c.vertical_id)!.push(c.id) })
        out.push({ key: `ch:${f?.id || 'none'}:${n}`, label: n, depth: f ? 1 : 0, fnId: f?.id || null, channelIds: m })
      }
    }
    return out
  }, [channels, functions])

  const cell = (r: typeof rows[number], vId: string) => {
    if (r.depth === 0 && r.fnId && !r.channelIds.size) {
      const o = (fnOwners || []).filter(x => x.function_id === r.fnId)
      return o.map(x => ({ email: x.email, primary: x.sort_order <= 0, inherited: false }))
    }
    const ids = r.channelIds.get(vId) || []
    if (!ids.length) return null
    const o = (chOwners || []).filter(x => ids.includes(x.channel_id))
    return o.map(x => ({ email: x.email, primary: x.sort_order <= 0, inherited: x.source === 'function' }))
  }

  return (
    <Card className="bg-white border-zinc-200">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">People map <InfoTip k="people_map" /></CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-600">
              <th className="text-left px-3 py-2 font-medium w-44">Domain › channel</th>
              {cols.map(v => (
                <th key={v.id} className="text-left px-3 py-2 font-medium">
                  <Link href={withVertical('/dashboard/', v.slug)} className="hover:text-blue-700">{v.name}</Link>
                  <div className="font-normal text-[10px] text-zinc-500 inline-flex items-center gap-1 ml-1">
                    <Crown className="w-3 h-3 text-amber-500" />{(vOwners || []).filter(o => o.vertical_id === v.id).map(o => nameOf(o.email)).join(', ') || 'no owner'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.slice(0, compact ? 14 : undefined).map(r => (
              <tr key={r.key} className={cn(r.depth === 0 && 'bg-zinc-50/60')}>
                <td className={cn('px-3 py-1.5 whitespace-nowrap', r.depth === 0 ? 'font-semibold text-zinc-800' : 'pl-6 text-zinc-700')}>
                  {r.label}
                </td>
                {cols.map(v => {
                  const people = cell(r, v.id)
                  const ids = r.channelIds.get(v.id) || []
                  const inner = people === null
                    ? <span className="text-zinc-300">·</span>
                    : people.length === 0
                      ? <span className="text-red-500 text-[10px]">no owner</span>
                      : people.map(p => (
                        <span key={p.email} title={p.email} className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 mr-1 mb-0.5', p.inherited ? 'bg-zinc-100 text-zinc-500' : 'bg-blue-50 text-blue-800', p.primary && !p.inherited && 'font-semibold')}>
                          {p.primary && !p.inherited && <Crown className="w-2.5 h-2.5 text-amber-500" />}{nameOf(p.email)}
                        </span>
                      ))
                  return (
                    <td key={v.id} className="px-3 py-1.5 align-top">
                      {ids.length ? <Link href={withVertical('/channel/', v.slug, { id: ids[0] })} className="block hover:opacity-80">{inner}</Link> : inner}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {compact && rows.length > 14 && <Link href="/members/" className="block px-3 py-2 text-[11px] text-blue-600 hover:underline">See everyone on the Members page</Link>}
      </CardContent>
    </Card>
  )
}
