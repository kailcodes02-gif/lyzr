'use client'

import { useCurrentUser, useUsers, useBudgetPeriods, useCategories, useChannels, useChannelFields, useHubSpotConnection, usePendingInvites } from '@/lib/hooks/use-data'
import { updateUserRole, createBudgetPeriod, upsertChannelField, deleteChannelField, disconnectHubSpot, createCategory, updateCategory, createChannel, updateChannel, inviteUser, cancelInvite } from '@/lib/actions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Users, Landmark, Settings, ShieldAlert, Plus, DollarSign, RefreshCw, Sliders, Trash2, Edit3, Link2, Unlink, Folder, Network } from 'lucide-react'

export default function AdminPage() {
  const queryClient = useQueryClient()
  const { data: currentUser, isLoading: userLoading } = useCurrentUser()
  const { data: users, isLoading: usersLoading } = useUsers()
  const { data: pendingInvites } = usePendingInvites()
  const { data: budgets, isLoading: budgetsLoading } = useBudgetPeriods()
  const { data: categories } = useCategories()
  const { data: channels } = useChannels()

  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState('users')

  // Form State for creating Budget Period
  const [scopeType, setScopeType] = useState<'global' | 'category' | 'channel'>('global')
  const [scopeId, setScopeId] = useState('')
  const [periodType, setPeriodType] = useState<'one_time' | 'monthly' | 'quarterly' | 'annual'>('monthly')
  const [periodLabel, setPeriodLabel] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [totalBudget, setTotalBudget] = useState('')
  const [notes, setNotes] = useState('')

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')

  // HubSpot Integration States
  const { data: hubspotConnection, isLoading: hubspotLoading } = useHubSpotConnection()
  const [isSyncing, setIsSyncing] = useState(false)

  // Custom Fields States
  const { data: allFields } = useChannelFields()
  const [selectedFieldChannelId, setSelectedFieldChannelId] = useState('')
  const [fieldName, setFieldName] = useState('')
  const [fieldSlug, setFieldSlug] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [fieldSurface, setFieldSurface] = useState('planning')
  const [fieldIsRequired, setFieldIsRequired] = useState(false)
  const [fieldCascades, setFieldCascades] = useState(true)
  const [fieldOptionsText, setFieldOptionsText] = useState('')
  const [fieldFormula, setFieldFormula] = useState('')
  const [fieldIsAutoCalc, setFieldIsAutoCalc] = useState(false)
  const [fieldDescription, setFieldDescription] = useState('')
  const [fieldSortOrder, setFieldSortOrder] = useState('0')
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)

  const [filterChannelId, setFilterChannelId] = useState('all')

  // Taxonomy Management States
  const [catName, setCatName] = useState('')
  const [catIcon, setCatIcon] = useState('folder')
  const [catSortOrder, setCatSortOrder] = useState('0')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [catIsActive, setCatIsActive] = useState(true)

  const [chanName, setChanName] = useState('')
  const [chanCategoryId, setChanCategoryId] = useState('')
  const [chanParentId, setChanParentId] = useState('none')
  const [chanSortOrder, setChanSortOrder] = useState('0')
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [chanIsActive, setChanIsActive] = useState(true)

  const [filterTaxonomyChannelCategory, setFilterTaxonomyChannelCategory] = useState('all')

  if (userLoading || usersLoading || budgetsLoading || hubspotLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse bg-zinc-50 min-h-screen">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-96 bg-zinc-200 rounded-xl" />
      </div>
    )
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4 bg-zinc-50 text-zinc-900 min-h-screen flex flex-col justify-center items-center">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <h2 className="text-xl font-bold text-zinc-900">Access Denied</h2>
        <p className="text-sm text-zinc-500">
          Only administrators have access to this control panel.
        </p>
      </div>
    )
  }

  const handleRoleChange = (userId: string, newRole: 'admin' | 'member') => {
    startTransition(async () => {
      try {
        await updateUserRole(userId, newRole)
        queryClient.invalidateQueries({ queryKey: ['users'] })
        queryClient.invalidateQueries({ queryKey: ['currentUser'] })
        toast.success('User role updated successfully')
      } catch (err: any) {
        console.error('updateUserRole failed:', err)
        toast.error(err?.message || 'Failed to update user role')
      }
    })
  }

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!email) return
    startTransition(async () => {
      try {
        const result = await inviteUser(email)
        setInviteEmail('')
        queryClient.invalidateQueries({ queryKey: ['pendingInvites'] })
        if (result.emailResult.sent) {
          toast.success(`Invite sent to ${email}`)
        } else {
          toast.success(`Invite recorded for ${email}. Email provider not configured — set RESEND_API_KEY in .env.local to enable sending.`)
        }
      } catch (err: any) {
        console.error('inviteUser failed:', err)
        toast.error(err?.message || 'Failed to invite user')
      }
    })
  }

  const handleCancelInvite = (id: string, email: string) => {
    if (!confirm(`Cancel pending invite for ${email}?`)) return
    startTransition(async () => {
      try {
        await cancelInvite(id)
        queryClient.invalidateQueries({ queryKey: ['pendingInvites'] })
        toast.success('Invite cancelled')
      } catch (err: any) {
        console.error('cancelInvite failed:', err)
        toast.error(err?.message || 'Failed to cancel invite')
      }
    })
  }

  const handleCreateBudget = (e: React.FormEvent) => {
    e.preventDefault()
    if (!periodLabel || !startsOn || !endsOn || !totalBudget) {
      toast.error('Please fill in all required fields')
      return
    }

    startTransition(async () => {
      try {
        await createBudgetPeriod({
          scope_type: scopeType,
          scope_id: scopeType !== 'global' ? scopeId : undefined,
          period_type: periodType,
          period_label: periodLabel,
          starts_on: startsOn,
          ends_on: endsOn,
          total_budget: Number(totalBudget),
          notes: notes || undefined,
        })
        queryClient.invalidateQueries({ queryKey: ['budgetPeriods'] })
        toast.success('Budget period created successfully')
        
        // Reset form
        setScopeId('')
        setPeriodLabel('')
        setStartsOn('')
        setEndsOn('')
        setTotalBudget('')
        setNotes('')
      } catch (err: any) {
        console.error('createBudgetPeriod failed:', err)
        toast.error(err?.message || 'Failed to create budget period')
      }
    })
  }

  // Custom Fields Handlers
  const handleNameChange = (name: string) => {
    setFieldName(name)
    if (!editingFieldId) {
      setFieldSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    }
  }

  const handleUpsertField = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFieldChannelId || !fieldName || !fieldSlug) {
      toast.error('Please select a channel and enter a field name and slug')
      return
    }

    const options = fieldOptionsText
      ? fieldOptionsText.split(',').map(s => s.trim()).filter(Boolean)
      : null

    startTransition(async () => {
      try {
        await upsertChannelField({
          id: editingFieldId || undefined,
          channel_id: selectedFieldChannelId,
          name: fieldName,
          slug: fieldSlug,
          field_type: fieldType,
          surface: fieldSurface,
          is_required: fieldIsRequired,
          options,
          formula: fieldFormula || null,
          is_auto_calc: fieldIsAutoCalc,
          description: fieldDescription || null,
          sort_order: Number(fieldSortOrder) || 0,
          cascades_to_children: fieldCascades,
        })
        queryClient.invalidateQueries({ queryKey: ['channelFields'] })
        toast.success(editingFieldId ? 'Custom field updated' : 'Custom field created')
        
        // Reset form
        setFieldName('')
        setFieldSlug('')
        setFieldOptionsText('')
        setFieldFormula('')
        setFieldIsAutoCalc(false)
        setFieldDescription('')
        setFieldSortOrder('0')
        setFieldIsRequired(false)
        setFieldCascades(true)
        setEditingFieldId(null)
      } catch (err: any) {
        console.error('upsertChannelField failed:', err)
        toast.error(`Failed to save custom field: ${err.message}`)
      }
    })
  }

  const handleDeleteField = (id: string) => {
    if (!confirm('Are you sure you want to delete this custom field?')) return
    startTransition(async () => {
      try {
        await deleteChannelField(id)
        queryClient.invalidateQueries({ queryKey: ['channelFields'] })
        toast.success('Custom field deleted')
      } catch (err: any) {
        console.error('deleteChannelField failed:', err)
        toast.error(`Failed to delete custom field: ${err.message}`)
      }
    })
  }

  const handleEditField = (field: any) => {
    setEditingFieldId(field.id)
    setSelectedFieldChannelId(field.channel_id)
    setFieldName(field.name)
    setFieldSlug(field.slug)
    setFieldType(field.field_type)
    setFieldSurface(field.surface)
    setFieldIsRequired(field.is_required)
    setFieldCascades(field.cascades_to_children)
    setFieldOptionsText(field.options ? field.options.join(', ') : '')
    setFieldFormula(field.formula || '')
    setFieldIsAutoCalc(field.is_auto_calc)
    setFieldDescription(field.description || '')
    setFieldSortOrder(String(field.sort_order))
    setActiveTab('custom_fields')
  }

  // Taxonomy Handlers
  const handleUpsertCategory = (e: React.FormEvent) => {
    e.preventDefault()
    if (!catName) {
      toast.error('Category Name is required')
      return
    }

    startTransition(async () => {
      try {
        if (editingCategoryId) {
          await updateCategory({
            id: editingCategoryId,
            name: catName,
            icon: catIcon,
            sort_order: Number(catSortOrder) || 0,
            is_active: catIsActive,
          })
          toast.success('Category updated successfully')
        } else {
          await createCategory({
            name: catName,
            icon: catIcon,
            sort_order: Number(catSortOrder) || 0,
          })
          toast.success('Category created successfully')
        }
        queryClient.invalidateQueries({ queryKey: ['categories'] })
        
        // Reset form
        setCatName('')
        setCatIcon('folder')
        setCatSortOrder('0')
        setEditingCategoryId(null)
        setCatIsActive(true)
      } catch (err: any) {
        console.error('upsertCategory failed:', err)
        toast.error(`Failed to save category: ${err.message}`)
      }
    })
  }

  const handleUpsertChannel = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chanCategoryId || !chanName) {
      toast.error('Category and Channel Name are required')
      return
    }

    startTransition(async () => {
      try {
        if (editingChannelId) {
          await updateChannel({
            id: editingChannelId,
            name: chanName,
            parent_channel_id: chanParentId === 'none' ? null : chanParentId,
            sort_order: Number(chanSortOrder) || 0,
            is_active: chanIsActive,
          })
          toast.success('Channel updated successfully')
        } else {
          await createChannel({
            category_id: chanCategoryId,
            parent_channel_id: chanParentId === 'none' ? null : chanParentId,
            name: chanName,
            sort_order: Number(chanSortOrder) || 0,
          })
          toast.success('Channel created successfully')
        }
        queryClient.invalidateQueries({ queryKey: ['channels'] })
        
        // Reset form
        setChanName('')
        setChanCategoryId('')
        setChanParentId('none')
        setChanSortOrder('0')
        setEditingChannelId(null)
        setChanIsActive(true)
      } catch (err: any) {
        console.error('upsertChannel failed:', err)
        toast.error(`Failed to save channel: ${err.message}`)
      }
    })
  }

  const handleEditCategory = (cat: any) => {
    setEditingCategoryId(cat.id)
    setCatName(cat.name)
    setCatIcon(cat.icon || 'folder')
    setCatSortOrder(String(cat.sort_order))
    setCatIsActive(cat.is_active)
  }

  const handleEditChannel = (ch: any) => {
    setEditingChannelId(ch.id)
    setChanCategoryId(ch.category_id)
    setChanParentId(ch.parent_channel_id || 'none')
    setChanName(ch.name)
    setChanSortOrder(String(ch.sort_order))
    setChanIsActive(ch.is_active)
  }

  // HubSpot Handlers
  const handleSyncHubSpot = async () => {
    // Static build has no sync server; the OAuth/sync backend was removed.
    toast.info('HubSpot sync needs the server edition — not available in this static deployment.')
  }

  const handleDisconnectHubSpot = () => {
    if (!confirm('Are you sure you want to disconnect your HubSpot integration? This will remove synced data access.')) return
    startTransition(async () => {
      try {
        await disconnectHubSpot()
        queryClient.invalidateQueries({ queryKey: ['hubspotConnection'] })
        toast.success('HubSpot disconnected successfully')
      } catch (err: any) {
        console.error('disconnectHubSpot failed:', err)
        toast.error(`Failed to disconnect: ${err.message}`)
      }
    })
  }

  // Helper to flat channels list
  const getFlatChannelLabel = (chId: string) => {
    const ch = channels?.find(c => c.id === chId)
    if (!ch) return 'Unknown'
    const parent = channels?.find(p => p.id === ch.parent_channel_id)
    return parent ? `${parent.name} > ${ch.name}` : ch.name
  }

  const filteredFieldsList = allFields?.filter(f => {
    if (filterChannelId === 'all') return true
    return f.channel_id === filterChannelId
  }) || []

  const filteredChannelsList = channels?.filter(ch => {
    if (filterTaxonomyChannelCategory === 'all') return true
    return ch.category_id === filterTaxonomyChannelCategory
  }) || []

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-zinc-600" /> Admin Control Panel
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Manage system users, configuration, and budgets</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white border border-zinc-200 p-1 rounded-lg flex flex-wrap gap-1 md:inline-flex">
          <TabsTrigger value="users" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <Users className="w-4 h-4 mr-2" /> Users
          </TabsTrigger>
          <TabsTrigger value="budgets" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <Landmark className="w-4 h-4 mr-2" /> Budgets Manager
          </TabsTrigger>
          <TabsTrigger value="custom_fields" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <Sliders className="w-4 h-4 mr-2" /> Custom Fields
          </TabsTrigger>
          <TabsTrigger value="taxonomy" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <Network className="w-4 h-4 mr-2" /> Taxonomy Manager
          </TabsTrigger>
          <TabsTrigger value="hubspot" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
            <RefreshCw className="w-4 h-4 mr-2" /> HubSpot Integration
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-6 space-y-6">
          {/* Invite a teammate */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Invite a teammate</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Send a sign-in invite to any @lyzr.ai email. They sign in with Google; any tasks already assigned to that address get auto-mapped to their account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  placeholder="teammate@lyzr.ai"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  className="bg-zinc-200 border-zinc-300 text-sm h-9 flex-1"
                />
                <Button type="submit" disabled={isPending || !inviteEmail.trim()} className="bg-violet-600 hover:bg-violet-700 text-white h-9">
                  <Plus className="w-4 h-4 mr-1" /> Send invite
                </Button>
              </form>

              {pendingInvites && pendingInvites.length > 0 && (
                <div className="mt-5">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
                    Pending invites ({pendingInvites.length})
                  </p>
                  <div className="space-y-1.5">
                    {pendingInvites.map((inv: any) => (
                      <div key={inv.id} className="flex items-center justify-between bg-zinc-100/60 border border-zinc-200 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-800 truncate">{inv.email}</p>
                          <p className="text-[10px] text-zinc-500">
                            Invited by {inv.inviter?.display_name || inv.inviter?.email || 'unknown'}
                            {inv.email_sent_at ? ' • email sent' : ' • email queued (no provider configured)'}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelInvite(inv.id, inv.email)}
                          className="text-zinc-500 hover:text-red-600 h-7"
                          disabled={isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Platform Users</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Manage user permissions and roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                    <th className="text-left font-medium py-3 px-4">Name</th>
                    <th className="text-left font-medium py-3 px-4">Email</th>
                    <th className="text-left font-medium py-3 px-4">Role</th>
                    <th className="text-right font-medium py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {users?.map(u => (
                    <tr key={u.id} className="hover:bg-zinc-100 transition-colors">
                      <td className="py-3 px-4 font-medium text-zinc-800">{u.display_name || 'Anonymous'}</td>
                      <td className="py-3 px-4 text-zinc-600">{u.email}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={u.role === 'admin' ? 'border-violet-300 text-violet-600 bg-violet-500/5' : 'border-zinc-300 text-zinc-600'}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {u.id !== currentUser.id ? (
                          <Select 
                            value={u.role} 
                            onValueChange={(val) => { if (val === 'admin' || val === 'member') handleRoleChange(u.id, val) }}
                            disabled={isPending}
                          >
                            <SelectTrigger className="w-[120px] bg-zinc-200 border-zinc-300 text-xs h-7 ml-auto">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-[10px] text-zinc-600 italic">Current User</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Budgets Manager Tab */}
        <TabsContent value="budgets" className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Create Budget Form */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Create Budget Period</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">Set limits for scopes</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateBudget} className="space-y-4">
                
                {/* Scope Type */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">Budget Scope</Label>
                  <Select value={scopeType} onValueChange={(val) => { if (val) { setScopeType(val as any); setScopeId(''); } }}>
                    <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                      <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                      <SelectItem value="global">Global (All Business Unit)</SelectItem>
                      <SelectItem value="category">Category Specific</SelectItem>
                      <SelectItem value="channel">Channel Specific</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Conditional Scope Selector */}
                {scopeType === 'category' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Category Selection</Label>
                    <Select value={scopeId} onValueChange={(val) => setScopeId(val || '')}>
                      <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                        <SelectValue placeholder="Select Category" />
                      </SelectTrigger>
                      <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                        {categories?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {scopeType === 'channel' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Channel Selection</Label>
                    <Select value={scopeId} onValueChange={(val) => setScopeId(val || '')}>
                      <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                        <SelectValue placeholder="Select Channel" />
                      </SelectTrigger>
                      <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                        {channels?.map(ch => (
                          <SelectItem key={ch.id} value={ch.id}>{getFlatChannelLabel(ch.id)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Period Label */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">Period Label (e.g. "May 2026")</Label>
                  <Input 
                    type="text" 
                    value={periodLabel} 
                    onChange={e => setPeriodLabel(e.target.value)}
                    placeholder="May 2026"
                    className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                    required
                  />
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Start Date</Label>
                    <Input 
                      type="date" 
                      value={startsOn} 
                      onChange={e => setStartsOn(e.target.value)}
                      className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">End Date</Label>
                    <Input 
                      type="date" 
                      value={endsOn} 
                      onChange={e => setEndsOn(e.target.value)}
                      className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                      required
                    />
                  </div>
                </div>

                {/* Amount */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">Total Budget (USD)</Label>
                  <Input 
                    type="number" 
                    value={totalBudget} 
                    onChange={e => setTotalBudget(e.target.value)}
                    placeholder="5000"
                    className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                    required
                  />
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">Notes (Optional)</Label>
                  <Input 
                    type="text" 
                    value={notes} 
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Internal memo..."
                    className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                  />
                </div>

                <Button 
                  type="submit" 
                  disabled={isPending}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs h-9 mt-2"
                >
                  <Plus className="w-4 h-4 mr-2" /> Create Budget
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Budgets List Table */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Configured Budgets</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                    <th className="text-left font-medium py-3 px-4">Period</th>
                    <th className="text-left font-medium py-3 px-4">Scope</th>
                    <th className="text-right font-medium py-3 px-4">Total Cap</th>
                    <th className="text-right font-medium py-3 px-4">Allocated</th>
                    <th className="text-right font-medium py-3 px-4">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {budgets?.map(b => (
                    <tr key={b.budget_period_id} className="hover:bg-zinc-100 transition-colors">
                      <td className="py-3 px-4 font-semibold text-zinc-800">{b.period_label}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="capitalize border-zinc-300 text-zinc-600 bg-zinc-100/50">
                          {b.scope_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-zinc-700">${Number(b.total_budget).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-emerald-600 font-medium">${Number(b.allocated).toLocaleString()}</td>
                      <td className={`py-3 px-4 text-right font-medium ${Number(b.remaining) < 0 ? 'text-red-600' : 'text-zinc-600'}`}>
                        ${Number(b.remaining).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {budgets?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-zinc-500">
                        No budget periods created yet. Use the creation panel to add one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Custom Fields Tab */}
        <TabsContent value="custom_fields" className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Field Form */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">
                {editingFieldId ? 'Edit Custom Field' : 'Create Custom Field'}
              </CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Define task metadata schemas per channel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpsertField} className="space-y-4">
                {/* Select Channel */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">Target Channel *</Label>
                  <Select value={selectedFieldChannelId} onValueChange={(val) => setSelectedFieldChannelId(val || '')}>
                    <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                      <SelectValue placeholder="Select Channel" />
                    </SelectTrigger>
                    <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                      {channels?.map(ch => (
                        <SelectItem key={ch.id} value={ch.id}>
                          {getFlatChannelLabel(ch.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Name & Slug */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Field Name *</Label>
                    <Input
                      type="text"
                      value={fieldName}
                      onChange={e => handleNameChange(e.target.value)}
                      placeholder="Total Spend"
                      className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Slug *</Label>
                    <Input
                      type="text"
                      value={fieldSlug}
                      onChange={e => setFieldSlug(e.target.value)}
                      placeholder="total_spend"
                      className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                      required
                    />
                  </div>
                </div>

                {/* Type & Surface */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Field Type</Label>
                    <Select value={fieldType} onValueChange={(val) => setFieldType(val || 'text')}>
                      <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="long_text">Long Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="currency">Currency</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="date_range">Date Range</SelectItem>
                        <SelectItem value="dropdown">Dropdown</SelectItem>
                        <SelectItem value="multi_select">Multi-Select</SelectItem>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                        <SelectItem value="person">Person Link</SelectItem>
                        <SelectItem value="file">File Attachment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Render Surface</Label>
                    <Select value={fieldSurface} onValueChange={(val) => setFieldSurface(val || 'planning')}>
                      <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                        <SelectItem value="planning">Planning Fields</SelectItem>
                        <SelectItem value="tracker">Tracker Fields</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Dropdown Options */}
                {(fieldType === 'dropdown' || fieldType === 'multi_select') && (
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Options (Comma separated list)</Label>
                    <Input
                      type="text"
                      value={fieldOptionsText}
                      onChange={e => setFieldOptionsText(e.target.value)}
                      placeholder="option1, option2, option3"
                      className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                    />
                  </div>
                )}

                {/* Auto Calc Configuration */}
                <div className="border border-zinc-200 bg-zinc-100/50 rounded-lg p-3 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="is_auto_calc"
                      checked={fieldIsAutoCalc}
                      onCheckedChange={checked => setFieldIsAutoCalc(!!checked)}
                      className="border-zinc-300 bg-zinc-100"
                    />
                    <Label htmlFor="is_auto_calc" className="text-zinc-600 text-xs cursor-pointer">
                      Auto-Calculated Value
                    </Label>
                  </div>

                  {fieldIsAutoCalc && (
                    <div className="space-y-1 pt-1">
                      <Label className="text-[10px] text-zinc-500">Formula Rule Description</Label>
                      <Input
                        type="text"
                        value={fieldFormula}
                        onChange={e => setFieldFormula(e.target.value)}
                        placeholder="e.g. clicks / impressions * 100"
                        className="bg-zinc-200 border-zinc-300 text-xs h-8 text-zinc-800"
                      />
                    </div>
                  )}
                </div>

                {/* Sort Order & Settings */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Sort Order</Label>
                    <Input
                      type="number"
                      value={fieldSortOrder}
                      onChange={e => setFieldSortOrder(e.target.value)}
                      className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                    />
                  </div>
                  <div className="flex flex-col justify-end space-y-2 pb-1.5">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="is_required"
                        checked={fieldIsRequired}
                        onCheckedChange={checked => setFieldIsRequired(!!checked)}
                        className="border-zinc-300 bg-zinc-100"
                      />
                      <Label htmlFor="is_required" className="text-zinc-600 text-xs cursor-pointer">Required</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="cascades"
                        checked={fieldCascades}
                        onCheckedChange={checked => setFieldCascades(!!checked)}
                        className="border-zinc-300 bg-zinc-100"
                      />
                      <Label htmlFor="cascades" className="text-zinc-600 text-xs cursor-pointer">Cascade to children</Label>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">Description (Optional)</Label>
                  <Input
                    type="text"
                    value={fieldDescription}
                    onChange={e => setFieldDescription(e.target.value)}
                    placeholder="Short description for tooltip..."
                    className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  {editingFieldId && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setFieldName('')
                        setFieldSlug('')
                        setFieldOptionsText('')
                        setFieldFormula('')
                        setFieldIsAutoCalc(false)
                        setFieldDescription('')
                        setFieldSortOrder('0')
                        setFieldIsRequired(false)
                        setFieldCascades(true)
                        setEditingFieldId(null)
                      }}
                      className="w-1/3 text-xs h-9"
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={isPending}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs h-9"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {editingFieldId ? 'Update Field' : 'Create Field'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Fields list */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base font-semibold text-zinc-900">Configured Fields Schema</CardTitle>
                <CardDescription className="text-zinc-500 text-xs mt-1">
                  List of custom field rules.
                </CardDescription>
              </div>
              <div className="w-48">
                <Select value={filterChannelId} onValueChange={(val) => setFilterChannelId(val || 'all')}>
                  <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-8">
                    <SelectValue placeholder="All Channels" />
                  </SelectTrigger>
                  <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                    <SelectItem value="all">All Channels</SelectItem>
                    {channels?.map(ch => (
                      <SelectItem key={ch.id} value={ch.id}>
                        {getFlatChannelLabel(ch.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600 font-medium">
                    <th className="text-left py-3 px-4">Channel</th>
                    <th className="text-left py-3 px-4">Field Name</th>
                    <th className="text-left py-3 px-4">Slug</th>
                    <th className="text-left py-3 px-4">Type</th>
                    <th className="text-left py-3 px-4">Surface</th>
                    <th className="text-center py-3 px-4">Cascade</th>
                    <th className="text-center py-3 px-4">Required</th>
                    <th className="text-right py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {filteredFieldsList.map(field => (
                    <tr key={field.id} className="hover:bg-zinc-100 transition-colors">
                      <td className="py-3 px-4 text-zinc-600 font-medium">
                        {getFlatChannelLabel(field.channel_id)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-zinc-800">{field.name}</td>
                      <td className="py-3 px-4 text-zinc-500 font-mono">{field.slug}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="border-zinc-300 text-zinc-600 font-mono capitalize">
                          {field.field_type.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 capitalize text-zinc-600">{field.surface}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={field.cascades_to_children ? 'text-emerald-600' : 'text-zinc-600'}>
                          {field.cascades_to_children ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={field.is_required ? 'text-red-600' : 'text-zinc-600'}>
                          {field.is_required ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditField(field)}
                          className="h-7 w-7 text-zinc-600 hover:text-zinc-900"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteField(field.id)}
                          className="h-7 w-7 text-zinc-500 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredFieldsList.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-zinc-500">
                        No custom fields configured for the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Taxonomy Manager Tab */}
        <TabsContent value="taxonomy" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Categories Management Panel */}
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-zinc-900">
                  {editingCategoryId ? 'Edit Category' : 'Create Category'}
                </CardTitle>
                <CardDescription className="text-zinc-500 text-xs">
                  Create and manage taxonomy categories.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleUpsertCategory} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Category Name *</Label>
                      <Input
                        type="text"
                        value={catName}
                        onChange={e => setCatName(e.target.value)}
                        placeholder="e.g. Community"
                        className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Category Icon</Label>
                      <Select value={catIcon} onValueChange={(val) => setCatIcon(val || 'folder')}>
                        <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                          <SelectItem value="folder">Folder (Default)</SelectItem>
                          <SelectItem value="share-2">Share2 (Social)</SelectItem>
                          <SelectItem value="file-text">FileText (Content)</SelectItem>
                          <SelectItem value="calendar">Calendar (Events)</SelectItem>
                          <SelectItem value="handshake">Handshake (Partnerships)</SelectItem>
                          <SelectItem value="zap">Zap (Automations)</SelectItem>
                          <SelectItem value="send">Send (Outbound)</SelectItem>
                          <SelectItem value="users">Users (Internal)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Sort Order</Label>
                      <Input
                        type="number"
                        value={catSortOrder}
                        onChange={e => setCatSortOrder(e.target.value)}
                        className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                      />
                    </div>
                    {editingCategoryId && (
                      <div className="flex items-center space-x-2 pt-4">
                        <Checkbox
                          id="cat_active"
                          checked={catIsActive}
                          onCheckedChange={checked => setCatIsActive(!!checked)}
                          className="border-zinc-300 bg-zinc-100"
                        />
                        <Label htmlFor="cat_active" className="text-zinc-600 text-xs cursor-pointer">
                          Category Active
                        </Label>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {editingCategoryId && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setCatName('')
                          setCatIcon('folder')
                          setCatSortOrder('0')
                          setEditingCategoryId(null)
                          setCatIsActive(true)
                        }}
                        className="w-1/3 text-xs h-9"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs h-9"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {editingCategoryId ? 'Update Category' : 'Create Category'}
                    </Button>
                  </div>
                </form>

                <Separator className="bg-zinc-100 my-4" />

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600 font-medium">
                        <th className="text-left py-2 px-3">Name</th>
                        <th className="text-left py-2 px-3">Slug</th>
                        <th className="text-center py-2 px-3">Icon</th>
                        <th className="text-center py-2 px-3">Sort</th>
                        <th className="text-center py-2 px-3">Active</th>
                        <th className="text-right py-2 px-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {categories?.map(cat => (
                        <tr key={cat.id} className="hover:bg-zinc-100 transition-colors">
                          <td className="py-2 px-3 font-semibold text-zinc-800">{cat.name}</td>
                          <td className="py-2 px-3 text-zinc-500 font-mono">{cat.slug}</td>
                          <td className="py-2 px-3 text-center text-zinc-600 font-mono">{cat.icon || 'folder'}</td>
                          <td className="py-2 px-3 text-center text-zinc-700">{cat.sort_order}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={cat.is_active ? 'text-emerald-600' : 'text-zinc-600'}>
                              {cat.is_active ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditCategory(cat)}
                              className="h-6 w-6 text-zinc-600 hover:text-zinc-900"
                            >
                              <Edit3 className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Channels Management Panel */}
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-zinc-900">
                  {editingChannelId ? 'Edit Channel' : 'Create Channel'}
                </CardTitle>
                <CardDescription className="text-zinc-500 text-xs">
                  Create and nesting-structure channels under categories.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleUpsertChannel} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Target Category *</Label>
                      <Select 
                        value={chanCategoryId} 
                        onValueChange={(val) => {
                          setChanCategoryId(val || '')
                          setChanParentId('none') // Reset parent channel when category changes
                        }}
                      >
                        <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                          <SelectValue placeholder="Select Category" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                          {categories?.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Parent Channel (Optional)</Label>
                      <Select value={chanParentId} onValueChange={(val) => setChanParentId(val || 'none')}>
                        <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-9">
                          <SelectValue placeholder="No Parent" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                          <SelectItem value="none">None (Top-Level Channel)</SelectItem>
                          {channels?.filter(ch => ch.category_id === chanCategoryId && ch.id !== editingChannelId && !ch.parent_channel_id).map(ch => (
                            <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Channel Name *</Label>
                      <Input
                        type="text"
                        value={chanName}
                        onChange={e => setChanName(e.target.value)}
                        placeholder="e.g. YouTube Ads"
                        className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-600">Sort Order</Label>
                      <Input
                        type="number"
                        value={chanSortOrder}
                        onChange={e => setChanSortOrder(e.target.value)}
                        className="bg-zinc-200 border-zinc-300 text-xs h-9 text-zinc-800"
                      />
                    </div>
                  </div>

                  {editingChannelId && (
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="chan_active"
                        checked={chanIsActive}
                        onCheckedChange={checked => setChanIsActive(!!checked)}
                        className="border-zinc-300 bg-zinc-100"
                      />
                      <Label htmlFor="chan_active" className="text-zinc-600 text-xs cursor-pointer">
                        Channel Active
                      </Label>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {editingChannelId && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setChanName('')
                          setChanCategoryId('')
                          setChanParentId('none')
                          setChanSortOrder('0')
                          setEditingChannelId(null)
                          setChanIsActive(true)
                        }}
                        className="w-1/3 text-xs h-9"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs h-9"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {editingChannelId ? 'Update Channel' : 'Create Channel'}
                    </Button>
                  </div>
                </form>

                <Separator className="bg-zinc-100 my-4" />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-600">Filter list by Category</Label>
                    <div className="w-36">
                      <Select value={filterTaxonomyChannelCategory} onValueChange={(val) => setFilterTaxonomyChannelCategory(val || 'all')}>
                        <SelectTrigger className="bg-zinc-200 border-zinc-300 text-xs h-7">
                          <SelectValue placeholder="All Categories" />
                        </SelectTrigger>
                        <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                          <SelectItem value="all">All Categories</SelectItem>
                          {categories?.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600 font-medium">
                          <th className="text-left py-2 px-3">Channel Name</th>
                          <th className="text-left py-2 px-3">Parent Channel</th>
                          <th className="text-center py-2 px-3">Sort</th>
                          <th className="text-center py-2 px-3">Active</th>
                          <th className="text-right py-2 px-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {filteredChannelsList.map(ch => (
                          <tr key={ch.id} className="hover:bg-zinc-100 transition-colors">
                            <td className="py-2 px-3 font-semibold text-zinc-800">{ch.name}</td>
                            <td className="py-2 px-3 text-zinc-500 font-mono">
                              {ch.parent_channel_id ? getFlatChannelLabel(ch.parent_channel_id) : 'None'}
                            </td>
                            <td className="py-2 px-3 text-center text-zinc-700">{ch.sort_order}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={ch.is_active ? 'text-emerald-600' : 'text-zinc-600'}>
                                {ch.is_active ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditChannel(ch)}
                                className="h-6 w-6 text-zinc-600 hover:text-zinc-900"
                              >
                                <Edit3 className="w-3 h-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* HubSpot Tab */}
        <TabsContent value="hubspot" className="mt-6 space-y-6">
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600" /> HubSpot OAuth Connection Settings
              </CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Link and manage your HubSpot CRM connection. Sync metrics and pipelines into Outbound channels.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {hubspotConnection ? (
                // Connected View
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border border-emerald-200 bg-emerald-500/5 gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                        <h4 className="font-semibold text-emerald-600 text-sm">HubSpot Public App Linked</h4>
                      </div>
                      <p className="text-xs text-zinc-600">
                        Portal ID: <span className="font-mono text-zinc-800">{hubspotConnection.portal_id}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled
                        title="Not available in the static deployment (no sync server)"
                        className="bg-zinc-300 text-zinc-600 text-xs h-9 cursor-not-allowed"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync unavailable (no server)
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleDisconnectHubSpot}
                        className="border-red-200 bg-red-500/5 hover:bg-red-50 text-red-600 text-xs h-9"
                      >
                        <Unlink className="w-4 h-4 mr-2" />
                        Disconnect
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="bg-zinc-100/50 border border-zinc-200 rounded-lg p-3">
                      <span className="text-zinc-500 block mb-1">Connected By</span>
                      <span className="font-medium text-zinc-700">
                        {hubspotConnection.connector?.display_name || hubspotConnection.connector?.email || 'System'}
                      </span>
                    </div>
                    <div className="bg-zinc-100/50 border border-zinc-200 rounded-lg p-3">
                      <span className="text-zinc-500 block mb-1">Connected On</span>
                      <span className="font-medium text-zinc-700">
                        {new Date(hubspotConnection.connected_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-zinc-100/50 border border-zinc-200 rounded-lg p-3">
                      <span className="text-zinc-500 block mb-1">Last CRM Synchronization</span>
                      <span className="font-medium text-zinc-700">
                        {hubspotConnection.last_sync_at ? new Date(hubspotConnection.last_sync_at).toLocaleString() : 'Never'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                // Setup / Link View
                <div className="space-y-6">
                  <div className="p-4 rounded-xl border border-zinc-300 bg-zinc-100/50 space-y-2">
                    <h4 className="font-semibold text-zinc-900 text-sm">HubSpot integration is not available in this deployment</h4>
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      The tracker runs as a fully static app (no backend server), and connecting a
                      HubSpot portal requires a server to hold the OAuth secrets. If the team wants
                      HubSpot contact sync later, the tracker can be redeployed on a small server plan.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
