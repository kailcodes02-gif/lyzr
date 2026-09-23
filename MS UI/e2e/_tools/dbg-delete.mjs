import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/MS/login/?mock=1"); await page.waitForURL(/outlook/);
const box = page.getByRole("combobox", { name: /search mail/i }); await box.click(); await page.keyboard.type("Wipro"); await page.keyboard.press("Enter");
await page.waitForURL(/q=Wipro/); await page.waitForTimeout(800);
for (const subj of ["Weekly GSI report: Sep 8 to Sep 14", "Partner portal access for two new Wipro SEs"]) {
  const row = page.getByRole("row").filter({ hasText: subj }); await row.hover();
  await row.getByRole("checkbox").first().click();
}
await page.getByRole("button", { name: /^delete$/i }).first().click();
await page.waitForTimeout(4500);
const hits = await page.getByText(/Move failed|has to be unique in a batch/).evaluateAll(els => els.map(e => e.outerHTML.slice(0, 300)));
console.log("matches:", hits.length); hits.forEach(h => console.log(" -", h));
console.log("toasts:", await page.locator("[data-sonner-toast]").allTextContents());
await browser.close();
