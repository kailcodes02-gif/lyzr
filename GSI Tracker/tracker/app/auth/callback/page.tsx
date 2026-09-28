'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { reportToOpener, signInPopupOpener } from '@/lib/embed-auth'

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
        // Supabase hides trigger messages behind "Database error saving new user";
        // that only happens for a non-Lyzr email or a twin-address duplicate.
        const code = desc.includes('already have a tracker account') ? 'twin' : (desc.includes('lyzr') || desc.includes('saving new user')) ? 'not_lyzr' : 'auth_failed'
        // Sign-in pop-up for an embedded tracker: the error belongs to the iframe.
        const opener = signInPopupOpener()
        if (opener) { reportToOpener(opener, { type: 'gsi-auth-error', error: code }); window.close(); return }
        router.replace(`/login?error=${code}`)
        return
      }
      // Attach owner / member rows written under either spelling of the email.
      try { await supabase.rpc('link_my_emails') } catch {}
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
      // Sign-in pop-up for an embedded tracker: hand the session to the iframe
      // and close. Hand over, not share — two holders of one refresh token trip
      // Supabase's reuse detection and both get logged out.
      const opener = signInPopupOpener()
      if (opener) {
        reportToOpener(opener, { type: 'gsi-auth', access_token: session.access_token, refresh_token: session.refresh_token })
        await supabase.auth.signOut({ scope: 'local' })
        window.close()
        return
      }
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
