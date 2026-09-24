'use client'

import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { HELP } from '@/lib/help-text'
import { cn } from '@/lib/utils'

// Small hover-help icon. Pass a key from lib/help-text.ts (preferred, so
// wording stays consistent) or free text.
export function InfoTip({ k, text, className, side = 'top' }: {
  k?: string
  text?: string
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  const body = text || (k ? HELP[k] : '')
  if (!body) return null
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('inline-flex items-center align-middle text-zinc-400 hover:text-blue-600 cursor-help', className)}
        aria-label="More information"
      >
        <Info className="w-3.5 h-3.5" />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[280px] leading-relaxed text-left">
        {body}
      </TooltipContent>
    </Tooltip>
  )
}

// Heading with an info icon after it: <HelpLabel k="channel">Channels</HelpLabel>
export function HelpLabel({ k, text, children, className }: { k?: string; text?: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {children}
      <InfoTip k={k} text={text} />
    </span>
  )
}
