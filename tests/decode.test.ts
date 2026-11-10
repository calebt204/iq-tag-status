import { describe, expect, it } from "vitest";
import { decodeTagCode, encodeTagCode } from "../src/decode";

describe("decodeTagCode", () => {
  it("decodes the unitId.companyId payload", () => {
    const code = encodeTagCode(100234, 1001);
    expect(code).toBe("MTAwMjM0LjEwMDE");
    expect(decodeTagCode(code)).toEqual({ unitId: 100234, companyId: 1001 });
  });

  it("accepts standard base64 with padding", () => {
    expect(decodeTagCode("MTAwMjM0LjEwMDE=")).toEqual({
      unitId: 100234,
      companyId: 1001,
    });
  });

  it("rejects the unseparated concatenation", () => {
    // MTAwMjM0MTAwMQ== is base64 for "1002341001" — ambiguous without a separator.
    expect(decodeTagCode("MTAwMjM0MTAwMQ==")).toBeNull();
  });

  it("rejects malformed codes", () => {
    expect(decodeTagCode("")).toBeNull();
    expect(decodeTagCode("%%%")).toBeNull();
    expect(decodeTagCode(Buffer.from("abc.def").toString("base64url"))).toBeNull();
    expect(decodeTagCode(Buffer.from("0.1001").toString("base64url"))).toBeNull();
  });
});
