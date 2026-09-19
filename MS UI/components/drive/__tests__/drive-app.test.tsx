import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

// URL state store the next/navigation mock reads from and writes to.
const nav = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (href: string) => {
      search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      listeners.forEach((l) => l());
    },
    sub: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/onedrive/",
    useRouter: () => ({ push: nav.set, replace: nav.set }),
    useSearchParams: () => {
      const s = React.useSyncExternalStore(nav.sub, nav.get, nav.get);
      return new URLSearchParams(s);
    },
  };
});
vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({
    instance: { getActiveAccount: () => ({ homeAccountId: "acc-1" }), getAllAccounts: () => [{ homeAccountId: "acc-1" }] },
    accounts: [{ homeAccountId: "acc-1" }],
  }),
}));

import { DriveApp } from "../drive-app";

beforeAll(() => {
  localStorage.setItem("msui.mock", "1");
  class IO {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = IO;
  Element.prototype.scrollIntoView = () => {};
});

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DriveApp />
    </QueryClientProvider>
  );
}

describe("DriveApp (mock mode)", () => {
  it("renders the mock tree at root, opens a folder and updates the breadcrumb", async () => {
    nav.set("/onedrive/");
    renderApp();
    const gsi = await screen.findByText("GSI Program", {}, { timeout: 5000 });
    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText("Weekly Reports")).toBeInTheDocument();
    fireEvent.doubleClick(gsi);
    await screen.findByText("Accenture", {}, { timeout: 5000 });
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByText("GSI Program")).toHaveAttribute("aria-current", "page");
    expect(nav.get()).toContain("folder=");
    // Backspace goes up a level.
    fireEvent.keyDown(window, { key: "Backspace" });
    await waitFor(() => expect(nav.get()).not.toContain("folder="));
  });

  it("creates a new folder with the n shortcut and shows it in the listing", async () => {
    nav.set("/onedrive/");
    renderApp();
    await screen.findByText("Personal", {}, { timeout: 5000 });
    fireEvent.keyDown(window, { key: "n" });
    const input = await screen.findByLabelText("Name");
    fireEvent.change(input, { target: { value: "Partner kits" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Partner kits", {}, { timeout: 5000 });
  });

  it("switches to a type repo view via the left panel", async () => {
    nav.set("/onedrive/");
    renderApp();
    await screen.findByText("Personal", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Sheets" }));
    await screen.findByText("Content calendar 2026.xlsx", {}, { timeout: 5000 });
    expect(screen.queryByText("GSI program charter.docx")).not.toBeInTheDocument();
    expect(nav.get()).toContain("repo=sheets");
  });
});
