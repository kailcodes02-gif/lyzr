'use client'

// Your personal link (lyzr.ai/marketing-tracker/?u=yourname), reachable from
// anywhere: the header, the account menu, My Tasks and the walkthrough.
import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { copyText, personUrl } from '@/lib/person-link'
import { cn } from '@/lib/utils'

export function useCopyMyLink() {
  const { data: me } = useCurrentUser()
  const url = me ? personUrl(me) : ''
  const copy = async () => {
    if (!url) return false
    const ok = await copyText(url)
    if (ok) toast.success('Your link is copied. Anyone at Lyzr can open it, see what you have on and add a task for you.', { description: url })
    else toast.message('Copy this link', { description: url, duration: 12000 })
    return ok
  }
  return { url, copy }
}

export function MyLinkButton({ className, label = 'My link' }: { className?: string; label?: string }) {
  const { url, copy } = useCopyMyLink()
  const [done, setDone] = useState(false)
  if (!url) return null
  return (
    <button type="button" title={`Copy your personal link: ${url}`}
      onClick={async () => { if (await copy()) { setDone(true); window.setTimeout(() => setDone(false), 1800) } }}
      className={cn('inline-flex items-center gap-1.5 h-8 rounded-md border border-zinc-300 bg-white hover:bg-zinc-50 px-2.5 text-xs font-medium text-zinc-800 cursor-pointer', className)}>
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Link2 className="w-3.5 h-3.5 text-blue-600" />}
      <span>{done ? 'Copied' : label}</span>
    </button>
  )
}

// The link written out with a copy button, for the walkthrough card.
export function MyLinkLine() {
  const { url } = useCopyMyLink()
  if (!url) return null
  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      <code className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-800 break-all select-all">{url}</code>
      <MyLinkButton label="Copy my link" />
    </span>
  )
}
