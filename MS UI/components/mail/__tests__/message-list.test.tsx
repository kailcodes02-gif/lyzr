import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { handleMail } from "@/lib/mock/mail";

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
    graphBatch: vi.fn(async (_i: unknown, _s: unknown, reqs: { id: string; method: string; url: string; body?: unknown }[]) => Promise.all(reqs.map(async (r) => ({ id: r.id, status: 200, body: await run(r.url, r.method, r.body) })))),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { flattenPages, useMessageActions, useMessageList } from "@/lib/mail/hooks";
import { groupThreads } from "@/lib/mail/logic";
import { ThreadRow } from "../message-list";

function Harness() {
  const list = useMessageList("inbox", "focused");
  const actions = useMessageActions();
  const threads = groupThreads(flattenPages(list.data));
  if (list.isPending) return <p>loading</p>;
  if (list.isError) return <p>error {String(list.error)}</p>;
  // The virtualiser needs layout, which jsdom lacks; render the rows it would mount.
  return (
    <div role="grid">
      {threads.map((t) => (
        <ThreadRow key={t.conversationId} thread={t} selected={false} focused={false} onOpen={() => {}} onToggleSelect={() => {}} actions={actions} />
      ))}
    </div>
  );
}

describe("MessageList with the mock inbox", () => {
  it("renders mock inbox conversations and toggles a star optimistically", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(5);
    expect(screen.getByText(/Accenture x Lyzr: joint webinar/)).toBeInTheDocument();
    // TCS legal review thread is flagged in the fixtures.
    const unstar = screen.getAllByRole("button", { name: "Unstar" });
    expect(unstar.length).toBeGreaterThan(0);
    const before = unstar.length;
    fireEvent.click(unstar[0]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Unstar" }).length).toBe(before - 1));
  });
});
