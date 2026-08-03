'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '@/lib/hooks/use-data'

export default function MyCalendarShortcut() {
  const router = useRouter()
  const { data: user, isLoading } = useCurrentUser()

  useEffect(() => {
    if (isLoading) return
    if (user?.email) {
      router.replace(`/owners/view/?email=${encodeURIComponent(user.email)}&tab=calendar`)
    } else {
      router.replace('/calendar')
    }
  }, [user, isLoading, router])

  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-zinc-50 text-zinc-500 text-sm">
      Loading your calendar...
    </div>
  )
}
