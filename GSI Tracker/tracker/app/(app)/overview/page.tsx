'use client'

import { PageIntro } from '@/components/ui/page-intro'
import { OverviewHeader, TreeOverview } from '@/components/workspace/tree-overview'

export default function OverviewPage() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1400px] mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <OverviewHeader />
      <PageIntro k="overview">
        The tree of everything: company → verticals → groups → channels → sub-channels, with task
        counts at every level. Use it to understand how the work is organised and where it lives.
      </PageIntro>
      <TreeOverview />
    </div>
  )
}
