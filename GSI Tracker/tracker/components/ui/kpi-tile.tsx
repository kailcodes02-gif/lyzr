import { Card, CardContent } from '@/components/ui/card'
import type { ReactNode } from 'react'

const ACCENTS: Record<string, { text: string; bg: string }> = {
  blue: { text: 'text-blue-600', bg: 'bg-blue-50' },
  emerald: { text: 'text-emerald-600', bg: 'bg-emerald-50' },
  red: { text: 'text-red-600', bg: 'bg-red-50' },
  violet: { text: 'text-violet-600', bg: 'bg-violet-50' },
  amber: { text: 'text-amber-600', bg: 'bg-amber-50' },
  zinc: { text: 'text-zinc-700', bg: 'bg-zinc-100' },
}

export function KpiTile({ label, value, icon, accent = 'blue', hint, valueClassName }: {
  label: string
  value: ReactNode
  icon?: ReactNode
  accent?: keyof typeof ACCENTS
  hint?: string
  valueClassName?: string
}) {
  const a = ACCENTS[accent] || ACCENTS.blue
  return (
    <Card className="bg-white border-zinc-200 hover:border-zinc-300 transition-all">
      <CardContent className="p-5 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
          <h3 className={`text-3xl font-bold mt-1 ${valueClassName || 'text-zinc-900'}`}>{value}</h3>
          {hint && <p className="text-[11px] text-zinc-500 mt-1 truncate">{hint}</p>}
        </div>
        {icon && <div className={`p-3 rounded-xl shrink-0 ${a.bg} ${a.text}`}>{icon}</div>}
      </CardContent>
    </Card>
  )
}
