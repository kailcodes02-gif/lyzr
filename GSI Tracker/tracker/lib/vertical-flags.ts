import type { Vertical, VerticalSettings } from './types/database'

// Per-vertical feature flags. GSI ships with every flag on (its HubSpot
// lead pull, Instantly report, pipeline widget and resources links exist);
// every other vertical starts with them off until an integration is built
// for it. Missing keys resolve to false so older rows stay valid.
export const DEFAULT_FLAGS: VerticalSettings = {
  leads_pipeline: false,
  weekly_report_builder: false,
  resources: false,
  hubspot_contacts: false,
}

export const ALL_FLAGS_ON: VerticalSettings = {
  leads_pipeline: true,
  weekly_report_builder: true,
  resources: true,
  hubspot_contacts: true,
}

export const FLAG_LABELS: Record<keyof VerticalSettings, { label: string; hint: string }> = {
  leads_pipeline: { label: 'Leads Pipeline', hint: 'HubSpot lead pull, email-interactions CSV and lead CSV import' },
  weekly_report_builder: { label: 'Weekly Report builder', hint: 'Create Weekly Report with HubSpot, Instantly and ad-spend inputs' },
  resources: { label: 'Resources page', hint: 'Curated link groups for this vertical' },
  hubspot_contacts: { label: 'HubSpot synced contacts tab', hint: 'Synced Contacts tab on the HubSpot channel' },
}

export function resolveFlags(settings: Vertical['settings'] | null | undefined): VerticalSettings {
  return { ...DEFAULT_FLAGS, ...(settings || {}) }
}
