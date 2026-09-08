import { errorMessage } from "../lib/sync/util";
import { createSyncDbClient } from "../lib/sync/db";
import { runSync, type SyncSource } from "../lib/sync/run";
import { runKnowledgeIngestion, type KnowledgeSource } from "../lib/knowledge/run";
import { suggestTopics } from "../lib/ai/suggest";
import { draftEmail } from "../lib/ai/draft";
import { runMailboxSync, type MailProvider } from "../lib/mail/run";
import { buildMicrosoftAuthorizeUrl, exchangeMicrosoftCode, fetchGraphMeEmail, isMicrosoftConfigured, MICROSOFT_SCOPES } from "../lib/mail/microsoft";
import { fetchGmailProfileEmail, GMAIL_SCOPE } from "../lib/mail/google";
import { refreshGoogleAccessToken } from "../lib/knowledge/drive";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CORTEX_BASE_URL: string;
  CORTEX_API_KEY: string;
  HUBSPOT_ACCESS_TOKEN: string;
  INSTANTLY_API_KEY: string;
  INSTANTLY_PRODUCT_UPDATE_TAG?: string;
  ANTHROPIC_API_KEY: string;
  SLACK_BOT_TOKEN?: string;
  // Same Google OAuth client already configured for Supabase's Google SSO
  // provider (Client ID isn't secret; the Secret is) — reused rather than
  // registering a second Google Cloud OAuth client, so there's one place
  // that owns "what Google API access this app has." Needed server-side to
  // exchange a stored refresh token for a fresh access token (Google's
  // token endpoint requires client_id+client_secret, it's never anonymous).
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  // Azure app registration for the per-user Outlook mailbox connection
  // (delegated Mail.Read via Microsoft Graph). ID + tenant are plain vars;
  // the secret is a `wrangler secret`. See SETUP_INTEGRATIONS.md.
  MS_GRAPH_CLIENT_ID?: string;
  MS_GRAPH_TENANT_ID?: string;
  MS_GRAPH_CLIENT_SECRET?: string;
  NEXT_PUBLIC_SITE_URL: string;
  // GitHub token (repo/actions scope) used to dispatch the
  // comms-tracker-refresh workflow. A Worker request is capped at a small
  // number of outbound API calls ("Too many subrequests"), which even the
  // smallest sync exceeds, so every refresh actually executes on GitHub
  // Actions; the Worker only queues it. Without this secret the routes fall
  // back to running in-process (only useful for local `wrangler dev`).
  GH_DISPATCH_TOKEN?: string;
  GH_REPO?: string;
}

const REFRESH_TARGETS = [
  "all", "sources", "mail", "knowledge",
  "cortex", "hubspot", "instantly", "gmail", "outlook",
  "lyzr_blog", "slack", "drive", "onedrive", "internal_email",
] as const;
type RefreshTarget = (typeof REFRESH_TARGETS)[number];

async function dispatchRefresh(env: Env, target: RefreshTarget, user: { id: string; email: string }): Promise<Response> {
  const repo = env.GH_REPO ?? "kailcodes02-gif/lyzr";
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/comms-tracker-refresh.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "comms-tracker-worker",
    },
    body: JSON.stringify({ ref: "main", inputs: { target } }),
  });
  if (res.status !== 204) {
    const text = await res.text().catch(() => "");
    return json({ error: `GitHub dispatch failed: ${res.status} ${text.slice(0, 300)}` }, 502);
  }
  // A placeholder run row so the UI shows something immediately; the
  // workflow's scripts write their own running/success rows within ~1 min.
  const db = createSyncDbClient(env);
  await db.from("sync_runs").insert({
    source_system: target === "all" || target === "sources" ? "cortex" : target === "mail" ? "gmail" : target === "knowledge" ? "lyzr_blog" : target,
    run_type: "manual",
    status: "success",
    finished_at: new Date().toISOString(),
    records_fetched: 0,
    records_upserted: 0,
    triggered_by: user.id,
    error_message: `queued: "${target}" refresh dispatched to GitHub Actions by ${user.email}; its own run rows follow within a minute`,
  });
  return json({ queued: true, target, executor: "github-actions" });
}

// Must match next.config.ts's basePath — the site is path-mounted at
// lyzr.kailash-gm.com/abm-tracker (a Worker route on the existing site's
// domain, alongside the sibling GSI_Tracker app), so every request this
// Worker receives (per the wrangler.jsonc route pattern) already carries
// this prefix. Cloudflare's Static Assets binding has no concept of a
// basePath, though — it serves the flat `out/` tree we built — so it has to
// be stripped before delegating to ASSETS.fetch(), and re-added when
// matching our own /api/sync/* routes (Next's basePath config only
// rewrites Next's own Link/router navigation, not plain fetch() strings).
const BASE_PATH = "/abm-tracker";

const SOURCES: SyncSource[] = ["cortex", "hubspot", "instantly"];
const KNOWLEDGE_SOURCES: KnowledgeSource[] = ["lyzr_blog", "slack", "drive", "onedrive", "internal_email"];
const MAIL_PROVIDERS: MailProvider[] = ["gmail", "outlook"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Validates the caller's Supabase session bearer token against Supabase
// Auth directly (same pattern the sibling app's Pages Functions use for
// `requireUser()`) — only a signed-in @lyzr.ai user can trigger a sync.
async function requireUser(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);

  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: string; email: string };
  return user;
}

async function handleSync(request: Request, env: Env, source: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  if (!SOURCES.includes(source as SyncSource) && source !== "all") {
    return new Response(JSON.stringify({ error: `Unknown source "${source}"` }), { status: 400 });
  }

  const user = await requireUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const db = createSyncDbClient(env);
  const sources = source === "all" ? SOURCES : [source as SyncSource];
  const results: Record<string, unknown> = {};

  for (const s of sources) {
    try {
      results[s] = await runSync(db, s, env, { runType: "manual", triggeredBy: user.id });
    } catch (err) {
      results[s] = { status: "failed", error: errorMessage(err) };
    }
  }

  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
}

async function handleKnowledgeSync(request: Request, env: Env, source: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  if (!KNOWLEDGE_SOURCES.includes(source as KnowledgeSource) && source !== "all") {
    return new Response(JSON.stringify({ error: `Unknown knowledge source "${source}"` }), { status: 400 });
  }

  const user = await requireUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const db = createSyncDbClient(env);
  const sources = source === "all" ? KNOWLEDGE_SOURCES : [source as KnowledgeSource];
  const results: Record<string, unknown> = {};

  for (const s of sources) {
    try {
      results[s] = await runKnowledgeIngestion(db, s, env, { runType: "manual", triggeredBy: user.id });
    } catch (err) {
      results[s] = { status: "failed", error: errorMessage(err) };
    }
  }

  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
}

async function handleAiSuggest(request: Request, env: Env, projectId: string): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  const user = await requireUser(request, env);
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const db = createSyncDbClient(env);
  const { data: project, error } = await db
    .from("projects")
    .select("name, accounts(canonical_name, product_engaged)")
    .eq("id", projectId)
    .single();
  if (error || !project) {
    return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
  }
  const account = project.accounts as unknown as { canonical_name: string; product_engaged: string[] } | null;

  const { suggestions, usage } = await suggestTopics(db, env, {
    name: project.name as string,
    accountName: account?.canonical_name ?? "",
    productEngaged: (account?.product_engaged as string[]) ?? [],
  });

  await db.from("ai_generations").insert({
    project_id: projectId,
    generation_type: "suggestions",
    model: "claude-sonnet-5",
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    requested_by: user.id,
  });

  return new Response(JSON.stringify({ suggestions }), { headers: { "Content-Type": "application/json" } });
}

async function handleAiDraft(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  const user = await requireUser(request, env);
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const body = (await request.json()) as {
    projectId?: string;
    projectName: string;
    accountName: string;
    recipientName?: string | null;
    selectedTopics: string[];
  };
  if (!body.selectedTopics?.length) {
    return new Response(JSON.stringify({ error: "selectedTopics is required" }), { status: 400 });
  }

  const { draft, usage } = await draftEmail(env, {
    projectName: body.projectName,
    accountName: body.accountName,
    recipientName: body.recipientName ?? null,
    selectedTopics: body.selectedTopics,
  });

  const db = createSyncDbClient(env);
  await db.from("ai_generations").insert({
    project_id: body.projectId ?? null,
    generation_type: "draft",
    model: "claude-sonnet-5",
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    requested_by: user.id,
  });

  return new Response(JSON.stringify({ draft }), { headers: { "Content-Type": "application/json" } });
}

// Logs the optimistic communication_events row once a user clicks through to
// the Gmail/Outlook compose window -- this app never confirms the email
// actually got sent (that click happens outside it entirely); the future
// mailbox-read sync (lib/knowledge/mail.ts) reconciles against these rows
// once real mail-read credentials exist.
async function handleSendLog(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  const user = await requireUser(request, env);
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const body = (await request.json()) as {
    accountId: string;
    projectId?: string | null;
    personId?: string | null;
    recipientEmail: string;
    subject: string;
    snippet?: string | null;
  };

  const db = createSyncDbClient(env);
  const { error } = await db.from("communication_events").insert({
    account_id: body.accountId,
    project_id: body.projectId ?? null,
    person_id: body.personId ?? null,
    direction: "outbound",
    source_system: "app",
    source_event_id: `app:${crypto.randomUUID()}`,
    recipient_email: body.recipientEmail,
    subject: body.subject,
    snippet: body.snippet ?? null,
    sent_at: new Date().toISOString(),
    match_status: body.personId ? "matched" : "person_unmatched",
    origin: "sent_via_app",
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}

// Stores the Google refresh token a user's browser just got back from
// Google (via Supabase's incremental-authorization redirect) — see
// app/auth/callback/page.tsx's `?connect=google` handling. One consent
// covers Drive (knowledge base) and Gmail (mailbox reading); the refresh
// token never round-trips again after this — only this Worker's
// service-role client reads it back, to mint short-lived access tokens.
async function handleGoogleConnect(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const user = await requireUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as { refreshToken?: string; scopes?: string[] };
  if (!body.refreshToken) return json({ error: "refreshToken is required" }, 400);

  // Record which mailbox this token belongs to (needed to tell "sent by me"
  // from "sent to me" when reading mail) — best effort, the connection is
  // still stored if the profile call fails.
  let accountEmail: string | null = user.email?.toLowerCase() ?? null;
  if ((body.scopes ?? []).includes(GMAIL_SCOPE)) {
    try {
      const token = await refreshGoogleAccessToken(env, body.refreshToken);
      accountEmail = (await fetchGmailProfileEmail(token)) ?? accountEmail;
    } catch {
      // keep the sign-in email
    }
  }

  const db = createSyncDbClient(env);
  const { error } = await db.from("user_oauth_tokens").upsert(
    {
      user_id: user.id,
      provider: "google",
      refresh_token: body.refreshToken,
      granted_scopes: body.scopes ?? [],
      account_email: accountEmail,
      // A fresh grant restarts both incremental cursors.
      drive_start_page_token: null,
      mail_cursor: null,
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, accountEmail });
}

// ---- Microsoft (Outlook) connect: plain OAuth authorization-code flow ----
// Not routed through Supabase Auth (sign-in stays Google-only); the Worker
// is the OAuth client. `state` carries the signed-in user's id, HMAC-signed
// with the app secret so the callback can't be replayed for someone else.
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function microsoftRedirectUri(env: Env): string {
  return `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/api/oauth/microsoft/callback`;
}

async function handleMicrosoftStart(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const user = await requireUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  if (!isMicrosoftConfigured(env)) {
    return json({ error: "Outlook is not configured yet — the Azure app registration (MS_GRAPH_CLIENT_ID/SECRET) is missing. See SETUP_INTEGRATIONS.md." }, 503);
  }

  const payload = `${user.id}.${Date.now()}`;
  const state = `${payload}.${await hmacHex(env.MS_GRAPH_CLIENT_SECRET!, payload)}`;
  // Same person, other tenant: subs@lyzr.ai signs in with Google, their
  // Microsoft mailbox is subs@lyzr.com.
  const loginHint = user.email ? user.email.replace(/@lyzr\.ai$/i, "@lyzr.com") : null;
  const url = buildMicrosoftAuthorizeUrl(env, { redirectUri: microsoftRedirectUri(env), state, loginHint });
  return json({ url });
}

async function handleMicrosoftCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${site}/admin/sync/?${q}`, 302);

  const err = url.searchParams.get("error");
  if (err) return back(`connect_error=${encodeURIComponent(url.searchParams.get("error_description") ?? err)}`);
  // Tenant-wide admin consent (the /adminconsent endpoint) also redirects
  // here, with admin_consent=True and no code -- nothing to store, just
  // confirm so the admin sees it worked and users can now connect.
  if (url.searchParams.get("admin_consent") === "True") return back("admin_consent=granted");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !isMicrosoftConfigured(env)) return back("connect_error=missing_code_or_state");

  const [userId, ts, sig] = state.split(".");
  if (!userId || !ts || !sig) return back("connect_error=bad_state");
  const expected = await hmacHex(env.MS_GRAPH_CLIENT_SECRET!, `${userId}.${ts}`);
  if (expected !== sig || Date.now() - Number(ts) > 15 * 60 * 1000) return back("connect_error=state_expired");

  try {
    const { accessToken, refreshToken } = await exchangeMicrosoftCode(env, code, microsoftRedirectUri(env));
    if (!refreshToken) return back("connect_error=no_refresh_token");
    const accountEmail = await fetchGraphMeEmail(accessToken).catch(() => null);

    const db = createSyncDbClient(env);
    const { error } = await db.from("user_oauth_tokens").upsert(
      {
        user_id: userId,
        provider: "microsoft",
        refresh_token: refreshToken,
        granted_scopes: MICROSOFT_SCOPES,
        account_email: accountEmail,
        mail_cursor: null,
      },
      { onConflict: "user_id,provider" }
    );
    if (error) return back(`connect_error=${encodeURIComponent(error.message)}`);
    return back(`connected=outlook&email=${encodeURIComponent(accountEmail ?? "")}`);
  } catch (e) {
    return back(`connect_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}

async function handleMailSync(request: Request, env: Env, provider: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!MAIL_PROVIDERS.includes(provider as MailProvider) && provider !== "all") {
    return json({ error: `Unknown mail provider "${provider}"` }, 400);
  }
  const user = await requireUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = createSyncDbClient(env);
  const providers = provider === "all" ? MAIL_PROVIDERS : [provider as MailProvider];
  const results: Record<string, unknown> = {};
  for (const p of providers) {
    try {
      results[p] = await runMailboxSync(db, p, env, { runType: "manual", triggeredBy: user.id });
    } catch (err) {
      results[p] = { status: "failed", error: errorMessage(err) };
    }
  }
  return json(results);
}

function stripBasePath(pathname: string): string {
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(BASE_PATH + "/")) return pathname.slice(BASE_PATH.length);
  return pathname;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = stripBasePath(url.pathname);

    const refreshMatch = path.match(/^\/api\/refresh\/([a-z_]+)\/?$/);
    if (refreshMatch) {
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      const target = refreshMatch[1] as RefreshTarget;
      if (!REFRESH_TARGETS.includes(target)) return json({ error: `Unknown refresh target "${target}"` }, 400);
      const user = await requireUser(request, env);
      if (!user) return json({ error: "Unauthorized" }, 401);
      if (env.GH_DISPATCH_TOKEN) return dispatchRefresh(env, target, user);
      // Fallback: run in-process (local dev only -- production hits the
      // subrequest cap, see GH_DISPATCH_TOKEN above).
      if (["cortex", "hubspot", "instantly", "sources"].includes(target)) return handleSync(request, env, target === "sources" ? "all" : target);
      if (["gmail", "outlook", "mail"].includes(target)) return handleMailSync(request, env, target === "mail" ? "all" : target);
      if (target === "all") return handleSync(request, env, "all");
      return handleKnowledgeSync(request, env, target === "knowledge" ? "all" : target);
    }

    const syncMatch = path.match(/^\/api\/sync\/([a-z]+)\/?$/);
    if (syncMatch) return handleSync(request, env, syncMatch[1]);

    const knowledgeMatch = path.match(/^\/api\/knowledge\/sync\/([a-z_]+)\/?$/);
    if (knowledgeMatch) return handleKnowledgeSync(request, env, knowledgeMatch[1]);

    const suggestMatch = path.match(/^\/api\/ai\/suggest\/([a-f0-9-]+)\/?$/);
    if (suggestMatch) return handleAiSuggest(request, env, suggestMatch[1]);

    if (path === "/api/ai/draft" || path === "/api/ai/draft/") return handleAiDraft(request, env);
    if (path === "/api/send/log" || path === "/api/send/log/") return handleSendLog(request, env);
    // `google-drive/connect` kept as an alias for the pre-Gmail callback page.
    if (/^\/api\/oauth\/google(-drive)?\/connect\/?$/.test(path)) return handleGoogleConnect(request, env);
    if (path === "/api/oauth/microsoft/start" || path === "/api/oauth/microsoft/start/") return handleMicrosoftStart(request, env);
    if (path === "/api/oauth/microsoft/callback" || path === "/api/oauth/microsoft/callback/") return handleMicrosoftCallback(request, env);

    const mailMatch = path.match(/^\/api\/mail\/sync\/([a-z]+)\/?$/);
    if (mailMatch) return handleMailSync(request, env, mailMatch[1]);

    const assetUrl = new URL(request.url);
    assetUrl.pathname = path;
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  },

  // Weekly Cron Trigger (see wrangler.jsonc's `triggers.crons`) — calls the
  // exact same runSync()/runKnowledgeIngestion() functions the manual
  // "Refresh" buttons use, so scheduled and manual runs share one code path
  // and one sync_runs history, per the project's stated sync architecture.
  // Typed inline rather than against the global `ScheduledEvent` -- this repo
  // doesn't generate @cloudflare/workers-types' ambient types (no
  // `wrangler types` step in the build), and the handler doesn't need
  // anything from the event object anyway.
  async scheduled(_event: { cron: string; scheduledTime: number }, env: Env): Promise<void> {
    const db = createSyncDbClient(env);
    for (const source of SOURCES) {
      try {
        await runSync(db, source, env, { runType: "scheduled" });
      } catch {
        // Logged into sync_runs by runSync itself; one source failing
        // shouldn't stop the others from running.
      }
    }
    // Mailboxes before the knowledge sources so this week's siva@ emails are
    // in the internal_email store before its MD file is rebuilt.
    for (const provider of MAIL_PROVIDERS) {
      try {
        await runMailboxSync(db, provider, env, { runType: "scheduled" });
      } catch {
        // Logged into sync_runs by runMailboxSync itself.
      }
    }
    for (const source of KNOWLEDGE_SOURCES) {
      try {
        await runKnowledgeIngestion(db, source, env, { runType: "scheduled" });
      } catch {
        // Same reasoning — logged into sync_runs, don't let one source's
        // failure (or an unconfigured Slack/Drive/mail adapter) stop the rest.
      }
    }
  },
};

export default worker;
