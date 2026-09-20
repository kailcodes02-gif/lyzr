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

test.describe("Calendar: other calendars, colleague overlays, people suggestions", () => {
  test("subscribes to Siva from Other calendars + and sees his blocks on the week", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await expect(page.getByText("Other calendars")).toBeVisible();
    await page.getByRole("button", { name: "Add other calendars" }).click();
    await page.getByRole("menuitem", { name: /subscribe to a colleague/i }).click();
    const picker = page.getByRole("dialog").getByPlaceholder("Add people");
    await picker.click();
    await page.keyboard.type("siva");
    await page.getByRole("option", { name: /Siva Surendira/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByTestId("colleague-row").filter({ hasText: "Siva Surendira" })).toBeVisible();
    // Siva's calendar is shared with details, so his subjects (or at least Busy blocks) show in the grid.
    await expect(page.locator(".msui-ev-colleague").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".msui-ev-colleague").first().click();
    await expect(page.getByTestId("colleague-detail")).toContainText("Siva Surendira");
  });

  test("quick-create guests field suggests Lyzr people with job titles", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await page.getByRole("button", { name: /^create$/i }).click();
    await page.getByPlaceholder("Add guests").click();
    await page.keyboard.type("ani");
    const option = page.getByRole("option", { name: /Anirudh Narayan/ }).first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    await expect(option).toContainText("GSI Partnerships Lead");
    await option.click();
    await expect(page.getByText("Find a time")).toBeVisible();
  });
});

test.describe("Calendar: freshness, colours, Teams default (not yet run: no next build/dev in this task)", () => {
  test("shows when the calendar was last updated and refreshes on demand", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await expect(page.getByText(/GSI weekly sync/i).first()).toBeVisible({ timeout: 15_000 });
    const ago = page.getByTestId("updated-ago");
    await expect(ago).toHaveText(/Updated (just now|\d+s ago)/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(ago).toHaveText(/Updating|Updated just now/, { timeout: 10_000 });
  });

  test("an event created in Outlook appears through polling, without a reload", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=day");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    await expect(page.getByText("Added in Outlook").first()).toBeAttached({ timeout: 40_000 });
    // The mock materialises it 20 s after boot and only through the delta; a 15 s poll picks it up.
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test("my calendars are blue, a calendar shared with me is not", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Show Calendar\b/ })).toHaveCSS("background-color", "rgb(26, 115, 232)");
    await expect(page.getByRole("checkbox", { name: /^Show GSI Events\b/ })).toHaveCSS("background-color", "rgb(66, 133, 244)");
    await expect(page.getByText("Other calendars")).toBeVisible();
    const shared = page.getByRole("checkbox", { name: /^Show Siva Surendira\b/ }).first();
    await expect(shared).toBeVisible();
    await expect(shared).not.toHaveCSS("background-color", "rgb(26, 115, 232)");
    await expect(shared).not.toHaveCSS("background-color", "rgb(66, 133, 244)");
  });

  test("adding a guest defaults the Teams meeting switch on; it can be turned off", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await page.getByRole("button", { name: /^create$/i }).click();
    const teams = page.getByRole("switch", { name: "Add Teams meeting" });
    await expect(teams).toHaveAttribute("aria-checked", "false");
    await page.getByPlaceholder("Add guests").click();
    await page.keyboard.type("siva");
    await page.getByRole("option", { name: /Siva Surendira/ }).first().click();
    await expect(teams).toHaveAttribute("aria-checked", "true");
    await teams.click();
    await expect(teams).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("Calendar: narrow widths and search deep links (not yet run: no next build/dev in this task)", () => {
  test("below 900px the left panel is a drawer behind the menu button and Create stays reachable", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await openDemo(page, "/MS/calendar/?view=day");
    await expect(page.getByTestId("calendar-left-panel")).toBeHidden();
    await expect(page.getByRole("button", { name: "Create event" })).toBeVisible();
    await page.getByRole("button", { name: "Calendars" }).click();
    await expect(page.getByTestId("calendar-left-panel")).toBeVisible();
    await expect(page.getByText("GSI Events")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("calendar-left-panel")).toBeHidden();
  });

  test("typing in search writes ?q back to the URL and clearing removes it", async ({ page }) => {
    await openDemo(page, "/MS/calendar/?view=week");
    await expect(page.getByText("GSI Events")).toBeVisible();
    await page.getByLabel("Search events").fill("weekly");
    await expect(page).toHaveURL(/q=weekly/);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).not.toHaveURL(/q=/);
  });
});
