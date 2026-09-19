import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers";

test("sign-in page renders and demo mode reaches all three apps", async ({ page }) => {
  await page.goto("/MS/login/?mock=0");
  await expect(page.getByRole("button", { name: /Sign in with Microsoft/ })).toBeVisible();
  await page.getByRole("button", { name: /Try the demo/ }).click();
  await page.waitForURL(/\/MS\/outlook\//);
  await expect(page.getByRole("link", { name: "OneDrive" })).toBeVisible();
  await page.getByRole("link", { name: "OneDrive" }).click();
  await page.waitForURL(/\/MS\/onedrive\//);
  await page.getByRole("link", { name: "Calendar" }).click();
  await page.waitForURL(/\/MS\/calendar\//);
  await expect(page.getByText(/Application error/i)).toHaveCount(0);
});

test("redirect bridge page without a payload falls back to login", async ({ page }) => {
  await page.goto("/MS/redirect/");
  await page.waitForURL(/\/MS\/login\//, { timeout: 40_000 });
});

test("demo mode survives a reload and sign-out clears it", async ({ page }) => {
  const errors = await openDemo(page);
  await page.reload();
  await page.waitForURL(/\/MS\/outlook\//);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/MS\/login\//);
  expect(errors.filter((e) => !/hydrat/i.test(e))).toEqual([]);
});
