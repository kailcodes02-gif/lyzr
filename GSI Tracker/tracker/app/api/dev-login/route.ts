import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Local-preview bypass: signs the browser in as preview@lyzr.ai WITHOUT Google
// OAuth. Hard-gated to `next dev` — production builds return 404, so this
// route can never ship as a working backdoor.
const PREVIEW_EMAIL = 'preview@lyzr.ai'

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not found', { status: 404 })
  }

  // Stable machine-local password; never displayed, never stored in code.
  const password = process.env.SUPABASE_SERVICE_ROLE_KEY!.slice(-32)
  const admin = await createServiceClient()

  const { error: createErr } = await admin.auth.admin.createUser({
    email: PREVIEW_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Local Preview' },
  })
  if (createErr && !/already|exists/i.test(createErr.message)) {
    return new NextResponse(`Preview user creation failed: ${createErr.message}`, { status: 500 })
  }
  if (createErr) {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existing = data?.users.find(u => u.email === PREVIEW_EMAIL)
    if (existing) await admin.auth.admin.updateUserById(existing.id, { password })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: PREVIEW_EMAIL, password })
  if (error) {
    return new NextResponse(
      `Sign-in failed: ${error.message}. If this says email logins are disabled, enable the Email provider in Supabase Auth settings (dev only).`,
      { status: 500 }
    )
  }
  return NextResponse.redirect(new URL('/', request.url))
}
