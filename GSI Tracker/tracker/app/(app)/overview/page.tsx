'use client'

import { OverviewHeader, TreeOverview } from '@/components/workspace/tree-overview'

export default function OverviewPage() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1400px] mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <OverviewHeader />
      <TreeOverview />
    </div>
  )
}
