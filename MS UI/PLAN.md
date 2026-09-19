<!--
Plan + feasibility for a Gmail-like Outlook UI and a Google-Drive-like OneDrive UI on Microsoft Graph.
Produced 2026-09-20 from a 22-agent research run: 5 research lenses, 14 load-bearing claims
fact-checked against learn.microsoft.com (4 corrected and folded in), completeness critique, revision.
Spot-checked afterwards: Graph Toolkit retired 2026-08-28 (npm deprecation notice), sharedWithMe
deprecation notice (stops Nov 2026), simple upload limit 250 MB. Status: PLAN ONLY, nothing built yet.
-->

# Outlook-as-Gmail + OneDrive-as-Drive on Microsoft Graph - Plan & Feasibility

## 1. Verdict: GO-WITH-CONDITIONS

Everything on your list is buildable as a pure browser app (MSAL.js + Graph, no backend, no secret) hosted like `comms-tracker`. The code is not the risk; **tenant consent is**. Every delegated scope you need is "admin consent required: No" in Graph's own reference - including delegated `Sites.Read.All`, so the comms-tracker block was tenant policy, not that scope ([permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)). Microsoft's managed default policy (rolled onto untouched tenants mid-2025) lets users self-consent to `User.Read`, `Mail.Send`, `Files.ReadWrite`, `Contacts.Read` but blocks `Mail.Read`, `Mail.ReadWrite`, `Mail.ReadBasic`, `Files.*.All`, `Sites.Read.All`/`Sites.ReadWrite.All`, `MailboxSettings.*`, `MailboxFolder.*`, `Calendars.*`, `Contacts.ReadWrite`, `Tasks.*`, `People.Read`, all `.Shared` variants and EWS/IMAP/POP/EAS ([policy doc](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies#microsoft-recommended-current-settings); the list auto-updates, re-read it before adding scopes). A mail client cannot read mail without `Mail.ReadWrite`, so expect one admin action - a Cloud Application Administrator suffices, scoped to this app or to you alone.

**What you will not get (plain language):** Outlook signature sync, snooze, schedule-send, Gmail-grade search (it will feel like Outlook web: ≤1,000 results, date-sorted), true multi-label semantics (categories are tags, a message lives in one folder), Trash-with-restore for OneDrive, folder colours, zip download, a durable "Shared with me" (endpoint dies Nov 2026), image proxying, and one full-page redirect through Microsoft roughly daily. Everything else is native or convincingly emulated.

**Do this first (2 minutes, no admin):**
0. Portal > App registrations > "Graph Python quick start" > Overview. If "Supported account types" is anything but single-tenant, **create the fresh registration from §2 first** and probe that instead: an unverified multi-tenant app requesting non-basic scopes triggers risk-based step-up consent (AADSTS90094) even where policy would allow you, giving a false "blocked".
1. Authentication > Add a platform > Single-page application > `http://localhost:3000/probe` (distinct path avoids a duplicate-URI rejection).
2. Signed in as subs@lyzr.ai, open:
   `https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=<id>&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fprobe&response_mode=query&scope=openid%20offline_access%20User.Read&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&state=t1`
3. Repeat, swapping the scope tail for `Files.ReadWrite`, `Mail.Send`, `Contacts.Read`, `Mail.ReadWrite`, `Calendars.ReadWrite`, `MailboxSettings.ReadWrite`, `Files.ReadWrite.All`. Never include `Sites.Read.All`. Ready-made links: `CONSENT-TEST.md`.

| Outcome | Meaning | Next step |
|---|---|---|
| "Permissions requested" + Accept | User-consentable | Accept; the code landing on localhost is harmless |
| "Need admin approval" + justification box + **Request approval** | Blocked, admin-consent workflow on | Submit; reviewers are emailed |
| "Need admin approval", no button | Blocked, workflow off | Send an admin the §2 consent URL |
| AADSTS53xxx device/compliance error | Conditional Access blocks unmanaged browsers | Hard blocker; talk to IT |

Expected pattern on the managed default: `User.Read`/`Files.ReadWrite`/`Mail.Send`/`Contacts.Read` pass, `Mail.ReadWrite`, `Calendars.ReadWrite` and `MailboxSettings.ReadWrite` fail → one admin grant unblocks everything. If even `User.Read` fails, user consent is disabled outright **or** the app has "Assignment required", or step-up/Conditional Access fired - check the sign-in log's Conditional Access tab before concluding.

## 2. App registration

Use a **fresh single-tenant registration** ("Lyzr Mail & Drive UI"). Don't widen "Lyzr Comms Tracker" (confidential client with refresh tokens in Supabase; adding `Mail.Send` makes a Worker/Supabase compromise send-as-user). Don't make the Lyzr app multi-tenant: that invites step-up consent. The outlook.com sandbox fallback (§6) needs a **second**, throwaway multi-tenant+MSA registration with authority `common`; same UI code, different client id.

| Setting | Value |
|---|---|
| Created 2026-09-20 | "Lyzr MS UI", client ID `cd569c2f-9121-4a99-8ba0-691c6df81cbd`, tenant `4b1018eb-9480-4542-89d0-4e6233aba226`, signs in as kailash.gm@lyzr.com |
| Supported account types | Single tenant (Lyzr only) |
| Platform | **Single-page application** only (PKCE + CORS on token endpoint). No Web platform, no secret, "Allow public client flows" = No, "Assignment required" = No unless the admin wants an allowlist |
| Redirect URIs | `http://localhost:3000/MS/redirect/` and `https://lyzr.kailash-gm.com/MS/redirect/` (byte-exact, trailing slash) |
| Delegated permissions | `openid profile offline_access User.Read Mail.ReadWrite Mail.Send Files.ReadWrite Calendars.ReadWrite Contacts.Read MailboxSettings.ReadWrite` (+ `Files.ReadWrite.All` only if "Shared with me" must open items; `People.Read` optional for better autocomplete; `MailboxSettings.Read` only for timezone/category master list) |
| Admin consent routes | (a) API permissions > "Grant admin consent for Lyzr"; (b) `https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/adminconsent?client_id=<id>&redirect_uri=<registered uri>`; (c) single-user: `POST /v1.0/oauth2PermissionGrants {consentType:"Principal", principalId:<your user id>, clientId:<app SP id>, resourceId:<Graph SP id>, scope:"<all scopes in one string>"}` ([doc](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-consent-single-user)) |

Route (c) prerequisites: the app's service principal must exist (created by the first consent attempt or `POST /servicePrincipals`); the admin needs `DelegatedPermissionGrant.ReadWrite.All` (+ `Application.ReadWrite.All` in Graph Explorer); list **every** scope in one grant (tenant-wide grants can revoke earlier ones); then assign the app to you via `POST /servicePrincipals/{id}/appRoleAssignedTo` with the default role.

## 3. Architecture

```
Browser (Next 16 static export SPA at lyzr.kailash-gm.com/MS: /outlook, /onedrive, /calendar)
  ├─ MSAL v5 (auth code + PKCE, localStorage cache, /redirect/ bridge page)
  ├─ graphFetch() ── Bearer ──▶ graph.microsoft.com/v1.0  (mail, drive, $batch, delta)
  ├─ <img>/<iframe>/<a> ──▶ @microsoft.graph.downloadUrl / preview getUrl (pre-authed)
  └─ chunked PUT ──▶ upload-session URLs (no Authorization header)
Cloudflare Worker: static assets + _headers only. No `main`, no secrets, no Supabase.
```

**Decision: pure SPA.** A Worker earns its place only for 90-day refresh tokens, background jobs (snooze, cron send) or classic webhooks - none in v1. Live updates ship as delta polling; Graph Web Push (GA Aug 2026, global cloud only, needs a service worker + browser permission, 7-day renewal, basic payload so you still call delta, overview docs not yet updated) is a later option. UX cost: SPA refresh tokens live 24 h, so one full-page bounce through login.microsoftonline.com per day; hidden-iframe renewal works in Chrome, dies in Safari/Brave → always fall back to `acquireTokenRedirect`.

| Library | Version | Why |
|---|---|---|
| next / react | 16.2 / 19.2.4 | Same toolchain and wrangler pattern as comms-tracker |
| @azure/msal-browser | ^5.22 | PKCE-only; needs COOP-free `app/redirect/page.tsx` calling `broadcastResponseToMainFrame()` in its own layout outside `MsalProvider` ([bridge doc](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge)) |
| @azure/msal-react | ^5.7 | Peer React 16.8–19 (React 19 ≥19.2.1); repo qualifies |
| @microsoft/microsoft-graph-types | ^2.43 | Types only; ~60-line `graphFetch` (401 retry, 429/503 `Retry-After`, `nextLink`, semaphore of 4). Skip Graph JS SDK (MSAL v5 compat unverified) and Graph Toolkit (retired Aug 2026) |
| @tanstack/react-query / react-virtual | ^5.103 / ^3.14 | Infinite lists, optimistic mutations |
| dompurify, @tiptap/react, react-dropzone, @dnd-kit, cmdk, shadcn base-nova, Tailwind 4 | current | Sanitising, compose, upload, drag-move, palette, chrome |

**Config values**

- `.env.local`: `NEXT_PUBLIC_MS_CLIENT_ID`, `NEXT_PUBLIC_MS_TENANT_ID=4b1018eb-9480-4542-89d0-4e6233aba226`, `NEXT_PUBLIC_BASE_PATH=/MS`, `NEXT_PUBLIC_SITE_URL=https://lyzr.kailash-gm.com/MS`.
- MSAL: `authority: https://login.microsoftonline.com/${TENANT_ID}`, `redirectUri: ${origin}${basePath}/redirect/`, `postLogoutRedirectUri: ${origin}${basePath}/`, `cache.cacheLocation: 'localStorage'`.
- `next.config.ts`: `output:'export'`, `trailingSlash:true`, `images:{unoptimized:true}`, `basePath:'/MS'`; every `useSearchParams` sits under `<Suspense>`.
- `wrangler.jsonc`: `name:'ms-ui'`, `compatibility_date:'2026-08-01'`, `assets:{directory:'out'}`, no `main`, `routes:[{pattern:'lyzr.kailash-gm.com/MS*', zone_name:'kailash-gm.com'}]`.
- `graphFetch`: global `Prefer: IdType="ImmutableId"` **except on `$search` requests** (Microsoft-reproduced bug returns `ErrorInvalidIdMalformed`); normalise search-result ids with `POST /me/translateExchangeIds` (restId → restImmutableEntryId, ≤1,000) before caching.
- `public/_headers`:
  ```
  /MS/*
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Content-Security-Policy: default-src 'self'; connect-src 'self' https://graph.microsoft.com https://login.microsoftonline.com https://*.sharepoint.com https://outlook.office.com; img-src 'self' data: blob: https:; frame-src 'self' blob: https://*.sharepoint.com https://*.svc.ms; media-src https: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'
    X-Frame-Options: DENY
  /MS/redirect/
    ! X-Frame-Options
    Content-Security-Policy: default-src 'self'; script-src 'self'; frame-ancestors 'self'
  ```
  No Cross-Origin-Opener-Policy anywhere. The bridge page must be iframe-able by its own origin for `ssoSilent`. Tune hosts after observing real traffic (M5).

Routes (no dynamic segments): `/outlook/?f=inbox&m=<id>&c=<conversationId>&q=`, `/outlook/compose/`, `/onedrive/?folder=<id>&view=grid|list&item=<id>`, `/onedrive/starred/`, `/onedrive/recent/`, `/onedrive/shared/`, `/onedrive/search/?q=`, `/calendar/` (section 8), `/redirect/`, `/login/`.

## 4. UI / IA

**Mail (Gmail look).** Three-pane CSS grid: 256 px left rail (large "Compose" pill, folders from `GET /me/mailFolders?$select=id,displayName,wellKnownName,childFolderCount,unreadItemCount` with unread badges, lazy `childFolders` on `childFolderCount>0`; Starred = `$filter=flag/flagStatus eq 'flagged'`), a top search bar (KQL, `/` focuses), a virtualised list pane (8 px-density rows: star, sender, subject + `bodyPreview` snippet, paperclip, date; bold when unread; hover reveals archive/delete/read/snooze-less actions; Primary/Other tabs from `inferenceClassification`), and a reading pane that stacks the thread by `conversationId`, showing `uniqueBody` collapsed except the last message, "···" toggle for quoted history. Compose is a sticky drawer bottom-right (minimise/expand/close, TipTap editor, To/Cc/Bcc chips from `GET /me/contacts?$search` with a local recent-recipients cache from Sent Items; `/me/people` if `People.Read` is granted). Display `mailFolder.displayName` verbatim (well-known folders come localised). Email HTML: DOMPurify → `<iframe srcdoc sandbox="allow-same-origin" referrerpolicy="no-referrer">` (no `allow-scripts`/`allow-forms`/`allow-top-navigation`, so script-safe) with a per-frame CSP meta; `allow-same-origin` lets the parent read `scrollHeight` and auto-size like Gmail. Remote images blocked until "Load images" (per-sender allowlist); `cid:` images swapped to blob URLs.

| Key | Action | Key | Action |
|---|---|---|---|
| j / k | next / previous | e | archive |
| o / Enter | open | # | delete |
| u | back to list | r / a / f | reply / reply-all / forward |
| c | compose | s | star |
| shift+i / shift+u | read / unread | / | search |
| ? | shortcut help | x | select |

**Drive (Google Drive look).** Left rail: "New" button, My files, Starred, Recently modified, Shared with me, Storage meter (`drive.quota`), Trash (link-out). Breadcrumb from `parentReference.path` after `root:`, `decodeURIComponent` each segment, clickable via an id→parent map. Grid (4-column responsive, thumbnail tiles) / list (name, modified by, date, size) toggle persisted in localStorage; folders first; `item.name` shown verbatim, never normalised. Right details pane (owner, modified, `versions`), context menu, shift/ctrl multi-select, drag-to-folder, preview modal (image/video/PDF on `downloadUrl`; Office via `POST …/preview` getUrl iframe; "Open in OneDrive" via `webUrl`). Tokens: system font stack (`Google Sans`-adjacent: `Inter, Roboto, system-ui`), 14 px base, Gmail's blue accent for unread/selection.

**Mail feature map**

| Gmail feature | Graph mechanism | Feasibility |
|---|---|---|
| Folder nav + badges | `/me/mailFolders` + `childFolders`; well-known `inbox`, `archive`, `deleteditems` | Native |
| Message list | `GET /me/mailFolders/{id}/messages?$select=…&$orderby=receivedDateTime desc&$top=50` + `nextLink` | Native |
| Threaded pane | `GET /me/messages?$filter=conversationId eq '…'`, sort `conversationIndex`, `uniqueBody` | Emulated |
| Search | `$search="from:x subject:y"` (≤1,000, date-sorted, no `$orderby`, no ImmutableId header) | Native, Outlook-grade |
| Star / read | `PATCH {flag:{flagStatus}}`, `PATCH {isRead}` | Native |
| Archive / delete / move | `POST …/move {destinationId}` | Native |
| Labels / Primary tab | `categories` tags; `inferenceClassification` | Emulated |
| Compose / reply / forward | **Draft-first only**: `POST /me/messages` (or `createReply|createReplyAll|createForward`) → attachments → 5–30 s undo timer → `POST …/send`; `DELETE` draft on undo. `sendMail` unused | Native |
| Attachments | `$select` metadata; download `…/attachments/{id}/$value`; upload <3 MB inline, 3–150 MB `createUploadSession` (chunks <4 MB, no auth header; browser CORS to outlook.office.com verified in M2). UI ceiling: tenant max message size, default 35 MB | Native |
| Recipient autocomplete | `GET /me/contacts?$search` (+ `/me/people` if granted) | Native |
| Live updates | Poll `/me/mailFolders/inbox/messages/delta` every 30–60 s while focused | Emulated |
| Signature, snooze, schedule-send, image proxy, mute | Not exposed; signature stored in-app | Not possible / local |

**Drive feature map**

| Drive feature | Graph mechanism | Feasibility |
|---|---|---|
| Folder tree with real names | `/me/drive/root/children`, `/items/{id}/children`, `$top=200`, lazy expand on `folder.childCount>0` | Native |
| Sort / filter | `$orderby=name` is documented-safe; date/size `$orderby` unsettled on OneDrive for Business - test in M3, else sort client-side; `$filter` unavailable | Emulated |
| Thumbnails | Per-item `/thumbnails` via `$batch` of 20, lazy (`$expand=thumbnails` unsupported on ODB) | Native |
| Preview / download | `downloadUrl` (~1 h TTL; `/content` 302 breaks CORS); Office via `/preview` getUrl | Native |
| Upload | `PUT …:/{name}:/content` ≤250 MB; `createUploadSession` chunks (320 KiB multiples, <60 MiB, resumable) | Native |
| New / rename / move / copy / delete | `POST children {folder:{}}`, `PATCH {name}`, `PATCH {parentReference}`, `POST /copy` (async), `DELETE` (recycle bin) | Native |
| Search | `GET /me/drive/root/search(q='…')` (`/search/query` needs `Files.Read.All`) | Native |
| Starred | `POST …/follow`, `GET /me/drive/following` (syncs with OneDrive Favorites) | Native |
| Recently modified | `/me/drive/root/delta` bootstrapped with `?token=latest`, sorted by `lastModifiedDateTime`, plus a local "opened by me" log; delta omits `parentReference.path` so crumbs come from the id map (`/me/drive/recent` dies Nov 2026) | Emulated |
| Shared with me | `/me/drive/sharedWithMe` deprecated (stops Nov 2026), needs `Files.Read.All` to open items | Stretch / pluggable |
| Trash with restore | No v1.0 recycle-bin API for work accounts | Not possible; link out |
| Folder colours, SharePoint libraries | Not exposed / needs `Sites.Read.All` | Not in v1 |

## 5. Phased plan

| Phase | Scope | Acceptance | Effort |
|---|---|---|---|
| **M0** Consent + auth | Probe (§1); new registration; scaffold the app in `MS UI/`; MSAL + bridge; `GET /me` | Signed in on localhost and prod; `ssoSilent` renews in Chrome and falls back to redirect in Safari; consent state per scope recorded in `readme/`; KNOWLEDGE_BASE build log | 0.5 d + admin wait |
| **M1** Read-only mail | Rail, virtualised list, thread pane in sandboxed auto-sized iframe, attachments, search | 10+ message thread renders; images blocked; `from:` search 200 without `ErrorInvalidIdMalformed`; build log | 1.5–2 d |
| **M2** Mail actions + compose | Read/star/archive/delete/move, `$batch` multi-select, shortcuts, draft-first compose with undo, reply/forward, both attachment tiers, contact chips | Optimistic UI rolls back on forced error; 20 MB upload-session PUT succeeds from browser; sent reply threads in Outlook web; build log | 1.5–2 d |
| **M3** Drive browse | Tree/breadcrumb, grid/list, thumbnails, preview, download, search, Starred | `?folder=<id>` deep link; Office preview inline; 100 MB download; `$orderby` date test recorded; build log | 1 d |
| **M4** Drive mutations | New folder, rename, drag-move, delete, dropzone upload with resume | 300 MB upload survives a network blip; move visible in OneDrive web; build log | 1–1.5 d |
| **M5** Polish | Recently-modified, Shared-with-me if `.All` granted, cmdk, offline/error states, responsive, CSP tuning | No CSP violations after real use; usable at 400 px; build log | 1–2 d |

~6–9 AI-assisted days for M0 to M5, plus 2–3 days for M6 Calendar (section 8); only M0 has an external dependency.

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Admin never consents to `Mail.ReadWrite` | Blocker | Cloud Application Administrator single-app or single-user grant; fallback: second multi-tenant+MSA registration against a personal outlook.com account (UI sandbox only) or a Business Basic trial tenant (free dev sandbox now needs VS Enterprise/partner status) |
| Conditional Access (compliant device, sign-in frequency) | Potential blocker | Probe surfaces it; check sign-in log CA tab |
| Governance: self-built client with `Mail.Send` on a work mailbox | Significant | Get IT blessing in the same conversation as the consent ask |
| XSS steals 24 h tokens from localStorage | Significant | Zero third-party scripts, strict CSP, DOMPurify + script-less sandbox |
| Daily redirect bounce; Safari kills silent renew | UX | Always fall back to `acquireTokenRedirect` |
| Recent / Shared-with-me endpoints die Nov 2026 | Significant | Delta-derived Recent; Shared-with-me pluggable |
| Managed policy exclusion list drifts | Minor | Re-read the policy doc page before adding scopes (the Graph `excludes` call needs admin permission) |
| Throttling (10k/10 min, 4 concurrent, 150 MB PATCH/POST/PUT per 5 min per mailbox) | Minor | Semaphore of 4, honour `Retry-After`, `$select` everywhere; one 150 MB attachment can exhaust the window |

## 7. Open questions only you / an admin can answer

1. Quick-start app's actual account type, platforms and redirect URIs (decides whether the probe runs on it).
2. Probe results per scope; is the admin-consent request workflow on?
3. Who is the Cloud Application Administrator; tenant-wide (with "Assignment required") or single-user grant?
4. Does the tenant enforce Conditional Access on Office 365 / All resources?
5. Tenant max message size (compose ceiling) and whether anonymous sharing links are allowed.
6. Is "Shared with me" a must-have (forces `Files.Read.All`)? SharePoint libraries (forces `Sites.Read.All`)?
7. Resolved 2026-09-20: path mount is `lyzr.kailash-gm.com/MS` with pages `/MS/outlook`, `/MS/onedrive`, `/MS/calendar`; folder is `MS UI/`.
8. Single-user (allowlist) or other Lyzr staff too?

## 8. Calendar (Google Calendar look)

**Verdict: GO, same admin gate as mail.** The calendar route needs one extra delegated scope, `Calendars.ReadWrite` (already in the §2 string), and it sits on the same managed-policy exclusion list as `Mail.ReadWrite`, so it rides the single admin grant, not a second round (Graph's reference says "admin consent required: No"; the block is tenant policy, [policy doc](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies#microsoft-recommended-current-settings)). Everything Google-shaped is native on Graph v1.0 with that scope; only mailbox time zone/working hours and the category colour list (`MailboxSettings.Read`), `findMeetingTimes` (`Calendars.Read.Shared`), delegate writes to a colleague's primary calendar (`Calendars.ReadWrite.Shared`) and a tenant-directory guest picker (`User.ReadBasic.All`: self-consentable, but a `.All` scope, your call) sit behind scopes not in the base string. Add `Calendars.ReadWrite` to the §1 probe list (expect "Need admin approval").

| Google Calendar feature | Graph mechanism | Feasibility |
|---|---|---|
| Calendar list + colour toggles | `GET /me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit,owner,allowedOnlineMeetingProviders`; `hexColor` is set only when the user picked one, else map the `color` enum to a local palette; visibility kept in localStorage `ms-ui.cal.visible` (Graph stores no "visible") | Native list; toggle emulated |
| Month / week / day / 4-day / agenda | `GET /me/calendars/{id}/calendarView?startDateTime&endDateTime&$top=1000&$select=…` (series pre-expanded as `occurrence`/`exception`; range values carry their own offset, UTC if none; `$top` max 1000, loop `@odata.nextLink`); visible calendars in one `$batch` of ≤20 | Native |
| Drag create / move / resize | `POST /me/calendars/{id}/events` with a client `transactionId`; `PATCH /me/events/{id} {start,end[,isAllDay]}`, optimistic, `revert()` on 4xx | Native |
| Recurrence: edit this / all / following | `recurrence{pattern,range}` maps 1:1 to Google's Custom dialog; "this" = `PATCH` occurrence id (400 `ErrorOccurrenceCrossingBoundary` if moved past a neighbour), "all" = `PATCH seriesMasterId`; "this and following" = set master `range.endDate` to the day before, then `POST` a new series | Native / emulated |
| Invites + RSVP | attendees on create are invited automatically (≤500); `POST …/accept\|tentativelyAccept\|decline {comment,sendResponse}` → 202; `proposedNewTime` on decline only when `allowNewTimeProposals`; organizer delete = `POST …/cancel {comment}`, attendee = decline then `DELETE` | Native |
| Find a time (free/busy) | `POST /me/calendar/getSchedule {schedules[≤20], startTime, endTime (<62 days), availabilityViewInterval:15}` returns `availabilityView` + `workingHours`; suggested slots computed client-side | Native; suggestions emulated |
| Teams link (Meet button) | `isOnlineMeeting:true, onlineMeetingProvider:'teamsForBusiness'` on POST or PATCH, no extra scope; render `onlineMeeting.joinUrl` (`onlineMeetingUrl` deprecated); one-way once set, preserve the Teams body blob on edits | Native |
| Reminders | one `reminderMinutesBeforeStart` per event; `GET /me/reminderView(startDateTime,endDateTime)` + `setTimeout` + Notification API while the tab is open; `snoozeReminder` / `dismissReminder` | Emulated |
| Colours | calendar tint from `color`/`hexColor`; per-event = `categories[]` with a local name→swatch map (master list needs `MailboxSettings.Read`); stripe `showAs=tentative`, lock `sensitivity=private` | Emulated |
| Time zones | browser IANA via `Intl`, validated with `GET /me/outlook/supportedTimeZones(TimeZoneStandard=microsoft.graph.timeZoneStandard'Iana')` (`User.Read`); reads stay UTC (no `Prefer` header) and convert client-side; writes send wall time + IANA name; all-day = date-only, end exclusive, never through `Date()` | Native |
| Live updates | `GET /me/calendarView/delta?startDateTime&endDateTime` (documented for the default calendar only; no `$select`/`$filter`; params on the first call only; filter `@removed` against held ids) every 60 s while visible; other calendars re-fetch on a timer | Emulated |
| Guest autocomplete | `/me/contacts` has no `$search`: page `GET /me/contacts?$top=1000` into a local index plus a recent-people cache; `GET /users?$search="displayName:x"&$count=true` with `ConsistencyLevel: eventual` only if `User.ReadBasic.All` is added | Native, degraded |

**UI / IA.** Grid on FullCalendar v7: `npm i @fullcalendar/react@7.1.0 temporal-polyfill@1.0.5` (MIT, React 17-19, fully React-rendered; daygrid/timegrid/list/interaction are entrypoints of the same package; measured 80.7 kB min+gz; named IANA `timeZone` prop with no luxon/moment; dark mode via `[data-color-scheme=dark]` or the `colorScheme` prop; mount through `next/dynamic(…, {ssr:false})` so the static export never evaluates Temporal). Add `react-day-picker@10.0.1` for the mini month and `date-fns-tz@3.2.0` for IANA math. Rejected: Schedule-X (drag/resize/create are premium), react-big-calendar (moment+luxon+dayjs+globalize deps), Toast UI (last published 2022). Routes: `/calendar/?view=day|week|month|4day|agenda&date=YYYY-MM-DD&cal=<id,id>&e=<eventId>`, `/calendar/event/?id=<id>&scope=this|series` (also `?new=1&start=&end=&allDay=` from "More options"), `/calendar/settings/` (tz override, week start, default duration/reminder, working hours). Layout: left rail (Create pill, mini month, My calendars with colour toggles), toolbar (Today, arrows, view switch, search), grid with now-line and side-by-side overlaps. Quick-create popover anchors to the drag selection: title, time chips, all-day, guest chips, location, Teams switch (enabled only when `allowedOnlineMeetingProviders` contains `teamsForBusiness`), Save. Detail popover on click: time in the active tz, Join Teams, organizer, attendee statuses, Yes/Maybe/No, Open in Outlook, edit/delete with 5 s undo.

| Key | Action | Key | Action |
|---|---|---|---|
| t | today | j / n, k / p | next / previous range (k/p not on Google's page, kept for mail parity) |
| 1/d, 2/w, 3/m, 4/x, 5/a | day, week, month, 4-day, agenda | c | create |
| e | open / edit | Backspace / Delete | delete |
| z | undo last PATCH/DELETE | g | go to date |
| / | search | r / s | refresh / settings |
| Esc | close popover | ? | shortcut help |

**What you will not get (plain language):** appointment schedules / booking pages (Bookings is a separate API and licence; link out), tasks in the grid, Outlook's own working hours and time zone (a settings field instead), Outlook-matching category colours (local map until `MailboxSettings.Read`), more than one reminder per event or email reminders, pop-ups when the tab is closed (Web Push stays a later option), "guests can invite others" toggles, room picker (`Place.Read.All` is admin-only), holiday/birthday calendars you did not already add in Outlook, starting a calendar share, one-click "this and following" (two writes under the hood), and a full-text event search (client-side over the loaded range).

**Phased plan row (insert after M2, or run beside M3/M4):**

| Phase | Scope | Acceptance | Effort |
|---|---|---|---|
| **M6** Calendar | FullCalendar views + dark attribute, left rail (mini month, calendar toggles), URL state, shortcuts, detail popover; quick-create + edit page, guest chips, Teams switch, RSVP, cancel/delete with undo, optimistic drag/resize, this/all prompt; delta polling, adjacent-range prefetch, tz override + `supportedTimeZones` check, getSchedule "Find a time" | `?view=week&date=…&e=<id>` deep-links on localhost and prod; 200+ occurrences of a daily series page without a flash on j/k; forced bad `timeZone` shows a toast and snaps back; Teams quick-create returns `joinUrl` and shows in Outlook web; Accept updates the organizer's tracking; an event made in Outlook web appears within 60 s via delta; IANA `Asia/Kolkata` accepted on create (else Windows-alias fallback logged in `readme/`); `ErrorOccurrenceCrossingBoundary` handled; no CSP violations; build log + consent row | 2–3 d |

**Risks to add:**

| Risk | Severity | Mitigation |
|---|---|---|
| Admin grant already issued without `Calendars.ReadWrite` (route (c) needs every scope in one string) | Significant | Ship the §2 string with `Calendars.ReadWrite` before the first grant |
| All-day / week-boundary off-by-one (UTC midnight, offset-less range params) | UX | Offsets in `startDateTime`/`endDateTime`, all-day as date-only, acceptance check above |
| Create/update "might not support all" IANA zones; no documented calendarView range ceiling | Minor | `supportedTimeZones` validation + Windows-alias fallback; `$top=1000` + `nextLink`, split ranges by week if 5xx |

## 9. Requirements check against the scope list (2026-09-20)

Scopes entered in the portal: `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Files.ReadWrite`, `Calendars.ReadWrite`, `Contacts.Read`, `offline_access`. **Verdict: they cover everything asked except two mail items, creating/deleting categories and automatic sorting rules, which need `MailboxSettings.ReadWrite`.** That scope is on the same managed-policy exclusion list as `Mail.ReadWrite`, so it rides the same admin grant. Added to section 2 and to the README. Facts below were checked against the v1.0 reference pages on 2026-09-20.

**Calendar**

| Ask | Graph mechanism | Scope | Feasibility |
|---|---|---|---|
| Schedule events | `POST /me/events` (or `/me/calendars/{id}/events`) | Calendars.ReadWrite | Native |
| Invite folks | `attendees[]` on the event; Outlook sends the invitations | Calendars.ReadWrite | Native |
| Accept / reject | `POST /me/events/{id}/accept`, `tentativelyAccept`, `decline` | Calendars.ReadWrite | Native |
| View calendar | `GET /me/calendarView?startDateTime&endDateTime` | Calendars.ReadWrite | Native |
| Recurring events | `recurrence.pattern` + `recurrence.range` on create; edit one occurrence or the series master | Calendars.ReadWrite | Native |

**Email**

| Ask | Graph mechanism | Scope | Feasibility |
|---|---|---|---|
| Read | `GET /me/mailFolders/{id}/messages`, `GET /me/messages/{id}` | Mail.ReadWrite | Native |
| Write, cc, bcc, forward | draft first: `POST /me/messages` with `toRecipients`, `ccRecipients`, `bccRecipients`; `createReply` / `createForward`; then `POST …/send` | Mail.ReadWrite + Mail.Send | Native |
| Star | `PATCH {flag:{flagStatus:'flagged'}}` | Mail.ReadWrite | Native |
| Label a message | `PATCH {categories:[…]}` (a message can carry many labels) | Mail.ReadWrite | Native |
| Create / delete labels (the category list) | `POST` / `DELETE /me/outlook/masterCategories` ([doc](https://learn.microsoft.com/en-us/graph/api/outlookuser-post-mastercategories?view=graph-rest-1.0)) | **MailboxSettings.ReadWrite** | Native, scope added |
| Different inboxes (folders) | `POST /me/mailFolders` and `…/childFolders`, `DELETE`, rename via `PATCH` | Mail.ReadWrite | Native |
| Mail segregation, automatic | inbox rules: `POST /me/mailFolders/inbox/messageRules` with conditions (sender, subject contains, importance …) and actions (`moveToFolder`, `assignCategories`, `markAsRead`, `forwardTo`, `delete`) ([doc](https://learn.microsoft.com/en-us/graph/api/mailfolder-post-messagerules?view=graph-rest-1.0)) | **MailboxSettings.ReadWrite** | Native, scope added |
| Mail segregation, manual | drag or multi-select then `POST …/move` in a `$batch` | Mail.ReadWrite | Native |
| Delete | `POST …/move {destinationId:'deleteditems'}` (Trash) or `DELETE` (permanent) | Mail.ReadWrite | Native |
| Mark spam | `POST …/move {destinationId:'junkemail'}`; optional "report + block sender" only via beta `reportMessage` (v1.0 has none; `markAsJunk` retired 30 Dec 2025) | Mail.ReadWrite | Native (move); beta (report) |
| Archive, read/unread, Primary tab, search, attachments | section 4 | Mail.ReadWrite | Native |

**Drive**

| Ask | Graph mechanism | Scope | Feasibility |
|---|---|---|---|
| See all folders, any depth | `…/children` per folder, or one `root/delta` walk | Files.ReadWrite | Native |
| Create folders from the UI, landing in real OneDrive | `POST /me/drive/items/{parent}/children {name, folder:{}}` | Files.ReadWrite | Native |
| Nested folders | same call with any parent, any depth | Files.ReadWrite | Native |
| Move files across folders | `PATCH {parentReference:{id}}` | Files.ReadWrite | Native |
| Rename, delete, copy, upload, download, preview | section 4 | Files.ReadWrite | Native |
| Share files | `POST …/createLink` (view or edit; scope `organization` or `users`; `anonymous` only if the tenant allows) and `POST …/invite` (named people, read or write, optional email) ([createLink](https://learn.microsoft.com/en-us/graph/api/driveitem-createlink?view=graph-rest-1.0), [invite](https://learn.microsoft.com/en-us/graph/api/driveitem-invite?view=graph-rest-1.0)) | Files.ReadWrite | Native |
| "Repos" by type: Sheets, Docs, Slides, PDFs, Images, Videos | Virtual views, not real folders. The app walks the drive once with `GET /me/drive/root/delta?$select=id,name,size,file,folder,parentReference,createdBy,lastModifiedBy,lastModifiedDateTime,webUrl`, keeps the list in the browser (IndexedDB), then refreshes with the `deltaLink`. Each "repo" is a filter on extension / `file.mimeType`. Files stay where they are in OneDrive and also appear in their real folder, like Google Drive's type filter | Files.ReadWrite | Emulated, client-side |
| Search by name | the local index (instant) plus `GET /me/drive/root/search(q='…')` | Files.ReadWrite | Native + emulated |
| Filter by file type and by owner | local index: type from extension / mimeType, owner from `createdBy.user.displayName` and `lastModifiedBy.user` (Graph has no `$filter` on children) | Files.ReadWrite | Emulated |

Note on the index: a OneDrive with tens of thousands of items takes a minute or two to walk on first load, then only changes are fetched. Excel, Word and PowerPoint files stay Office files; "Sheets / Docs / Slides" are just the names of the type views.
