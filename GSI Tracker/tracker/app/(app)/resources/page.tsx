'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BookOpen, ExternalLink, FileSpreadsheet, Globe, FolderOpen, Plus, Trash2, X } from 'lucide-react'
import { useVertical } from '@/lib/hooks/use-vertical'
import { useVerticalResources } from '@/lib/hooks/use-data'
import { addVerticalResource, deleteVerticalResource } from '@/lib/actions'
import { toast } from 'sonner'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'account & lead data': FileSpreadsheet,
  'content & assets': FolderOpen,
}
const iconFor = (group: string) => ICONS[group.toLowerCase()] || (/page|site|web|live/i.test(group) ? Globe : FolderOpen)

export default function ResourcesPage() {
  const { verticalId, vertical, flags, canManage, resolving } = useVertical()
  const { data: resources, isLoading } = useVerticalResources(verticalId === 'all' ? undefined : verticalId)
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [group, setGroup] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof resources>>()
    for (const r of resources || []) {
      if (!m.has(r.group_name)) m.set(r.group_name, [])
      m.get(r.group_name)!.push(r)
    }
    return [...m.entries()]
  }, [resources])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['verticalResources', verticalId] })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (verticalId === 'all') return
    setBusy(true)
    try {
      await addVerticalResource(verticalId, group, name, url)
      setName(''); setUrl('')
      refresh()
      toast.success('Link added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add link')
    } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    if (!confirm('Remove this link?')) return
    try { await deleteVerticalResource(id); refresh() } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }

  if (!resolving && !flags.resources) {
    return (
      <div className="p-8 text-center space-y-2 bg-zinc-50 min-h-screen">
        <h1 className="text-xl font-semibold text-zinc-900">Resources are not enabled for {vertical?.name || 'this vertical'}</h1>
        <p className="text-sm text-zinc-500">A vertical owner can switch this on in Vertical Settings and add links there.</p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-600" /> {vertical?.name || ''} Resources
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            The team&apos;s shared sheets, asset repositories and live pages for {vertical?.name || 'this vertical'}, one click away.
          </p>
        </div>
        {canManage && (
          <Button variant="outline" className="border-zinc-300" onClick={() => setAdding(a => !a)}>
            {adding ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}{adding ? 'Close' : 'Add link'}
          </Button>
        )}
      </div>

      {adding && canManage && (
        <form onSubmit={submit} className="bg-white border border-zinc-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input list="resource-groups" value={group} onChange={e => setGroup(e.target.value)} placeholder="Group (e.g. Content & Assets)" className="bg-zinc-50 border-zinc-300 text-sm" required />
          <datalist id="resource-groups">{groups.map(([g]) => <option key={g} value={g} />)}</datalist>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Link name" className="bg-zinc-50 border-zinc-300 text-sm" required />
          <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="bg-zinc-50 border-zinc-300 text-sm" required />
          <Button type="submit" disabled={busy} className="bg-blue-600 hover:bg-blue-500 text-white"><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </form>
      )}

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {!isLoading && groups.length === 0 && (
        <Card className="bg-white border-zinc-200"><CardContent className="py-12 text-center text-sm text-zinc-500">
          No links yet.{canManage ? ' Use "Add link" to start a group.' : ''}
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {groups.map(([groupName, links]) => {
          const Icon = iconFor(groupName)
          return (
            <Card key={groupName} className="bg-white border-zinc-200">
              <CardHeader className="py-4">
                <CardTitle className="text-sm text-zinc-700 flex items-center gap-2">
                  <Icon className="w-4 h-4 text-blue-600" /> {groupName}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {links.map(link => (
                  <div key={link.id} className="flex items-center gap-1 group">
                    <a href={link.url} target="_blank" rel="noreferrer"
                      className="flex-1 flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-blue-50 transition-colors">
                      <span className="text-sm text-zinc-700 group-hover:text-blue-700">{link.name}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-400 group-hover:text-blue-600 shrink-0" />
                    </a>
                    {canManage && (
                      <button onClick={() => remove(link.id)} className="p-1 text-zinc-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Remove link">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
