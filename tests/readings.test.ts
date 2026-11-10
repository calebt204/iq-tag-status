import { describe, expect, it } from "vitest";
import { parsePressureHex, parseTempHex, toDisplayReading } from "../src/readings";

describe("parsePressureHex", () => {
  it("parses PSI from hex", () => {
    expect(parsePressureHex("64")).toBe(100);
  });

  it("treats FF as missing", () => {
    expect(parsePressureHex("FF")).toBeNull();
  });
});

describe("parseTempHex", () => {
  it("parses the IQ temperature protocol", () => {
    // 0x28 = 40 → -50 + 2.5*40 = 50°F
    expect(parseTempHex("28")).toBe(50);
  });

  it("subtracts 128 for values >= 128", () => {
    // 0x90 = 144 → 144-128=16 → -50 + 2.5*16 = -10°F
    expect(parseTempHex("90")).toBe(-10);
  });

  it("treats FFF and FE as missing", () => {
    expect(parseTempHex("FFF")).toBeNull();
    expect(parseTempHex("FE")).toBeNull();
  });
});

describe("toDisplayReading", () => {
  it("maps a lastReading payload", () => {
    expect(
      toDisplayReading(1, 2, {
        pressure: "64",
        temperature: "28",
        timeStamp: 1_700_000_000,
        latitude: 41.1,
        longitude: -95.2,
      }),
    ).toEqual({
      axle: 1,
      tire: 2,
      pressurePsi: 100,
      temperatureF: 50,
      timeStampSeconds: 1_700_000_000,
    });
  });
});
