import { describe, it, expect } from "vitest";
import { normalizeOriginName, originKey, findSimilarOrigin, isUnlistedOrigin } from "../src/domain/origin.js";

describe("origin names", () => {
  it("are stored in capitals with single spaces", () => {
    expect(normalizeOriginName("  kouassi   kouassikro ")).toBe("KOUASSI KOUASSIKRO");
    expect(normalizeOriginName(null)).toBe("");
  });

  it("match the other spellings already in the real data: apostrophe/space, doubled letters, accents", () => {
    expect(originKey("M'BAHIAKRO")).toBe(originKey("M BAHIAKRO"));
    expect(originKey("SAKKASSOU")).toBe(originKey("SAKASSOU"));
    expect(originKey("Séguéla")).toBe(originKey("SEGUELA"));
  });

  it("finds the town a new spelling would duplicate, and nothing for a genuinely new town", () => {
    const master = ["DIANRA", "M'BAHIAKRO", "SAKASSOU"];
    expect(findSimilarOrigin("m bahiakro", master)).toBe("M'BAHIAKRO");
    expect(findSimilarOrigin("Sakkassou", master)).toBe("SAKASSOU");
    expect(findSimilarOrigin("KORHOGO", master)).toBeUndefined();
    expect(findSimilarOrigin("   ", master)).toBeUndefined();
  });

  it("an unlisted origin is one the master doesn't have; blank is not unlisted", () => {
    expect(isUnlistedOrigin(" dianra ", ["DIANRA"])).toBe(false);
    expect(isUnlistedOrigin("KORHOGO", ["DIANRA"])).toBe(true);
    expect(isUnlistedOrigin("", ["DIANRA"])).toBe(false);
  });
});
