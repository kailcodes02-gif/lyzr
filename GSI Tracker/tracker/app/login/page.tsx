'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

function LoginContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const router = useRouter()

  // Already signed in? Straight to the app.
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/')
    })
  }, [router])

  // Which buttons to show, in order. Each provider must also be switched on
  // in Supabase › Authentication › Providers, or Supabase answers
  // "provider is not enabled" and we show that under the buttons.
  const providers = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS || 'azure').split(',').map(s => s.trim()).filter(Boolean)
  const [failed, setFailed] = useState<string | null>(null)

  const signIn = async (provider: 'google' | 'azure' | 'slack_oidc') => {
    const supabase = createClient()
    const redirectTo = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/auth/callback/`
    const opts: Record<string, unknown> = { redirectTo }
    if (provider === 'google') opts.queryParams = { hd: 'lyzr.ai', prompt: 'select_account' }
    if (provider === 'azure') { opts.scopes = 'openid profile email User.Read'; opts.queryParams = { prompt: 'select_account' } }
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: opts })
    if (error) { console.error('Login error:', error); setFailed(error.message) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-50 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-50 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="bg-zinc-100 backdrop-blur-xl border border-zinc-300 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V10" />
                <path d="M18 20V4" />
                <path d="M6 20v-4" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 mb-1">Lyzr Marketing Tracker</h1>
            <p className="text-sm text-zinc-600">Lyzr internal operations tool</p>
          </div>

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm text-center">
              {error === 'not_lyzr' ? 'Only lyzr.com Microsoft accounts can sign in. If you used to sign in with Google, ask an admin to move your account to your lyzr.com address.' : error === 'twin' ? 'You already have an account under your other Lyzr email. Sign in with that one, then add this login under Me › Linked accounts.' : 'Authentication failed. Please try again.'}
            </div>
          )}

          <div className="space-y-3">
            {providers.includes('slack_oidc') && (
              <button onClick={() => signIn('slack_oidc')} className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-[#4A154B] text-white font-medium rounded-xl hover:bg-[#3d1140] transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg cursor-pointer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5.04 15.16a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52zm1.27 0a2.52 2.52 0 1 1 5.04 0v6.32a2.52 2.52 0 1 1-5.04 0v-6.32zM8.83 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.83zm0 1.27a2.52 2.52 0 1 1 0 5.04H2.52a2.52 2.52 0 1 1 0-5.04h6.31zm10.13 2.52a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.83zm-1.27 0a2.52 2.52 0 1 1-5.04 0V2.52a2.52 2.52 0 1 1 5.04 0v6.31zm-2.52 10.13a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52zm0-1.27a2.52 2.52 0 1 1 0-5.04h6.31a2.52 2.52 0 1 1 0 5.04h-6.31z"/></svg>
                Sign in with Slack
              </button>
            )}
            {providers.includes('azure') && (
              <button onClick={() => signIn('azure')} className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white text-zinc-900 font-medium rounded-xl hover:bg-zinc-100 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg cursor-pointer border border-zinc-200">
                <svg width="20" height="20" viewBox="0 0 23 23"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="12" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="12" width="10" height="10" fill="#00A4EF"/><rect x="12" y="12" width="10" height="10" fill="#FFB900"/></svg>
                Sign in with Microsoft
              </button>
            )}
            {providers.includes('google') && (
              <button onClick={() => signIn('google')} className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white text-zinc-900 font-medium rounded-xl hover:bg-zinc-100 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg cursor-pointer border border-zinc-200">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Sign in with Google
              </button>
            )}
          </div>
          {failed && <p className="mt-3 text-xs text-center text-red-600">{failed}</p>}

          <p className="mt-6 text-xs text-center text-zinc-500">
            Sign in with your Lyzr Microsoft account (name@lyzr.com)
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
