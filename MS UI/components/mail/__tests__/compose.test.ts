import { describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

import { attachmentIdFromLocation, attachmentLimitError, composeBody, draftFromMessage, MAX_ATTACHMENT_BYTES, MAX_MESSAGE_BYTES, splitDraftBody } from "../compose";

// A realistic Outlook reply body: signature with an inline cid image, a table, then the quoted header.
const OUTLOOK_REPLY = '<html><head><style>p{margin:0}</style></head><body><div id="Signature"><table><tr><td><img src="cid:image001.png@01D9A1B2.C3D4E5F6" width="120"></td></tr></table></div><div id="appendonsend"></div><hr style="display:inline-block;width:98%"><div id="divRplyFwdMsg"><b>From:</b> Priya Raman</div><div><p>Original text</p></div></body></html>';

describe("draft bodies", () => {
  it("keeps the whole server HTML of a reply out of the editor and sends it back verbatim after typing", () => {
    const d = draftFromMessage({ id: "d1", body: { contentType: "html", content: OUTLOOK_REPLY } }, "reply");
    expect(d.body).toBe("");
    expect(d.quotedHtml).toBe(OUTLOOK_REPLY);
    const sent = composeBody("<p>Thanks Priya, works for us.</p>", d.quotedHtml);
    expect(sent).toContain("<p>Thanks Priya, works for us.</p>");
    expect(sent).toContain('cid:image001.png@01D9A1B2.C3D4E5F6');
    expect(sent).toContain("<table>");
    expect(sent).toContain('id="Signature"');
    expect(sent).toContain('id="divRplyFwdMsg"');
    expect(sent.indexOf("Thanks Priya")).toBeLessThan(sent.indexOf("divRplyFwdMsg"));
  });
  it("splits a re-opened draft at the first Outlook marker and leaves plain text editable", () => {
    const s = splitDraftBody('<p>my draft text</p><div id="appendonsend"></div><div>quoted</div>');
    expect(s.body).toBe("<p>my draft text</p>");
    expect(s.quotedHtml).toBe('<div id="appendonsend"></div><div>quoted</div>');
    expect(splitDraftBody("<p>only mine</p>")).toEqual({ body: "<p>only mine</p>", quotedHtml: undefined });
    expect(splitDraftBody("")).toEqual({ body: "", quotedHtml: undefined });
  });
  it("does not flatten a draft whose editable part has images or tables", () => {
    const s = splitDraftBody('<table><tr><td>x</td></tr></table><hr><div>quoted</div>');
    expect(s.body).toBe("");
    expect(s.quotedHtml).toContain("<table>");
  });
  it("sends an empty editor as nothing rather than an empty paragraph", () => {
    expect(composeBody("<p></p>", "<div>q</div>")).toBe("<div></div><br><div>q</div>");
    expect(composeBody("<p>hi</p>")).toBe("<p>hi</p>");
  });
});

describe("attachment limits and ids", () => {
  it("rejects a file over the upload-session maximum and a total over the message limit", () => {
    expect(attachmentLimitError({ name: "a.zip", size: 1024 }, 0)).toBeNull();
    expect(attachmentLimitError({ name: "big.iso", size: MAX_ATTACHMENT_BYTES + 1 }, 0)).toMatch(/limit per attachment is 150 MB/);
    expect(attachmentLimitError({ name: "deck.pptx", size: 10 * 1024 * 1024 }, MAX_MESSAGE_BYTES - 5 * 1024 * 1024)).toMatch(/past 35 MB/);
    expect(attachmentLimitError({ name: "x", size: 1 }, 0, { file: 10, message: 0 })).toMatch(/past 0 MB/);
  });
  it("reads the attachment id from the final PUT's Location header", () => {
    expect(attachmentIdFromLocation("https://outlook.office.com/api/v2.0/Users('u')/Messages('m')/Attachments('AAMkADI5MAAIT3drCAAABEgAQANAqbAe7qaROhYdTnUQwXm0=')")).toBe("AAMkADI5MAAIT3drCAAABEgAQANAqbAe7qaROhYdTnUQwXm0=");
    expect(attachmentIdFromLocation(null)).toBeUndefined();
  });
});
