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
  test("clicking label GSI opens the folder-backed label view: the folder's mail plus labelled mail elsewhere", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("link", { name: "Label GSI" }).click();
    await expect(page).toHaveURL(/f=label(%3A|:)GSI/);
    await expect(page.getByRole("link", { name: "Label GSI" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Label view GSI")).toBeVisible();
    // Fix 4: the header names the backing folder and its count (3 messages sit in the GSI folder).
    await expect(page.getByLabel("Backing folder")).toContainText("Folder: GSI");
    await expect(page.getByLabel("Label view GSI")).toContainText("3 in folder");
    const rows = page.getByRole("row");
    await expect(rows.first()).toBeVisible();
    await expect.poll(() => rows.count()).toBeGreaterThan(4);
    // Moved into the folder without the category (an Outlook rule that stamped nothing) still lists.
    await expect(page.getByText(/GSI enablement: Wipro SE cohort dates/)).toBeVisible();
    // Stamped mail in the folder and in the inbox both list.
    await expect(page.getByText(/GSI partner day: booth and speaking slot/)).toBeVisible();
    await expect(page.getByText(/TCS co-sell deck: legal review complete/)).toBeVisible();
    // Accenture partner agreement lives in a subfolder and still shows (categories query accepted by the demo).
    await expect(page.getByText(/Accenture partner agreement countersigned/)).toBeVisible();
    // Open folder lands on the plain folder view.
    await page.getByRole("link", { name: "Open folder" }).click();
    await expect(page).toHaveURL(/f=f-gsi/);
    await expect(page.getByText(/GSI enablement: Wipro SE cohort dates/)).toBeVisible();
    await expect(page.getByText(/TCS co-sell deck: legal review complete/)).toHaveCount(0);
  });

  test("creating a label with a From domain (kept in the inbox) backfills the Accenture thread", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("button", { name: "New label" }).click();
    await page.getByLabel("Label name").fill("Accenture");
    await page.getByLabel("Condition 1 value").fill("@accenture.com");
    await page.getByLabel("Condition 1 value").press("Enter");
    // Outlook's phrasing, live.
    await expect(page.getByLabel("Rule preview")).toContainText("Apply this rule after the message arrives: with '@accenture.com' in the sender's address, move it to the Accenture folder");
    // "Only in this label" is on by default; this label stays in the inbox.
    await expect(page.getByRole("switch", { name: "Only in this label" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("switch", { name: "Only in this label" }).click();
    await expect(page.getByLabel("Rule preview")).toContainText("assign it to the Accenture category");
    await expect(page.getByLabel("Rule preview")).not.toContainText("move it to");
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/labelled "Accenture"/)).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Accenture x Lyzr: joint webinar" });
    await expect(row).toContainText("Accenture");
    await page.getByRole("link", { name: "Label Accenture" }).click();
    await expect(page).toHaveURL(/f=label(%3A|:)Accenture/);
    await expect(page.getByRole("row").first()).toBeVisible();
  });

  test("a label with two any-of conditions and an exception: Outlook sentence in Filters, matching mail only under the label", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await expect(page.getByText(/Design assets for Wipro landing page/)).toBeVisible();
    await expect(page.getByText(/Partner portal access for two new Wipro SEs/)).toBeVisible();
    await page.getByRole("button", { name: "New label" }).click();
    await page.getByLabel("Label name").fill("Wipro");
    await page.getByLabel("Condition 1 value").fill("@wipro.com");
    await page.getByLabel("Condition 1 value").press("Enter");
    await page.getByRole("button", { name: "Add condition" }).click();
    await page.getByLabel("Condition 2 type").selectOption("subjectContains");
    await page.getByLabel("Condition 2 value").fill("ai360");
    await page.getByLabel("Condition 2 value").press("Enter");
    await page.getByRole("button", { name: "Add exception" }).click();
    await page.getByLabel("Exception 1 type").selectOption("subjectContains");
    await page.getByLabel("Exception 1 value").fill("Partner portal");
    await page.getByLabel("Exception 1 value").press("Enter");
    await expect(page.getByLabel("Rule preview")).toContainText("with '@wipro.com' in the sender's address or with 'ai360' in the subject, except if with 'Partner portal' in the subject, move it to the Wipro folder and assign it to the Wipro category and stop processing more rules");
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/moved out of the inbox/)).toBeVisible();
    // The exception kept the portal-access mail in Primary; the design assets mail left.
    await expect(page.getByText(/Design assets for Wipro landing page/)).toHaveCount(0);
    await expect(page.getByText(/Partner portal access for two new Wipro SEs/)).toBeVisible();
    await page.getByRole("link", { name: "Label Wipro" }).click();
    await expect(page.getByText(/Design assets for Wipro landing page/)).toBeVisible();
    await expect(page.getByText(/Wipro ai360: campaign launch checklist/)).toBeVisible();
    await expect(page.getByText(/Partner portal access for two new Wipro SEs/)).toHaveCount(0);
    // Two rules (any-of), each with the exception, phrased as Outlook does.
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByText("Label: Wipro (sender keywords)")).toBeVisible();
    await expect(page.getByText("Label: Wipro (subject)")).toBeVisible();
    await expect(page.getByText("Apply this rule after the message arrives: with '@wipro.com' in the sender's address, except if with 'Partner portal' in the subject, move it to the Wipro folder and assign it to the Wipro category and stop processing more rules")).toBeVisible();
    // Diagnostics: every strategy reports a count for the new label.
    await page.getByText("Diagnostics", { exact: true }).click();
    await page.getByLabel("Diagnose label").selectOption("Wipro");
    await page.getByRole("button", { name: "Run diagnostics" }).click();
    await expect(page.getByLabel("Diagnostic folder", { exact: true })).toContainText(/\d+ messages in "Wipro"/);
    await expect(page.getByLabel("Diagnostic filter", { exact: true })).toContainText(/\d+ messages/);
    await expect(page.getByLabel("Diagnostic folder+enrichment", { exact: true })).toContainText(/\d+ messages/);
    await page.keyboard.press("Escape");
    // Edit label round-trips both rows and the exception.
    await page.getByRole("button", { name: "Options for label Wipro" }).click();
    await page.getByRole("menuitem", { name: "Edit label" }).click();
    await expect(page.getByLabel("Condition 1 type")).toHaveValue("fromContains");
    await expect(page.getByLabel("Condition 2 type")).toHaveValue("subjectContains");
    await expect(page.getByLabel("Exception 1 type")).toHaveValue("subjectContains");
    await expect(page.getByRole("group", { name: "Exception 1" })).toContainText("Partner portal");
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

test.describe("Move to tab, always for this sender, and print in demo mode", () => {
  test("Mayuri's LinkedIn mail moves from Social to Primary and Yes keeps it there with a visible rule", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    const subject = "Partner marketing slot at LinkedIn Talent Connect";
    await page.getByRole("button", { name: "Turn on inbox sorting" }).click();
    await expect(page.getByText(/Inbox sorting on/)).toBeVisible();
    await page.getByRole("tab", { name: /social/i }).click();
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row).toBeVisible();
    await row.hover();
    await row.getByRole("button", { name: "Move to tab" }).click();
    await page.getByRole("menuitem", { name: "Primary" }).click();
    await expect(page.getByText(/Moved to Primary\. Do this for all mail from mayuri\.murthy@linkedin\.com\?/)).toBeVisible();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByText(/will always stay in Primary/)).toBeVisible();
    // Gone from Social (the refetch after the PATCH settles is what removes it), listed in Primary.
    await expect(row).toHaveCount(0);
    await page.getByRole("tab", { name: /primary/i }).click();
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
    // The rule shows in Filters with a plain summary and can be deleted there.
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByText("Sorting: Primary (mayuri.murthy@linkedin.com)")).toBeVisible();
    await expect(page.getByText("Always keep mail from mayuri.murthy@linkedin.com in Primary.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete filter Sorting: Primary (mayuri.murthy@linkedin.com)" })).toBeEnabled();
  });

  test("bulk Move to tab sends selected Primary rows to Promotions", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    // A recent row: the list is virtualised, older rows are not in the DOM until scrolled to.
    const subject = "Webinar registration page live";
    const row = page.getByRole("row").filter({ hasText: subject });
    await row.hover();
    await row.getByRole("checkbox", { name: `Select ${subject}` }).click();
    // The toolbar's button (first in the DOM); the hovered row shows its own.
    await page.getByRole("button", { name: "Move to tab" }).first().click();
    await page.getByRole("menuitem", { name: "Promotions" }).click();
    await expect(page.getByText(/Moved to Promotions/)).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.getByRole("tab", { name: /promotions/i }).click();
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
  });

  test("Print builds a script-free print document with the headers in a hidden frame; Ctrl+P does the same", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    // Headless Chromium has no print dialog: print() is a no-op and the frame stays for inspection.
    const subject = "TCS co-sell deck: legal review complete";
    await page.getByRole("row").filter({ hasText: subject }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print" }).click();
    const frame = page.getByTestId("print-frame");
    await expect(frame).toHaveCount(1);
    const html = await frame.evaluate((el) => (el as HTMLIFrameElement).srcdoc);
    expect(html).toContain(`<h1>${subject}</h1>`);
    expect(html).toContain("<b>From</b> Rahul Verma &lt;rahul.verma@tcs.com&gt;");
    expect(html).toContain("<b>To</b>");
    expect(html).toContain("<b>Date</b>");
    expect(html).toContain("TCS-Lyzr-cosell-redline.docx");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
    // Ctrl/Cmd+P from the reading pane replaces the frame with a fresh one.
    await frame.evaluate((el) => el.setAttribute("data-old", "1"));
    await page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
    await expect(page.getByTestId("print-frame")).toHaveCount(1);
    await expect(page.locator('[data-testid="print-frame"][data-old="1"]')).toHaveCount(0);
  });

  test("Not spam in the Spam folder moves the message back to the Inbox with an Undo", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("link", { name: /^Spam/ }).click();
    await expect(page).toHaveURL(/f=junkemail/);
    const subject = "You have won a free conference pass";
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row).toBeVisible();
    // Visible without hovering: the pointer is parked elsewhere first.
    await page.mouse.move(5, 5);
    await expect(row.getByRole("button", { name: "Not spam" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Not spam" })).toContainText("Not spam");
    await row.getByRole("button", { name: "Not spam" }).click();
    await expect(page.getByText("Marked as not spam")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
  });
});

test.describe("Spam and Trash banners in demo mode", () => {
  test("an open Spam message shows the yellow banner and its Not spam button moves it to the Inbox", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("link", { name: /^Spam/ }).click();
    await expect(page).toHaveURL(/f=junkemail/);
    const subject = "You have won a free conference pass";
    await page.getByRole("row").filter({ hasText: subject }).click();
    await expect(page).toHaveURL(/[?&]c=/);
    const banner = page.getByTestId("spam-banner");
    await expect(banner).toContainText("This message is in Spam.");
    // The toolbar carries a labelled button too (icon + text).
    await expect(page.getByRole("button", { name: "Not spam" }).first()).toContainText("Not spam");
    await banner.getByRole("button", { name: "Not spam" }).click();
    await expect(page.getByText("Marked as not spam")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]c=/);
    await expect(page.getByRole("row").filter({ hasText: subject })).toHaveCount(0);
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
  });

  test("the Spam folder opened by its Graph id (not the well-known name) still shows the banner and the row buttons", async ({ page }) => {
    await openDemo(page, "/MS/outlook/?f=f-junk");
    const subject = "You have won a free conference pass";
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row.getByRole("button", { name: "Not spam" })).toBeVisible();
    await row.click();
    await expect(page.getByTestId("spam-banner")).toContainText("This message is in Spam.");
  });

  test("an open Trash message shows the Trash banner and Move to Inbox puts it back", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    const subject = "Design assets for Wipro landing page";
    await page.getByRole("row").filter({ hasText: subject }).click();
    await page.getByRole("button", { name: "Delete" }).first().click();
    await page.getByRole("link", { name: /^Trash/ }).click();
    await expect(page).toHaveURL(/f=deleteditems/);
    await page.getByRole("row").filter({ hasText: subject }).click();
    const banner = page.getByTestId("trash-banner");
    await expect(banner).toContainText("This message is in Trash.");
    await banner.getByRole("button", { name: "Move to Inbox" }).click();
    await expect(page.getByText("Moved to Inbox")).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]c=/);
    await expect(page.getByRole("row").filter({ hasText: subject })).toHaveCount(0);
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await expect(page.getByRole("row").filter({ hasText: subject })).toBeVisible();
  });
});

test.describe("Unsubscribe in demo mode", () => {
  test("a newsletter with an https List-Unsubscribe shows Unsubscribe next to the sender and opens the page in a new tab", async ({ page, context }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("row").filter({ hasText: "Your weekly HubSpot digest" }).click();
    await expect(page).toHaveURL(/[?&]c=/);
    const link = page.getByTestId("unsubscribe-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("data-source", "header");
    // Sits in the sender line, right after the address.
    await expect(page.locator("header", { has: link })).toContainText("marketing@hubspot.com");
    // The follow-up offer needs the folder list (is this copy in the Inbox?): ready once Archive is enabled.
    await expect(page.getByRole("button", { name: "Archive" }).first()).toBeEnabled();
    // The demo's hosts do not resolve: answer them so the new tab keeps its URL.
    await context.route("https://hubspot.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>unsubscribed</p>" }));
    const popup = context.waitForEvent("page");
    await link.click();
    const tab = await popup;
    await tab.waitForLoadState();
    expect(tab.url()).toMatch(/^https:\/\/hubspot\.example\/unsubscribe\?u=kailash/);
    await tab.close();
    await expect(page.getByText("Unsubscribe page opened in a new tab")).toBeVisible();
    await expect(page.getByRole("button", { name: "Move to Trash" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move to Promotions" })).toBeVisible();
  });

  test("a mailto-only List-Unsubscribe asks first, then sends the mail through Graph and files it in Sent", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("row").filter({ hasText: "LinkedIn Pulse: The rise of agentic AI" }).click();
    const link = page.getByTestId("unsubscribe-link");
    await expect(link).toBeVisible();
    let asked = "";
    page.once("dialog", (d) => {
      asked = d.message();
      void d.accept();
    });
    await link.click();
    await expect(page.getByText("Unsubscribe request sent to unsubscribe@example.com")).toBeVisible();
    expect(asked).toBe("Send an unsubscribe email to unsubscribe@example.com?");
    // The message menu offers the same action.
    await page.getByRole("button", { name: "More", exact: true }).first().click();
    await expect(page.getByRole("menuitem", { name: "Unsubscribe" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: /^Sent/ }).click();
    await expect(page.getByRole("row").filter({ hasText: "Unsubscribe" }).first()).toBeVisible();
  });

  test("a mail with no header but an Unsubscribe link in the body shows the link and opens it", async ({ page, context }) => {
    await openDemo(page, "/MS/outlook/");
    // The oldest inbox row sits below the virtualised window: reach it through search.
    const box = page.getByRole("combobox", { name: /search mail/i });
    await box.click();
    await page.keyboard.type("Product Hunt");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=Product/);
    await page.getByRole("row").filter({ hasText: "Product Hunt Daily" }).click();
    const link = page.getByTestId("unsubscribe-link");
    await expect(link).toBeVisible();
    // The tooltip names the source ("Link found in the message").
    await expect(link).toHaveAttribute("data-source", "body");
    await context.route("https://producthunt.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>unsubscribed</p>" }));
    const popup = context.waitForEvent("page");
    await link.click();
    const tab = await popup;
    await tab.waitForLoadState();
    expect(tab.url()).toMatch(/^https:\/\/producthunt\.example\/opt-out\?u=kailash/);
    await tab.close();
    await expect(page.getByText("Unsubscribe page opened in a new tab")).toBeVisible();
  });

  test("a plain mail from a person shows no Unsubscribe", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await page.getByRole("row").filter({ hasText: "Webinar registration page live" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("iframe[title='Message body']")).toBeVisible();
    await expect(page.getByTestId("unsubscribe-link")).toHaveCount(0);
  });
});

// Search results carry REST ids (Graph drops the immutable-id Prefer on
// $search) and list several messages of one conversation; the demo's $batch
// rejects a repeated request id exactly like Graph, so these prove that a
// bulk action from a search view neither mixes id formats nor repeats an id.
test.describe("Bulk actions from a search view in demo mode", () => {
  const search = async (page: import("@playwright/test").Page, text: string) => {
    const box = page.getByRole("combobox", { name: /search mail/i });
    await box.click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${text}`));
    await expect(page.getByRole("row").first()).toBeVisible();
  };
  const select = async (page: import("@playwright/test").Page, subject: string) => {
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row).toBeVisible();
    await row.hover();
    await row.getByRole("checkbox", { name: new RegExp(`^Select (Re: )?${subject}`) }).click();
  };
  // "Weekly GSI report: Sep 8 to Sep 14" matches "Wipro" through two of its messages (one conversation, two ids).
  const thread = "Weekly GSI report: Sep 8 to Sep 14";
  const single1 = "Design assets for Wipro landing page";
  const single2 = "Partner portal access for two new Wipro SEs";

  test("bulk archive of three results, one a duplicate conversation, moves every message and lands in Archive", async ({ page }) => {
    const errors = await openDemo(page, "/MS/outlook/");
    await search(page, "Wipro");
    await select(page, thread);
    await select(page, single1);
    await select(page, single2);
    await page.getByRole("button", { name: /^archive$/i }).first().click();
    await expect(page.getByText("3 conversations archived")).toBeVisible();
    await expect(page.getByText(/Move failed|has to be unique in a batch/)).toHaveCount(0);
    await page.getByRole("link", { name: /^Archive/ }).click();
    await expect(page).toHaveURL(/f=archive/);
    for (const s of [thread, single1, single2]) await expect(page.getByRole("row").filter({ hasText: s })).toBeVisible();
    // The Inbox no longer lists them (the conversation's inbox copies all moved).
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await expect(page.getByRole("row").first()).toBeVisible();
    for (const s of [thread, single1, single2]) await expect(page.getByRole("row").filter({ hasText: s })).toHaveCount(0);
    expect(errors.filter((e) => !/hydrat/i.test(e))).toEqual([]);
  });

  test("bulk delete from a search moves the results to Trash and the search no longer lists them", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await search(page, "Wipro");
    await select(page, thread);
    await select(page, single1);
    await page.getByRole("button", { name: /^delete$/i }).first().click();
    await expect(page.getByText("2 conversations moved to Trash")).toBeVisible();
    await expect(page.getByText(/Move failed|has to be unique in a batch/)).toHaveCount(0);
    // Graph's $search spans every folder, Trash included, so the rows may still be listed here.
    await expect(page.getByRole("row").filter({ hasText: single2 })).toBeVisible();
    await page.getByRole("link", { name: /^Trash/ }).click();
    await expect(page).toHaveURL(/f=deleteditems/);
    await expect(page.getByRole("row").filter({ hasText: thread })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: single1 })).toBeVisible();
  });

  test("star and label from a search result go through and show in Starred and the label view", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await search(page, "Wipro");
    const row = page.getByRole("row").filter({ hasText: single2 });
    await row.getByRole("button", { name: "Star" }).click();
    await expect(row.getByRole("button", { name: "Unstar" })).toBeVisible();
    await select(page, single2);
    await page.getByRole("button", { name: "Label as" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Urgent/ }).click();
    await expect(page.getByText(/Update failed|has to be unique in a batch/)).toHaveCount(0);
    await expect(row).toContainText("Urgent");
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Starred" }).click();
    await expect(page.getByRole("row").filter({ hasText: single2 })).toBeVisible();
    await page.getByRole("link", { name: "Label Urgent" }).click();
    await expect(page.getByRole("row").filter({ hasText: single2 })).toBeVisible();
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
    await expect(page.getByText(/move it to the Leadership folder and assign it to the Leadership category and stop processing more rules/).first()).toBeVisible();
  });

  test("a label with Skip the inbox creates a folder visible in the folder list and moves matching mail", async ({ page }) => {
    await openDemo(page, "/MS/outlook/");
    await expect(page.getByText(/Infosys Topaz partner enablement/)).toBeVisible();
    await page.getByRole("button", { name: "New label" }).click();
    await page.getByLabel("Label name").fill("Infosys");
    await page.getByLabel("Condition 1 value").fill("@infosys.com");
    await page.getByLabel("Condition 1 value").press("Enter");
    // "Only in this label" is the default for a new label.
    await expect(page.getByRole("switch", { name: "Only in this label" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/moved out of the inbox/)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Infosys/ })).toBeVisible();
    await expect(page.getByText(/Infosys Topaz partner enablement/)).toHaveCount(0);
    await page.getByRole("link", { name: "Label Infosys" }).click();
    await expect(page.getByText(/Infosys Topaz partner enablement/)).toBeVisible();
    // Edit reflects the switch and offers to move the mail back.
    await page.getByRole("button", { name: "Options for label Infosys" }).click();
    await page.getByRole("menuitem", { name: "Edit label" }).click();
    await expect(page.getByRole("switch", { name: "Only in this label" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Move this label's mail back to Inbox" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Condition 1" })).toContainText("@infosys.com");
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

test("search suggests directory people and searches from:<email>", async ({ page }) => {
  await openDemo(page, "/MS/outlook/");
  await page.getByRole("combobox", { name: /search mail/i }).click();
  await page.keyboard.type("ani");
  const list = page.getByTestId("search-suggestions");
  await expect(list.getByTestId("search-person").filter({ hasText: "Ani Sharma" })).toContainText("Solutions Engineer");
  await list.getByTestId("search-person").filter({ hasText: "Ani Sharma" }).click();
  await expect(page).toHaveURL(/q=from(%3A|:).*ani\.sharma/);
  await expect(page.getByTestId("search-chip")).toHaveText("From: Ani Sharma");
});
