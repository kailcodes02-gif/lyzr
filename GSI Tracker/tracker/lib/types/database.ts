// Database types for Core v0
// These mirror the Supabase schema exactly

export type UserRole = 'admin' | 'member'
export type TaskStatus = 'not_started' | 'in_progress' | 'live' | 'blocked' | 'done' | 'cancelled'
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
export type AssignmentRole = 'primary' | 'secondary' | 'tertiary' | 'other'
export type MentionSurface = 'task_description' | 'task_comment' | 'checklist_item' | 'blocked_description' | 'insight'
export type BudgetPeriodType = 'one_time' | 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'custom'
export type BudgetScopeType = 'global' | 'vertical' | 'category' | 'channel'
export type NotificationType = 'assigned' | 'mentioned' | 'comment' | 'status_change' | 'dependency_completed' | 'subtask_completed' | 'parent_blocked' | 'budget_overrun_warning' | 'overdue'
  | 'task_edited' | 'checklist' | 'subtask_added' | 'suggestion' | 'suggestion_resolved' | 'campaign_ask' | 'task_created'
export type FieldType = 'text' | 'long_text' | 'number' | 'currency' | 'date' | 'date_range' | 'dropdown' | 'multi_select' | 'checkbox' | 'url' | 'email' | 'phone' | 'person' | 'file'
export type FieldSurface = 'planning' | 'tracker'

export interface User {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  role: UserRole
  created_at: string
  alt_email?: string | null
}

// ============ VERTICALS & FUNCTIONS ============

export interface VerticalSettings {
  leads_pipeline: boolean
  weekly_report_builder: boolean
  resources: boolean
  hubspot_contacts: boolean
}

export interface Vertical {
  id: string
  name: string
  slug: string
  description: string | null
  icon: string | null
  color: string | null
  sort_order: number
  is_active: boolean
  settings: Partial<VerticalSettings>
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface VerticalOwner {
  vertical_id: string
  email: string
  user_id: string | null
  sort_order: number
  created_at: string
}

export interface Fn {
  id: string
  name: string
  slug: string
  icon: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface FunctionOwner {
  function_id: string
  email: string
  user_id: string | null
  sort_order: number
  created_at: string
}

export interface VerticalResource {
  id: string
  vertical_id: string
  group_name: string
  name: string
  url: string
  sort_order: number
  added_by: string | null
  created_at: string
}

export interface TaxonomyTemplate {
  id: string
  name: string
  slug: string
  description: string | null
  body: Record<string, unknown>
  source_vertical_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CampaignKind = 'launch' | 'thunderclap' | 'campaign'
export type CampaignStatus = 'upcoming' | 'live' | 'done' | 'cancelled'

export interface Campaign {
  id: string
  vertical_id: string | null
  kind: CampaignKind
  name: string
  slug: string
  headline: string | null
  description: string | null
  cta_label: string | null
  cta_url: string | null
  starts_on: string | null
  ends_on: string | null
  status: CampaignStatus
  is_pinned: boolean
  color: string | null
  ask: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CampaignOwner { campaign_id: string; email: string; user_id: string | null; sort_order: number }
export interface CampaignParticipant {
  campaign_id: string
  email: string
  user_id: string | null
  done_at: string | null
  proof_url: string | null
  note: string | null
}

export const CAMPAIGN_KIND: Record<CampaignKind, { label: string; emoji: string; className: string }> = {
  launch: { label: 'Launch', emoji: '🚀', className: 'from-violet-600 to-fuchsia-600' },
  thunderclap: { label: 'Thunderclap', emoji: '⚡', className: 'from-amber-500 to-orange-600' },
  campaign: { label: 'Campaign', emoji: '🎯', className: 'from-blue-600 to-cyan-600' },
}

export interface VerticalMember { vertical_id: string; email: string; user_id: string | null; added_by: string | null; created_at: string }

export interface TaskSuggestion {
  id: string
  task_id: string
  suggested_by: string
  patch: Record<string, unknown>
  note: string | null
  status: 'pending' | 'accepted' | 'rejected'
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  suggester?: { id: string; email: string; display_name: string | null; avatar_url: string | null }
}

export interface EffectiveChannelOwner {
  channel_id: string
  email: string
  user_id: string | null
  sort_order: number
  source: 'channel' | 'parent' | 'function'
}

export interface Category {
  id: string
  vertical_id: string
  name: string
  slug: string
  icon: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export type ChannelTier = 'gold' | 'silver' | 'bronze' | 'hygiene'

export interface Channel {
  id: string
  vertical_id: string
  function_id: string | null
  category_id: string
  parent_channel_id: string | null
  name: string
  slug: string
  sort_order: number
  is_active: boolean
  created_at: string
  tier: ChannelTier | null
  goal: string | null
  target: string | null
  budget_note: string | null
  extra: Record<string, unknown>
  // Joined
  category?: Category
  parent_channel?: Channel
  children?: Channel[]
}

export interface ChannelOwner {
  channel_id: string
  email: string
  user_id: string | null
  sort_order: number
  created_at: string
}

export interface ChannelResource {
  id: string
  channel_id: string
  name: string
  url: string
  added_by: string | null
  created_at: string
}

export interface ChannelLearning {
  id: string
  channel_id: string
  body: string
  added_by: string | null
  created_at: string
}

export interface ChannelTarget {
  id: string
  channel_id: string
  body: string
  added_by: string | null
  sort_order: number
  created_at: string
}

export const TIER_CONFIG: Record<ChannelTier, { label: string; emoji: string; className: string }> = {
  gold: { label: 'Gold', emoji: '🥇', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  silver: { label: 'Silver', emoji: '🥈', className: 'bg-slate-100 text-slate-700 border-slate-300' },
  bronze: { label: 'Bronze', emoji: '🥉', className: 'bg-orange-100 text-orange-800 border-orange-300' },
  hygiene: { label: 'Hygiene', emoji: '🧹', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

export const GRADE_STAR: Record<string, string> = {
  gold: 'text-amber-500',
  silver: 'text-slate-400',
  bronze: 'text-orange-600',
}

export interface Task {
  id: string
  channel_id: string
  parent_task_id: string | null
  nesting_level: number
  title: string
  description: string | null
  priority: TaskPriority
  status: TaskStatus
  due_date: string | null
  result_url: string | null
  result_file_path: string | null
  budget_allocated: number | null
  budget_period_id: string | null
  blocked_by_user_id: string | null
  blocked_by_email: string | null
  blocked_reason: string | null
  planning_fields: Record<string, unknown>
  tracker_fields: Record<string, unknown>
  created_by: string
  created_at: string
  updated_at: string
  went_live_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  recurring_template_id?: string | null
  tracker_frozen_at?: string | null
  campaign_id?: string | null
  // Joined
  channel?: Channel
  creator?: User
  assignments?: TaskAssignment[]
  // Unresolved rows = owners who haven't signed in yet (email-only)
  pending_assignments?: { email: string; role: AssignmentRole; resolved_user_id: string | null }[]
  subtasks?: Task[]
  checklist_items?: ChecklistItem[]
  comments?: TaskComment[]
}

export interface TaskAssignment {
  task_id: string
  user_id: string
  role: AssignmentRole
  assigned_at: string
  assigned_by: string | null
  // Joined
  user?: User
}

export interface ChecklistItem {
  id: string
  task_id: string
  body: string
  is_done: boolean
  done_at: string | null
  done_by: string | null
  sort_order: number
  created_by: string
  created_at: string
}

export interface TaskComment {
  id: string
  task_id: string
  user_id: string
  body: string
  file_path: string | null
  created_at: string
  updated_at: string
  // Joined
  user?: User
}

export interface Mention {
  id: string
  task_id: string
  surface: MentionSurface
  surface_ref_id: string | null
  mentioned_user_id: string | null
  mentioned_email: string | null
  mentioned_by: string
  created_at: string
}

export interface BudgetPeriod {
  id: string
  scope_type: BudgetScopeType
  scope_id: string | null
  period_type: BudgetPeriodType
  period_label: string
  starts_on: string
  ends_on: string
  total_budget: number
  created_by: string
  created_at: string
  notes: string | null
  vertical_id: string | null
}

export interface BudgetPeriodSummary extends BudgetPeriod {
  budget_period_id: string
  allocated: number
  remaining: number
  task_count: number
}

export interface ActivityLog {
  id: string
  task_id: string | null
  actor_id: string | null
  action: string
  from_value: unknown
  to_value: unknown
  created_at: string
  // Joined
  actor?: User
  task?: Task
}

export interface Notification {
  id: string
  user_id: string
  task_id: string | null
  type: NotificationType
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
  // Joined
  task?: Task
}

export interface SavedView {
  id: string
  user_id: string
  vertical_id: string | null
  page: string
  name: string
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

// Priority colors — P0 status red, P1 brand orange, P2 navy, P3/P4 greys
export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  P0: '#D92D20',
  P1: '#FE4B1E',
  P2: '#043E77',
  P3: '#8A857C',
  P4: '#6B675F',
}

// Status — traffic light: green = live/done (brand live #2F8F5B), yellow = in
// progress, red = blocked, grey = not started/cancelled (brand paused tone).
export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bgColor: string }> = {
  not_started: { label: 'Not Started', color: '#6B675F', bgColor: '#F1F0EE' },
  in_progress: { label: 'In Progress', color: '#B54708', bgColor: '#FEF0C7' },
  live: { label: 'Live', color: '#1F613E', bgColor: '#D8EDE2' },
  blocked: { label: 'Blocked', color: '#B42318', bgColor: '#FEE4E2' },
  done: { label: 'Done', color: '#194E32', bgColor: '#B2DBC6' },
  cancelled: { label: 'Cancelled', color: '#8A857C', bgColor: '#E3E1DE' },
}

// Traffic-light dot per status (lists, tables, the Projects view).
export const STATUS_DOT: Record<TaskStatus, string> = {
  not_started: '#B8B4AD',
  in_progress: '#F5A00A',
  live: '#2F8F5B',
  blocked: '#D92D20',
  done: '#2F8F5B',
  cancelled: '#CFCCC7',
}

// Kanban columns (cancelled hidden by default)
export const KANBAN_COLUMNS: TaskStatus[] = ['not_started', 'in_progress', 'live', 'blocked', 'done']

// Category icons mapping to lucide names
export const CATEGORY_ICONS: Record<string, string> = {
  'share-2': 'Share2',
  'file-text': 'FileText',
  'calendar': 'Calendar',
  'handshake': 'Handshake',
  'zap': 'Zap',
  'send': 'Send',
  'users': 'Users',
}

export interface ChannelField {
  id: string
  channel_id: string
  name: string
  slug: string
  field_type: FieldType
  surface: FieldSurface
  is_required: boolean
  options: string[] | null
  formula: string | null
  is_auto_calc: boolean
  description: string | null
  sort_order: number
  cascades_to_children: boolean
  created_at: string
}

