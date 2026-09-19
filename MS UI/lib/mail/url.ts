// URL state for /outlook/?f=&c=&m=&q=&tab= so every view deep-links.
export type MailTab = "focused" | "other";
export type MailUrlState = {
  folder: string; // folder id or well-known name; "starred" is virtual
  conversation?: string;
  message?: string;
  query?: string;
  tab?: MailTab;
};

export const DEFAULT_FOLDER = "inbox";

export function parseMailUrl(search: string | URLSearchParams): MailUrlState {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const tabRaw = sp.get("tab");
  const tab: MailTab | undefined = tabRaw === "other" ? "other" : tabRaw === "focused" ? "focused" : undefined;
  return {
    folder: sp.get("f") || DEFAULT_FOLDER,
    conversation: sp.get("c") || undefined,
    message: sp.get("m") || undefined,
    query: sp.get("q") || undefined,
    tab,
  };
}

export function serializeMailUrl(state: Partial<MailUrlState>): string {
  const sp = new URLSearchParams();
  if (state.folder && state.folder !== DEFAULT_FOLDER) sp.set("f", state.folder);
  if (state.conversation) sp.set("c", state.conversation);
  if (state.message) sp.set("m", state.message);
  if (state.query) sp.set("q", state.query);
  if (state.tab && state.tab !== "focused") sp.set("tab", state.tab);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
