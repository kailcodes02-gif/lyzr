'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Edit3, Plus } from 'lucide-react'
import { useCategories, useChannels, useFunctions } from '@/lib/hooks/use-data'
import { createCategory, updateCategory, createChannel, updateChannel } from '@/lib/actions'
import type { Category, Channel } from '@/lib/types/database'

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

// Categories + channels editor for ONE vertical. Used by Admin > Taxonomy
// (with a vertical selector above it) and by the in-space Vertical Settings.
export function TaxonomyManager({ verticalId }: { verticalId: string }) {
  const queryClient = useQueryClient()
  const { data: categories } = useCategories(verticalId)
  const { data: channels } = useChannels(verticalId)
  const { data: functions } = useFunctions()
  const [isPending, startTransition] = useTransition()

  const [catName, setCatName] = useState('')
  const [catIcon, setCatIcon] = useState('folder')
  const [catSortOrder, setCatSortOrder] = useState('0')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [catIsActive, setCatIsActive] = useState(true)

  const [chanName, setChanName] = useState('')
  const [chanCategoryId, setChanCategoryId] = useState('')
  const [chanParentId, setChanParentId] = useState('none')
  const [chanFunctionId, setChanFunctionId] = useState('inherit')
  const [chanTier, setChanTier] = useState('none')
  const [chanSortOrder, setChanSortOrder] = useState('0')
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [chanIsActive, setChanIsActive] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] })
    queryClient.invalidateQueries({ queryKey: ['channels'] })
  }

  const resetCat = () => { setCatName(''); setCatIcon('folder'); setCatSortOrder('0'); setEditingCategoryId(null); setCatIsActive(true) }
  const resetChan = () => {
    setChanName(''); setChanCategoryId(''); setChanParentId('none'); setChanFunctionId('inherit'); setChanTier('none')
    setChanSortOrder('0'); setEditingChannelId(null); setChanIsActive(true)
  }

  const handleUpsertCategory = (e: React.FormEvent) => {
    e.preventDefault()
    if (!catName) { toast.error('Category name is required'); return }
    startTransition(async () => {
      try {
        if (editingCategoryId) {
          await updateCategory({ id: editingCategoryId, name: catName, icon: catIcon, sort_order: Number(catSortOrder) || 0, is_active: catIsActive })
          toast.success('Category updated')
        } else {
          await createCategory({ vertical_id: verticalId, name: catName, icon: catIcon, sort_order: Number(catSortOrder) || 0 })
          toast.success('Category created')
        }
        invalidate(); resetCat()
      } catch (err) { toast.error(`Failed to save category: ${errMsg(err)}`) }
    })
  }

  const handleUpsertChannel = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chanCategoryId || !chanName) { toast.error('Category and channel name are required'); return }
    const fn = chanFunctionId === 'inherit' ? null : chanFunctionId
    const tier = chanTier === 'none' ? null : chanTier
    startTransition(async () => {
      try {
        if (editingChannelId) {
          await updateChannel({
            id: editingChannelId, name: chanName, parent_channel_id: chanParentId === 'none' ? null : chanParentId,
            sort_order: Number(chanSortOrder) || 0, is_active: chanIsActive, function_id: fn, tier,
          })
          toast.success('Channel updated')
        } else {
          await createChannel({
            category_id: chanCategoryId, parent_channel_id: chanParentId === 'none' ? null : chanParentId,
            name: chanName, sort_order: Number(chanSortOrder) || 0, function_id: fn, tier,
          })
          toast.success('Channel created')
        }
        invalidate(); resetChan()
      } catch (err) { toast.error(`Failed to save channel: ${errMsg(err)}`) }
    })
  }

  const editCategory = (cat: Category) => {
    setEditingCategoryId(cat.id); setCatName(cat.name); setCatIcon(cat.icon || 'folder')
    setCatSortOrder(String(cat.sort_order)); setCatIsActive(cat.is_active)
  }
  const editChannel = (ch: Channel) => {
    setEditingChannelId(ch.id); setChanCategoryId(ch.category_id); setChanParentId(ch.parent_channel_id || 'none')
    setChanName(ch.name); setChanSortOrder(String(ch.sort_order)); setChanIsActive(ch.is_active)
    setChanFunctionId(ch.function_id || 'inherit'); setChanTier(ch.tier || 'none')
  }

  const label = (chId: string) => {
    const ch = channels?.find(c => c.id === chId)
    if (!ch) return 'Unknown'
    const parent = channels?.find(p => p.id === ch.parent_channel_id)
    return parent ? `${parent.name} > ${ch.name}` : ch.name
  }
  const fnName = (id: string | null) => functions?.find(f => f.id === id)?.name
  const visibleChannels = (channels || []).filter(ch => filterCategory === 'all' || ch.category_id === filterCategory)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Categories */}
      <Card className="bg-white border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900">{editingCategoryId ? 'Edit Category' : 'Create Category'}</CardTitle>
          <CardDescription className="text-zinc-500 text-xs">Top-level groups inside this vertical (Paid, Organic, Events…).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleUpsertCategory} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Category name *</Label>
                <Input value={catName} onChange={e => setCatName(e.target.value)} placeholder="e.g. Community" className="bg-zinc-100 border-zinc-300 text-xs h-9" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Icon</Label>
                <Select value={catIcon} onValueChange={val => setCatIcon(val || 'folder')}>
                  <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    <SelectItem value="folder">Folder</SelectItem>
                    <SelectItem value="zap">Zap (Paid)</SelectItem>
                    <SelectItem value="send">Send (Outbound)</SelectItem>
                    <SelectItem value="sprout">Sprout (Organic)</SelectItem>
                    <SelectItem value="calendar">Calendar (Events)</SelectItem>
                    <SelectItem value="share-2">Share (Social)</SelectItem>
                    <SelectItem value="file-text">File (Content)</SelectItem>
                    <SelectItem value="handshake">Handshake (Partnerships)</SelectItem>
                    <SelectItem value="users">Users (Community)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Sort order</Label>
                <Input type="number" value={catSortOrder} onChange={e => setCatSortOrder(e.target.value)} className="bg-zinc-100 border-zinc-300 text-xs h-9" />
              </div>
              {editingCategoryId && (
                <div className="flex items-center space-x-2 pt-4">
                  <Checkbox id="tm_cat_active" checked={catIsActive} onCheckedChange={c => setCatIsActive(!!c)} className="border-zinc-300" />
                  <Label htmlFor="tm_cat_active" className="text-zinc-600 text-xs cursor-pointer">Active</Label>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {editingCategoryId && <Button type="button" variant="ghost" onClick={resetCat} className="w-1/3 text-xs h-9">Cancel</Button>}
              <Button type="submit" disabled={isPending} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs h-9">
                <Plus className="w-4 h-4 mr-2" />{editingCategoryId ? 'Update Category' : 'Create Category'}
              </Button>
            </div>
          </form>
          <Separator className="bg-zinc-100" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600 font-medium">
                  <th className="text-left py-2 px-3">Name</th><th className="text-left py-2 px-3">Slug</th>
                  <th className="text-center py-2 px-3">Sort</th><th className="text-center py-2 px-3">Active</th><th className="text-right py-2 px-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(categories || []).map(cat => (
                  <tr key={cat.id} className="hover:bg-zinc-100 transition-colors">
                    <td className="py-2 px-3 font-semibold text-zinc-800">{cat.name}</td>
                    <td className="py-2 px-3 text-zinc-500 font-mono">{cat.slug}</td>
                    <td className="py-2 px-3 text-center text-zinc-700">{cat.sort_order}</td>
                    <td className="py-2 px-3 text-center"><span className={cat.is_active ? 'text-emerald-600' : 'text-zinc-600'}>{cat.is_active ? 'Yes' : 'No'}</span></td>
                    <td className="py-2 px-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => editCategory(cat)} className="h-6 w-6 text-zinc-600 hover:text-zinc-900" aria-label={`Edit ${cat.name}`}><Edit3 className="w-3 h-3" /></Button>
                    </td>
                  </tr>
                ))}
                {(categories || []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-zinc-500">No categories yet. Create one, or clone a template from Admin › Verticals.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Channels */}
      <Card className="bg-white border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900">{editingChannelId ? 'Edit Channel' : 'Create Channel'}</CardTitle>
          <CardDescription className="text-zinc-500 text-xs">Channels and sub-channels. Link each channel to a workspace function so it rolls up across verticals.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleUpsertChannel} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Category *</Label>
                <Select value={chanCategoryId} onValueChange={val => { setChanCategoryId(val || ''); setChanParentId('none') }}>
                  <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-9"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    {(categories || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Parent channel</Label>
                <Select value={chanParentId} onValueChange={val => setChanParentId(val || 'none')}>
                  <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-9"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    <SelectItem value="none">None (top-level channel)</SelectItem>
                    {(channels || []).filter(ch => ch.category_id === chanCategoryId && ch.id !== editingChannelId && !ch.parent_channel_id).map(ch => (
                      <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Channel name *</Label>
                <Input value={chanName} onChange={e => setChanName(e.target.value)} placeholder="e.g. YouTube Ads" className="bg-zinc-100 border-zinc-300 text-xs h-9" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Function</Label>
                <Select value={chanFunctionId} onValueChange={val => setChanFunctionId(val || 'inherit')}>
                  <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    <SelectItem value="inherit">{chanParentId === 'none' ? 'None' : 'Inherit from parent'}</SelectItem>
                    {(functions || []).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Tier</Label>
                <Select value={chanTier} onValueChange={val => setChanTier(val || 'none')}>
                  <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    <SelectItem value="none">No tier</SelectItem>
                    <SelectItem value="gold">Gold</SelectItem><SelectItem value="silver">Silver</SelectItem>
                    <SelectItem value="bronze">Bronze</SelectItem><SelectItem value="hygiene">Hygiene</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-600">Sort order</Label>
                <Input type="number" value={chanSortOrder} onChange={e => setChanSortOrder(e.target.value)} className="bg-zinc-100 border-zinc-300 text-xs h-9" />
              </div>
            </div>
            {editingChannelId && (
              <div className="flex items-center space-x-2">
                <Checkbox id="tm_chan_active" checked={chanIsActive} onCheckedChange={c => setChanIsActive(!!c)} className="border-zinc-300" />
                <Label htmlFor="tm_chan_active" className="text-zinc-600 text-xs cursor-pointer">Active</Label>
              </div>
            )}
            <div className="flex gap-2">
              {editingChannelId && <Button type="button" variant="ghost" onClick={resetChan} className="w-1/3 text-xs h-9">Cancel</Button>}
              <Button type="submit" disabled={isPending} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs h-9">
                <Plus className="w-4 h-4 mr-2" />{editingChannelId ? 'Update Channel' : 'Create Channel'}
              </Button>
            </div>
          </form>
          <Separator className="bg-zinc-100" />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-zinc-600">Filter by category</Label>
              <div className="w-40">
                <Select value={filterCategory} onValueChange={val => setFilterCategory(val || 'all')}>
                  <SelectTrigger className="bg-zinc-100 border-zinc-300 text-xs h-7"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    <SelectItem value="all">All categories</SelectItem>
                    {(categories || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600 font-medium">
                    <th className="text-left py-2 px-3">Channel</th><th className="text-left py-2 px-3">Parent</th>
                    <th className="text-left py-2 px-3">Function</th><th className="text-center py-2 px-3">Active</th><th className="text-right py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {visibleChannels.map(ch => (
                    <tr key={ch.id} className="hover:bg-zinc-100 transition-colors">
                      <td className="py-2 px-3 font-semibold text-zinc-800">{ch.name}</td>
                      <td className="py-2 px-3 text-zinc-500">{ch.parent_channel_id ? label(ch.parent_channel_id) : '—'}</td>
                      <td className="py-2 px-3 text-zinc-600">{fnName(ch.function_id) || <span className="text-zinc-400">none</span>}</td>
                      <td className="py-2 px-3 text-center"><span className={ch.is_active ? 'text-emerald-600' : 'text-zinc-600'}>{ch.is_active ? 'Yes' : 'No'}</span></td>
                      <td className="py-2 px-3 text-right">
                        <Button variant="ghost" size="icon" onClick={() => editChannel(ch)} className="h-6 w-6 text-zinc-600 hover:text-zinc-900" aria-label={`Edit ${ch.name}`}><Edit3 className="w-3 h-3" /></Button>
                      </td>
                    </tr>
                  ))}
                  {visibleChannels.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-zinc-500">No channels yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
