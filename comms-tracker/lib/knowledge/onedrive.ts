import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../sync/batch";
import { GRAPH, graphGet, isMicrosoftConfigured, refreshMicrosoftAccessToken, type MicrosoftEnv } from "../mail/microsoft";
import { ensureKnowledgeBucket, sha256Hex, writeKnowledgeMarkdown } from "./util";
import { extractOfficeText, OFFICE_TEXT_EXTENSIONS } from "./office-text";

// OneDrive + SharePoint knowledge source. Same per-user consent as Outlook
// (one "Connect Outlook" click grants Mail.Read, Files.Read.All and
// Sites.Read.All), same shape as drive.ts on the Google side: the tracker
// only ever sees what the connected user can themselves open, and each
// drive is read incrementally through Graph's delta links.
const MAX_SITES = 20;
const MAX_FILES_PER_USER_PER_RUN = 200;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type DriveRef = { id: string; label: string };
type DriveItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: unknown;
  deleted?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
};
type Connection = { user_id: string; account_email: string | null; refresh_token: string; onedrive_delta: Record<string, string> | null };

async function listDrives(token: string, log: (m: string) => void): Promise<DriveRef[]> {
  const drives: DriveRef[] = [];
  try {
    const me = await graphGet<{ id: string; name?: string }>(token, `${GRAPH}/me/drive?$select=id,name`);
    drives.push({ id: me.id, label: "OneDrive" });
  } catch (err) {
    log(`onedrive: personal drive unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    // Every SharePoint site the user can reach; each site can expose
    // several document libraries (drives).
    const sites = await graphGet<{ value: Array<{ id: string; displayName?: string; name?: string }> }>(
      token,
      `${GRAPH}/sites?search=*&$select=id,displayName,name&$top=${MAX_SITES}`
    );
    for (const site of sites.value.slice(0, MAX_SITES)) {
      try {
        const libs = await graphGet<{ value: Array<{ id: string; name?: string }> }>(token, `${GRAPH}/sites/${site.id}/drives?$select=id,name`);
        for (const lib of libs.value) drives.push({ id: lib.id, label: `${site.displayName ?? site.name ?? "SharePoint"} / ${lib.name ?? "Documents"}` });
      } catch {
        // a site without document libraries, or one we can list but not read
      }
    }
  } catch (err) {
    log(`onedrive: SharePoint site listing unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  return drives;
}

// Graph delta: first call walks the whole drive, later calls (stored
// deltaLink) return only what changed. Both end with a fresh deltaLink.
async function listChanged(token: string, driveId: string, deltaLink: string | undefined, cap: number): Promise<{ items: DriveItem[]; nextDeltaLink: string | null }> {
  const items: DriveItem[] = [];
  let url: string | undefined = deltaLink ?? `${GRAPH}/drives/${driveId}/root/delta?$select=id,name,size,lastModifiedDateTime,webUrl,file,folder,deleted&$top=200`;
  let next: string | null = null;
  while (url) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } = await graphGet(token, url);
    for (const it of page.value) {
      if (it.deleted || it.folder || !it.file) continue;
      const ext = it.name.split(".").pop()?.toLowerCase() ?? "";
      if (!OFFICE_TEXT_EXTENSIONS.includes(ext)) continue;
      if ((it.size ?? 0) > MAX_FILE_BYTES) continue;
      items.push(it);
    }
    if (page["@odata.deltaLink"]) next = page["@odata.deltaLink"];
    url = page["@odata.nextLink"];
    if (items.length >= cap && !url) break;
  }
  return { items, nextDeltaLink: next };
}

async function downloadText(token: string, driveId: string, item: DriveItem): Promise<string | null> {
  const meta = await graphGet<DriveItem>(token, `${GRAPH}/drives/${driveId}/items/${item.id}?$select=id,name,@microsoft.graph.downloadUrl`);
  const dl = meta["@microsoft.graph.downloadUrl"];
  if (!dl) return null;
  const res = await fetch(dl); // pre-authenticated, no bearer needed
  if (!res.ok) return null;
  return extractOfficeText(item.name, new Uint8Array(await res.arrayBuffer()));
}

export async function ingestOneDrive(
  db: SupabaseClient,
  env: MicrosoftEnv,
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  if (!isMicrosoftConfigured(env)) {
    log("onedrive: MS_GRAPH_CLIENT_ID/SECRET not set — skipping (see SETUP_INTEGRATIONS.md)");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }
  await ensureKnowledgeBucket(db);

  const { data: connections, error: connErr } = await db
    .from("user_oauth_tokens")
    .select("user_id, account_email, refresh_token, onedrive_delta")
    .eq("provider", "microsoft");
  if (connErr) throw connErr;
  if (!connections || connections.length === 0) {
    log('onedrive: no one has connected Outlook/Microsoft yet — use "Connect Outlook" on /admin/sync (skipping)');
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }

  let fetched = 0;
  let upserted = 0;
  for (const conn of connections as Connection[]) {
    try {
      const { accessToken, refreshToken: rotated } = await refreshMicrosoftAccessToken(env, conn.refresh_token);
      const deltas: Record<string, string> = { ...(conn.onedrive_delta ?? {}) };
      const drives = await listDrives(accessToken, log);
      let budget = MAX_FILES_PER_USER_PER_RUN;
      const rows: Array<Record<string, unknown>> = [];

      for (const drive of drives) {
        if (budget <= 0) break;
        const { items, nextDeltaLink } = await listChanged(accessToken, drive.id, deltas[drive.id], budget);
        const batch = items.slice(0, budget);
        budget -= batch.length;
        fetched += batch.length;

        const existing = await db
          .from("knowledge_documents")
          .select("source_ref, content_hash")
          .eq("source_type", "onedrive")
          .in("source_ref", batch.map((i) => i.id));
        if (existing.error) throw existing.error;
        const hashByRef = new Map((existing.data ?? []).map((r) => [r.source_ref, r.content_hash]));

        for (const item of batch) {
          let text: string | null;
          try {
            text = await downloadText(accessToken, drive.id, item);
          } catch (err) {
            log(`onedrive: failed to read ${item.name}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
          if (!text) continue;
          const hash = await sha256Hex(text);
          if (hashByRef.get(item.id) === hash) continue;
          rows.push({
            source_type: "onedrive",
            source_ref: item.id,
            title: `${drive.label}: ${item.name}`,
            content_md: text,
            content_hash: hash,
            published_at: item.lastModifiedDateTime ?? null,
            fetched_at: new Date().toISOString(),
          });
        }
        if (nextDeltaLink) deltas[drive.id] = nextDeltaLink;
      }

      for (const b of chunk(rows, 200)) {
        const { error } = await db.from("knowledge_documents").upsert(b, { onConflict: "source_type,source_ref" });
        if (error) throw error;
        upserted += b.length;
      }

      const patch: Record<string, unknown> = { onedrive_delta: deltas };
      if (rotated) patch.refresh_token = rotated;
      const { error: updErr } = await db.from("user_oauth_tokens").update(patch).eq("user_id", conn.user_id).eq("provider", "microsoft");
      if (updErr) throw updErr;
      log(`onedrive: ${conn.account_email ?? conn.user_id}: ${drives.length} drive(s), ${rows.length} file(s) stored`);
    } catch (err) {
      log(`onedrive: failed for ${conn.account_email ?? conn.user_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const { data: docs, error: docsErr } = await db
    .from("knowledge_documents")
    .select("title, published_at")
    .eq("source_type", "onedrive")
    .order("published_at", { ascending: false })
    .limit(300);
  if (docsErr) throw docsErr;
  const body = (docs ?? []).map((d) => `## ${d.title}\nupdated ${d.published_at}\n`).join("\n");
  await writeKnowledgeMarkdown(db, "onedrive-sharepoint.md", `# onedrive-sharepoint.md\n\n${body}`);

  return { fetched, upserted, flaggedForReview: 0 };
}
