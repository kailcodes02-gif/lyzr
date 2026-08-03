import { Suspense } from 'react'
import { AppSidebar, AppHeader } from '@/components/layout/app-shell'
import { AuthGuard } from '@/components/layout/auth-guard'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        {/* Suspense: sidebar reads useSearchParams for channel highlighting */}
        <Suspense fallback={<aside className="w-64 bg-white border-r border-zinc-200" />}>
          <AppSidebar />
        </Suspense>
        <div className="flex-1 flex flex-col overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
