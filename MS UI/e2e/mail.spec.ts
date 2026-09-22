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

test.describe("Labels, filters and inbox tabs in demo mode", () => {
  test("clicking label GSI opens the label view with only GSI rows", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("link", { name: "Label GSI" }).click();
    await expect(page).toHaveURL(/f=label(%3A|:)GSI/);
    await expect(page.getByRole("link", { name: "Label GSI" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Label view GSI")).toBeVisible();
    const rows = page.getByRole("row");
    await expect(rows.first()).toBeVisible();
    await expect.poll(() => rows.count()).toBeGreaterThan(2);
    await expect(rows.filter({ hasNotText: "GSI" })).toHaveCount(0);
    // Accenture partner agreement lives in a subfolder and still shows in the label view.
    await expect(page.getByText(/Accenture partner agreement countersigned/)).toBeVisible();
  });

  test("creating a label with a From domain backfills the Accenture thread", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("button", { name: "New label" }).click();
    await page.getByLabel("Label name").fill("Accenture");
    await page.getByLabel("From addresses or domains").fill("@accenture.com");
    await page.getByLabel("From addresses or domains").press("Enter");
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/labelled "Accenture"/)).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Accenture x Lyzr: joint webinar" });
    await expect(row).toContainText("Accenture");
    await page.getByRole("link", { name: "Label Accenture" }).click();
    await expect(page).toHaveURL(/f=label(%3A|:)Accenture/);
    await expect(page.getByRole("row").first()).toBeVisible();
  });

  test("Social tab shows a LinkedIn row after inbox sorting is enabled", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await expect(page.getByRole("tab", { name: /primary/i })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Turn on inbox sorting" }).click();
    await expect(page.getByText(/Inbox sorting on/)).toBeVisible();
    await page.getByRole("tab", { name: /social/i }).click();
    await expect(page).toHaveURL(/tab=social/);
    await expect(page.getByText(/reacted to your post|connection requests/).first()).toBeVisible();
    await page.getByRole("tab", { name: /promotions/i }).click();
    await expect(page).toHaveURL(/tab=promotions/);
    await expect(page.getByText(/HubSpot digest|LinkedIn Pulse|Gartner Newsletter/).first()).toBeVisible();
    await page.getByRole("tab", { name: /primary/i }).click();
    await expect(page.getByText(/Your weekly HubSpot digest/)).toHaveCount(0);
  });
});

test.describe("Preset labels and skip-the-inbox in demo mode", () => {
  test("Set up my labels moves Siva's mail under Leadership and out of Primary", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await expect(page.getByText(/Leadership offsite agenda/)).toBeVisible();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Set up my labels" }).click();
    // Five labels: categories, folders, rules, then a scan and move of matching mail.
    await expect(page.getByLabel("Result for Leadership")).toContainText(/moved out of the inbox/, { timeout: 40_000 });
    await expect(page.getByText(/labels set up/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Label Leadership" }).click();
    await expect(page).toHaveURL(/f=label(%3A|:)Leadership/);
    await expect(page.getByText(/Leadership offsite agenda/)).toBeVisible();
    // Primary no longer lists it; the Leadership folder now exists in the folder list.
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await expect(page.getByRole("tab", { name: /primary/i })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("row").first()).toBeVisible();
    await expect(page.getByText(/Leadership offsite agenda/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Leadership/ })).toBeVisible();
    // The Calendar label files into "Calendar invites": Exchange reserves the folder name "Calendar".
    await expect(page.getByRole("link", { name: /^Calendar invites/ })).toBeVisible();
    // Filters dialog summarises the move.
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByText(/then label Leadership, move to Leadership, stop other rules/).first()).toBeVisible();
  });

  test("a label with Skip the inbox creates a folder visible in the folder list and moves matching mail", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await expect(page.getByText(/Infosys Topaz partner enablement/)).toBeVisible();
    await page.getByRole("button", { name: "New label" }).click();
    await page.getByLabel("Label name").fill("Infosys");
    await page.getByLabel("From addresses or domains").fill("@infosys.com");
    await page.getByLabel("From addresses or domains").press("Enter");
    await page.getByRole("switch", { name: "Skip the inbox" }).click();
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/moved out of the inbox/)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Infosys/ })).toBeVisible();
    await expect(page.getByText(/Infosys Topaz partner enablement/)).toHaveCount(0);
    await page.getByRole("link", { name: "Label Infosys" }).click();
    await expect(page.getByText(/Infosys Topaz partner enablement/)).toBeVisible();
    // Edit reflects the switch and offers to move the mail back.
    await page.getByRole("button", { name: "Options for label Infosys" }).click();
    await page.getByRole("menuitem", { name: "Edit label" }).click();
    await expect(page.getByRole("switch", { name: "Skip the inbox" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Move this label's mail back to Inbox" })).toBeVisible();
  });
});

// Every action happens in Outlook and the UI reflects it: the demo mailbox
// files sent mail into Sent Items after a delay and delivers a new message
// 20 s after the first request, so these prove the polls, not the optimistic state.
test.describe("Actions land in Outlook and show in their folder", () => {
  test("star shows the thread in Starred; unstar takes it out again", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    const subject = "Partner portal access for two new Wipro SEs";
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Star" }).click();
    await expect(row.getByRole("button", { name: "Unstar" })).toBeVisible();
    await page.getByRole("link", { name: "Starred" }).click();
    await expect(page).toHaveURL(/f=starred/);
    const starred = page.getByRole("row").filter({ hasText: subject });
    await expect(starred).toBeVisible();
    await starred.getByRole("button", { name: "Unstar" }).click();
    // The refetch after the call settles is what removes it: the server wins.
    await expect(starred).toHaveCount(0);
    await expect(page.getByTestId("updated-ago")).toContainText(/Updated \d+s ago/);
  });

  test("delete moves the thread to Trash", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    const subject = "Design assets for Wipro landing page";
    await page.getByRole("row").filter({ hasText: subject }).click();
    await expect(page).toHaveURL(/[?&]c=/);
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page).not.toHaveURL(/[?&]c=/);
    await expect(page.getByRole("row").filter({ hasText: subject })).toHaveCount(0);
    await page.getByRole("link", { name: /^Trash/ }).click();
    await expect(page).toHaveURL(/f=deleteditems/);
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
  });

  test("report spam moves the thread to Spam and out of the Inbox", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    const subject = "Partner portal access for two new Wipro SEs";
    await page.getByRole("row").filter({ hasText: subject }).click();
    await expect(page).toHaveURL(/[?&]c=/);
    await page.getByRole("button", { name: "Report spam" }).first().click();
    await expect(page).not.toHaveURL(/[?&]c=/);
    await page.getByRole("link", { name: /^Spam/ }).click();
    await expect(page).toHaveURL(/f=junkemail/);
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await expect(page.getByRole("row").first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: subject })).toHaveCount(0);
  });

  test("send closes the composer, toasts Sent, and Sent Items shows the mail once Outlook files it", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    const subject = `Playwright freshness ${Date.now()}`;
    await page.getByRole("button", { name: /compose/i }).click();
    const to = page.getByPlaceholder(/recipients|^to$/i).first();
    await to.fill("siva@lyzr.ai");
    await to.press("Enter");
    await page.getByPlaceholder(/subject/i).fill(subject);
    await page.locator('[contenteditable="true"]').first().fill("Sent through the demo mailbox.");
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByRole("dialog", { name: "Compose message" })).toHaveCount(0);
    await expect(page.getByText(/undo/i).first()).toBeVisible();
    // Open Sent Items while the undo window is still running: the list is
    // fetched before the send, so only the poll can bring the row in.
    await page.getByRole("link", { name: /^Sent/ }).click();
    await expect(page).toHaveURL(/f=sentitems/);
    await expect(page.getByRole("row").first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: subject })).toHaveCount(0);
    // 5 s undo window, then the send call, then the toast.
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /^Sent$/ })).toBeVisible({ timeout: 15_000 });
    // The demo keeps sent mail in the Outbox for 3 s; the Sent Items poll (every 2 s) files it into the open list.
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible({ timeout: 15_000 });
  });

  test("mail that reaches Outlook after the page loaded shows in the Inbox without a reload", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await expect(page.getByRole("row").first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Arrived from Outlook" })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "Arrived from Outlook" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("link", { name: /^Inbox/ })).toContainText(/\d+/);
  });
});
