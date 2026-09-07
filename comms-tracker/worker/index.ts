import { createSyncDbClient } from "../lib/sync/db";
import { runSync, type SyncSource } from "../lib/sync/run";
import { runKnowledgeIngestion, type KnowledgeSource } from "../lib/knowledge/run";
import { suggestTopics } from "../lib/ai/suggest";
import { draftEmail } from "../lib/ai/draft";

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
  MS_GRAPH_CLIENT_SECRET?: string;
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
const KNOWLEDGE_SOURCES: KnowledgeSource[] = ["lyzr_blog", "slack", "drive", "internal_email"];

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
      results[s] = { status: "failed", error: err instanceof Error ? err.message : String(err) };
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
      results[s] = { status: "failed", error: err instanceof Error ? err.message : String(err) };
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

// Stores the Drive-scoped refresh token a user's browser just got back from
// Google (via Supabase's incremental-authorization OAuth redirect) — see
// app/auth/callback/page.tsx's `?connect=drive` handling. The refresh token
// itself never round-trips again after this; only this Worker's
// service-role client ever reads it back out, to mint short-lived access
// tokens for lib/knowledge/drive.ts's ingestion runs.
async function handleGoogleDriveConnect(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  const user = await requireUser(request, env);
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const body = (await request.json()) as { refreshToken?: string; scopes?: string[] };
  if (!body.refreshToken) {
    return new Response(JSON.stringify({ error: "refreshToken is required" }), { status: 400 });
  }

  const db = createSyncDbClient(env);
  const { error } = await db.from("user_oauth_tokens").upsert(
    {
      user_id: user.id,
      provider: "google_drive",
      refresh_token: body.refreshToken,
      granted_scopes: body.scopes ?? [],
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
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

    const syncMatch = path.match(/^\/api\/sync\/([a-z]+)\/?$/);
    if (syncMatch) return handleSync(request, env, syncMatch[1]);

    const knowledgeMatch = path.match(/^\/api\/knowledge\/sync\/([a-z_]+)\/?$/);
    if (knowledgeMatch) return handleKnowledgeSync(request, env, knowledgeMatch[1]);

    const suggestMatch = path.match(/^\/api\/ai\/suggest\/([a-f0-9-]+)\/?$/);
    if (suggestMatch) return handleAiSuggest(request, env, suggestMatch[1]);

    if (path === "/api/ai/draft" || path === "/api/ai/draft/") return handleAiDraft(request, env);
    if (path === "/api/send/log" || path === "/api/send/log/") return handleSendLog(request, env);
    if (path === "/api/oauth/google-drive/connect" || path === "/api/oauth/google-drive/connect/")
      return handleGoogleDriveConnect(request, env);

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
