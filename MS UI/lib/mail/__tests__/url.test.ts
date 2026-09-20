import { describe, expect, it } from "vitest";
import { labelFolderKey, labelFromFolder, parseMailUrl, serializeMailUrl } from "../url";

describe("mail URL state", () => {
  it("parses with defaults", () => {
    expect(parseMailUrl("")).toEqual({ folder: "inbox", conversation: undefined, message: undefined, query: undefined, tab: undefined, focused: undefined });
    expect(parseMailUrl("?f=starred&c=conv1&m=msg1&q=from%3Apriya&tab=social&focused=1")).toEqual({ folder: "starred", conversation: "conv1", message: "msg1", query: "from:priya", tab: "social", focused: true });
    expect(parseMailUrl("?tab=bogus").tab).toBeUndefined();
    expect(parseMailUrl("?tab=other").tab).toBeUndefined();
    expect(parseMailUrl("?tab=promotions").tab).toBe("promotions");
  });
  it("serialises omitting defaults and round-trips", () => {
    expect(serializeMailUrl({ folder: "inbox", tab: "primary" })).toBe("");
    const s = serializeMailUrl({ folder: "f-1", conversation: "c", query: "a b", tab: "social", focused: true });
    expect(s).toBe("?f=f-1&c=c&q=a+b&tab=social&focused=1");
    expect(parseMailUrl(s)).toMatchObject({ folder: "f-1", conversation: "c", query: "a b", tab: "social", focused: true });
  });
  it("round-trips label views as f=label:<name>", () => {
    expect(labelFolderKey("GSI")).toBe("label:GSI");
    expect(labelFromFolder("label:GSI")).toBe("GSI");
    expect(labelFromFolder("label:Weekly report")).toBe("Weekly report");
    expect(labelFromFolder("inbox")).toBeUndefined();
    expect(labelFromFolder("label:")).toBeUndefined();
    const s = serializeMailUrl({ folder: labelFolderKey("Priya's team") });
    expect(s).toBe("?f=label%3APriya%27s+team");
    expect(labelFromFolder(parseMailUrl(s).folder)).toBe("Priya's team");
  });
});
