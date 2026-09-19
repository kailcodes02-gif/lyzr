import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers";

test.describe("Outlook (Gmail layout) in demo mode", () => {
  test("inbox lists messages, opens a thread, star and archive work", async ({ page }) => {
    const errors = await openDemo(page, "/MS/outlook/");
    const rows = page.getByRole("row").or(page.getByTestId("message-row"));
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(5);
    const first = rows.first();
    const subject = (await first.textContent()) ?? "";
    await first.click();
    await expect(page).toHaveURL(/[?&]c=/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(subject.length).toBeGreaterThan(0);
    // star from the reading pane toolbar, then archive returns to the list
    await page.getByRole("button", { name: /^(star|unstar)$/i }).first().click();
    await page.getByRole("button", { name: /^archive$/i }).first().click();
    await expect(page).not.toHaveURL(/[?&]c=/);
    expect(errors.filter((e) => !/hydrat/i.test(e))).toEqual([]);
  });

  test("compose drawer opens, accepts a recipient, and sends with undo", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("button", { name: /compose/i }).click();
    const to = page.getByPlaceholder(/recipients|^to$/i).first();
    await to.fill("siva@lyzr.ai");
    await to.press("Enter");
    await page.getByPlaceholder(/subject/i).fill("Playwright test mail");
    await page.locator('[contenteditable="true"]').first().fill("Hello from the demo.");
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText(/undo/i).first()).toBeVisible();
  });

  test("folders rail navigates and search filters", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("link", { name: /^sent/i }).or(page.getByRole("button", { name: /^sent/i })).first().click();
    await expect(page).toHaveURL(/f=sent/i);
    await page.keyboard.press("/");
    await page.keyboard.type("report");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=report/);
  });
});
