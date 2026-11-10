import type { DisplayReading } from "./readings.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPressure(psi: number | null): string {
  return psi == null ? "—" : `${psi} PSI`;
}

function formatTemp(tempF: number | null): string {
  return tempF == null ? "—" : `${tempF} °F`;
}

function formatTime(seconds: number | null): string {
  if (seconds == null) return "—";
  return new Date(seconds * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function sensorRows(readings: DisplayReading[]): string {
  if (readings.length === 0) {
    return `<tr><td colspan="4">No active sensors on this unit.</td></tr>`;
  }

  return readings
    .map((r) => {
      const position =
        r.axle != null && r.tire != null
          ? `Axle ${r.axle} / Tire ${r.tire}`
          : "Unknown position";
      return `<tr>
  <td>${escapeHtml(position)}</td>
  <td>${escapeHtml(formatPressure(r.pressurePsi))}</td>
  <td>${escapeHtml(formatTemp(r.temperatureF))}</td>
  <td>${escapeHtml(formatTime(r.timeStampSeconds))}</td>
</tr>`;
    })
    .join("\n");
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      margin: 0;
      padding: 1.25rem;
      line-height: 1.4;
      background: #0f1419;
      color: #e7ecf1;
    }
    h1 { font-size: 1.35rem; margin: 0 0 0.35rem; }
    .meta { color: #9aa7b5; margin-bottom: 1.25rem; font-size: 0.95rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #18212b;
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      text-align: left;
      padding: 0.75rem 0.85rem;
      border-bottom: 1px solid #2a3642;
      font-size: 0.95rem;
    }
    th { background: #1e2a36; color: #b8c4d0; font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    .empty { color: #9aa7b5; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderStatusPage(opts: {
  unitName: string;
  unitStatus: string;
  readings: DisplayReading[];
}): string {
  const asOfSeconds = opts.readings
    .map((r) => r.timeStampSeconds)
    .filter((t): t is number => t != null)
    .reduce((max, t) => Math.max(max, t), 0);

  const asOf =
    asOfSeconds > 0
      ? formatTime(asOfSeconds)
      : "no readings yet";

  const body = `  <h1>${escapeHtml(opts.unitName)}</h1>
  <p class="meta">Status: ${escapeHtml(opts.unitStatus)} · As of: ${escapeHtml(asOf)}</p>
  <table>
    <thead>
      <tr>
        <th>Position</th>
        <th>Pressure</th>
        <th>Temperature</th>
        <th>Reading time</th>
      </tr>
    </thead>
    <tbody>
${sensorRows(opts.readings)}
    </tbody>
  </table>`;

  return pageShell(`${opts.unitName} · Unit status`, body);
}

export function renderNotFoundPage(): string {
  const body = `  <h1>Unit not found</h1>
  <p class="empty">This tag is not linked to an available unit.</p>`;
  return pageShell("Unit not found", body);
}

export function renderErrorPage(): string {
  const body = `  <h1>Temporarily unavailable</h1>
  <p class="empty">Unit status could not be loaded. Try again in a moment.</p>`;
  return pageShell("Temporarily unavailable", body);
}
