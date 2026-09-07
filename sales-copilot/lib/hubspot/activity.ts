import { createServiceClient } from "@/lib/supabase/server";

const HUBSPOT_API = "https://api.hubapi.com";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function hubspotHeaders() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function findContactId(email: string): Promise<string | null> {
  const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hubspotHeaders(),
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
      properties: ["email", "firstname", "lastname", "company", "lifecyclestage"],
      limit: 1,
    }),
  });
  if (!response.ok) {
    throw new Error(`HubSpot contact search failed: ${response.status}`);
  }
  const data = await response.json();
  return data.results?.[0]?.id ?? null;
}

async function fetchEngagements(contactId: string) {
  // Legacy Engagements v1 API: one call returns full engagement objects
  // (emails, calls, meetings, notes, tasks) with metadata — simpler than the
  // v4 associations + batch-read dance for a Phase 1 activity pull. Flag for
  // migration if HubSpot deprecates v1.
  const response = await fetch(
    `${HUBSPOT_API}/engagements/v1/engagements/associated/CONTACT/${contactId}/paged?limit=50`,
    { headers: hubspotHeaders() }
  );
  if (!response.ok) {
    throw new Error(`HubSpot engagements fetch failed: ${response.status}`);
  }
  return response.json();
}

export interface HubSpotActivityResult {
  found: boolean;
  raw?: unknown;
}

// Pulls (and caches) a contact's HubSpot engagement timeline for BOFU
// context. Returns found:false if the contact isn't in HubSpot at all —
// callers should fall back to MOFU-level context rather than erroring.
export async function getHubSpotActivity(contactEmail: string): Promise<HubSpotActivityResult> {
  const supabase = await createServiceClient();

  const { data: cached } = await supabase
    .from("hubspot_activity_cache")
    .select("raw_activity, fetched_at")
    .eq("contact_email", contactEmail)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return { found: true, raw: cached.raw_activity };
  }

  const contactId = await findContactId(contactEmail);
  if (!contactId) return { found: false };

  const engagements = await fetchEngagements(contactId);

  await supabase.from("hubspot_activity_cache").upsert({
    contact_email: contactEmail,
    raw_activity: engagements,
    fetched_at: new Date().toISOString(),
  });

  return { found: true, raw: engagements };
}
