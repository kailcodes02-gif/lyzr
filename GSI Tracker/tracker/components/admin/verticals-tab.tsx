'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Building2, Plus, Save, Trash2, LayoutTemplate, ExternalLink } from 'lucide-react'
import { useVerticals, useAllVerticalOwners, useTaxonomyTemplates, useChannels } from '@/lib/hooks/use-data'
import {
  createVertical, updateVertical, addVerticalOwner, removeVerticalOwner, setPrimaryVerticalOwner,
  saveVerticalAsTemplate, applyTaxonomyTemplate, deleteTaxonomyTemplate,
} from '@/lib/actions'
import { FLAG_LABELS, resolveFlags } from '@/lib/vertical-flags'
import { withVertical } from '@/lib/hooks/use-space-href'
import { OwnersEditor } from '@/components/vertical/owners-editor'
import { InfoTip } from '@/components/ui/info-tip'
import type { Vertical, VerticalSettings } from '@/lib/types/database'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

export function VerticalsTab() {
  const queryClient = useQueryClient()
  const { data: verticals } = useVerticals(true)
  const { data: owners } = useAllVerticalOwners()
  const { data: templates } = useTaxonomyTemplates()
  const { data: channels } = useChannels('all')
  const [isPending, startTransition] = useTransition()

  // Create form
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState<string>('empty')
  const [ownerEmails, setOwnerEmails] = useState('')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['verticals'] })
    queryClient.invalidateQueries({ queryKey: ['verticalOwners'] })
    queryClient.invalidateQueries({ queryKey: ['categories'] })
    queryClient.invalidateQueries({ queryKey: ['channels'] })
    queryClient.invalidateQueries({ queryKey: ['taxonomyTemplates'] })
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    startTransition(async () => {
      try {
        await createVertical({
          name, slug: slug || undefined, description: description || undefined,
          templateId: start === 'empty' ? null : start,
          ownerEmails: ownerEmails.split(/[,\s]+/).filter(Boolean),
        })
        toast.success(`Vertical "${name}" created${start !== 'empty' ? ' from template' : ''}`)
        setName(''); setSlug(''); setDescription(''); setStart('empty'); setOwnerEmails('')
        refresh()
      } catch (err) { toast.error(errMsg(err)) }
    })
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" /> New vertical <InfoTip k="vertical" /></CardTitle>
          <CardDescription className="text-zinc-500 text-xs">A vertical is a business line (GSI, Emerging Partners, a product) or the company-wide &quot;Lyzr&quot; space. Clone a template to start with the standard channel tree, or start empty.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-zinc-600">Name *</Label>
              <Input value={name} onChange={e => { setName(e.target.value); if (!slug) setSlug('') }} placeholder="e.g. Emerging Partners" className="bg-zinc-100 border-zinc-300 text-xs h-9" required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-600">Slug (URL, optional)</Label>
              <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} placeholder="auto from name" className="bg-zinc-100 border-zinc-300 text-xs h-9 font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-600">Start from</Label>
              <Select value={start} onValueChange={v => setStart(v || 'empty')}>
                <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                  <SelectItem value="empty">Empty (build channels later)</SelectItem>
                  {(templates || []).map(t => <SelectItem key={t.id} value={t.id}>Clone template: {t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-600">Vertical owners (emails, comma separated)</Label>
              <Input value={ownerEmails} onChange={e => setOwnerEmails(e.target.value)} placeholder="a@lyzr.ai, b@lyzr.ai" className="bg-zinc-100 border-zinc-300 text-xs h-9" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs text-zinc-600">Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What this vertical covers" className="bg-zinc-100 border-zinc-300 text-xs" />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={isPending} className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-9"><Plus className="w-4 h-4 mr-2" /> Create vertical</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(verticals || []).map(v => (
          <VerticalEditor
            key={v.id}
            vertical={v}
            owners={(owners || []).filter(o => o.vertical_id === v.id)}
            channelCount={(channels || []).filter(c => c.vertical_id === v.id).length}
            templates={templates || []}
            onChanged={refresh}
          />
        ))}
      </div>

      <Card className="bg-white border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-violet-600" /> Taxonomy templates <InfoTip k="template" /></CardTitle>
          <CardDescription className="text-zinc-500 text-xs">Snapshots of a vertical&apos;s categories, channels, sub-channels and custom fields. Save one from any vertical above.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(templates || []).length === 0 && <p className="text-xs text-zinc-500">No templates yet.</p>}
          {(templates || []).map(t => {
            const cats = Array.isArray((t.body as { categories?: unknown[] }).categories) ? (t.body as { categories: unknown[] }).categories.length : 0
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800">{t.name} <span className="font-mono text-[10px] text-zinc-400">{t.slug}</span></p>
                  <p className="text-[11px] text-zinc-500 truncate">{t.description || `${cats} categories`}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-600" aria-label="Delete template"
                  onClick={() => { if (confirm(`Delete template "${t.name}"?`)) deleteTaxonomyTemplate(t.id).then(refresh).catch(err => toast.error(errMsg(err))) }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function VerticalEditor({ vertical, owners, channelCount, templates, onChanged }: {
  vertical: Vertical
  owners: { email: string; user_id: string | null; sort_order: number }[]
  channelCount: number
  templates: { id: string; name: string }[]
  onChanged: () => void
}) {
  const [name, setName] = useState(vertical.name)
  const [description, setDescription] = useState(vertical.description || '')
  const [flags, setFlags] = useState<VerticalSettings>(resolveFlags(vertical.settings))
  const [templateName, setTemplateName] = useState('')
  const [applyId, setApplyId] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = name !== vertical.name || description !== (vertical.description || '') || JSON.stringify(flags) !== JSON.stringify(resolveFlags(vertical.settings))

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); onChanged(); toast.success(ok) } catch (err) { toast.error(errMsg(err)) } finally { setBusy(false) }
  }

  return (
    <Card className={`bg-white border-zinc-200 ${vertical.is_active ? '' : 'opacity-60'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
              {vertical.name}
              {!vertical.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
            </CardTitle>
            <CardDescription className="text-zinc-500 text-xs font-mono">/{vertical.slug} · {channelCount} channels</CardDescription>
          </div>
          <Link href={withVertical('/dashboard/', vertical.slug)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open</Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-zinc-600">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="bg-zinc-100 border-zinc-300 text-xs h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-600">Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} className="bg-zinc-100 border-zinc-300 text-xs h-9" />
          </div>
        </div>

        <div>
          <Label className="text-xs text-zinc-600">Owners</Label>
          <div className="mt-1">
            <OwnersEditor
              owners={owners} canEdit
              queryKeys={[['verticalOwners'], ['myVerticalIds'], ['knownEmails']]}
              onAdd={(email, primary) => addVerticalOwner(vertical.id, email, primary)}
              onRemove={email => removeVerticalOwner(vertical.id, email)}
              onPromote={email => setPrimaryVerticalOwner(vertical.id, email)}
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-zinc-600 inline-flex items-center gap-1">Features <InfoTip k="feature_flags" /></Label>
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(FLAG_LABELS) as (keyof VerticalSettings)[]).map(key => (
              <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 cursor-pointer" title={FLAG_LABELS[key].hint}>
                <span className="text-xs text-zinc-700">{FLAG_LABELS[key].label}</span>
                <Switch checked={flags[key]} onCheckedChange={c => setFlags(f => ({ ...f, [key]: !!c }))} />
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || busy} className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8"
            onClick={() => run(() => updateVertical({ id: vertical.id, name, description, settings: flags }), 'Vertical saved')}>
            <Save className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" disabled={busy} className="text-xs h-8 border-zinc-300"
            onClick={() => run(() => updateVertical({ id: vertical.id, is_active: !vertical.is_active }), vertical.is_active ? 'Vertical deactivated' : 'Vertical reactivated')}>
            {vertical.is_active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-zinc-100">
          <div className="flex items-center gap-2">
            <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Save as template: name" className="bg-zinc-100 border-zinc-300 text-xs h-8" />
            <Button size="sm" variant="outline" disabled={!templateName.trim() || busy} className="text-xs h-8 border-zinc-300 shrink-0"
              onClick={() => run(() => saveVerticalAsTemplate(vertical.id, templateName).then(() => setTemplateName('')), 'Template saved')}>
              <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={applyId} onValueChange={v => setApplyId(v || '')}>
              <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-8"><SelectValue placeholder="Apply a template to this vertical" /></SelectTrigger>
              <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!applyId || busy} className="text-xs h-8 border-zinc-300 shrink-0"
              onClick={() => run(() => applyTaxonomyTemplate(vertical.id, applyId).then(() => setApplyId('')), 'Template applied (existing channels kept)')}>
              Apply
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
