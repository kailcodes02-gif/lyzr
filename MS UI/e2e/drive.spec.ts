import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers";

test.describe("OneDrive (Google Drive layout) in demo mode", () => {
  test("shows folders, opens one, breadcrumb updates, type views filter", async ({ page }) => {
    const errors = await openDemo(page, "/MS/onedrive/");
    await expect(page.getByText(/my files/i).first()).toBeVisible();
    const folder = page.getByText(/GSI Program/).first();
    await expect(folder).toBeVisible();
    await folder.dblclick();
    await expect(page).toHaveURL(/folder=/);
    await expect(page.getByRole("navigation", { name: /breadcrumb/i }).getByText(/GSI Program/)).toBeVisible();
    await page.getByRole("link", { name: /^sheets$/i }).or(page.getByRole("button", { name: /^sheets$/i })).first().click();
    await expect(page).toHaveURL(/repo=sheets/);
    await expect(page.getByText(/\.xlsx/i).first()).toBeVisible();
    expect(errors.filter((e) => !/hydrat/i.test(e))).toEqual([]);
  });

  test("new folder is created and appears", async ({ page }) => {
    await openDemo(page, "/MS/onedrive/");
    await page.getByRole("button", { name: /^new$/i }).click();
    await page.getByRole("menuitem", { name: /new folder/i }).click();
    await page.getByRole("textbox").last().fill("Playwright Folder");
    await page.getByRole("button", { name: /create|ok/i }).click();
    await expect(page.getByText("Playwright Folder").first()).toBeVisible();
  });

  test("preview opens for a file and closes with Escape", async ({ page }) => {
    await openDemo(page, "/MS/onedrive/");
    await page.getByRole("link", { name: /^pdfs$/i }).or(page.getByRole("button", { name: /^pdfs$/i })).first().click();
    await page.getByText(/\.pdf/i).first().dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test("double-clicking a PowerPoint file opens it in PowerPoint (demo explains instead of navigating)", async ({ page }) => {
  await openDemo(page, "/MS/onedrive/?repo=slides");
  await page.getByText(/\.pptx/i).first().dblclick();
  await expect(page.getByText(/would open .* in PowerPoint/i)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// Live refresh: the demo's OneDrive gains a file 20 s after the first delta
// walk, as if a colleague added it in OneDrive itself. The visible-tab
// delta poll (every ~30 s) shows it without any action in this UI.
test("a file added in OneDrive appears without a manual refresh, and the freshness indicator ticks", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "/MS/onedrive/");
  await page.getByText(/GSI Program/).first().dblclick();
  await expect(page.getByText("Added in OneDrive.pdf")).toHaveCount(0);
  await expect(page.getByTestId("drive-updated")).toContainText(/Updated|Updating/);
  await expect(page.getByRole("button", { name: /^refresh$/i })).toBeVisible();
  await expect(page.getByText("Added in OneDrive.pdf").first()).toBeVisible({ timeout: 75_000 });
});

test("the Refresh button refetches from OneDrive at once", async ({ page }) => {
  await openDemo(page, "/MS/onedrive/");
  // Let the indicator age past "just now" so the click is what resets it.
  await expect(page.getByTestId("drive-updated")).toContainText(/Updated \d+s ago/, { timeout: 15_000 });
  await page.getByRole("button", { name: /^refresh$/i }).click();
  await expect(page.getByTestId("drive-updated")).toContainText(/just now/, { timeout: 10_000 });
});
