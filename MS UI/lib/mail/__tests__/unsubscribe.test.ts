// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../sanitize";
import { findUnsubscribeLink, isOneClick, parseListUnsubscribe, parseMailto, planUnsubscribe, unsubscribeFromHeaders, unsubscribeInfoOf, unsubscribeMailPayload } from "../unsubscribe";

const H = (list?: string, post?: string) => [
  ...(list !== undefined ? [{ name: "List-Unsubscribe", value: list }] : []),
  ...(post !== undefined ? [{ name: "List-Unsubscribe-Post", value: post }] : []),
];

describe("parseMailto", () => {
  it("reads the address, subject and body", () => {
    expect(parseMailto("mailto:unsub@example.com?subject=Unsubscribe%20digest&body=please")).toEqual({ address: "unsub@example.com", subject: "Unsubscribe digest", body: "please" });
  });
  it("takes the first of several addresses and drops junk", () => {
    expect(parseMailto("mailto:a@x.com,b@x.com")).toEqual({ address: "a@x.com" });
    expect(parseMailto("mailto:")).toBeUndefined();
    expect(parseMailto("mailto:not-an-address")).toBeUndefined();
    expect(parseMailto("https://x.com")).toBeUndefined();
  });
});

describe("parseListUnsubscribe", () => {
  it("mailto only", () => {
    expect(parseListUnsubscribe("<mailto:unsub@example.com>")).toEqual({ mailto: { address: "unsub@example.com" } });
  });
  it("https only", () => {
    expect(parseListUnsubscribe("<https://news.example/u?id=1>")).toEqual({ url: "https://news.example/u?id=1" });
  });
  it("both, in either order", () => {
    const both = { mailto: { address: "unsub@example.com" }, url: "https://news.example/u" };
    expect(parseListUnsubscribe("<https://news.example/u>, <mailto:unsub@example.com>")).toEqual(both);
    expect(parseListUnsubscribe("<mailto:unsub@example.com>,<https://news.example/u>")).toEqual(both);
  });
  it("ignores http, bare values, empty brackets and malformed entries", () => {
    expect(parseListUnsubscribe("<http://insecure.example/u>")).toEqual({});
    expect(parseListUnsubscribe("https://bare.example/u")).toEqual({});
    expect(parseListUnsubscribe("<>, <mailto:>, <https://>")).toEqual({});
    expect(parseListUnsubscribe("")).toEqual({});
    expect(parseListUnsubscribe(undefined)).toEqual({});
  });
});

describe("headers", () => {
  it("One-Click is read case-insensitively from List-Unsubscribe-Post", () => {
    expect(isOneClick(H("<https://x.example/u>", "List-Unsubscribe=One-Click"))).toBe(true);
    expect(isOneClick(H("<https://x.example/u>", "list-unsubscribe=one-click"))).toBe(true);
    expect(isOneClick(H("<https://x.example/u>", "something else"))).toBe(false);
    expect(isOneClick(H("<https://x.example/u>"))).toBe(false);
  });
  it("unsubscribeFromHeaders builds the info with oneClick only when an https URL exists", () => {
    expect(unsubscribeFromHeaders(H("<https://x.example/u>, <mailto:u@x.example>", "List-Unsubscribe=One-Click"))).toEqual({ source: "header", url: "https://x.example/u", mailto: { address: "u@x.example" }, oneClick: true });
    expect(unsubscribeFromHeaders(H("<mailto:u@x.example>", "List-Unsubscribe=One-Click"))).toEqual({ source: "header", url: undefined, mailto: { address: "u@x.example" }, oneClick: false });
    expect(unsubscribeFromHeaders(H("<ftp://x>"))).toBeUndefined();
    expect(unsubscribeFromHeaders([])).toBeUndefined();
    expect(unsubscribeFromHeaders(undefined)).toBeUndefined();
  });
  it("header names match case-insensitively", () => {
    expect(unsubscribeFromHeaders([{ name: "list-unsubscribe", value: "<mailto:u@x.example>" }])?.mailto?.address).toBe("u@x.example");
  });
});

describe("findUnsubscribeLink", () => {
  it("matches the anchor text", () => {
    expect(findUnsubscribeLink('<p>Bye. <a href="https://n.example/x?u=1">Unsubscribe</a></p>')).toBe("https://n.example/x?u=1");
    expect(findUnsubscribeLink('<a href="https://n.example/p">Manage your preferences</a>')).toBe("https://n.example/p");
    expect(findUnsubscribeLink('<a href="https://n.example/p">Email preferences</a>')).toBe("https://n.example/p");
    expect(findUnsubscribeLink('<a href="https://n.example/o">Opt out</a>')).toBe("https://n.example/o");
    expect(findUnsubscribeLink('<a href="https://n.example/o">opt-out</a>')).toBe("https://n.example/o");
  });
  it("matches the href when the text says something else", () => {
    expect(findUnsubscribeLink('<a href="https://n.example/unsubscribe?u=1">click here</a>')).toBe("https://n.example/unsubscribe?u=1");
  });
  it("skips javascript: and relative hrefs, returns undefined when nothing matches", () => {
    expect(findUnsubscribeLink('<a href="javascript:void(0)">Unsubscribe</a>')).toBeUndefined();
    expect(findUnsubscribeLink('<a href="/unsubscribe">Unsubscribe</a>')).toBeUndefined();
    expect(findUnsubscribeLink('<a href="https://n.example/">Read more</a>')).toBeUndefined();
    expect(findUnsubscribeLink("")).toBeUndefined();
    expect(findUnsubscribeLink(undefined)).toBeUndefined();
  });
  it("still finds the link after the body was sanitised", () => {
    const html = sanitizeEmailHtml('<div><script>x()</script><a href="https://n.example/unsub" onclick="evil()">Unsubscribe</a></div>').html;
    expect(findUnsubscribeLink(html)).toBe("https://n.example/unsub");
  });
});

describe("unsubscribeInfoOf and the plan", () => {
  it("prefers the header over a body link", () => {
    const info = unsubscribeInfoOf(H("<mailto:u@x.example>"), '<a href="https://n.example/unsub">Unsubscribe</a>');
    expect(info).toEqual({ source: "header", url: undefined, mailto: { address: "u@x.example" }, oneClick: false });
    expect(planUnsubscribe(info!)).toEqual({ kind: "mail", mailto: { address: "u@x.example" } });
  });
  it("falls back to the body link (https opens, mailto sends)", () => {
    expect(unsubscribeInfoOf([], '<a href="https://n.example/unsub">Unsubscribe</a>')).toEqual({ source: "body", url: "https://n.example/unsub", oneClick: false });
    expect(unsubscribeInfoOf(undefined, '<a href="mailto:leave@x.example?subject=Bye">Unsubscribe</a>')).toEqual({ source: "body", mailto: { address: "leave@x.example", subject: "Bye" }, oneClick: false });
    expect(unsubscribeInfoOf(undefined, "<p>no links</p>")).toBeUndefined();
  });
  it("an https URL wins over a mailto in the plan (the browser opens it; no cross-origin POST)", () => {
    expect(planUnsubscribe({ source: "header", url: "https://x.example/u", mailto: { address: "u@x.example" }, oneClick: true })).toEqual({ kind: "open", url: "https://x.example/u" });
  });
  it("builds the sendMail payload with the mailto subject or a default", () => {
    expect(unsubscribeMailPayload({ address: "u@x.example", subject: "Unsubscribe digest" }, "me@lyzr.ai")).toEqual({
      message: { subject: "Unsubscribe digest", body: { contentType: "text", content: "Please unsubscribe me@lyzr.ai from this list." }, toRecipients: [{ emailAddress: { address: "u@x.example" } }] },
      saveToSentItems: true,
    });
    expect(unsubscribeMailPayload({ address: "u@x.example" }).message.subject).toBe("Unsubscribe");
  });
});
