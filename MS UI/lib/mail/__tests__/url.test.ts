import { describe, expect, it } from "vitest";
import { parseMailUrl, serializeMailUrl } from "../url";

describe("mail URL state", () => {
  it("parses with defaults", () => {
    expect(parseMailUrl("")).toEqual({ folder: "inbox", conversation: undefined, message: undefined, query: undefined, tab: undefined });
    expect(parseMailUrl("?f=starred&c=conv1&m=msg1&q=from%3Apriya&tab=other")).toEqual({ folder: "starred", conversation: "conv1", message: "msg1", query: "from:priya", tab: "other" });
    expect(parseMailUrl("?tab=bogus").tab).toBeUndefined();
  });
  it("serialises omitting defaults and round-trips", () => {
    expect(serializeMailUrl({ folder: "inbox", tab: "focused" })).toBe("");
    const s = serializeMailUrl({ folder: "f-1", conversation: "c", query: "a b", tab: "other" });
    expect(s).toBe("?f=f-1&c=c&q=a+b&tab=other");
    expect(parseMailUrl(s)).toMatchObject({ folder: "f-1", conversation: "c", query: "a b", tab: "other" });
  });
});
