'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Settings, ShieldAlert, Users, Network, BookOpen, Save, Info } from 'lucide-react'
import { useVertical } from '@/lib/hooks/use-vertical'
import { useVerticalOwners, useVerticalResources } from '@/lib/hooks/use-data'
import { updateVertical, addVerticalOwner, removeVerticalOwner, setPrimaryVerticalOwner, addVerticalResource, deleteVerticalResource } from '@/lib/actions'
import { TaxonomyManager } from '@/components/admin/taxonomy-manager'
import { InfoTip } from '@/components/ui/info-tip'
import { OwnersEditor } from '@/components/vertical/owners-editor'
import { FLAG_LABELS, resolveFlags } from '@/lib/vertical-flags'
import type { VerticalSettings } from '@/lib/types/database'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

export default function VerticalSettingsPage() {
  const { mode, vertical, verticalId, canManage, isAdmin, resolving } = useVertical()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: owners } = useVerticalOwners(verticalId === 'all' ? undefined : verticalId)
  const { data: resources } = useVerticalResources(verticalId === 'all' ? undefined : verticalId)

  useEffect(() => {
    if (!resolving && mode === 'workspace') router.replace('/')
  }, [resolving, mode, router])

  if (resolving || !vertical) return <div className="p-8 bg-zinc-50 min-h-screen" />

  if (!canManage) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4 bg-zinc-50 text-zinc-900 min-h-screen flex flex-col justify-center items-center">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <h2 className="text-xl font-bold text-zinc-900">Owners only</h2>
        <p className="text-sm text-zinc-500">Only admins or owners of {vertical.name} can change its settings.</p>
      </div>
    )
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['verticals'] })
    queryClient.invalidateQueries({ queryKey: ['vertical'] })
    queryClient.invalidateQueries({ queryKey: ['verticalResources'] })
  }
  // Keyed by vertical + updated_at so the form re-seeds after a save or a switch.
  return <SettingsForm key={`${vertical.id}:${vertical.updated_at}`} vertical={vertical} isAdmin={isAdmin} owners={owners || []} resources={resources || []} refresh={refresh} />
}

function SettingsForm({ vertical, isAdmin, owners, resources, refresh }: {
  vertical: NonNullable<ReturnType<typeof useVertical>['vertical']>
  isAdmin: boolean
  owners: { email: string; user_id: string | null; sort_order: number }[]
  resources: { id: string; group_name: string; name: string; url: string }[]
  refresh: () => void
}) {
  const [name, setName] = useState(vertical.name)
  const [description, setDescription] = useState(vertical.description || '')
  const [flags, setFlags] = useState<VerticalSettings>(resolveFlags(vertical.settings))
  const [busy, setBusy] = useState(false)
  const [rGroup, setRGroup] = useState(''); const [rName, setRName] = useState(''); const [rUrl, setRUrl] = useState('')

  const saveGeneral = async () => {
    setBusy(true)
    try {
      await updateVertical({ id: vertical.id, name, description, settings: isAdmin ? flags : undefined })
      refresh(); toast.success('Saved')
    } catch (err) { toast.error(errMsg(err)) } finally { setBusy(false) }
  }
  const addResource = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await addVerticalResource(vertical.id, rGroup, rName, rUrl); setRName(''); setRUrl(''); refresh() } catch (err) { toast.error(errMsg(err)) }
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-zinc-600" /> {vertical.name} Settings <InfoTip k="vertical_owner" />
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Owners, taxonomy, resources and features for this vertical.</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="bg-white border border-zinc-200 p-1 rounded-lg flex flex-wrap gap-1 md:inline-flex">
          <TabsTrigger value="general" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><Info className="w-4 h-4 mr-2" /> General</TabsTrigger>
          <TabsTrigger value="owners" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><Users className="w-4 h-4 mr-2" /> Owners</TabsTrigger>
          <TabsTrigger value="taxonomy" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><Network className="w-4 h-4 mr-2" /> Taxonomy</TabsTrigger>
          <TabsTrigger value="resources" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900"><BookOpen className="w-4 h-4 mr-2" /> Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <Card className="bg-white border-zinc-200">
            <CardHeader><CardTitle className="text-base font-semibold">General</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-zinc-600">Name</Label><Input value={name} onChange={e => setName(e.target.value)} className="bg-zinc-100 border-zinc-300 text-xs h-9" /></div>
                <div className="space-y-1"><Label className="text-xs text-zinc-600">Slug</Label><Input value={vertical.slug} disabled className="bg-zinc-100 border-zinc-300 text-xs h-9 font-mono" /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs text-zinc-600">Description</Label><Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} className="bg-zinc-100 border-zinc-300 text-xs" /></div>
              <div>
                <Label className="text-xs text-zinc-600 inline-flex items-center gap-1">Features {isAdmin ? '' : '(admins change these)'} <InfoTip k="feature_flags" /></Label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(FLAG_LABELS) as (keyof VerticalSettings)[]).map(key => (
                    <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2" title={FLAG_LABELS[key].hint}>
                      <span className="text-xs text-zinc-700">{FLAG_LABELS[key].label}</span>
                      <Switch checked={flags[key]} disabled={!isAdmin} onCheckedChange={c => setFlags(f => ({ ...f, [key]: !!c }))} />
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={busy} className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-9"><Save className="w-4 h-4 mr-2" /> Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="owners" className="mt-6">
          <Card className="bg-white border-zinc-200">
            <CardHeader>
              <CardTitle className="text-base font-semibold inline-flex items-center gap-1">Vertical owners <InfoTip k="vertical_owner" /></CardTitle>
              <CardDescription className="text-xs text-zinc-500">Owners manage this vertical&apos;s channels, budgets, custom fields and resources. Only admins can change who the owners are.</CardDescription>
            </CardHeader>
            <CardContent>
              <OwnersEditor
                owners={owners} canEdit={isAdmin}
                queryKeys={[['verticalOwners'], ['myVerticalIds'], ['knownEmails']]}
                onAdd={(email, primary) => addVerticalOwner(vertical.id, email, primary)}
                onRemove={email => removeVerticalOwner(vertical.id, email)}
                onPromote={email => setPrimaryVerticalOwner(vertical.id, email)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxonomy" className="mt-6">
          <TaxonomyManager verticalId={vertical.id} />
        </TabsContent>

        <TabsContent value="resources" className="mt-6">
          <Card className="bg-white border-zinc-200">
            <CardHeader>
              <CardTitle className="text-base font-semibold inline-flex items-center gap-1">Resources <InfoTip k="resources" /></CardTitle>
              <CardDescription className="text-xs text-zinc-500">Link groups shown on this vertical&apos;s Resources page{flags.resources ? '' : ' (page hidden until the Resources feature is on)'}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={addResource} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Input value={rGroup} onChange={e => setRGroup(e.target.value)} placeholder="Group" className="bg-zinc-100 border-zinc-300 text-xs h-9" required />
                <Input value={rName} onChange={e => setRName(e.target.value)} placeholder="Name" className="bg-zinc-100 border-zinc-300 text-xs h-9" required />
                <Input value={rUrl} onChange={e => setRUrl(e.target.value)} placeholder="https://…" className="bg-zinc-100 border-zinc-300 text-xs h-9" required />
                <Button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-9">Add</Button>
              </form>
              <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
                {resources.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="text-zinc-500 w-40 truncate">{r.group_name}</span>
                    <a href={r.url} target="_blank" rel="noreferrer" className="flex-1 text-blue-700 hover:underline truncate">{r.name}</a>
                    <button onClick={() => { if (confirm('Remove link?')) deleteVerticalResource(r.id).then(refresh).catch(err => toast.error(errMsg(err))) }} className="text-zinc-400 hover:text-red-600">Remove</button>
                  </div>
                ))}
                {resources.length === 0 && <p className="px-3 py-4 text-xs text-zinc-500">No links yet.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
