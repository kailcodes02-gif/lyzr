import { Suspense } from 'react'
import { Hub } from '@/components/hub/hub'

export default function PersonalSpacePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <Hub />
    </Suspense>
  )
}
