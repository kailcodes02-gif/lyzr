'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { rememberReturnTo } from '@/lib/return-to'
import { deepLinkTarget } from '@/lib/embed'

// Static build has no middleware: the auth gate lives client-side. Data was
// never protected by the old middleware anyway — Supabase RLS is the boundary;
// this guard only handles the redirect UX.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let waiting: number | undefined
    // Arrived through the public lyzr.ai link with ?u= or ?page=: that is
    // where this visit is headed, signed in or not.
    const deep = deepLinkTarget()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (!session) {
        // Come back to this page (e.g. someone's shared link) after sign-in.
        rememberReturnTo(deep)
        router.replace('/login')
      } else {
        if (!deep) { setReady(true); return }
        // Headed somewhere else: keep the spinner up until we are there, so
        // this page never flashes on the way to the one the link points at.
        router.replace(deep)
        waiting = window.setInterval(() => {
          if (deepLinkTarget()) return
          window.clearInterval(waiting)
          if (!cancelled) setReady(true)
        }, 30)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login')
    })
    return () => { cancelled = true; window.clearInterval(waiting); subscription.unsubscribe() }
  }, [router])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full" />
      </div>
    )
  }
  return <>{children}</>
}
