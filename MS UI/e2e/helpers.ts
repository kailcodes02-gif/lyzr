import { expect, type Page } from "@playwright/test";

// Enters demo mode from the sign-in page and lands on Outlook.
export async function openDemo(page: Page, path = "/MS/outlook/") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|ERR_CONNECTION|net::|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/MS/login/?mock=1`);
  await page.waitForURL(/\/MS\/outlook\//, { timeout: 30_000 });
  if (path !== "/MS/outlook/") await page.goto(path);
  await expect(page.getByText(/Application error/i)).toHaveCount(0);
  return errors;
}
