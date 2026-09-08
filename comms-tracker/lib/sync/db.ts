import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Standalone service-role client for sync code — deliberately NOT
// lib/supabase/server.ts's createServiceClient(), which lives in a file that
// also imports `next/headers` at module scope. That import only resolves
// inside a Next.js server/edge request context; sync code needs to run both
// there (the Worker's /api/sync/* routes) and outside it (local `tsx`
// scripts, tests), so it gets its own minimal factory.
export function createSyncDbClient(env: {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Whether a column exists on the live schema -- used by writers that
// started emitting a newly added column (e.g. communication_events.body_text,
// migration 011) so a refresh keeps working if the code ships before the
// migration has been run in the Supabase SQL Editor. Cached per process.
const columnCache = new Map<string, boolean>();
export async function hasColumn(db: SupabaseClient, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;
  const { error } = await db.from(table).select(column).limit(1);
  const exists = !error || error.code !== "42703";
  columnCache.set(key, exists);
  return exists;
}

export function stripColumn(rows: Array<Record<string, unknown>>, column: string): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const copy = { ...r };
    delete copy[column];
    return copy;
  });
}
