// Label set-up against Graph: categories, folders, rules and the backfill,
// written against a small injected API so hooks.ts (MSAL + graphFetch) and
// the tests (the in-memory mock) run exactly the same code.
import { GraphError, type BatchRequest } from "@/lib/graph";
import { backfillTargets, folderByNamePath, hasCategory, matchesConditions, ownRules, planLabelInsert, presetConditions, RULES_PATH, rulesForLabel, withCategory, type LabelConditions, type RuleOptions } from "./labels";
import type { PresetLabel } from "./presets";
import type { MailFolder, Message, MessageRule, OutlookCategory } from "./types";

export type BatchOutcome = { ok: string[]; failed: { id: string; status: number; detail: string }[] };
export type PageOf<T> = { value: T[]; "@odata.nextLink"?: string };

export type GraphApi = {
  get: <T>(path: string) => Promise<T>;
  getAll: <T>(path: string, max?: number) => Promise<T[]>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  patch: <T>(path: string, body: unknown) => Promise<T>;
  del: (path: string) => Promise<void>;
  // Runs the sub-requests (id = message id) and reports which failed.
  batch: (requests: BatchRequest[]) => Promise<BatchOutcome>;
};

export const CATEGORIES_PATH = "/me/outlook/masterCategories";
export const BACKFILL_SELECT = "id,conversationId,subject,from,sender,toRecipients,categories,receivedDateTime,internetMessageHeaders";
export const BACKFILL_MAX = 500;
export const inboxScanPath = () => `/me/mailFolders/inbox/messages?$select=${BACKFILL_SELECT}&$orderby=receivedDateTime desc&$top=100`;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function errorMessage(e: unknown): string {
  if (e instanceof GraphError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

// Idempotent: the existing category (any casing) is returned, else created.
export async function ensureCategory(api: GraphApi, name: string, color: string): Promise<OutlookCategory> {
  const cats = await api.get<PageOf<OutlookCategory>>(CATEGORIES_PATH).then((p) => p.value);
  const have = cats.find((c) => same(c.displayName, name));
  return have ?? api.post<OutlookCategory>(CATEGORIES_PATH, { displayName: name, color });
}

// Siblings of the Inbox that Exchange creates itself (Top of Information
// Store). Sibling display names must be unique whatever the item class, so
// POST /me/mailFolders with one of these is refused (409 ErrorFolderExists),
// and GET /me/mailFolders never lists the non-mail ones (Calendar, Contacts,
// Tasks, Notes, Journal), so the clash cannot be found by name either.
export const RESERVED_FOLDER_NAMES = ["Calendar", "Contacts", "Tasks", "Notes", "Journal", "Drafts", "Inbox", "Sent Items", "Deleted Items", "Junk Email", "Archive", "Outbox", "Conversation History"];
export const isReservedFolderName = (name: string) => RESERVED_FOLDER_NAMES.some((r) => same(r, name.trim()));
// The folder name a label is filed under: the name itself unless Exchange reserves it.
export const safeFolderName = (name: string) => (isReservedFolderName(name) ? `${name.trim()} mail` : name);
export const isFolderExistsError = (e: unknown) => e instanceof GraphError && (e.status === 409 || /ErrorFolderExists/i.test(e.code));

// A top-level folder with the given name (GET by displayName, POST if
// missing). A reserved name, or a POST refused because a sibling of that
// name exists, falls back to "<name> mail"; the caller reads displayName on
// the result to learn which folder is actually used.
export async function ensureFolder(api: GraphApi, name: string): Promise<MailFolder> {
  const find = (n: string) => api.get<PageOf<MailFolder>>(folderByNamePath(n)).then((p) => p.value.find((f) => same(f.displayName, n)));
  const candidates = isReservedFolderName(name) ? [safeFolderName(name)] : [name, `${name.trim()} mail`];
  for (const [i, n] of candidates.entries()) {
    const found = await find(n);
    if (found) return found;
    try {
      return await api.post<MailFolder>("/me/mailFolders", { displayName: n });
    } catch (e) {
      if (!isFolderExistsError(e)) throw e;
      // A hidden or concurrently created folder may now be listed.
      const again = await find(n);
      if (again) return again;
      if (i === candidates.length - 1) throw e;
    }
  }
  throw new Error(`Could not create a folder for "${name}"`);
}

// Replaces the label's own rules: delete, then insert the new ones before
// the sorting rules (renumbering what follows). Foreign rules are untouched.
export async function replaceLabelRules(api: GraphApi, label: string, conditions: LabelConditions, opts: RuleOptions = {}): Promise<MessageRule[]> {
  const all = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value);
  const own = ownRules(label, all);
  for (const r of own) await api.del(`${RULES_PATH}/${r.id}`);
  const rest = all.filter((r) => !own.includes(r));
  const count = rulesForLabel(label, conditions, 0, opts).length;
  const plan = planLabelInsert(rest, count);
  for (const p of plan.renumber) await api.patch(`${RULES_PATH}/${p.id}`, { sequence: p.sequence });
  const created: MessageRule[] = [];
  for (const body of rulesForLabel(label, conditions, plan.start - 1, opts)) created.push(await api.post<MessageRule>(RULES_PATH, body));
  return created;
}

export type BackfillResult = { labelled: number; moved: number; failed: number };

// Scans the inbox (last 500), labels the matches that lack the category
// (batches of 20, existing categories kept) and, for a skip-inbox label,
// moves every match into the folder.
export async function backfillLabel(api: GraphApi, label: string, conditions: LabelConditions, meAddress?: string, moveToFolder?: string): Promise<BackfillResult> {
  const inbox = await api.getAll<Message>(inboxScanPath(), BACKFILL_MAX);
  const matches = inbox.filter((m) => matchesConditions(m, conditions, meAddress));
  const targets = backfillTargets(matches, label, conditions, meAddress);
  let failed = 0;
  let labelled = 0;
  if (targets.length) {
    const res = await api.batch(targets.map((m) => ({ id: m.id, method: "PATCH", url: `/me/messages/${m.id}`, body: { categories: withCategory(m.categories, label) } })));
    failed += res.failed.length;
    labelled = targets.length - res.failed.length;
  }
  let moved = 0;
  if (moveToFolder && matches.length) {
    const res = await api.batch(matches.map((m) => ({ id: m.id, method: "POST", url: `/me/messages/${m.id}/move`, body: { destinationId: moveToFolder } })));
    failed += res.failed.length;
    moved = matches.length - res.failed.length;
  }
  return { labelled, moved, failed };
}

// Puts a skip-inbox label's mail back: every message in the folder that
// carries the category moves to the Inbox.
export async function moveLabelBackToInbox(api: GraphApi, label: string, folderId: string): Promise<number> {
  const inFolder = await api.getAll<Message>(`/me/mailFolders/${folderId}/messages?$select=id,categories&$top=100`, BACKFILL_MAX);
  const mine = inFolder.filter((m) => hasCategory(m, label));
  if (!mine.length) return 0;
  const res = await api.batch(mine.map((m) => ({ id: m.id, method: "POST", url: `/me/messages/${m.id}/move`, body: { destinationId: "inbox" } })));
  return mine.length - res.failed.length;
}

export type LabelSpec = { name: string; color: string; conditions: LabelConditions; skipInbox: boolean; folderName?: string };
// folderName: the folder actually used (may differ from the label, see
// ensureFolder). error: this label failed at `error`; whatever was created
// before the failure stays and a re-run resumes from it.
export type InstallResult = { name: string; folderId?: string; folderName?: string; rules: number; error?: string } & BackfillResult;

// Category (colour only when created), folder when skipInbox, rules
// (replaced, never duplicated) and the backfill. Re-running updates in place.
export async function installLabel(api: GraphApi, spec: LabelSpec, meAddress?: string, backfill = true): Promise<InstallResult> {
  await ensureCategory(api, spec.name, spec.color);
  const folder = spec.skipInbox ? await ensureFolder(api, spec.folderName ?? spec.name) : undefined;
  const rules = await replaceLabelRules(api, spec.name, spec.conditions, folder ? { moveToFolder: folder.id } : {});
  const res = backfill ? await backfillLabel(api, spec.name, spec.conditions, meAddress, folder?.id) : { labelled: 0, moved: 0, failed: 0 };
  return { name: spec.name, folderId: folder?.id, folderName: folder?.displayName, rules: rules.length, ...res };
}

export const presetSpec = (p: PresetLabel): LabelSpec => ({ name: p.name, color: p.color, conditions: presetConditions(p), skipInbox: p.skipInbox, folderName: p.folderName });

// One result per preset, always: a label that fails (folder clash, throttled
// rule POST, quota) is reported in its own line and the next one still runs.
export async function installPresets(api: GraphApi, presets: PresetLabel[], meAddress?: string): Promise<InstallResult[]> {
  const out: InstallResult[] = [];
  for (const p of presets) {
    try {
      out.push(await installLabel(api, presetSpec(p), meAddress));
    } catch (e) {
      out.push({ name: p.name, rules: 0, labelled: 0, moved: 0, failed: 1, error: errorMessage(e) });
    }
  }
  return out;
}
