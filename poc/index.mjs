// PoC: GET /t/{code}?key=<mobileApiKey>
//   code = unitId
//   key  = mobile API key (query string, as stored on the NFC tag)
//
// Calls {BASE_URL}/api/v1/mobile/units/{unitId}/configuration with
//   Authorization: Bearer <key>
//   Content-Type: application/json
// and renders an HTML page that mirrors phoenix-rapid's unit page.
//
// Add &format=json to get the raw upstream JSON instead of HTML.
//
// Env vars:
//   BASE_URL   e.g. https://api.example.com   (required, no trailing slash needed)
//
// Deploy: zip index.mjs + render.mjs together. Handler = index.handler (Node 20+, no deps).

import { renderMessagePage, renderUnitPage } from "./render.mjs";

const html = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  body,
});

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body, null, 2),
});

export const handler = async (event) => {
  const unitIdRaw = event.pathParameters?.code;
  const apiKey = event.queryStringParameters?.key;
  const wantJson = event.queryStringParameters?.format === "json";
  const baseUrl = (process.env.BASE_URL ?? "").replace(/\/$/, "");

  if (!baseUrl) return json(500, { error: "BASE_URL not set" });
  if (!unitIdRaw || !apiKey) {
    return html(400, renderMessagePage("Bad request", "Need /t/{unitId}?key={apiKey}"));
  }

  const url = `${baseUrl}/api/v1/mobile/units/${encodeURIComponent(unitIdRaw)}/configuration`;
  console.log("GET", url);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    const text = await res.text();
    console.log("status:", res.status);
    console.log("response:", text);

    if (wantJson) {
      return {
        statusCode: res.status,
        headers: { "Content-Type": res.headers.get("content-type") ?? "text/plain" },
        body: text,
      };
    }

    if (!res.ok) {
      const msg =
        res.status === 401 || res.status === 403
          ? "This tag's key was not accepted."
          : res.status === 404
            ? "This tag is not linked to an available unit."
            : "Unit data could not be loaded.";
      return html(res.status === 404 ? 404 : 502, renderMessagePage("Unavailable", msg));
    }

    return html(200, renderUnitPage(JSON.parse(text), Number(unitIdRaw)));
  } catch (err) {
    console.error("request failed", err);
    return html(502, renderMessagePage("Temporarily unavailable", "Try again in a moment."));
  }
};
