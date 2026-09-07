import type { NormalizedCampaign, NormalizedEmail } from "./types";

// Instantly v2. Auth via `Authorization: Bearer`. List endpoints paginate
// via `starting_after` / response.next_starting_after (not offset, not `after`).
//
// Tag mechanism (confirmed empirically — not fully documented): tags are a
// separate `/custom-tags` resource (id/label), applied to entities via
// `/custom-tag-mappings` rows carrying {tag_id, resource_id, resource_type}.
// resource_type 2 = campaign (inferred by cross-checking known campaign ids
// against mapping resource_ids; resource_type 1 appears to be leads).
// IMPORTANT: the `tag_id` query filter on /custom-tag-mappings does not
// appear to actually filter server-side (verified against live data) — always
// fetch all mappings and filter client-side by tag_id.

// Trailing slash matters: BASE has a path component (/api/v2), and
// `new URL(path, base)` with a LEADING slash on `path` resolves from the
// origin root, silently dropping /api/v2 — every call site below passes a
// leading-slash path for readability, so BASE must end in "/" and the
// leading slash gets stripped before resolving.
const BASE = "https://api.instantly.ai/api/v2/";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Instantly's real limit is 20 requests/minute (confirmed via live 429s) —
// with 300+ campaigns each needing at least one /emails call, hitting this
// is normal, not exceptional. Retry with backoff instead of failing the
// whole sync on the first rate-limited request.
async function instantlyFetch<T>(
  apiKey: string,
  path: string,
  params: Record<string, string>,
  attempt = 1
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });

  if (res.status === 429 && attempt <= 6) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 4000;
    await sleep(waitMs);
    return instantlyFetch<T>(apiKey, path, params, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Instantly ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

type InstantlyPage<T> = { items: T[]; next_starting_after?: string | null };

async function fetchAllPages<T>(
  apiKey: string,
  path: string,
  baseParams: Record<string, string>
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;
  do {
    const params = { ...baseParams, limit: "100", ...(startingAfter ? { starting_after: startingAfter } : {}) };
    const page = await instantlyFetch<InstantlyPage<T>>(apiKey, path, params);
    all.push(...page.items);
    startingAfter = page.next_starting_after ?? undefined;
  } while (startingAfter);
  return all;
}

type InstantlyCampaign = { id: string; name: string; status: number; timestamp_updated?: string };
type InstantlyCustomTag = { id: string; label: string };
type InstantlyTagMapping = { tag_id: string; resource_id: string; resource_type: number };
type InstantlyEmail = {
  id: string;
  campaign_id: string | null;
  from_address_email: string | null;
  to_address_email_list: string;
  subject: string | null;
  body?: { html?: string };
  timestamp_email: string;
};

const CAMPAIGN_RESOURCE_TYPE = 2;

export async function fetchInstantlyCampaigns(opts: { apiKey: string }): Promise<NormalizedCampaign[]> {
  const raw = await fetchAllPages<InstantlyCampaign>(opts.apiKey, "/campaigns", {});
  return raw.map((c) => ({
    sourceId: c.id,
    name: c.name,
    status: String(c.status),
    tags: [], // populated separately via resolveCampaignIdsForTag — Instantly doesn't return tags inline on /campaigns
    updatedAt: c.timestamp_updated ?? null,
    raw: c,
  }));
}

// Returns null if no tag with this label exists yet (the team hasn't created
// it) so callers can fall back gracefully instead of erroring.
export async function resolveCampaignIdsForTagLabel(
  apiKey: string,
  tagLabel: string
): Promise<Set<string> | null> {
  const tags = await fetchAllPages<InstantlyCustomTag>(apiKey, "/custom-tags", {});
  const tag = tags.find((t) => t.label.toLowerCase() === tagLabel.toLowerCase());
  if (!tag) return null;

  const mappings = await fetchAllPages<InstantlyTagMapping>(apiKey, "/custom-tag-mappings", {});
  const campaignIds = new Set(
    mappings.filter((m) => m.tag_id === tag.id && m.resource_type === CAMPAIGN_RESOURCE_TYPE).map((m) => m.resource_id)
  );
  return campaignIds;
}

export async function fetchInstantlyEmailsForCampaign(
  apiKey: string,
  campaignId: string
): Promise<NormalizedEmail[]> {
  const raw = await fetchAllPages<InstantlyEmail>(apiKey, "/emails", { campaign_id: campaignId });
  return raw.map((e) => ({
    sourceId: e.id,
    campaignId: e.campaign_id,
    senderEmail: e.from_address_email,
    recipientEmail: e.to_address_email_list,
    subject: e.subject,
    bodyHtml: e.body?.html ?? null,
    sentAt: e.timestamp_email,
    raw: e,
  }));
}
