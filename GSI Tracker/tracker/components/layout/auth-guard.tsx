'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Static build has no middleware: the auth gate lives client-side. Data was
// never protected by the old middleware anyway — Supabase RLS is the boundary;
// this guard only handles the redirect UX.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (!session) {
        router.replace('/login')
      } else {
        setReady(true)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login')
    })
    return () => { cancelled = true; subscription.unsubscribe() }
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
