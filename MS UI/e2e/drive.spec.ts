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
