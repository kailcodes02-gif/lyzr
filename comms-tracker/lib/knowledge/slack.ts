import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../sync/batch";
import { ensureKnowledgeBucket, sha256Hex, writeKnowledgeMarkdown } from "./util";

// Needs a Slack app (bot token, `channels:history` + `channels:read` scopes
// -- `groups:history`/`groups:read` too if private channels should count --
// installed to the workspace and invited into whichever channels should
// feed the knowledge base). See SETUP_INTEGRATIONS.md.
export function isSlackConfigured(env: { SLACK_BOT_TOKEN?: string }): boolean {
  return Boolean(env.SLACK_BOT_TOKEN);
}

const SLACK_API = "https://slack.com/api";
// Bounds one run's wall-clock/API usage regardless of channel count or
// history depth -- same convention as lyzr-scrape's MAX_PAGES_PER_RUN.
// Thread replies aren't fetched (conversations.history only returns
// top-level messages) -- a v1 stopgap, not the real scope, same spirit as
// Instantly's no-tag campaign cap.
const MAX_MESSAGES_PER_CHANNEL_PER_RUN = 500;

type SlackChannel = { id: string; name: string };
type SlackMessage = { ts: string; text?: string; subtype?: string; bot_id?: string };

// Slack throttles brand-new / undistributed apps hard on conversations.list
// (a flat `ratelimited` with retry-after: 30s that can repeat several times
// in a row). Honour retry-after and try a few times before giving up, so a
// single throttled call doesn't fail the whole weekly run.
const MAX_SLACK_ATTEMPTS = 4;

async function slackGet<T extends object>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_SLACK_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as T & { ok: boolean; error?: string };
    if (res.ok && body.ok) return body;
    const retryAfter = Number(res.headers.get("retry-after") ?? "0");
    lastError = `Slack ${method} failed: ${body.error ?? res.status}${retryAfter ? ` (retry-after: ${retryAfter}s)` : ""}`;
    const throttled = res.status === 429 || body.error === "ratelimited";
    if (!throttled || attempt === MAX_SLACK_ATTEMPTS) break;
    await new Promise((r) => setTimeout(r, Math.max(retryAfter, 5) * 1000 + attempt * 1000));
  }
  throw new Error(lastError);
}

// Only channels the bot has actually been invited into -- it can list every
// public channel in the workspace regardless, but conversations.history
// 404s (`not_in_channel`) for ones it isn't a member of.
async function listMemberChannels(token: string): Promise<SlackChannel[]> {
  const all: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const page = await slackGet<{
      channels: Array<{ id: string; name: string; is_member: boolean }>;
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    for (const c of page.channels) if (c.is_member) all.push({ id: c.id, name: c.name });
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return all;
}

// `oldest` (a Slack message ts) scopes this to messages since the last
// successful run -- without it, every weekly run would re-walk a channel's
// entire history. Slack's `oldest` filter is exclusive, so re-using the
// newest ts seen last run as next run's `oldest` can't return it twice.
async function fetchChannelMessagesSince(
  token: string,
  channelId: string,
  oldest: string | undefined
): Promise<SlackMessage[]> {
  const all: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const page = await slackGet<{
      messages: SlackMessage[];
      has_more: boolean;
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.history", {
      channel: channelId,
      limit: "200",
      ...(oldest ? { oldest } : {}),
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.messages);
    cursor = page.has_more ? page.response_metadata?.next_cursor : undefined;
  } while (cursor && all.length < MAX_MESSAGES_PER_CHANNEL_PER_RUN);
  return all.slice(0, MAX_MESSAGES_PER_CHANNEL_PER_RUN);
}

// Per-channel bookmark of the newest message ts already ingested, stored in
// source_sync_state.last_cursor (JSONB) keyed by channel id -- the same row
// runKnowledgeIngestion's caller upserts last_synced_at/last_run_id onto,
// but that upsert only touches those two columns, so it never clobbers this.
type SlackCursorState = Record<string, string>;

export async function ingestSlack(
  db: SupabaseClient,
  env: { SLACK_BOT_TOKEN?: string },
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  if (!isSlackConfigured(env)) {
    log("slack: SLACK_BOT_TOKEN not set — skipping (see SETUP_INTEGRATIONS.md)");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }
  const token = env.SLACK_BOT_TOKEN!;
  await ensureKnowledgeBucket(db);

  const { data: stateRow, error: stateErr } = await db
    .from("source_sync_state")
    .select("last_cursor")
    .eq("source_key", "slack")
    .maybeSingle();
  if (stateErr) throw stateErr;
  const cursor = (stateRow?.last_cursor as SlackCursorState | null) ?? {};

  // conversations.list is the call Slack throttles for this app; once a run
  // has succeeded the channel ids are already in the cursor, so a throttled
  // listing falls back to those (names via conversations.info, best effort)
  // instead of failing the whole source. New channels get picked up on the
  // next run where the listing succeeds.
  let channels: SlackChannel[];
  try {
    channels = await listMemberChannels(token);
  } catch (err) {
    const knownIds = Object.keys(cursor);
    if (knownIds.length === 0) throw err;
    log(`slack: channel listing throttled (${err instanceof Error ? err.message : String(err)}); using the ${knownIds.length} channel(s) from the last successful run`);
    channels = await Promise.all(
      knownIds.map(async (id) => {
        try {
          const info = await slackGet<{ channel: { id: string; name: string } }>(token, "conversations.info", { channel: id });
          return { id, name: info.channel.name };
        } catch {
          return { id, name: id };
        }
      })
    );
  }
  if (channels.length === 0) {
    log("slack: bot isn't a member of any channel yet — invite it with /invite in Slack");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }

  const nextCursor: SlackCursorState = { ...cursor };
  let fetched = 0;
  let upserted = 0;

  for (const channel of channels) {
    const oldest = cursor[channel.id];
    const messages = await fetchChannelMessagesSince(token, channel.id, oldest);
    fetched += messages.length;
    if (messages.length === 0) continue;

    let maxTs = oldest ?? "0";
    const rows: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
      if (msg.ts > maxTs) maxTs = msg.ts;
      // Skip system messages (channel_join/topic changes/etc.) and the
      // bot's own posts -- neither is useful "what's happening" content.
      if (msg.subtype || msg.bot_id || !msg.text?.trim()) continue;
      rows.push({
        source_type: "slack",
        source_ref: `${channel.id}:${msg.ts}`,
        title: `#${channel.name}`,
        content_md: msg.text,
        content_hash: await sha256Hex(msg.text),
        published_at: new Date(Number(msg.ts.split(".")[0]) * 1000).toISOString(),
        fetched_at: new Date().toISOString(),
      });
    }
    nextCursor[channel.id] = maxTs;

    for (const batch of chunk(rows, 500)) {
      const { error } = await db.from("knowledge_documents").upsert(batch, { onConflict: "source_type,source_ref" });
      if (error) throw error;
      upserted += batch.length;
    }
  }

  const { error: cursorErr } = await db
    .from("source_sync_state")
    .upsert({ source_key: "slack", last_cursor: nextCursor }, { onConflict: "source_key" });
  if (cursorErr) throw cursorErr;

  log(`slack: ${channels.length} channel(s) (${channels.map((c) => c.name).join(", ")}), ${fetched} message(s) checked, ${upserted} stored`);

  // Rebuild the canonical slack.md from whatever's now in the table, same
  // "cheap, always in sync" convention as lyzr-scrape.ts.
  const { data: docs, error: docsErr } = await db
    .from("knowledge_documents")
    .select("title, content_md, published_at")
    .eq("source_type", "slack")
    .order("published_at", { ascending: false })
    .limit(300);
  if (docsErr) throw docsErr;
  const body = (docs ?? [])
    .map((d) => `## ${d.title} — ${new Date(d.published_at as string).toLocaleString()}\n\n${d.content_md}\n`)
    .join("\n");
  await writeKnowledgeMarkdown(db, "slack.md", `# slack.md\n\n${body}`);

  return { fetched, upserted, flaggedForReview: 0 };
}
