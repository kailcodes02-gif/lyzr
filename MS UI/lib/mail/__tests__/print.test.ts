import { describe, expect, it } from "vitest";
import { buildPrintDocument, escapeHtml, fmtAttachmentSize, PRINT_FRAME_TESTID, printDocument, printMessageOf } from "../print";
import type { Message } from "../types";

describe("buildPrintDocument", () => {
  const doc = buildPrintDocument({
    subject: "Accenture <x> & Lyzr",
    account: "kailash.gm@lyzr.com",
    messages: [
      { from: "Priya Raman <priya.raman@accenture.com>", to: "Kailash G M <kailash.gm@lyzr.com>", cc: "Siva <siva@lyzr.ai>", date: "20 Sep 2026, 09:30", bodyHtml: "<p>Hello <b>there</b></p>", attachments: [{ name: "guide.pdf", size: 1_240_000 }] },
      { from: "Kailash G M <kailash.gm@lyzr.com>", to: "", date: "20 Sep 2026, 10:00", bodyHtml: "<p>Reply</p>", attachments: [] },
    ],
  });
  it("has the subject, every header field and the attachments, escaped", () => {
    expect(doc).toContain("<title>Accenture &lt;x&gt; &amp; Lyzr</title>");
    expect(doc).toContain("<h1>Accenture &lt;x&gt; &amp; Lyzr</h1>");
    expect(doc).toContain("<b>From</b> Priya Raman &lt;priya.raman@accenture.com&gt;");
    expect(doc).toContain("<b>To</b> Kailash G M &lt;kailash.gm@lyzr.com&gt;");
    expect(doc).toContain("<b>Cc</b> Siva &lt;siva@lyzr.ai&gt;");
    expect(doc).toContain("<b>Date</b> 20 Sep 2026, 09:30");
    expect(doc).toContain("<b>To</b> me");
    expect(doc).not.toContain("<b>Cc</b> </div>");
    expect(doc).toContain("1 attachment<ul><li>guide.pdf (1.2 MB)</li></ul>");
    expect(doc).toContain('<article data-message="2">');
    expect(doc).toContain("<p>Hello <b>there</b></p>");
    expect(doc).toContain("kailash.gm@lyzr.com</span>");
  });
  it("carries no scripts, a CSP and a print stylesheet", () => {
    expect(doc).not.toMatch(/<script/i);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src * data: blob:");
    expect(doc).toContain("@media print");
    expect(doc).toContain("@page");
  });
  it("helpers", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(fmtAttachmentSize(0)).toBe("");
    expect(fmtAttachmentSize(512)).toBe("512 B");
    expect(fmtAttachmentSize(88_000)).toBe("86 KB");
  });
});

describe("printMessageOf", () => {
  const m: Message = {
    id: "1",
    subject: "s",
    from: { emailAddress: { name: "Mei Chen", address: "mei.chen@wipro.com" } },
    toRecipients: [{ emailAddress: { name: "Kailash", address: "k@lyzr.com" } }],
    ccRecipients: [{ emailAddress: { address: "cc@lyzr.com" } }],
    receivedDateTime: "2026-09-20T09:30:00Z",
    body: { contentType: "html", content: '<p onclick="x()">Hi<script>alert(1)</script></p><img src="https://img.example.com/a.png"><img src="cid:logo">' },
  };
  it("sanitises the body, allows remote images for print and maps cid images", () => {
    const p = printMessageOf(m, [{ id: "a1", name: "logo.png", isInline: true, contentId: "logo" }, { id: "a2", name: "deck.pptx", size: 10 }], { logo: "data:image/png;base64,AAAA" }, (iso) => `date:${iso}`);
    expect(p.from).toBe("Mei Chen <mei.chen@wipro.com>");
    expect(p.to).toBe("Kailash <k@lyzr.com>");
    expect(p.cc).toBe("cc@lyzr.com");
    expect(p.date).toBe("date:2026-09-20T09:30:00Z");
    expect(p.bodyHtml).not.toMatch(/script|onclick/);
    expect(p.bodyHtml).toContain('src="https://img.example.com/a.png"');
    expect(p.bodyHtml).toContain('src="data:image/png;base64,AAAA"');
    // Inline images are not listed as attachments.
    expect(p.attachments).toEqual([{ name: "deck.pptx", size: 10 }]);
  });
  it("renders a text body as escaped HTML", () => {
    const p = printMessageOf({ ...m, body: { contentType: "text", content: "a < b\nsee https://x.y" } });
    expect(p.bodyHtml).toContain("a &lt; b");
    expect(p.bodyHtml).toContain('<a href="https://x.y"');
  });
});

describe("printDocument", () => {
  it("mounts one hidden same-origin frame with the document and replaces an earlier one", () => {
    const first = printDocument("<!doctype html><html><body>one</body></html>");
    expect(first.getAttribute("data-testid")).toBe(PRINT_FRAME_TESTID);
    expect(first.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(first.srcdoc).toContain("one");
    expect(first.style.visibility).toBe("hidden");
    const second = printDocument("<!doctype html><html><body>two</body></html>");
    const frames = document.querySelectorAll(`iframe[data-testid="${PRINT_FRAME_TESTID}"]`);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(second);
    second.remove();
  });
});
