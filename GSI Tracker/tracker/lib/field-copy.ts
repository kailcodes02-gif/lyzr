// Plain-language labels and (i) help for the task fields every channel got
// when the GTM blueprint was seeded (scripts/seed-gtm.mjs). Keyed by slug.
// A field an admin has renamed keeps its own name; one with a description
// shows that description as its help instead of the default below.

type Copy = { label: string; help: string; seededName: string; options?: Record<string, string> }

const COPY: Record<string, Copy> = {
  frequency: {
    seededName: 'Frequency', label: 'How often',
    help: 'How often this activity runs — e.g. “Weekly”, “Monthly 1×”, “Once”, “Ongoing”.',
  },
  grade: {
    seededName: 'Star grade', label: 'Importance tier',
    help: 'How important this activity is in the marketing plan. Gold = must-do flagship work (starts as Critical priority), Silver = important (High), Bronze = good to have (Medium). Shown as a coloured ★ on the task card.',
    options: { gold: '★ Gold — must-do flagship', silver: '★ Silver — important', bronze: '★ Bronze — good to have' },
  },
  kpi_target: {
    seededName: 'KPI target', label: 'Target',
    help: 'What success looks like, as a number — e.g. “500 registrations” or “10k impressions/month”.',
  },
  opp_target: {
    seededName: 'Opportunity target', label: 'Opportunities target',
    help: 'How many sales opportunities this activity should create.',
  },
  kpi_actual: {
    seededName: 'KPI actual', label: 'Result achieved',
    help: 'What actually happened against the target — e.g. “430 registrations”. Fill in once it has run.',
  },
  opportunities_actual: {
    seededName: 'Opportunities actual', label: 'Opportunities created',
    help: 'How many sales opportunities it actually created.',
  },
  spend: {
    seededName: 'Spend', label: 'Money spent',
    help: 'What was actually spent on this activity, in USD.',
  },
  evidence_url: {
    seededName: 'Evidence URL', label: 'Proof link',
    help: 'A link that shows the result — a report, dashboard, screenshot or post.',
  },
}

export function fieldCopy(field: { slug: string; name: string; description?: string | null }) {
  const c = COPY[field.slug]
  const renamed = !c || field.name !== c.seededName
  return {
    label: renamed ? field.name : c.label,
    help: field.description || c?.help || '',
    optionLabel: (opt: string) => c?.options?.[opt] || opt.replace(/_/g, ' '),
  }
}

export const GRADE_HELP: Record<string, string> = {
  gold: 'Gold tier — must-do flagship activity',
  silver: 'Silver tier — important activity',
  bronze: 'Bronze tier — good-to-have activity',
}
