'use client'

import { useCurrentUser, useUsers, useBudgetPeriods, useCategories, useChannels, useHubSpotConnection, usePendingInvites, useVerticals } from '@/lib/hooks/use-data'
import { TaxonomyManager } from '@/components/admin/taxonomy-manager'
import { VerticalsTab } from '@/components/admin/verticals-tab'
import { FunctionsTab } from '@/components/admin/functions-tab'
import { TaskFieldsTab } from '@/components/admin/task-fields-tab'
import { ApiKeysCard } from '@/components/admin/api-keys-card'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { updateUserRole, createBudgetPeriod, disconnectHubSpot, inviteUser, cancelInvite } from '@/lib/actions'
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
import { Users, Landmark, Settings, ShieldAlert, Plus, DollarSign, RefreshCw, Sliders, Trash2, Edit3, Link2, Unlink, Network, Building2, Workflow } from 'lucide-react'

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-8 bg-zinc-50 min-h-screen" />}>
      <AdminContent />
    </Suspense>
  )
}

function AdminContent() {
  const initialTab = useSearchParams().get('tab') || 'users'
  const queryClient = useQueryClient()
  const { data: currentUser, isLoading: userLoading } = useCurrentUser()
  const { data: users, isLoading: usersLoading } = useUsers()
  const { data: pendingInvites } = usePendingInvites()
  const { data: budgets, isLoading: budgetsLoading } = useBudgetPeriods()
  const { data: categories } = useCategories()
  const { data: channels } = useChannels()

  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState(initialTab)

  // Form State for creating Budget Period
  const [scopeType, setScopeType] = useState<'global' | 'vertical' | 'category' | 'channel'>('global')
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

  const { data: allVerticals } = useVerticals(true)
  const [taxonomyVertical, setTaxonomyVertical] = useState('')

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
  const verticalNameOf = (id: string) => allVerticals?.find(v => v.id === id)?.name
  const getFlatChannelLabel = (chId: string) => {
    const ch = channels?.find(c => c.id === chId)
    if (!ch) return 'Unknown'
    const parent = channels?.find(p => p.id === ch.parent_channel_id)
    const base = parent ? `${parent.name} > ${ch.name}` : ch.name
    const vn = verticalNameOf(ch.vertical_id)
    return vn ? `${vn} · ${base}` : base
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      
      {/* Header */}
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-zinc-600" /> Workspace settings
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Set up how the tracker is organised. Work top to bottom the first time — each section explains what it is for.</p>
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(String(v))} orientation="vertical" className="w-full flex-col lg:flex-row gap-6 items-start">
        <TabsList className="w-full lg:w-64 shrink-0 h-auto flex-col items-stretch gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 lg:sticky lg:top-20">
          {SECTIONS.map((s, i) => (
            <TabsTrigger key={s.value} value={s.value}
              className="h-auto justify-start items-start gap-2.5 rounded-lg px-3 py-2 text-left whitespace-normal data-active:bg-zinc-100 data-active:text-zinc-900 after:hidden">
              <s.icon className="w-4 h-4 mt-0.5 shrink-0 text-zinc-500" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-zinc-900">
                  <span className="brand-label text-zinc-400 mr-1.5">{String(i + 1).padStart(2, '0')}</span>{s.label}
                </span>
                <span className="block text-[11px] font-normal text-zinc-500 leading-snug">{s.short}</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 min-w-0 w-full space-y-5">
        <SectionHeader value={activeTab} />

        {/* Users Tab */}
        <TabsContent value="users" className="mt-0 space-y-6">
          {/* Invite a teammate */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Invite a teammate</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Send a sign-in invite to any lyzr.com email. They sign in with Microsoft; any tasks already assigned to that address get auto-mapped to their account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  placeholder="teammate@lyzr.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  className="bg-white border-zinc-300 text-sm h-9 flex-1"
                />
                <Button type="submit" disabled={isPending || !inviteEmail.trim()} className="bg-zinc-900 hover:bg-zinc-800 text-white h-9">
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
              <CardTitle className="text-base font-semibold text-zinc-900">Everyone in the tracker</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                Admins can change every workspace setting. Members do the work. Change someone’s role on the right.
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
                            <SelectTrigger className="w-[120px] bg-white border-zinc-300 text-xs h-7 ml-auto">
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
        <TabsContent value="budgets" className="mt-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Create Budget Form */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Add a budget</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">A spending limit for a period of time.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateBudget} className="space-y-4">
                
                {/* Scope Type */}
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-600">What does this budget cover?</Label>
                  <Select value={scopeType} onValueChange={(val) => { if (val) { setScopeType(val as any); setScopeId(''); } }}>
                    <SelectTrigger className="bg-white border-zinc-300 text-xs h-9">
                      <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                      <SelectItem value="global">The whole company</SelectItem>
                      <SelectItem value="vertical">One vertical</SelectItem>
                      <SelectItem value="category">One group</SelectItem>
                      <SelectItem value="channel">One channel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Conditional Scope Selector */}
                {scopeType === 'vertical' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Vertical</Label>
                    <Select value={scopeId} onValueChange={(val) => setScopeId(val || '')}>
                      <SelectTrigger className="bg-white border-zinc-300 text-xs h-9">
                        <SelectValue placeholder="Choose a vertical" />
                      </SelectTrigger>
                      <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                        {(allVerticals || []).map(v => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {scopeType === 'category' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Which group?</Label>
                    <Select value={scopeId} onValueChange={(val) => setScopeId(val || '')}>
                      <SelectTrigger className="bg-white border-zinc-300 text-xs h-9">
                        <SelectValue placeholder="Choose a group" />
                      </SelectTrigger>
                      <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                        {categories?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{verticalNameOf(c.vertical_id) ? `${verticalNameOf(c.vertical_id)} · ` : ''}{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {scopeType === 'channel' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">Which channel?</Label>
                    <Select value={scopeId} onValueChange={(val) => setScopeId(val || '')}>
                      <SelectTrigger className="bg-white border-zinc-300 text-xs h-9">
                        <SelectValue placeholder="Choose a channel" />
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
                  <Label className="text-xs text-zinc-600">Name this period (e.g. “May 2026”)</Label>
                  <Input 
                    type="text" 
                    value={periodLabel} 
                    onChange={e => setPeriodLabel(e.target.value)}
                    placeholder="May 2026"
                    className="bg-white border-zinc-300 text-xs h-9 text-zinc-800"
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
                      className="bg-white border-zinc-300 text-xs h-9 text-zinc-800"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-600">End Date</Label>
                    <Input 
                      type="date" 
                      value={endsOn} 
                      onChange={e => setEndsOn(e.target.value)}
                      className="bg-white border-zinc-300 text-xs h-9 text-zinc-800"
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
                    className="bg-white border-zinc-300 text-xs h-9 text-zinc-800"
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
                    className="bg-white border-zinc-300 text-xs h-9 text-zinc-800"
                  />
                </div>

                <Button 
                  type="submit" 
                  disabled={isPending}
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-xs h-9 mt-2"
                >
                  <Plus className="w-4 h-4 mr-2" /> Add budget
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Budgets List Table */}
          <Card className="bg-white border-zinc-200 backdrop-blur-xl lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900">Budgets already set</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                    <th className="text-left font-medium py-3 px-4">Period</th>
                    <th className="text-left font-medium py-3 px-4">Scope</th>
                    <th className="text-right font-medium py-3 px-4">Limit</th>
                    <th className="text-right font-medium py-3 px-4">Planned on tasks</th>
                    <th className="text-right font-medium py-3 px-4">Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {budgets?.map(b => (
                    <tr key={b.budget_period_id} className="hover:bg-zinc-100 transition-colors">
                      <td className="py-3 px-4 font-semibold text-zinc-800">{b.period_label}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="capitalize border-zinc-300 text-zinc-600 bg-zinc-100/50">
                          {({ global: 'Whole company', vertical: 'Vertical', category: 'Group', channel: 'Channel' } as Record<string, string>)[b.scope_type] || b.scope_type}
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
                        No budgets yet. Add one on the left.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom_fields" className="mt-0">
          <TaskFieldsTab />
        </TabsContent>

        {/* Taxonomy Manager Tab: per vertical */}
        <TabsContent value="taxonomy" className="mt-0 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-xs text-zinc-600">Showing the structure of</Label>
            <div className="w-56">
              <Select value={taxonomyVertical} onValueChange={val => setTaxonomyVertical(val || '')}>
                <SelectTrigger className="bg-white border-zinc-300 text-xs h-9"><SelectValue placeholder="Pick a vertical" /></SelectTrigger>
                <SelectContent className="bg-white shadow-lg border-zinc-300 text-xs text-zinc-700">
                  {(allVerticals || []).map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-zinc-500">Vertical owners can edit the same thing from their space under Vertical Settings.</p>
          </div>
          {taxonomyVertical ? <TaxonomyManager verticalId={taxonomyVertical} /> : <p className="text-sm text-zinc-500">Pick a vertical to manage its categories and channels.</p>}
        </TabsContent>

        {/* Verticals Tab */}
        <TabsContent value="verticals" className="mt-0">
          <VerticalsTab />
        </TabsContent>

        {/* Functions Tab */}
        <TabsContent value="functions" className="mt-0">
          <FunctionsTab />
        </TabsContent>

        {/* HubSpot Tab */}
        <TabsContent value="hubspot" className="mt-0 space-y-6">
          <ApiKeysCard />
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600" /> HubSpot
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
        </div>
      </Tabs>
    </div>
  )
}

// The settings sections, in the order someone setting up the tracker should
// walk them. `why` is shown at the top of each section in plain language.
const SECTIONS = [
  { value: 'users', label: 'People', icon: Users, short: 'Invite teammates, pick admins',
    why: 'Everyone who uses the tracker. Invite a teammate by email — they sign in with Microsoft and any tasks already assigned to their address appear automatically. Admins can change every setting on this page; members just do the work. For vertical, channel and leadership roles, use the Members page.' },
  { value: 'verticals', label: 'Verticals', icon: Building2, short: 'Business lines with their own dashboard',
    why: 'A vertical is a business line — GSI is one. Each vertical gets its own dashboard, channels, owners and members. Lyzr is the company-wide vertical: it is always on and can\u2019t be removed.' },
  { value: 'taxonomy', label: 'Channels & structure', icon: Network, short: 'Groups → channels → sub-channels',
    why: 'The folders work lives in. Inside each vertical, work is organised as Group → Channel → Sub-channel (e.g. Demand gen → Events → Field events). Every task sits in one channel. Pick a vertical below to add, rename or reorder its channels.' },
  { value: 'functions', label: 'Domains', icon: Workflow, short: 'One discipline across verticals',
    why: 'A domain ties the same discipline together across verticals — one “Events” domain covers the Events channel in GSI and everywhere else, so it can have one owner and one company-wide view.' },
  { value: 'custom_fields', label: 'Task fields', icon: Sliders, short: 'Extra questions a channel\u2019s tasks ask',
    why: 'Every task has a title, owner, due date and priority. Task fields add the extra details one channel needs — Events tasks might ask “Venue” and “Expected attendees”, Paid Ads tasks “Daily budget”. Build one in four steps; drag to reorder.' },
  { value: 'budgets', label: 'Budgets', icon: Landmark, short: 'Money limits per period',
    why: 'Set how much can be spent in a period — for the whole company, one vertical, one group or one channel. Budgets entered on tasks count against the matching limit, so you can see what is left.' },
  { value: 'hubspot', label: 'Integrations', icon: RefreshCw, short: 'API keys, HubSpot and other connections',
    why: 'Connections to outside tools. API keys let Lyzr agents, bots and scripts read and update the tracker through its API; HubSpot lead data is read-only and never written back.' },
] as const

function SectionHeader({ value }: { value: string }) {
  const s = SECTIONS.find(x => x.value === value) || SECTIONS[0]
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 flex gap-3">
      <s.icon className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{s.label}</h2>
        <p className="text-[13px] leading-relaxed text-zinc-600 mt-0.5 max-w-3xl">{s.why}</p>
      </div>
    </div>
  )
}
