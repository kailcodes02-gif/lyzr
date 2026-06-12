import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image, favicon (asset paths)
     * - common image/font extensions
     * - api routes (they re-validate auth.getUser themselves and don't need the middleware round-trip)
     *
     * Skipping /api here cuts ~150-300ms per data fetch since auth.getUser() makes a network
     * call to Supabase. RLS still gates the actual queries server-side.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf)$).*)',
  ],
}
