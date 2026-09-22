import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { handleMail, mockMessages, mockRules } from "@/lib/mock/mail";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{ homeAccountId: "x" }] }) }));
vi.mock("@/lib/graph", async () => {
  const actual = await vi.importActual<typeof import("@/lib/graph")>("@/lib/graph");
  const run = async (path: string, method: string, body?: unknown) => {
    const url = new URL(path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`);
    const r = handleMail(method, url, body);
    if (r === undefined) throw new Error(`no mock for ${method} ${path}`);
    return r;
  };
  return {
    ...actual,
    graphFetch: vi.fn((_i: unknown, _s: unknown, path: string, init?: { method?: string; body?: unknown }) => run(path, init?.method ?? "GET", init?.body)),
    graphGetAll: vi.fn(async (_i: unknown, _s: unknown, path: string) => ((await run(path, "GET")) as { value: unknown[] }).value),
    graphBatch: vi.fn(async (_i: unknown, _s: unknown, reqs: { id: string; method: string; url: string; body?: unknown }[]) => Promise.all(reqs.map(async (r) => ({ id: r.id, status: 200, body: await run(r.url, r.method, r.body) })))),
  };
});
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { toast } from "sonner";
import { useMessageActions } from "@/lib/mail/hooks";
import type { Message } from "@/lib/mail/types";

type Actions = ReturnType<typeof useMessageActions>;
// The hook's result, handed out through a ref-like holder (test only).
const held: { actions?: Actions } = {};
function Harness() {
  const a = useMessageActions();
  useEffect(() => {
    held.actions = a;
  });
  return <p>ready</p>;
}

const mayuri = () => mockMessages.find((m) => m.from?.emailAddress?.address === "mayuri.murthy@linkedin.com")!;
type ToastOpts = { action?: { label: string; onClick: () => void }; duration?: number };
const lastSuccess = () => (toast.success as unknown as { mock: { calls: [string, ToastOpts?][] } }).mock.calls.at(-1)!;

describe("Move to tab and spam undo against the demo mailbox", () => {
  it("moves Mayuri's mail to Primary, offers the sender rule, and Yes creates it before the sorting rules", async () => {
    // As after "Turn on inbox sorting": the Social rule has stamped her.
    mockRules.push({ id: "rule-social", displayName: "Sorting: Social", sequence: 5, isEnabled: true, conditions: { senderContains: ["linkedin.com"] }, actions: { assignCategories: ["Social"], stopProcessingRules: false } });
    mayuri().categories = ["Social"];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>
    );
    await screen.findByText("ready");
    const before: Message = { ...mayuri() };
    act(() => void held.actions!.moveToTab([before], "primary"));
    await waitFor(() => expect(mayuri().categories).toEqual([]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Moved to Primary. Do this for all mail from mayuri.murthy@linkedin.com?", expect.objectContaining({ action: expect.objectContaining({ label: "Yes" }) })));
    const [, opts] = lastSuccess();
    await act(async () => opts!.action!.onClick());
    await waitFor(() => expect(mockRules.some((r) => r.displayName === "Sorting: Primary (mayuri.murthy@linkedin.com)")).toBe(true));
    const rule = mockRules.find((r) => r.displayName === "Sorting: Primary (mayuri.murthy@linkedin.com)")!;
    expect(rule.conditions).toEqual({ fromAddresses: [{ emailAddress: { address: "mayuri.murthy@linkedin.com" } }] });
    expect(rule.actions).toEqual({ stopProcessingRules: true });
    expect(rule.sequence).toBeLessThan(mockRules.find((r) => r.displayName === "Sorting: Social")!.sequence);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mail from mayuri.murthy@linkedin.com will always stay in Primary"));
    // Back to Social keeps other labels and drops nothing else.
    act(() => void held.actions!.moveToTab([{ ...mayuri(), categories: ["GSI"] }], "social"));
    await waitFor(() => expect(mayuri().categories).toEqual(["GSI", "Social"]));
  });

  it("reports spam with an Undo that moves the message back to the Inbox", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>
    );
    await screen.findByText("ready");
    const target = mockMessages.find((m) => m.subject === "Partner portal access for two new Wipro SEs")!;
    act(() => held.actions!.spam([target.id]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reported as spam", expect.objectContaining({ duration: 5000, action: expect.objectContaining({ label: "Undo" }) })));
    const moved = mockMessages.find((m) => m.subject === "Partner portal access for two new Wipro SEs")!;
    expect(moved.parentFolderId).toBe("f-junk");
    expect(moved.id).not.toBe(target.id);
    const [, opts] = lastSuccess();
    act(() => opts!.action!.onClick());
    await waitFor(() => expect(mockMessages.find((m) => m.subject === "Partner portal access for two new Wipro SEs")!.parentFolderId).toBe("f-inbox"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Moved back to Inbox"));
    // Not spam from the Spam folder: the same, the other way round.
    const junk = mockMessages.find((m) => m.parentFolderId === "f-junk")!;
    act(() => held.actions!.notSpam([junk.id]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Marked as not spam", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })));
    expect(mockMessages.find((m) => m.subject === junk.subject)!.parentFolderId).toBe("f-inbox");
  });
});
