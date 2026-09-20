import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Calendar } from "@/components/ui/calendar";

describe("mini month header alignment", () => {
  it("renders 7 weekday header cells with the same fixed width class as the day cells", () => {
    const { container } = render(<Calendar mode="single" month={new Date(2026, 8, 20)} selected={new Date(2026, 8, 20)} showOutsideDays />);
    const ths = Array.from(container.querySelectorAll("thead th"));
    expect(ths).toHaveLength(7);
    for (const th of ths) {
      expect(th.className).toContain("w-(--cell-size)");
      expect(th.className).toContain("shrink-0");
    }
    const firstWeek = container.querySelector("tbody tr");
    const tds = Array.from(firstWeek?.querySelectorAll("td") ?? []);
    expect(tds).toHaveLength(7);
    for (const td of tds) expect(td.className).toContain("w-(--cell-size)");
    // thead and tbody are laid out as blocks so both rows share the same flex geometry.
    expect(container.querySelector("table")?.className).toMatch(/\[&_thead\]:block/);
    expect(container.querySelector("[data-today]")).toBeTruthy();
  });
});
