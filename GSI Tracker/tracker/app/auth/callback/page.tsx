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
    const supabase = createClient()

    // createBrowserClient auto-detects the ?code and performs the PKCE
    // exchange during initialization; getSession() awaits that, so by the
    // time it resolves the session either exists or the exchange failed.
    const finish = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        const desc = (searchParams.get('error_description') || '').toLowerCase()
        router.replace(desc.includes('lyzr') ? '/login?error=not_lyzr' : '/login?error=auth_failed')
        return
      }
      // Microsoft does not send a picture claim; fetch the photo from Graph
      // once with the provider token and keep a small data URL on the profile.
      try {
        const provider = session.user.app_metadata?.provider
        if (provider === 'azure' && session.provider_token) {
          const { data: me } = await supabase.from('users').select('avatar_url, display_name').eq('id', session.user.id).maybeSingle()
          if (me && !me.avatar_url) {
            const res = await fetch('https://graph.microsoft.com/v1.0/me/photos/96x96/$value', { headers: { Authorization: `Bearer ${session.provider_token}` } })
            if (res.ok) {
              const blob = await res.blob()
              const dataUrl = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(blob) })
              if (dataUrl.length < 60_000) await supabase.from('users').update({ avatar_url: dataUrl }).eq('id', session.user.id)
            }
          }
        }
      } catch (e) { console.warn('avatar fetch skipped', e) }
      router.replace('/')
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
