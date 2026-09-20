import { describe, expect, it, vi } from "vitest";
import { THUMBNAIL_TTL_MS } from "@/lib/drive/freshness";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

import { cachedThumbnail, rememberThumbnail } from "../item-icon";

describe("thumbnail cache", () => {
  it("is reused after a rename or move (same id and content) and only re-requested when the content or the url age changed", () => {
    const t0 = 1_000_000;
    expect(cachedThumbnail("f1", "c1", t0)).toBeUndefined();
    rememberThumbnail("f1", "https://thumb/1", "c1", t0);
    // Rename / move: same id, same cTag: hit.
    expect(cachedThumbnail("f1", "c1", t0 + 60_000)).toBe("https://thumb/1");
    // New content version: miss (and the stale entry is dropped).
    expect(cachedThumbnail("f1", "c2", t0 + 60_000)).toBeUndefined();
    expect(cachedThumbnail("f1", "c1", t0 + 60_000)).toBeUndefined();
    // Expired pre-authenticated url: miss.
    rememberThumbnail("f1", "https://thumb/2", "c2", t0);
    expect(cachedThumbnail("f1", "c2", t0 + THUMBNAIL_TTL_MS + 1)).toBeUndefined();
    // "No thumbnail" is cached too, so the tile does not re-ask every mount.
    rememberThumbnail("f2", null, undefined, t0);
    expect(cachedThumbnail("f2", undefined, t0 + 1)).toBeNull();
  });
});
