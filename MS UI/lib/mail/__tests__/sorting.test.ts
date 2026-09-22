import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { GraphError } from "@/lib/graph";
import { mockCategories, mockRules } from "@/lib/mock/mail";
import { backfillLabel } from "../install";
import { enableSorting, isFilterRejected, listStrategy, loadListStrategy, mailRetry, setListStrategy, type SortingProgress } from "../hooks";
import { inboxTabPath, isSortingRule, PROMOTIONS_LABEL, SOCIAL_LABEL } from "../labels";
import { mockApi, mockCall, type Message, type Page } from "./helpers";

describe("inbox sorting set-up (categories, two rules, backfill)", () => {
  it("creates both labels and rules once, backfills with counts, reports progress in order, and is idempotent", async () => {
    const api = mockApi();
    const seen: SortingProgress[] = [];
    const res = await enableSorting(api, (label, c) => backfillLabel(api, label, c), (p) => seen.push(p));
    expect(seen).toEqual(["labels", "rules", "social", "promotions"]);
    expect(mockCategories.filter((c) => c.displayName === SOCIAL_LABEL)).toHaveLength(1);
    expect(mockCategories.filter((c) => c.displayName === PROMOTIONS_LABEL)).toHaveLength(1);
    expect(mockRules.filter(isSortingRule).map((r) => r.displayName).sort()).toEqual(["Sorting: Promotions", "Sorting: Social"]);
    expect(res.social).toBeGreaterThan(0);
    expect(res.promos).toBeGreaterThan(0);
    expect(res.failed).toBe(0);
    // Primary (server strategy) no longer lists the sorted mail; the tabs do.
    const primary = (mockCall("GET", inboxTabPath("primary")) as Page<Message>).value;
    expect(primary.some((m) => m.categories?.includes(SOCIAL_LABEL) || m.categories?.includes(PROMOTIONS_LABEL))).toBe(false);
    expect((mockCall("GET", inboxTabPath("social")) as Page<Message>).value.length).toBe(res.social);
    expect((mockCall("GET", inboxTabPath("promotions")) as Page<Message>).value.length).toBe(res.promos);
    // Second run: nothing duplicated, nothing left to label.
    const again = await enableSorting(api, (label, c) => backfillLabel(api, label, c));
    expect(again).toEqual({ social: 0, promos: 0, failed: 0 });
    expect(mockRules.filter(isSortingRule)).toHaveLength(2);
    expect(mockCategories.filter((c) => c.displayName === SOCIAL_LABEL)).toHaveLength(1);
  });
});

describe("list strategy fallback", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    setListStrategy({ label: "filter", primary: "server" });
  });
  it("treats any 400 on a first page as a rejected query, so the view falls back instead of going blank", () => {
    expect(isFilterRejected(new GraphError(400, "ErrorInvalidUrlQueryFilter", "x", "/me/messages"))).toBe(true);
    expect(isFilterRejected(new GraphError(400, "BadRequest", "The query filter contains one or more invalid nodes.", "/me/messages"))).toBe(true);
    expect(isFilterRejected(new GraphError(404, "ErrorItemNotFound", "x", "/me/messages"))).toBe(false);
    expect(isFilterRejected(new Error("offline"))).toBe(false);
  });
  it("remembers a rejected Primary filter across reloads and never retries a 4xx", () => {
    expect(loadListStrategy()).toEqual({ label: "filter", primary: "server" });
    setListStrategy({ primary: "client" });
    expect(listStrategy.primary).toBe("client");
    expect(loadListStrategy()).toEqual({ label: "filter", primary: "client" });
    localStorage.setItem("msui.mail.listStrategy", "not json");
    expect(loadListStrategy()).toEqual({ label: "filter", primary: "server" });
    expect(mailRetry(0, new GraphError(400, "BadRequest", "x", "/p"))).toBe(false);
    expect(mailRetry(0, new GraphError(403, "ErrorAccessDenied", "x", "/p"))).toBe(false);
    expect(mailRetry(0, new GraphError(503, "ServiceUnavailable", "x", "/p"))).toBe(true);
    expect(mailRetry(1, new GraphError(503, "ServiceUnavailable", "x", "/p"))).toBe(false);
    expect(mailRetry(0, new Error("offline"))).toBe(true);
  });
});
