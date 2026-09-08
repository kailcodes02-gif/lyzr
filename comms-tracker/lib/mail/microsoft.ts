import {
  INTERNAL_KNOWLEDGE_SENDERS,
  lookbackStart,
  MAX_INBOX_PER_RUN,
  MAX_INTERNAL_PER_RUN,
  MAX_SENT_PER_RUN,
  type MailboxRead,
  type MailMessage,
} from "./types";

// Outlook side, via Microsoft Graph with DELEGATED permissions: each user
// connects their own lyzr.com mailbox from /admin/sync ("Connect Outlook"),
// which runs a plain OAuth authorization-code flow through the Worker
// (/api/oauth/microsoft/start + /callback) -- NOT through Supabase Auth, so
// the app's sign-in stays Google-only and Outlook is just a connected
// mailbox, mirroring how Drive/Gmail are connected on the Google side.
// Needs an Azure app registration; see SETUP_INTEGRATIONS.md.
export type MicrosoftEnv = {
  MS_GRAPH_CLIENT_ID?: string;
  MS_GRAPH_CLIENT_SECRET?: string;
  MS_GRAPH_TENANT_ID?: string;
};

// Mail.Read = Outlook reading; Files.Read.All + Sites.Read.All = OneDrive and
// SharePoint document libraries the user can open (knowledge source, see
// lib/knowledge/onedrive.ts). All delegated -- consented per user, never
// tenant-wide.
export const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Mail.Read", "Files.Read.All", "Sites.Read.All"];
export const GRAPH = "https://graph.microsoft.com/v1.0";

export function isMicrosoftConfigured(env: MicrosoftEnv): boolean {
  return Boolean(env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET);
}

// "organizations" = any Entra work account; a single-tenant registration
// should set MS_GRAPH_TENANT_ID to the lyzr.com tenant id so only that
// directory can consent.
function tenant(env: MicrosoftEnv): string {
  return env.MS_GRAPH_TENANT_ID || "organizations";
}

export function buildMicrosoftAuthorizeUrl(env: MicrosoftEnv, input: { redirectUri: string; state: string; loginHint?: string | null }): string {
  const url = new URL(`https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", env.MS_GRAPH_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "consent");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(env: MicrosoftEnv, params: Record<string, string>): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_GRAPH_CLIENT_ID!,
      client_secret: env.MS_GRAPH_CLIENT_SECRET!,
      scope: MICROSOFT_SCOPES.join(" "),
      ...params,
    }),
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(`Microsoft token request failed: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim());
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null };
}

export function exchangeMicrosoftCode(env: MicrosoftEnv, code: string, redirectUri: string) {
  return tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

// Microsoft rotates refresh tokens on use -- callers must persist the
// returned refreshToken when it's non-null or the next run's refresh fails.
export function refreshMicrosoftAccessToken(env: MicrosoftEnv, refreshToken: string) {
  return tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function graphGet<T>(token: string, url: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph ${url.replace(GRAPH, "")} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchGraphMeEmail(token: string): Promise<string | null> {
  const me = await graphGet<{ mail?: string | null; userPrincipalName?: string }>(token, `${GRAPH}/me?$select=mail,userPrincipalName`);
  return (me.mail ?? me.userPrincipalName ?? "").toLowerCase() || null;
}

type GraphRecipient = { emailAddress?: { address?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: { content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  sentDateTime?: string;
  receivedDateTime?: string;
};

function addr(r: GraphRecipient | undefined): string | null {
  return r?.emailAddress?.address?.toLowerCase() ?? null;
}

function toMessage(m: GraphMessage, direction: MailMessage["direction"], withBody: boolean): MailMessage | null {
  const sentAt = m.sentDateTime ?? m.receivedDateTime;
  if (!sentAt) return null;
  return {
    messageId: m.internetMessageId ?? `outlook:${m.id}`,
    providerId: m.id,
    direction,
    from: addr(m.from),
    to: (m.toRecipients ?? []).map(addr).filter((a): a is string => Boolean(a)),
    cc: (m.ccRecipients ?? []).map(addr).filter((a): a is string => Boolean(a)),
    subject: m.subject ?? null,
    snippet: m.bodyPreview ?? null,
    body: withBody ? (m.body?.content?.slice(0, 20000) ?? null) : null,
    sentAt: new Date(sentAt).toISOString(),
  };
}

async function listMessages(token: string, firstUrl: string, cap: number, direction: MailMessage["direction"], withBody: boolean): Promise<MailMessage[]> {
  const out: MailMessage[] = [];
  let url: string | undefined = firstUrl;
  while (url && out.length < cap) {
    const page: { value: GraphMessage[]; "@odata.nextLink"?: string } = await graphGet(
      token,
      url,
      withBody ? { Prefer: 'outlook.body-content-type="text"' } : {}
    );
    for (const m of page.value) {
      const msg = toMessage(m, direction, withBody);
      if (msg) out.push(msg);
    }
    url = page["@odata.nextLink"];
  }
  return out.slice(0, cap);
}

const SELECT = "id,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime";

export async function readOutlook(env: MicrosoftEnv, refreshToken: string, cursor: string | null): Promise<MailboxRead & { accessToken: string; rotatedRefreshToken: string | null }> {
  const { accessToken, refreshToken: rotated } = await refreshMicrosoftAccessToken(env, refreshToken);
  const since = lookbackStart(cursor).toISOString();

  // Bodies come back as text (Prefer header) so the tracker can show the
  // whole email on double-click; Graph pages of 100 with bodies are fine.
  const sentUrl = `${GRAPH}/me/mailFolders/SentItems/messages?$select=${SELECT},body&$filter=sentDateTime ge ${since}&$top=100`;
  const inboxUrl = `${GRAPH}/me/mailFolders/Inbox/messages?$select=${SELECT},body&$filter=receivedDateTime ge ${since}&$top=100`;
  const senderFilter = INTERNAL_KNOWLEDGE_SENDERS.map((s) => `from/emailAddress/address eq '${s}'`).join(" or ");
  const internalUrl = `${GRAPH}/me/messages?$select=${SELECT},body&$filter=receivedDateTime ge ${since} and (${senderFilter})&$top=50`;

  const [sent, inbox, internal] = await Promise.all([
    listMessages(accessToken, sentUrl, MAX_SENT_PER_RUN, "outbound", true),
    listMessages(accessToken, inboxUrl, MAX_INBOX_PER_RUN, "inbound", true),
    listMessages(accessToken, internalUrl, MAX_INTERNAL_PER_RUN, "inbound", true),
  ]);
  return { sent, inbox, internal, accessToken, rotatedRefreshToken: rotated };
}
