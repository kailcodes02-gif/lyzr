'use client'

import { useTasks, useChannels } from '@/lib/hooks/use-data'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useState, useTransition, useMemo } from 'react'
import { Upload, Users, AlertCircle, FileText, CheckCircle2, XCircle } from 'lucide-react'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { importLeads } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import Papa from 'papaparse'

import {
  Dialog as BaseDialog,
  DialogContent as BaseDialogContent,
  DialogHeader as BaseDialogHeader,
  DialogTitle as BaseDialogTitle,
  DialogDescription as BaseDialogDescription,
  DialogFooter as BaseDialogFooter,
} from '@/components/ui/dialog'

// Lead fields a CSV column can map to. "ignore" is also valid (handled via empty mapping).
const LEAD_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
  { value: 'source', label: 'Source channel' },
  { value: 'generated_date', label: 'Generated date' },
  { value: 'lead_status', label: 'Lead status' },
  { value: 'notes', label: 'Notes (long text)' },
] as const

type LeadField = typeof LEAD_FIELDS[number]['value']

// Hints used to auto-suggest CSV column -> Lead field mappings.
const FIELD_HINTS: Record<LeadField, string[]> = {
  name: ['name', 'fullname', 'leadname', 'contactname', 'firstname'],
  email: ['email', 'emailaddress', 'mail', 'workemail'],
  company: ['company', 'companyname', 'organization', 'org', 'account'],
  source: ['source', 'sourcechannel', 'channel', 'leadsource', 'campaign'],
  generated_date: ['generateddate', 'date', 'created', 'createddate', 'createdat', 'leaddate'],
  lead_status: ['leadstatus', 'status', 'stage'],
  notes: ['notes', 'note', 'description', 'comments', 'remarks'],
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  qualified: 'bg-violet-50 text-violet-600 border-violet-500/20',
  unqualified: 'bg-zinc-100 text-zinc-600 border-zinc-300',
  converted: 'bg-emerald-50 text-emerald-600 border-emerald-200',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Returns a mapping from CSV column header -> Lead field (or '' for ignore).
// Each Lead field is assigned to at most one CSV column.
function autoSuggestMapping(headers: string[]): Record<string, LeadField | ''> {
  const result: Record<string, LeadField | ''> = {}
  const taken = new Set<LeadField>()

  for (const h of headers) {
    const norm = normalize(h)
    let match: LeadField | '' = ''
    for (const field of LEAD_FIELDS) {
      if (taken.has(field.value)) continue
      const hints = FIELD_HINTS[field.value]
      if (hints.some(hint => norm === hint || norm.includes(hint))) {
        match = field.value
        taken.add(field.value)
        break
      }
    }
    result[h] = match
  }
  return result
}

export default function LeadsPage() {
  const queryClient = useQueryClient()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  useChannels()

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [csvData, setCsvData] = useState<Record<string, string>[] | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  // columnMapping[csvHeader] = leadField | '' (ignore)
  const [columnMapping, setColumnMapping] = useState<Record<string, LeadField | ''>>({})
  const [dedup, setDedup] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Build reverse map: leadField -> csvHeader (or undefined if not mapped)
  const fieldToColumn = useMemo(() => {
    const m: Partial<Record<LeadField, string>> = {}
    for (const [col, field] of Object.entries(columnMapping)) {
      if (field) m[field] = col
    }
    return m
  }, [columnMapping])

  // Unmapped CSV columns (will become extra_fields JSON on the task)
  const unmappedColumns = useMemo(
    () => headers.filter(h => !columnMapping[h]),
    [headers, columnMapping]
  )

  // Validation pass: per-row email validity + dupes within the file
  const validation = useMemo(() => {
    if (!csvData) return null
    const emailCol = fieldToColumn.email
    const seenEmails = new Set<string>()
    const rowFlags = csvData.map(row => {
      const email = emailCol ? String(row[emailCol] || '').trim() : ''
      const validEmail = EMAIL_RE.test(email)
      const isDupeInFile = validEmail && seenEmails.has(email.toLowerCase())
      if (validEmail) seenEmails.add(email.toLowerCase())
      return { email, validEmail, isDupeInFile }
    })
    const validCount = rowFlags.filter(r => r.validEmail).length
    const invalidCount = rowFlags.filter(r => !r.validEmail).length
    const dupeCount = rowFlags.filter(r => r.isDupeInFile).length
    return { rowFlags, validCount, invalidCount, dupeCount }
  }, [csvData, fieldToColumn])

  if (tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-zinc-200 rounded-xl" />
          ))}
        </div>
        <div className="h-96 bg-zinc-200 rounded-xl" />
      </div>
    )
  }

  const leadsTasks = tasks?.filter(t => t.channel?.slug === 'all-leads') || []
  const totalLeads = leadsTasks.length
  const newLeads = leadsTasks.filter(t => (t.planning_fields?.lead_status || t.planning_fields?.status) === 'new').length
  const qualifiedLeads = leadsTasks.filter(t => t.planning_fields?.lead_status === 'qualified').length
  const convertedLeads = leadsTasks.filter(t => t.planning_fields?.lead_status === 'converted').length

  const resetUploadState = () => {
    setCsvData(null)
    setHeaders([])
    setColumnMapping({})
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    Papa.parse<Record<string, string>>(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          toast.error('CSV appears to be empty.')
          return
        }
        const fileHeaders = (results.meta.fields || Object.keys(results.data[0] as object)).filter(Boolean)
        setCsvData(results.data)
        setHeaders(fileHeaders)
        setColumnMapping(autoSuggestMapping(fileHeaders))
      },
      error: (err) => {
        toast.error(`Failed to parse CSV: ${err.message}`)
      },
    })
  }

  // When the user picks a Lead field for a CSV column, ensure no other column
  // is already mapped to the same field (auto-unmap the previous one).
  const setColumnField = (csvHeader: string, field: LeadField | '') => {
    setColumnMapping(prev => {
      const next: Record<string, LeadField | ''> = { ...prev }
      if (field) {
        for (const h of Object.keys(next)) {
          if (h !== csvHeader && next[h] === field) next[h] = ''
        }
      }
      next[csvHeader] = field
      return next
    })
  }

  const handleImport = () => {
    if (!csvData || !validation) return

    if (!fieldToColumn.email) {
      toast.error('Please map a CSV column to the Email field before importing.')
      return
    }

    const formattedLeads = csvData
      .map((row, idx) => {
        const flag = validation.rowFlags[idx]
        if (!flag.validEmail) return null

        const extra_fields: Record<string, unknown> = {}
        for (const col of unmappedColumns) {
          const val = row[col]
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            extra_fields[col] = val
          }
        }

        return {
          name: String(row[fieldToColumn.name || ''] || '').trim() || 'Unknown',
          email: String(row[fieldToColumn.email || ''] || '').trim(),
          company: String(row[fieldToColumn.company || ''] || '').trim(),
          source: String(row[fieldToColumn.source || ''] || '').trim() || 'CSV Import',
          generated_date:
            String(row[fieldToColumn.generated_date || ''] || '').trim() ||
            new Date().toISOString().split('T')[0],
          lead_status: String(row[fieldToColumn.lead_status || ''] || '').trim() || 'new',
          notes: String(row[fieldToColumn.notes || ''] || '').trim(),
          extra_fields,
        }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)

    if (formattedLeads.length === 0) {
      toast.error('No rows with valid email addresses to import.')
      return
    }

    startTransition(async () => {
      try {
        const res = await importLeads(formattedLeads, dedup)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['activity'] })
        toast.success(
          `Imported ${res.imported} lead${res.imported === 1 ? '' : 's'}` +
            (res.skipped > 0 ? ` (skipped ${res.skipped} duplicates)` : '')
        )
        setUploadOpen(false)
        resetUploadState()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'An error occurred during import.'
        console.error('importLeads failed:', err)
        toast.error(msg)
      }
    })
  }

  const previewRows = csvData?.slice(0, 5) || []

  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-600" /> Leads Pipeline
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Import, view, and track prospective marketing leads
          </p>
        </div>
        <Button
          onClick={() => setUploadOpen(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white border-0"
        >
          <Upload className="w-4 h-4 mr-2" /> Upload CSV
        </Button>
      </div>

      {/* KPI stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardContent className="p-6">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold">Total leads</span>
            <h3 className="text-2xl font-bold text-zinc-900 mt-1">{totalLeads}</h3>
          </CardContent>
        </Card>
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardContent className="p-6">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold">New leads</span>
            <h3 className="text-2xl font-bold text-blue-600 mt-1">{newLeads}</h3>
          </CardContent>
        </Card>
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardContent className="p-6">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold">Qualified</span>
            <h3 className="text-2xl font-bold text-violet-600 mt-1">{qualifiedLeads}</h3>
          </CardContent>
        </Card>
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardContent className="p-6">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold">Converted</span>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">{convertedLeads}</h3>
          </CardContent>
        </Card>
      </div>

      {/* Leads Grid */}
      <Card className="bg-white border-zinc-200 backdrop-blur-xl">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                <th className="text-left font-medium py-3 px-4">Lead Name</th>
                <th className="text-left font-medium py-3 px-4">Email</th>
                <th className="text-left font-medium py-3 px-4">Company</th>
                <th className="text-left font-medium py-3 px-4">Source</th>
                <th className="text-left font-medium py-3 px-4">Generated Date</th>
                <th className="text-left font-medium py-3 px-4">Lead Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {leadsTasks.map(lead => {
                const name = lead.title
                const email = (lead.planning_fields?.email as string) || '-'
                const company = (lead.planning_fields?.company as string) || '-'
                const source = (lead.planning_fields?.source as string) || '-'
                const date = (lead.planning_fields?.generated_date as string) || '-'
                const status = (lead.planning_fields?.lead_status as string) || 'new'

                return (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedTaskId(lead.id)}
                    className="hover:bg-zinc-100 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4 font-medium text-zinc-800">{name}</td>
                    <td className="py-3.5 px-4 text-zinc-600">{email}</td>
                    <td className="py-3.5 px-4 text-zinc-600">{company}</td>
                    <td className="py-3.5 px-4 text-zinc-600">{source}</td>
                    <td className="py-3.5 px-4 text-zinc-500">{date}</td>
                    <td className="py-3.5 px-4">
                      <Badge variant="outline" className={STATUS_COLORS[status] || STATUS_COLORS.new}>
                        {status}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
              {leadsTasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
                    No leads found in pipeline. Click Upload CSV to add leads.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Upload CSV Dialog */}
      <BaseDialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          if (!open) resetUploadState()
        }}
      >
        <BaseDialogContent className="bg-white border-zinc-300 text-zinc-900 max-w-3xl max-h-[90vh] overflow-y-auto">
          <BaseDialogHeader>
            <BaseDialogTitle className="text-zinc-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" /> Upload Leads CSV
            </BaseDialogTitle>
            <BaseDialogDescription className="text-zinc-600 text-xs">
              Map your CSV columns to lead fields. Unmapped columns are stored as extra_fields on each lead.
            </BaseDialogDescription>
          </BaseDialogHeader>

          <div className="space-y-5 my-2">
            {!csvData ? (
              <div className="border border-dashed border-zinc-300 rounded-lg p-8 flex flex-col items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-zinc-500" />
                <div className="text-center">
                  <span className="text-xs text-zinc-600">Select a CSV file to begin parsing</span>
                </div>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="bg-zinc-100 border-zinc-300 text-xs h-9 cursor-pointer w-56"
                />
              </div>
            ) : (
              <>
                {/* Validation summary */}
                {validation && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-lg border border-zinc-200 bg-zinc-100/50 p-3">
                      <div className="text-[10px] uppercase text-zinc-500 font-semibold">Total rows</div>
                      <div className="text-lg font-bold text-zinc-900 mt-0.5">{csvData.length}</div>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-500/5 p-3">
                      <div className="text-[10px] uppercase text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Valid
                      </div>
                      <div className="text-lg font-bold text-emerald-600 mt-0.5">{validation.validCount}</div>
                    </div>
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                      <div className="text-[10px] uppercase text-rose-400 font-semibold flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Bad email
                      </div>
                      <div className="text-lg font-bold text-rose-300 mt-0.5">{validation.invalidCount}</div>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <div className="text-[10px] uppercase text-amber-600 font-semibold flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Dupes in file
                      </div>
                      <div className="text-lg font-bold text-amber-300 mt-0.5">{validation.dupeCount}</div>
                    </div>
                  </div>
                )}

                {/* Column mapping form */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-zinc-700">Map CSV columns to lead fields</h4>
                    <span className="text-[10px] text-zinc-500">
                      {unmappedColumns.length} unmapped {unmappedColumns.length === 1 ? 'column' : 'columns'}
                      {unmappedColumns.length > 0 ? ' to extra_fields' : ''}
                    </span>
                  </div>
                  <div className="bg-zinc-100/50 p-3 rounded-lg border border-zinc-200 max-h-64 overflow-y-auto">
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-2 items-center">
                      <div className="text-[10px] uppercase text-zinc-500 font-semibold">CSV column</div>
                      <div />
                      <div className="text-[10px] uppercase text-zinc-500 font-semibold">Lead field</div>
                      {headers.map((h) => {
                        const currentField = columnMapping[h] || ''
                        return (
                          <FragmentRow
                            key={h}
                            header={h}
                            currentField={currentField}
                            onChange={(val) => setColumnField(h, val as LeadField | '')}
                          />
                        )
                      })}
                    </div>
                  </div>
                  {!fieldToColumn.email && (
                    <div className="text-[11px] text-rose-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Email field is required to import.
                    </div>
                  )}
                </div>

                {/* Preview pane */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-zinc-700">Preview (first 5 rows)</h4>
                  <div className="bg-zinc-100/40 border border-zinc-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-500">
                          <th className="text-left font-medium py-2 px-3 w-8">#</th>
                          {LEAD_FIELDS.filter(f => fieldToColumn[f.value]).map(f => (
                            <th key={f.value} className="text-left font-medium py-2 px-3">
                              {f.label}
                              <span className="block text-[9px] text-zinc-600 font-normal">
                                from: {fieldToColumn[f.value]}
                              </span>
                            </th>
                          ))}
                          <th className="text-left font-medium py-2 px-3">Email valid?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {previewRows.map((row, i) => {
                          const flag = validation?.rowFlags[i]
                          return (
                            <tr key={i} className="text-zinc-700">
                              <td className="py-1.5 px-3 text-zinc-600">{i + 1}</td>
                              {LEAD_FIELDS.filter(f => fieldToColumn[f.value]).map(f => {
                                const col = fieldToColumn[f.value]!
                                const val = row[col]
                                const isEmailCell = f.value === 'email'
                                const isBad = isEmailCell && flag && !flag.validEmail
                                return (
                                  <td
                                    key={f.value}
                                    className={`py-1.5 px-3 ${isBad ? 'text-rose-400' : ''}`}
                                  >
                                    {val ? String(val).slice(0, 40) : <span className="text-zinc-600">-</span>}
                                  </td>
                                )
                              })}
                              <td className="py-1.5 px-3">
                                {flag?.validEmail ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-600">
                                    <CheckCircle2 className="w-3 h-3" /> ok
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-rose-400">
                                    <XCircle className="w-3 h-3" /> invalid
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {previewRows.length === 0 && (
                          <tr>
                            <td colSpan={LEAD_FIELDS.length + 2} className="py-3 px-3 text-center text-zinc-600">
                              No preview rows.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {unmappedColumns.length > 0 && (
                    <div className="text-[10px] text-zinc-500">
                      Unmapped columns stored as extra_fields:{' '}
                      <span className="text-zinc-600">{unmappedColumns.join(', ')}</span>
                    </div>
                  )}
                </div>

                {/* Dedup option */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="dedup"
                    checked={dedup}
                    onCheckedChange={(checked) => setDedup(!!checked)}
                  />
                  <Label htmlFor="dedup" className="text-xs text-zinc-600 cursor-pointer">
                    Skip rows where email already exists in pipeline
                  </Label>
                </div>
              </>
            )}
          </div>

          <BaseDialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setUploadOpen(false)
                resetUploadState()
              }}
              className="text-zinc-600 hover:text-zinc-900"
            >
              Cancel
            </Button>
            {csvData && (
              <Button
                onClick={handleImport}
                disabled={isPending || !fieldToColumn.email || (validation?.validCount ?? 0) === 0}
                className="bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {isPending
                  ? 'Importing...'
                  : `Import ${validation?.validCount ?? 0} lead${(validation?.validCount ?? 0) === 1 ? '' : 's'}`}
              </Button>
            )}
          </BaseDialogFooter>
        </BaseDialogContent>
      </BaseDialog>

      {/* Task Detail Drawer */}
      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null)
          }}
          onTaskIdChange={setSelectedTaskId}
        />
      )}
    </div>
  )
}

// Single CSV column -> Lead field mapping row. Defined out-of-line so the parent
// re-renders cleanly when the mapping state changes.
function FragmentRow({
  header,
  currentField,
  onChange,
}: {
  header: string
  currentField: string
  onChange: (val: string) => void
}) {
  return (
    <>
      <div className="text-xs text-zinc-700 truncate" title={header}>
        {header}
      </div>
      <div className="text-zinc-600 text-xs">{'→'}</div>
      <select
        value={currentField}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-200 border border-zinc-300 rounded-md px-2 py-1 text-xs text-zinc-700 h-8"
      >
        <option value="">Ignore this column</option>
        {LEAD_FIELDS.map(f => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </>
  )
}
