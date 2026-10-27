import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
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

// Google-Drive-style New: a Word / Excel / PowerPoint file is created in the
// folder being looked at and opened in its web app (the demo explains instead).
test("New > Word document inside a folder creates it there and opens it in Word", async ({ page }) => {
  await openDemo(page, "/MS/onedrive/");
  await page.getByText(/GSI Program/).first().dblclick();
  await expect(page).toHaveURL(/folder=/);
  await page.getByRole("button", { name: /^new$/i }).click();
  await expect(page.getByRole("menuitem", { name: /excel workbook/i })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /powerpoint presentation/i })).toBeVisible();
  await page.getByRole("menuitem", { name: /word document/i }).click();
  const input = page.getByRole("textbox", { name: "Name" });
  await expect(input).toHaveValue("Document.docx");
  await input.fill("Playwright brief");
  await page.getByRole("button", { name: /^create$/i }).click();
  await expect(page.getByText(/would open "Playwright brief\.docx" in Word/i)).toBeVisible();
  await expect(page.getByText(/created in GSI Program/i)).toBeVisible();
  await expect(page.getByRole("navigation", { name: /breadcrumb/i }).getByText(/GSI Program/)).toBeVisible();
  await expect(page.getByText("Playwright brief.docx").first()).toBeVisible();
  await expect(page).toHaveURL(/folder=/);
});

test("New > Excel workbook from the Docs type view lands in My files and says so", async ({ page }) => {
  await openDemo(page, "/MS/onedrive/?repo=docs");
  await page.getByRole("button", { name: /^new$/i }).click();
  await page.getByRole("menuitem", { name: /excel workbook/i }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Book.xlsx");
  await page.getByRole("button", { name: /^create$/i }).click();
  await expect(page.getByText(/"Book\.xlsx" created in My files/i)).toBeVisible();
  await expect(page.getByText(/go to My files/i)).toBeVisible();
  await expect(page.getByText(/would open "Book\.xlsx" in Excel/i)).toBeVisible();
  await page.getByRole("button", { name: /^my files$/i }).click();
  await expect(page.getByText("Book.xlsx").first()).toBeVisible();
});

// Folder upload: the whole tree lands, nested folders included, whatever
// OneDrive would refuse is cleaned, OS clutter is left out, and a file over
// the 4 MB simple-upload limit goes through an upload session.
test.describe("folder upload keeps the whole folder", () => {
  let dir = "";
  test.beforeAll(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "msui-")), "Quarterly pack");
    const put = (rel: string, bytes: number | string = "hello") => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), typeof bytes === "number" ? Buffer.alloc(bytes) : bytes);
    };
    put("summary.txt");
    put("Decks/Q3 review.pptx");
    put("Decks/Archive/2025/old.pptx");
    put("What? notes/idea.txt");
    put(".DS_Store");
    put("big/video.bin", 5 * 1024 * 1024);
  });

  const openTree = async (page: Page, ...names: string[]) => {
    for (const n of names) await page.getByText(n, { exact: true }).first().dblclick();
  };

  test("the Folder upload input (Safari/Firefox path) uploads every file into its folders", async ({ page }) => {
    await page.addInitScript(() => { delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker; });
    await openDemo(page, "/MS/onedrive/");
    await page.getByRole("button", { name: /^new$/i }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: /folder upload/i }).click();
    await (await chooser).setFiles(dir);
    await expect(page.getByTestId("upload-tray-status")).toHaveText("5 uploads complete", { timeout: 30_000 });
    await expect(page.getByText(/Uploaded "Quarterly pack" to My files/)).toBeVisible();
    await openTree(page, "Quarterly pack");
    for (const n of ["summary.txt", "Decks", "What_ notes", "big"]) await expect(page.getByText(n, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(".DS_Store")).toHaveCount(0);
    await openTree(page, "Decks", "Archive", "2025");
    await expect(page.getByText("old.pptx", { exact: true }).first()).toBeVisible();
  });

  test("the directory picker (Chrome/Edge path) also creates empty folders", async ({ page }) => {
    await page.addInitScript(() => {
      const f = (name: string) => ({ kind: "file", name, getFile: async () => new File(["x"], name) });
      const d = (name: string, kids: unknown[]) => ({ kind: "directory", name, values: async function* () { yield* kids; } });
      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () =>
        d("Picked tree", [f("readme.md"), d("Empty one", []), d("src", [f("a.ts"), d("lib", [f("b.ts")])])]);
    });
    await openDemo(page, "/MS/onedrive/");
    await page.getByRole("button", { name: /^new$/i }).click();
    await page.getByRole("menuitem", { name: /folder upload/i }).click();
    await expect(page.getByTestId("upload-tray-status")).toHaveText("3 uploads complete", { timeout: 30_000 });
    await openTree(page, "Picked tree");
    await expect(page.getByText("Empty one", { exact: true }).first()).toBeVisible();
    await openTree(page, "src", "lib");
    await expect(page.getByText("b.ts", { exact: true }).first()).toBeVisible();
  });

  test("dropping a folder on the page keeps its structure instead of flattening it", async ({ page }) => {
    await openDemo(page, "/MS/onedrive/");
    await expect(page.getByText(/GSI Program/).first()).toBeVisible();
    await page.evaluate(() => {
      const fe = (name: string) => ({ isFile: true, isDirectory: false, name, fullPath: `/${name}`, file: (ok: (f: File) => void) => ok(new File(["x"], name)) });
      const de = (name: string, kids: unknown[]) => ({
        isFile: false, isDirectory: true, name, fullPath: `/${name}`,
        createReader: () => { let done = false; return { readEntries: (ok: (e: unknown[]) => void) => { ok(done ? [] : kids); done = true; } }; },
      });
      const root = de("Dropped", [fe("top.txt"), de("inner", [fe("deep.txt")]), de("blank", [])]);
      const loose = new File(["x"], "loose.txt");
      const items = [
        { kind: "file", type: "", getAsFile: () => null, webkitGetAsEntry: () => root },
        { kind: "file", type: "text/plain", getAsFile: () => loose, webkitGetAsEntry: () => fe("loose.txt") },
      ];
      const dt = { items, files: [loose], types: ["Files"], dropEffect: "copy", effectAllowed: "all" };
      // Any element inside the dropzone root; the events bubble to it.
      const target = Array.from(document.querySelectorAll("span, div")).find((el) => el.textContent === "GSI Program") ?? document.body;
      for (const type of ["dragenter", "dragover", "drop"]) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        target.dispatchEvent(ev);
      }
    });
    await expect(page.getByTestId("upload-tray-status")).toHaveText("3 uploads complete", { timeout: 30_000 });
    await page.getByRole("button", { name: "Close upload tray" }).click(); // the tray lists every name
    await expect(page.getByText("loose.txt", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("deep.txt")).toHaveCount(0); // not flattened into My files
    await openTree(page, "Dropped");
    await expect(page.getByText("blank", { exact: true }).first()).toBeVisible();
    await openTree(page, "inner");
    await expect(page.getByText("deep.txt", { exact: true }).first()).toBeVisible();
  });
});
