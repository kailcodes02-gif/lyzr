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
  it("keeps <style> blocks, including ones Outlook puts in <head>, so class CSS still applies", () => {
    const r = sanitizeEmailHtml('<html><head><style>.hero{color:#c00} @media (max-width:600px){.hero{font-size:20px}}</style></head><body><p class="hero">x</p></body></html>');
    expect(r.html).toContain("<style>");
    expect(r.html).toContain(".hero{color:#c00}");
    expect(r.html).toContain("@media (max-width:600px)");
    expect(r.hasRemoteImages).toBe(false);
  });
  it("counts and strips remote url() and @import inside <style>, restoring url() when allowed", () => {
    const html = '<style>@import url("https://evil/track.css"); .bg{background:url(https://evil/pixel.png)}</style><p class="bg">x</p>';
    const blocked = sanitizeEmailHtml(html);
    expect(blocked.hasRemoteImages).toBe(true);
    expect(blocked.blockedImages).toBe(1);
    expect(blocked.html).not.toContain("@import");
    expect(blocked.html).not.toContain("https://evil/pixel.png");
    const allowed = sanitizeEmailHtml(html, { allowRemoteImages: true });
    expect(allowed.html).not.toContain("@import");
    expect(allowed.html).toContain("url(https://evil/pixel.png)");
  });
  it("blocks srcset-only remote images and drops media elements", () => {
    const r = sanitizeEmailHtml('<img srcset="https://cdn/a.png 1x, https://cdn/b.png 2x" alt="hero"><video src="https://cdn/v.mp4"></video>');
    expect(r.hasRemoteImages).toBe(true);
    expect(r.blockedImages).toBe(1);
    expect(r.html).not.toMatch(/ srcset="https/);
    expect(r.html).toContain('data-srcset="https://cdn/a.png 1x, https://cdn/b.png 2x"');
    expect(r.html).not.toContain("<video");
    expect(sanitizeEmailHtml('<img srcset="https://cdn/a.png 1x">', { allowRemoteImages: true }).html).toContain('srcset="https://cdn/a.png 1x"');
  });
  it("wraps the body in a document with a CSP that forbids scripts", () => {
    const doc = frameDocument("<p>x</p>", false);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src data: blob:;");
    expect(frameDocument("", true)).toContain("img-src * data: blob:;");
  });
});
