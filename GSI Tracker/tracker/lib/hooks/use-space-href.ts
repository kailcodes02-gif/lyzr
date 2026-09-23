'use client'

import { useCallback } from 'react'
import { useVertical } from './use-vertical'

// Builds hrefs that carry the current vertical scope (?v=<slug> or ?v=all).
// Static export uses trailingSlash, so paths always end with "/" before "?".
export function withVertical(path: string, slug: string | 'all', extra?: Record<string, string | undefined>): string {
  const [base, query = ''] = path.split('?')
  const normalized = base.endsWith('/') ? base : `${base}/`
  const params = new URLSearchParams(query)
  params.set('v', slug)
  for (const [k, val] of Object.entries(extra || {})) {
    if (val === undefined || val === null || val === '') params.delete(k)
    else params.set(k, val)
  }
  return `${normalized}?${params.toString()}`
}

export function useSpaceHref() {
  const { slug } = useVertical()
  return useCallback(
    (path: string, extra?: Record<string, string | undefined>) => withVertical(path, slug, extra),
    [slug],
  )
}
