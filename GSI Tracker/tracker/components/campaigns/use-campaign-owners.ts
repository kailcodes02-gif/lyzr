'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { CampaignOwner } from '@/lib/types/database'

// All campaign owners in one query, filtered client-side per banner card.
export function useAllCampaignOwners() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['campaignOwners', 'all'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('campaign_owners').select('*').order('sort_order')
      if (error) throw error
      return data as CampaignOwner[]
    },
  })
}

export function useCampaignOwnersInline(campaignId: string): CampaignOwner[] {
  const { data } = useAllCampaignOwners()
  return (data || []).filter(o => o.campaign_id === campaignId)
}
