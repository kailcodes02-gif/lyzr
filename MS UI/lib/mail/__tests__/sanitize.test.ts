import { describe, expect, it } from "vitest";
import { frameDocument, sanitizeEmailHtml } from "../sanitize";

describe("sanitizeEmailHtml", () => {
  it("removes scripts, forms and event handlers but keeps inline styles", () => {
    const r = sanitizeEmailHtml('<div style="color:red" onclick="x()">hi<script>alert(1)</script><form><input></form><a href="https://a.b">l</a></div>');
    expect(r.html).not.toContain("script");
    expect(r.html).not.toContain("onclick");
    expect(r.html).not.toContain("<form");
    expect(r.html).toContain('style="color:red"');
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain('rel="noopener noreferrer"');
  });
  it("blocks remote images by default and shows them when allowed", () => {
    const html = '<img src="https://cdn.example.com/a.png"><div style="background:url(https://x/y.png)"></div>';
    const blocked = sanitizeEmailHtml(html);
    expect(blocked.blockedImages).toBe(2);
    expect(blocked.hasRemoteImages).toBe(true);
    expect(blocked.html).toContain('data-src="https://cdn.example.com/a.png"');
    expect(blocked.html).not.toMatch(/ src="https/);
    const allowed = sanitizeEmailHtml(html, { allowRemoteImages: true });
    expect(allowed.blockedImages).toBe(0);
    expect(allowed.html).toContain('src="https://cdn.example.com/a.png"');
  });
  it("resolves cid: images from the attachment map", () => {
    const r = sanitizeEmailHtml('<img src="cid:logo@1"><img src="cid:missing">', { cidMap: { "logo@1": "blob:abc" } });
    expect(r.html).toContain('src="blob:abc"');
    expect(r.html).toContain('data-src="cid:missing"');
    expect(r.blockedImages).toBe(0);
  });
  it("wraps the body in a document with a CSP that forbids scripts", () => {
    const doc = frameDocument("<p>x</p>", false);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src data: blob:;");
    expect(frameDocument("", true)).toContain("img-src * data: blob:;");
  });
});
