'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/use-data'

// Onboarding memory that follows the PERSON, not the browser. localStorage
// alone kept replaying the tour: inside the lyzr.ai frame (and on any new
// device) the browser store comes back empty on the next sign-in. The flags
// live in one saved_views row per user (page 'onboarding', name 'flags'),
// whose config is { "tour:v3": true, "intro:space_dashboard": true, … }.
// localStorage stays as a same-session cache so nothing flashes twice while
// the query is in flight.

const PAGE = 'onboarding'
const NAME = 'flags'

export function useOnboardingFlags() {
  const supabase = createClient()
  const { data: user } = useCurrentUser()
  const { data, isSuccess } = useQuery({
    queryKey: ['onboardingFlags', user?.id],
    enabled: !!user,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      // limit(1), not single: the live table tolerated duplicates before
      // migration 033 restored its unique rule.
      const { data, error } = await supabase
        .from('saved_views').select('config')
        .eq('user_id', user!.id).eq('page', PAGE).eq('name', NAME)
        .order('updated_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0]?.config ?? {}) as Record<string, boolean>
    },
  })
  // Until the row is confirmed absent, callers must not auto-open anything.
  return { flags: data, ready: isSuccess }
}

export function useMarkOnboardingFlag() {
  const supabase = createClient()
  const qc = useQueryClient()
  const { data: user } = useCurrentUser()
  return async (...keys: string[]) => {
    if (!user || !keys.length) return
    const prev = qc.getQueryData<Record<string, boolean>>(['onboardingFlags', user.id]) ?? {}
    const config = { ...prev, ...Object.fromEntries(keys.map(k => [k, true])) }
    qc.setQueryData(['onboardingFlags', user.id], config)
    try {
      // Update-then-insert instead of upsert: it works with or without the
      // unique constraint (033). A race just writes the same flags twice.
      const { data: hit, error: ue } = await supabase.from('saved_views')
        .update({ config, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('page', PAGE).eq('name', NAME).select('id')
      if (ue) throw ue
      if (!hit?.length) {
        const { error: ie } = await supabase.from('saved_views')
          .insert({ user_id: user.id, page: PAGE, name: NAME, config })
        if (ie) throw ie
      }
    } catch {
      // Offline or racing another tab: the local cache still hides it this
      // session, and the next successful mark rewrites the full set.
    }
  }
}
