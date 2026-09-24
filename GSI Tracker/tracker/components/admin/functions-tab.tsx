'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Workflow, Plus, Trash2, ExternalLink } from 'lucide-react'
import { useFunctions, useAllFunctionOwners, useChannels, useVerticals } from '@/lib/hooks/use-data'
import {
  createFunction, updateFunction, deleteFunction, addFunctionOwner, removeFunctionOwner, setPrimaryFunctionOwner, setChannelFunction,
} from '@/lib/actions'
import { OwnersEditor } from '@/components/vertical/owners-editor'
import { InfoTip } from '@/components/ui/info-tip'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

export function FunctionsTab() {
  const queryClient = useQueryClient()
  const { data: functions } = useFunctions(true)
  const { data: owners } = useAllFunctionOwners()
  const { data: channels } = useChannels('all')
  const { data: verticals } = useVerticals(true)
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [mapVertical, setMapVertical] = useState('all')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['functions'] })
    queryClient.invalidateQueries({ queryKey: ['functionOwners'] })
    queryClient.invalidateQueries({ queryKey: ['channels'] })
    queryClient.invalidateQueries({ queryKey: ['channelOwners'] })
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      try {
        await createFunction({ name, sort_order: (functions?.length || 0) + 1 })
        setName(''); refresh(); toast.success('Function created')
      } catch (err) { toast.error(errMsg(err)) }
    })
  }

  const topChannels = (channels || []).filter(c => !c.parent_channel_id && (mapVertical === 'all' || c.vertical_id === mapVertical))
  const verticalName = (id: string) => verticals?.find(v => v.id === id)?.name || ''

  return (
    <div className="space-y-6">
      <Card className="bg-white border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2"><Workflow className="w-4 h-4 text-emerald-600" /> Functions <InfoTip k="function" /></CardTitle>
          <CardDescription className="text-zinc-500 text-xs">
            A function (Content, Social, Paid…) is the same discipline across verticals. Its owners are inherited by every vertical&apos;s channel of that function unless the vertical sets its own, and the function owner gets one roll-up view across verticals.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleCreate} className="flex items-center gap-2 max-w-md">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="New function name" className="bg-zinc-100 border-zinc-300 text-xs h-9" />
            <Button type="submit" disabled={isPending || !name.trim()} className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-9 shrink-0"><Plus className="w-4 h-4 mr-1" /> Add</Button>
          </form>
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            {(functions || []).map(f => {
              const instances = (channels || []).filter(c => c.function_id === f.id && !c.parent_channel_id)
              return (
                <div key={f.id} className={`p-3 space-y-2 ${f.is_active ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-zinc-800">{f.name}</p>
                    <span className="font-mono text-[10px] text-zinc-400">{f.slug}</span>
                    {!f.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                    <span className="text-[11px] text-zinc-500">{instances.length} channel{instances.length === 1 ? '' : 's'} across {new Set(instances.map(i => i.vertical_id)).size} vertical{new Set(instances.map(i => i.vertical_id)).size === 1 ? '' : 's'}</span>
                    <span className="flex-1" />
                    <Link href={`/function/?id=${f.id}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View</Link>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => updateFunction({ id: f.id, is_active: !f.is_active }).then(refresh).catch(err => toast.error(errMsg(err)))}>
                      {f.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-600" aria-label="Delete function"
                      onClick={() => { if (confirm(`Delete function "${f.name}"? Channels keep working, they just lose the link.`)) deleteFunction(f.id).then(refresh).catch(err => toast.error(errMsg(err))) }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <OwnersEditor
                    owners={(owners || []).filter(o => o.function_id === f.id)} canEdit
                    queryKeys={[['functionOwners'], ['channelOwners'], ['knownEmails']]}
                    onAdd={(email, primary) => addFunctionOwner(f.id, email, primary)}
                    onRemove={email => removeFunctionOwner(f.id, email)}
                    onPromote={email => setPrimaryFunctionOwner(f.id, email)}
                    emptyText="No default owners; verticals set their own channel owners"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-zinc-200">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base font-semibold text-zinc-900">Channel to function mapping</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">Top-level channels only; sub-channels inherit their parent&apos;s function.</CardDescription>
            </div>
            <div className="w-48">
              <Select value={mapVertical} onValueChange={v => setMapVertical(v || 'all')}>
                <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                  <SelectItem value="all">All verticals</SelectItem>
                  {(verticals || []).map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600 font-medium">
                <th className="text-left py-2 px-3">Vertical</th><th className="text-left py-2 px-3">Channel</th><th className="text-left py-2 px-3">Function</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {topChannels.map(ch => (
                <tr key={ch.id}>
                  <td className="py-2 px-3 text-zinc-500">{verticalName(ch.vertical_id)}</td>
                  <td className="py-2 px-3 font-medium text-zinc-800">{ch.name}</td>
                  <td className="py-2 px-3">
                    <select
                      value={ch.function_id || ''}
                      onChange={e => setChannelFunction(ch.id, e.target.value || null).then(refresh).catch(err => toast.error(errMsg(err)))}
                      className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-700"
                    >
                      <option value="">None</option>
                      {(functions || []).filter(f => f.is_active || f.id === ch.function_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {topChannels.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-zinc-500">No channels.</td></tr>}
            </tbody>
          </table>
          <Label className="sr-only">Mapping</Label>
        </CardContent>
      </Card>
    </div>
  )
}
