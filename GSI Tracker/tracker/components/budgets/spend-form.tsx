'use client'

// Log money actually spent against a budget: amount, the date it was spent,
// and what it was for. One line, Enter to add. Used inside a budget's row on
// the Budgets page and in the quick dialog on channel / campaign pages.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { addBudgetSpend } from '@/lib/actions'
import { money } from '@/lib/budgets'
import { cn } from '@/lib/utils'

const today = () => new Date().toLocaleDateString('en-CA')
const field = 'h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900'

export function SpendForm({ budgetId, onAdded, autoFocus, className }: { budgetId: string; onAdded?: () => void; autoFocus?: boolean; className?: string }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const amt = Number(amount)
  const ok = amount.trim() !== '' && Number.isFinite(amt) && amt !== 0 && !!date

  const add = async () => {
    if (!ok || busy) return
    setBusy(true)
    try {
      await addBudgetSpend({ budget_id: budgetId, amount: amt, spent_on: date, note })
      toast.success(amt < 0 ? `Logged a ${money(-amt)} refund` : `Logged ${money(amt)} spent`)
      setAmount(''); setNote('')
      qc.invalidateQueries({ queryKey: ['budgets'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      onAdded?.()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add() } }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} onClick={e => e.stopPropagation()}>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
        <input type="number" step="any" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={onEnter} autoFocus={autoFocus}
          placeholder="Amount spent" aria-label="Amount spent" className={cn(field, 'w-36 pl-6')} />
      </div>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} onKeyDown={onEnter} aria-label="Date spent" className={cn(field, 'w-40')} />
      <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={onEnter} placeholder="What was it for? e.g. LinkedIn invoice" aria-label="What it was for" className={cn(field, 'flex-1 min-w-[12rem]')} />
      <button type="button" disabled={!ok || busy} onClick={add}
        className="inline-flex items-center gap-1 h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium px-3 disabled:opacity-50 cursor-pointer">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Log spend
      </button>
    </div>
  )
}

export function SpendDialog({ open, onOpenChange, budgetId, title }: { open: boolean; onOpenChange: (o: boolean) => void; budgetId: string; title: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border border-zinc-200 text-zinc-900 sm:max-w-2xl rounded-xl shadow-2xl p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-zinc-100">
          <DialogTitle className="text-base font-semibold">Log spend · {title}</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-5 space-y-2">
          <SpendForm budgetId={budgetId} autoFocus onAdded={() => onOpenChange(false)} />
          <p className="text-xs text-zinc-500">Enter what was actually paid and the day it was paid. Use a minus amount for a refund.</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
