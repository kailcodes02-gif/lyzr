'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'

export default function MyCalendarShortcut() {
  const router = useRouter()
  const { data: user, isLoading } = useCurrentUser()
  const { slug, resolving } = useVertical()

  useEffect(() => {
    if (isLoading || resolving) return
    if (user?.email) {
      router.replace(`/owners/view/?email=${encodeURIComponent(user.email)}&tab=calendar&v=${slug}`)
    } else {
      router.replace(`/calendar/?v=${slug}`)
    }
  }, [user, isLoading, resolving, slug, router])

  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-zinc-50 text-zinc-500 text-sm">
      Loading your calendar...
    </div>
  )
}
