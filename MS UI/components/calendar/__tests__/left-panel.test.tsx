import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [{ homeAccountId: "x" }] }) }));
vi.mock("@/lib/mock", async (orig) => ({ ...(await orig<typeof import("@/lib/mock")>()), isMockMode: () => true }));

import { colleagueDetailText, LeftPanel } from "../left-panel";

const cal = { id: "cal-default", name: "Calendar", isDefaultCalendar: true, canEdit: true };
const uk = { id: "cal-uk", name: "United Kingdom holidays", canEdit: false };

function renderPanel(extra: Partial<React.ComponentProps<typeof LeftPanel>> = {}) {
  return render(
    <LeftPanel
      date="2026-09-22"
      onDate={() => {}}
      weekStartsOn={1}
      calendars={[cal]}
      otherCalendars={[{ cal: uk, groupName: "Other calendars", ownerName: "" }]}
      hidden={new Set()}
      onToggle={() => {}}
      onCreate={() => {}}
      loading={false}
      createRef={React.createRef<HTMLButtonElement>()}
      {...extra}
    />,
  );
}

describe("left panel: failed calendars and colleague detail levels", () => {
  it("shows 'Could not load' with a Retry that refetches for a calendar whose view failed", () => {
    const onRetryCalendar = vi.fn();
    renderPanel({ failed: new Map([["cal-uk", "ApplicationThrottled: Application is over its MailboxConcurrency limit"]]), onRetryCalendar });
    const row = screen.getAllByTestId("calendar-row").find((r) => r.getAttribute("data-failed") === "true")!;
    expect(row).toHaveTextContent("United Kingdom holidays");
    expect(row).toHaveTextContent("Could not load");
    fireEvent.click(screen.getByRole("button", { name: "Retry United Kingdom holidays" }));
    expect(onRetryCalendar).toHaveBeenCalledTimes(1);
  });

  it("warns when only busy/free is available for a colleague and notes limited details", () => {
    const people = [
      { name: "Siva Surendira", email: "siva@lyzr.ai", color: "#0b8043" },
      { name: "Anirudh Narayan", email: "anirudh@lyzr.ai", color: "#8e24aa" },
      { name: "Priya Raman", email: "priya@lyzr.ai", color: "#d50000" },
    ];
    renderPanel({
      colleagues: people,
      colleagueDetails: new Map([
        ["siva@lyzr.ai", "full"],
        ["anirudh@lyzr.ai", "busy"],
        ["priya@lyzr.ai", "limited"],
      ]),
    });
    const rows = screen.getAllByTestId("colleague-row");
    const byEmail = (e: string) => rows.find((r) => r.getAttribute("data-email") === e)!;
    expect(byEmail("siva@lyzr.ai")).not.toHaveTextContent(/busy\/free only/i);
    expect(byEmail("siva@lyzr.ai")).toHaveTextContent("siva@lyzr.ai");
    expect(byEmail("anirudh@lyzr.ai")).toHaveTextContent(/busy\/free only/i);
    expect(byEmail("anirudh@lyzr.ai").querySelector('[aria-label="Warning"]')).not.toBeNull();
    expect(byEmail("priya@lyzr.ai")).toHaveTextContent(/limited details/i);
    expect(colleagueDetailText("none")).toBeNull();
    expect(colleagueDetailText(undefined)).toBeNull();
  });
});
