import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers";

test.describe("Calendar (Google Calendar layout) in demo mode", () => {
  test("renders the week, switches views, opens an event", async ({ page }) => {
    const errors = await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText(/GSI weekly sync/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("combobox", { name: "View" }).click();
    await page.getByRole("option", { name: /^month$/i }).click();
    await expect(page).toHaveURL(/view=month/);
    await page.getByText(/GSI weekly sync/i).first().click();
    await expect(page.getByRole("dialog").or(page.getByText(/organizer/i)).first()).toBeVisible();
    expect(errors.filter((e) => !/hydrat/i.test(e))).toEqual([]);
  });

  test("creates an event from the Create button", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await expect(page.getByText(/Marketing standup/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /^create$/i }).click();
    await page.getByPlaceholder(/add title|title/i).first().fill("Playwright standup");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/event created/i)).toBeVisible();
    await expect(page.getByText("Playwright standup").first()).toBeAttached();
  });
});
