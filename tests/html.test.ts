import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderNotFoundPage,
  renderStatusPage,
} from "../src/html";

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<"&'>`)).toBe("&lt;&quot;&amp;&#39;&gt;");
  });
});

describe("renderStatusPage", () => {
  it("renders unit name and sensor rows", () => {
    const html = renderStatusPage({
      unitName: 'Trailer <A>',
      unitStatus: "active",
      readings: [
        {
          axle: 1,
          tire: 1,
          pressurePsi: 100,
          temperatureF: 50,
          timeStampSeconds: 1_700_000_000,
        },
      ],
    });

    expect(html).toContain("Trailer &lt;A&gt;");
    expect(html).toContain("100 PSI");
    expect(html).toContain("50 °F");
    expect(html).toContain("Axle 1 / Tire 1");
  });
});

describe("renderNotFoundPage", () => {
  it("returns a generic not-found page", () => {
    expect(renderNotFoundPage()).toContain("Unit not found");
  });
});
