// URL state for /outlook/?f=&c=&m=&q=&tab=&focused= so every view deep-links.
// f may be a folder id / well-known name, "starred", or "label:<name>" for a
// category view. tab is the Gmail-style inbox tab; focused=1 narrows the inbox
// to Outlook's Focused classification (a switch, not a tab).
export type MailTab = "primary" | "social" | "promotions";
export type MailUrlState = {
  folder: string; // folder id or well-known name; "starred" and "label:<name>" are virtual
  conversation?: string;
  message?: string;
  query?: string;
  tab?: MailTab;
  focused?: boolean;
};

export const DEFAULT_FOLDER = "inbox";
export const LABEL_PREFIX = "label:";

export function labelFolderKey(name: string): string {
  return `${LABEL_PREFIX}${name}`;
}

// The category name when the folder key is a label view, else undefined.
export function labelFromFolder(folder: string): string | undefined {
  return folder.startsWith(LABEL_PREFIX) && folder.length > LABEL_PREFIX.length ? folder.slice(LABEL_PREFIX.length) : undefined;
}

export function parseMailTab(raw: string | null | undefined): MailTab | undefined {
  return raw === "social" || raw === "promotions" ? raw : raw === "primary" ? "primary" : undefined;
}

export function parseMailUrl(search: string | URLSearchParams): MailUrlState {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    folder: sp.get("f") || DEFAULT_FOLDER,
    conversation: sp.get("c") || undefined,
    message: sp.get("m") || undefined,
    query: sp.get("q") || undefined,
    tab: parseMailTab(sp.get("tab")),
    focused: sp.get("focused") === "1" ? true : undefined,
  };
}

export function serializeMailUrl(state: Partial<MailUrlState>): string {
  const sp = new URLSearchParams();
  if (state.folder && state.folder !== DEFAULT_FOLDER) sp.set("f", state.folder);
  if (state.conversation) sp.set("c", state.conversation);
  if (state.message) sp.set("m", state.message);
  if (state.query) sp.set("q", state.query);
  if (state.tab && state.tab !== "primary") sp.set("tab", state.tab);
  if (state.focused) sp.set("focused", "1");
  const s = sp.toString();
  return s ? `?${s}` : "";
}
