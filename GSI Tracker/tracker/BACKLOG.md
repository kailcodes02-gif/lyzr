# Lyzr GSI/SI Marketing Tracker - Parked Backlog

> This file tracks features that are explicitly out of Core v0 scope.
> Build these in order after v0 ships.

## Phase 2 - Immediate fast-follows (right after v0)

1. **Calendar view** - per owner, per category, and global; recurring-task icons
2. **CSV column-mapping UI** - map arbitrary CSV headers to lead fields (replace fixed column order)
3. **Slack integration** - bot OAuth, per-category notification channels, DM on assign/mention, channel posts on create/live/done/blocked, daily overdue digest at 9:00 IST, retry queue via Supabase Edge Function
4. **Weekly snapshot cron** - nightly Supabase Edge Function + Weekly Review time-travel view with unspent-budget callouts
5. **Recurring tasks** - simple Google Calendar model: next instance auto-generates on completion; editing template affects future instances
6. **Task dependencies** - depends-on + blocks, with Slack/in-app ping when dependency closes
7. **45-day tracker-field freeze** - lock tracker metrics 45 days after completion; admin override

## Phase 3 - HubSpot + generic field engine

8. **HubSpot read-only sync** - OAuth, nightly contact/sequence sync, read-only contacts view under Outbound > HubSpot, "create task from contact"
9. **Generic Notion-style custom-field engine** - replace hardcoded channel field schemas with admin-editable engine (14 field types, per-channel, parent > child cascading)
10. **HubSpot pipeline-influenced auto-pull** - replace manual pipeline_influenced_usd entry

## Phase 4 - v2 polish

11. Task templates
12. Formula engine for custom auto-calc fields
13. AI summary of the Weekly Review
14. Recurring per-instance exceptions (full GCal parity)
15. Per-user notification preferences
16. Approval gates for high-budget/customer-facing tasks
17. Channel-level KPI dashboards
18. Track actual budget spend
19. Saved views
20. Bulk operations
21. Multi-currency
22. Inbox view
23. Slack quiet hours
24. Google Calendar sync
25. Monthly report generator
26. Custom statuses per channel
27. Effort/time tracking
28. Lyzr agentic AI auto-fill of tracker fields

## Never (explicitly out of scope)

- Public task sharing
- Email-to-create-task
- Mobile native app
- Real-time multiplayer cursors
- Email notifications
- HubSpot writes
- Multi-business-unit support
- Delegated channel-admin role
