# Lyzr Marketing Tracker (formerly GSI Tracker)

Next.js 16 static export + Supabase. Multi-vertical task / tracker / budget
tool for the Lyzr marketing team. Live at https://lyzr.kailash-gm.com/GSI_Tracker/

- Product spec and history: `../lyzr-marketing-tracker-spec-v2.md`, `../knowledge_transfer.md`
- Architecture decisions: `DECISIONS.md` (D13 = verticals layer)
- Runbooks (cutover, seed, deploy): `RESTRUCTURE.md`
- Workspace-wide knowledge base: `../../KNOWLEDGE_BASE.md`

## Develop
```bash
npm install
npm run dev        # http://localhost:3000/GSI_Tracker
npm test           # vitest (lib/task-logic, lib/week-logic)
npx tsc --noEmit
```

## Data model in one line
verticals -> categories -> channels (-> sub-channels, linked to workspace
`functions`) -> tasks (-> sub-activities) -> checklist items. Budgets,
weekly reports, snapshots and saved views are scoped by vertical.
