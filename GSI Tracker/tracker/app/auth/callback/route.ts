import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  // Route handlers receive basePath-stripped URLs; redirects must add it back.
  const base = process.env.NEXT_PUBLIC_BASE_PATH || ''

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${base}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${base}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${base}${next}`)
      }
    }
  }

  // Return the user to login with error
  return NextResponse.redirect(`${origin}${base}/login?error=auth_failed`)
}
