import { Suspense } from 'react'
import { AuthGuard } from '@/components/layout/auth-guard'
import { VerticalProvider } from '@/components/providers/vertical-provider'
import { WelcomeTour } from '@/components/workspace/welcome-tour'

// The personal space (/u/): its own light shell instead of the dashboard's
// sidebar. Same sign-in gate; the vertical provider is here because the task
// drawer and the New task dialog read it.
export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
        <VerticalProvider>{children}<WelcomeTour hub /></VerticalProvider>
      </Suspense>
    </AuthGuard>
  )
}
