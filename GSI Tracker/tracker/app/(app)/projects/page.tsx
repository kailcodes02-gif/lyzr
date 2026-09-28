'use client'

import { Suspense } from 'react'
import { ProjectView } from '@/components/projects/project-view'

export default function ProjectsPage() {
  return <Suspense fallback={<div className="p-8 bg-white min-h-screen" />}><ProjectView /></Suspense>
}
