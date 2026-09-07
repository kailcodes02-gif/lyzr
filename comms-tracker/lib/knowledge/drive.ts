import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../sync/batch";
import { ensureKnowledgeBucket, sha256Hex, writeKnowledgeMarkdown } from "./util";

// Per-user consent, not domain-wide delegation: each signed-in user grants
// Drive read access at their own initiative (see app/auth/callback/page.tsx's
// `?connect=drive` handling and the "Connect Google Drive" button on
// /admin/sync) -- this only ever sees what whichever users have connected
// can themselves see, not literally "everyone's Drive". See
// SETUP_INTEGRATIONS.md for the Google Cloud Console side of this.
export function isDriveConfigured(env: { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string }): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// Native Google types have a text export; anything else (PDFs, uploaded
// .docx, images) would need format-specific handling this v1 doesn't do --
// logged as skipped rather than silently dropped, same convention as
// lyzr-scrape's page cap and Instantly's no-tag campaign cap.
const EXPORTABLE_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const MAX_FILES_PER_USER_PER_RUN = 200;

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; trashed?: boolean };

async function refreshAccessToken(
  env: { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string },
  refreshToken: string
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token refresh failed: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim());
  }
  return body.access_token;
}

async function driveGet<T>(accessToken: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${DRIVE_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// First run for this user: no startPageToken yet, so there's no "changes
// since X" to ask for -- list the current file set directly instead. Bounded
// to the most recently modified files, same reasoning as every other
// adapter's first-run cap.
async function listInitialFiles(accessToken: string): Promise<DriveFile[]> {
  const mimeFilter = Object.keys(EXPORTABLE_MIME_TYPES)
    .map((m) => `mimeType='${m}'`)
    .join(" or ");
  const page = await driveGet<{ files: DriveFile[] }>(accessToken, "files", {
    q: `trashed=false and (${mimeFilter})`,
    orderBy: "modifiedTime desc",
    pageSize: String(MAX_FILES_PER_USER_PER_RUN),
    fields: "files(id,name,mimeType,modifiedTime,trashed)",
  });
  return page.files;
}

// Subsequent runs: changes.list since the stored startPageToken -- the
// idiomatic Drive incremental-sync mechanism (files.list has no equivalent
// "since" filter). Returns the changed files plus a new cursor to store.
async function listChangedFiles(
  accessToken: string,
  startPageToken: string
): Promise<{ files: DriveFile[]; nextStartPageToken: string }> {
  const files: DriveFile[] = [];
  let pageToken = startPageToken;
  let newStartPageToken = startPageToken;
  do {
    const page = await driveGet<{
      changes: Array<{ file?: DriveFile; removed?: boolean }>;
      nextPageToken?: string;
      newStartPageToken?: string;
    }>(accessToken, "changes", {
      pageToken,
      pageSize: "200",
      fields: "nextPageToken,newStartPageToken,changes(removed,file(id,name,mimeType,modifiedTime,trashed))",
    });
    for (const change of page.changes) {
      if (change.removed || !change.file || change.file.trashed) continue;
      if (EXPORTABLE_MIME_TYPES[change.file.mimeType]) files.push(change.file);
    }
    if (page.newStartPageToken) newStartPageToken = page.newStartPageToken;
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && files.length < MAX_FILES_PER_USER_PER_RUN);
  return { files: files.slice(0, MAX_FILES_PER_USER_PER_RUN), nextStartPageToken: newStartPageToken };
}

async function exportFileText(accessToken: string, file: DriveFile): Promise<string> {
  const exportMime = EXPORTABLE_MIME_TYPES[file.mimeType];
  const url = new URL(`${DRIVE_API}/files/${file.id}/export`);
  url.searchParams.set("mimeType", exportMime);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive export failed for ${file.id}: ${res.status}`);
  return res.text();
}

type ConnectedUser = { user_id: string; refresh_token: string; drive_start_page_token: string | null };

export async function ingestDrive(
  db: SupabaseClient,
  env: { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string },
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  if (!isDriveConfigured(env)) {
    log("drive: GOOGLE_OAUTH_CLIENT_ID/SECRET not set — skipping (see SETUP_INTEGRATIONS.md)");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }
  await ensureKnowledgeBucket(db);

  const { data: connectedUsers, error: usersErr } = await db
    .from("user_oauth_tokens")
    .select("user_id, refresh_token, drive_start_page_token")
    .eq("provider", "google_drive");
  if (usersErr) throw usersErr;

  if (!connectedUsers || connectedUsers.length === 0) {
    log("drive: no one has connected Google Drive yet — use the \"Connect Google Drive\" button on /admin/sync");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }

  let fetched = 0;
  let upserted = 0;

  for (const connection of connectedUsers as ConnectedUser[]) {
    try {
      const accessToken = await refreshAccessToken(env, connection.refresh_token);

      let files: DriveFile[];
      let nextStartPageToken: string;
      if (connection.drive_start_page_token) {
        const result = await listChangedFiles(accessToken, connection.drive_start_page_token);
        files = result.files;
        nextStartPageToken = result.nextStartPageToken;
      } else {
        files = await listInitialFiles(accessToken);
        const startToken = await driveGet<{ startPageToken: string }>(accessToken, "changes/startPageToken", {});
        nextStartPageToken = startToken.startPageToken;
      }
      fetched += files.length;

      const existing = await db
        .from("knowledge_documents")
        .select("source_ref, content_hash")
        .eq("source_type", "drive")
        .in(
          "source_ref",
          files.map((f) => f.id)
        );
      if (existing.error) throw existing.error;
      const hashByRef = new Map((existing.data ?? []).map((r) => [r.source_ref, r.content_hash]));

      const rows: Array<Record<string, unknown>> = [];
      for (const file of files) {
        let text: string;
        try {
          text = await exportFileText(accessToken, file);
        } catch (err) {
          log(`drive: failed to export ${file.name} (${file.id}): ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const hash = await sha256Hex(text);
        if (hashByRef.get(file.id) === hash) continue; // unchanged since last run

        rows.push({
          source_type: "drive",
          source_ref: file.id,
          title: file.name,
          content_md: text,
          content_hash: hash,
          published_at: file.modifiedTime,
          fetched_at: new Date().toISOString(),
        });
      }

      for (const batch of chunk(rows, 500)) {
        const { error } = await db.from("knowledge_documents").upsert(batch, { onConflict: "source_type,source_ref" });
        if (error) throw error;
        upserted += batch.length;
      }

      const { error: cursorErr } = await db
        .from("user_oauth_tokens")
        .update({ drive_start_page_token: nextStartPageToken })
        .eq("user_id", connection.user_id)
        .eq("provider", "google_drive");
      if (cursorErr) throw cursorErr;
    } catch (err) {
      // One user's revoked/expired grant shouldn't stop the others' Drive
      // content from being ingested this run.
      log(`drive: failed for user ${connection.user_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`drive: ${connectedUsers.length} connected user(s), ${fetched} file(s) checked, ${upserted} stored`);

  // Rebuild the canonical drive.md from whatever's now in the table, same
  // "cheap, always in sync" convention as lyzr-scrape.ts.
  const { data: docs, error: docsErr } = await db
    .from("knowledge_documents")
    .select("title, source_ref, published_at")
    .eq("source_type", "drive")
    .order("published_at", { ascending: false })
    .limit(300);
  if (docsErr) throw docsErr;
  const body = (docs ?? [])
    .map((d) => `## ${d.title}\nhttps://drive.google.com/file/d/${d.source_ref}/view — updated ${d.published_at}\n`)
    .join("\n");
  await writeKnowledgeMarkdown(db, "drive.md", `# drive.md\n\n${body}`);

  return { fetched, upserted, flaggedForReview: 0 };
}
