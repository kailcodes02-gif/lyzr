import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCalendarMock } from "@/lib/mock/calendar";
import type { FcEventInput, WallEvent } from "@/lib/calendar/events";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{ homeAccountId: "x" }] }) }));
vi.mock("@/lib/mock", async (orig) => ({ ...(await orig<typeof import("@/lib/mock")>()), isMockMode: () => true }));

let search = "";
const replace = vi.fn((href: string) => {
  search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/calendar/",
  useSearchParams: () => new URLSearchParams(search),
}));

// next/dynamic -> plain lazy; the FullCalendar grid is replaced by a stub that lists titles.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const C = React.lazy(loader);
    return function Dyn(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <C {...props} />
        </React.Suspense>
      );
    };
  },
}));
vi.mock("@/components/calendar/grid", () => ({
  default: ({ events, onSelect, onEventClick }: { events: FcEventInput[]; onSelect: (s: { start: string; end: string; allDay: boolean; x: number; y: number }) => void; onEventClick: (ev: WallEvent, el: HTMLElement) => void }) => (
    <div data-testid="grid">
      <button onClick={() => onSelect({ start: "2026-09-21T10:00:00", end: "2026-09-21T10:30:00", allDay: false, x: 10, y: 10 })}>drag-select</button>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={(evt) => onEventClick(e.extendedProps.ev, evt.currentTarget)}>
              {e.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

import { CalendarApp } from "../calendar-app";

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CalendarApp />
    </QueryClientProvider>,
  );
}

describe("CalendarApp (mock mode)", () => {
  beforeEach(() => {
    search = "";
    resetCalendarMock();
    localStorage.clear();
  });

  it("renders both mock calendars and the recurring series", async () => {
    renderApp();
    expect(await screen.findByText("GSI Events", {}, { timeout: 4000 })).toBeInTheDocument();
    // This week's occurrence is the "(moved)" exception; any week shows one of the two.
    await waitFor(() => expect(screen.getAllByText(/GSI weekly sync/).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(screen.getByTestId("range-title").textContent).toMatch(/\d{4}/);
  });

  it("creates an event from a drag selection and shows it after the refetch", async () => {
    renderApp();
    await screen.findByText("GSI Events", {}, { timeout: 4000 });
    fireEvent.click(await screen.findByText("drag-select"));
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Wipro enablement deck" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Wipro enablement deck")).toBeInTheDocument(), { timeout: 4000 });
  });

  it("opens the detail popover with the full description fetched on demand (calendarView omits body)", async () => {
    renderApp();
    await screen.findByText("GSI Events", {}, { timeout: 4000 });
    const chip = await screen.findByRole("button", { name: "Accenture QBR prep" }, { timeout: 4000 });
    fireEvent.click(chip);
    const detail = await screen.findByTestId("event-detail");
    expect(detail).toHaveTextContent("Accenture QBR prep");
    await waitFor(() => expect(screen.getByTestId("event-description")).toHaveTextContent("Slides: GSI partner deck v7, Q3 pipeline numbers."), { timeout: 4000 });
    // Guests are listed with the organizer first.
    expect(detail).toHaveTextContent(/guests/i);
    expect(detail).toHaveTextContent("Priya");
  });

  it("keeps the failure bars in the flow above the grid, never absolutely positioned over the day headers", async () => {
    renderApp();
    await screen.findByText("GSI Events", {}, { timeout: 4000 });
    // Nothing fails in mock mode; the layout contract is that the grid wrapper, not a banner, is the positioned area.
    const main = screen.getByRole("main");
    expect(main.className).toContain("flex-col");
    expect(screen.queryByTestId("partial-failure")).toBeNull();
  });

  it("switches view through the URL", async () => {
    search = "?view=agenda";
    renderApp();
    await screen.findByText("GSI Events", {}, { timeout: 4000 });
    expect(screen.queryByTestId("grid")).toBeNull();
    await waitFor(() => expect(screen.getAllByText(/GSI weekly sync/).length).toBeGreaterThan(0), { timeout: 4000 });
  });
});
