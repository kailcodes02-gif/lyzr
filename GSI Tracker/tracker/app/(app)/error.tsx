'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App route error boundary:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 p-4 lg:p-8">
      <div className="max-w-2xl mx-auto rounded-2xl border border-red-500/30 bg-red-500/5 backdrop-blur-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-500/15 text-red-600">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Something went wrong</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              This page failed to load. You can try again or head back to the dashboard.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-600 font-mono break-words max-h-40 overflow-y-auto">
          {error.message || 'Unknown error'}
          {error.digest && (
            <div className="mt-2 text-[10px] text-zinc-600">digest: {error.digest}</div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={reset}
            className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white border-0"
          >
            <RefreshCw className="w-4 h-4 mr-2" /> Reset
          </Button>
          <a
            href="/"
            className="text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
