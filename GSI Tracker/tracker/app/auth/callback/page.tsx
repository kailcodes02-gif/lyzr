'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// PKCE landing page (static build — no server route): exchanges the ?code
// from Google/Supabase for a session, then enters the app.
function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const code = searchParams.get('code')
    const supabase = createClient()

    const finish = async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
          router.replace('/')
          return
        }
      }
      // Already-established session (detectSessionInUrl may have consumed it)
      const { data: { session } } = await supabase.auth.getSession()
      router.replace(session ? '/' : '/login?error=auth_failed')
    }
    finish()
  }, [searchParams, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="text-center space-y-3">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full mx-auto" />
        <p className="text-sm text-zinc-500">Signing you in…</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <CallbackContent />
    </Suspense>
  )
}
