import { Suspense } from 'react'
import { AppSidebar, AppHeader } from '@/components/layout/app-shell'
import { AuthGuard } from '@/components/layout/auth-guard'
import { VerticalProvider } from '@/components/providers/vertical-provider'
import { WelcomeTour } from '@/components/workspace/welcome-tour'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      {/* Suspense: the vertical provider and sidebar read useSearchParams */}
      <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
        <VerticalProvider>
          <div className="flex h-screen overflow-hidden">
            <AppSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              <AppHeader />
              <main className="flex-1 overflow-y-auto">
                {children}
              </main>
              <WelcomeTour />
            </div>
          </div>
        </VerticalProvider>
      </Suspense>
    </AuthGuard>
  )
}
