// Server-side HTML renderer that mirrors phoenix-rapid's unit page
// (src/components/units/detail/*): alerts banner, unit header accordion,
// and the tire diagram with click-for-details panel.
//
// Input: the JSON returned by GET /api/v1/mobile/units/{id}/configuration
// No dependencies. Pure functions, so it can be run locally (see preview.mjs).

const NONE = 0;
const MED = 1;
const HIGH = 2;
const CRIT = 3;

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

function makeFormatter(prefs = {}) {
  const p = String(prefs["pressure-mode"] ?? "psi").toLowerCase();
  const t = String(prefs["temperature-mode"] ?? "fahrenheit").toLowerCase();
  const celsius = t.startsWith("c");
  const factor = { psi: 1, bar: 0.0689476, kpa: 6.89476, pa: 6894.76 }[p] ?? 1;
  const pressureMode = factor === 1 ? "psi" : p;
  return {
    pressure: (psi) => (psi * factor).toFixed(pressureMode === "psi" ? 0 : 1),
    pressureUnit: pressureMode.toUpperCase(),
    temp: (f) => Math.round(celsius ? Math.floor((5 / 9) * (f - 32)) : f),
    tempUnit: celsius ? "°C" : "°F",
  };
}

// Mirrors isNewSensor (CONSTANTS.PRESSURE_THRESHOLD = 0)
const isNewSensor = (pressure) => pressure < 0;

function alertLabel(a) {
  return a === CRIT ? "Critical" : a === HIGH ? "High" : a === MED ? "Medium" : "None";
}

// error for CRIT/HIGH, warning for MED, success otherwise
function alertTone(a) {
  return a === CRIT || a === HIGH ? "error" : a === MED ? "warning" : "success";
}

function formatUtc(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function timeAgo(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "Just now";
}

const CHEVRON = `<svg class="chev" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>`;

/* ------------------------------------------------------------------ */
/* tire status + cross-axle logic (ported from TireVisualDiagram.tsx) */
/* ------------------------------------------------------------------ */

function thresholdsOf(unit) {
  const t = unit.currentTemplate?.thresholds ?? {};
  return {
    low: t.lowPressureThreshold ?? 20,
    high: t.highPressureThreshold ?? 20,
    highTemp: t.highTemperatureThreshold ?? 160,
    crossPressure: t.crossAxlePressureThreshold ?? 20,
    crossTemp: t.crossAxleTemperatureThreshold ?? 30,
  };
}

function tireStatus(tire, th) {
  if (tire.lastReading == null || isNewSensor(tire.pressure)) return "offline";
  if (tire.lostSignal) return "lostSignal";

  const ref = tire.referencePressure || 100;
  const lowPsi = Math.round(ref * (1 - th.low / 100));
  const highPsi = Math.round(ref * (1 + th.high / 100));

  if (tire.pressure <= lowPsi || tire.pressure >= highPsi || tire.temperature >= th.highTemp) {
    return "critical";
  }

  const buffer = ref * 0.05;
  if (
    tire.pressure <= lowPsi + buffer ||
    tire.pressure >= highPsi - buffer ||
    tire.temperature >= th.highTemp * 0.9
  ) {
    return "warning";
  }
  return "good";
}

const severityToStatus = (s) =>
  s === "critical" ? CRIT : s === "high" ? HIGH : s === "medium" ? MED : NONE;

function resolveAxleCrossAlerts(axleNumber, computed, alerts) {
  let pressure = computed?.pressure ?? NONE;
  let temperature = computed?.temperature ?? NONE;
  for (const a of alerts ?? []) {
    const type = String(a.type ?? "");
    const isCross = type.includes("cross-axle") || type.includes("cross_axle");
    if (!isCross || a.axle !== axleNumber) continue;
    const st = severityToStatus(a.severity);
    if (type.includes("pressure")) pressure = Math.max(pressure, st);
    else if (type.includes("temperature")) temperature = Math.max(temperature, st);
  }
  return { pressure, temperature };
}

const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

function sideComparison(data, axleNumber, slots) {
  const count = slots.filter(Boolean).length;
  const leftPos = count > 2 ? [1, 2] : [1];
  const rightPos = count > 2 ? [3, 4] : [4];
  const pick = (positions) =>
    positions
      .map((pos) => data.find((t) => t.axlePosition === axleNumber && t.tirePosition === pos))
      .filter((t) => t && !isNewSensor(t.pressure));
  const left = pick(leftPos);
  const right = pick(rightPos);

  const lp = avg(left.map((t) => t.pressure));
  const rp = avg(right.map((t) => t.pressure));
  const lt = avg(left.filter((t) => t.temperature >= 0).map((t) => t.temperature));
  const rt = avg(right.filter((t) => t.temperature >= 0).map((t) => t.temperature));

  let pressureDiffPercent = null;
  if (lp !== null && rp !== null) {
    const mid = (lp + rp) / 2;
    pressureDiffPercent = mid === 0 ? 0 : (Math.abs(lp - rp) / mid) * 100;
  }
  const tempDiff = lt !== null && rt !== null ? Math.abs(lt - rt) : null;

  return { lp, rp, lt, rt, pressureDiffPercent, tempDiff };
}

function pressureExplanation(diff, threshold, status) {
  if (diff === null) return "Not enough tire readings on both sides to compare pressure.";
  const r = diff.toFixed(1);
  if (status === NONE) return `Left and right pressure differ by ${r}%, which is within the ${threshold}% threshold.`;
  if (status === MED) return `Left and right pressure differ by ${r}%, approaching the ${threshold}% threshold.`;
  return `Left and right pressure differ by ${r}%, which exceeds the ${threshold}% threshold.`;
}

function tempExplanation(diff, threshold, status, unit) {
  if (diff === null) return "Not enough tire readings on both sides to compare temperature.";
  const r = diff.toFixed(1);
  if (status === NONE) return `Left and right temperature differ by ${r}${unit}, which is within the ±${threshold}${unit} threshold.`;
  if (status === MED) return `Left and right temperature differ by ${r}${unit}, approaching the ±${threshold}${unit} threshold.`;
  return `Left and right temperature differ by ${r}${unit}, which exceeds the ±${threshold}${unit} threshold.`;
}

/* ------------------------------------------------------------------ */
/* sections                                                           */
/* ------------------------------------------------------------------ */

function renderActiveAlerts(unit) {
  const alerts = unit.alerts ?? [];
  if (alerts.length === 0) return "";

  const level = (s) => ({ critical: 4, high: 3, medium: 2 })[s] ?? 1;
  const highest = alerts.reduce((h, a) => (level(a.severity) > level(h) ? a.severity : h), alerts[0].severity);
  const bg = { critical: "error", high: "warning-dark", medium: "warning" }[highest] ?? "grey";
  const iconColor = { critical: "var(--error)", high: "var(--warning-dark)", medium: "var(--warning)" }[highest] ?? "var(--grey-500)";

  const items = alerts
    .map((alert) => {
      const sensor = (unit.data ?? []).find((s) => Number(s.sensorId) === alert.sensorId);
      const isCross = String(alert.type).includes("cross-axle");
      let pos = "";
      if (isCross && alert.axle) pos = `Axle ${alert.axle}`;
      else if (sensor) pos = `Axle ${sensor.axlePosition}, Tire ${sensor.tirePosition}`;
      const type = String(alert.type).split("-").map(cap).join(" ");
      return `<div class="alert-item">
  <svg viewBox="0 0 24 24" width="24" height="24" style="color:${iconColor}"><path fill="currentColor" d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>
  <div>
    <div class="row wrap" style="gap:8px">
      <span class="body2 bold">${esc(type)}</span>
      <span class="chip chip-${alert.severity === "critical" ? "error" : "warning"}" style="height:20px">${esc(alert.severity)}</span>
    </div>
    <div class="caption secondary">${esc(pos)}${pos ? " • " : ""}${esc(timeAgo(alert.createdOn))}</div>
  </div>
</div>`;
    })
    .join("\n");

  return `<details class="acc">
  <summary class="acc-sum bg-${bg}" style="color:#fff">
    <span class="h6">Active Alerts (${alerts.length})</span>${CHEVRON}
  </summary>
  <div class="acc-det"><div class="row wrap" style="gap:8px">${items}</div></div>
</details>`;
}

function renderHeader(unit) {
  const lastUpdate = unit.updateDate ? formatUtc(unit.updateDate) : "No data";
  const statusTone = { Active: "success", Parked: "warning", Archived: "error", Deleted: "error" }[unit.status] ?? "default";
  const alertChip =
    unit.alert !== NONE
      ? `<span class="chip chip-${alertTone(unit.alert)}">${esc(alertLabel(unit.alert))}${unit.alertType ? ` (${esc(unit.alertType)})` : ""}</span>`
      : "";

  const attached = (unit.attachedUnits ?? []).length
    ? `<div style="margin-top:24px">
        <div class="overline secondary">Attached Units</div>
        <div class="row wrap" style="gap:8px;margin-top:8px">${unit.attachedUnits
          .map((a) => `<span class="chip chip-outlined-primary">${esc(a.name)}</span>`)
          .join("")}</div>
      </div>`
    : "";

  const info = (label, value) =>
    `<div><div class="caption secondary">${esc(label)}</div><div class="body1">${esc(value || "—")}</div></div>`;

  return `<details class="acc">
  <summary class="acc-sum hoverable">
    <div class="header-main">
      <div class="truck">
        <svg viewBox="0 0 24 24" width="35" height="35"><path fill="currentColor" d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5m13.5-9 1.96 2.5H17V9.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <h2 class="unit-name">${esc(unit.name)}</h2>
        <div class="row wrap" style="gap:4px;margin-top:4px">
          <span class="chip chip-outlined">${esc(unit.type)}</span>
          <span class="chip chip-${statusTone}">${esc(unit.status)}</span>
          ${alertChip}
        </div>
      </div>
    </div>${CHEVRON}
  </summary>
  <div class="acc-det" style="padding-top:24px">
    <div class="overline secondary">General Information</div>
    <hr />
    <div class="grid-info">
      ${info("Template", unit.currentTemplate?.name)}
      ${info("Last Update", lastUpdate)}
    </div>
    <div style="margin-top:24px">
      <div class="overline secondary">Device Information</div>
      <hr />
      <div class="grid-info two">
        ${info("Device Name", unit.deviceName)}
        ${info("Device Serial", unit.deviceSerial)}
      </div>
      ${attached}
    </div>
  </div>
</details>`;
}

/* ---------- tire diagram ---------- */

function pf(pressureStr) {
  if (!pressureStr || pressureStr.length > 5) return "pf-s";
  if (pressureStr.length > 3) return "pf-m";
  return "pf-l";
}

function renderTire(tire, status, fmt, panelId) {
  const noData = isNewSensor(tire.pressure);
  const pressure = noData ? null : fmt.pressure(tire.pressure);
  const temp = noData ? null : fmt.temp(tire.temperature);
  const body = noData
    ? `<div class="tire-nodata">No Data</div>`
    : `<div class="tire-pressure ${pf(pressure)}">${esc(pressure)}</div>
       <div class="tire-unit">${esc(fmt.pressureUnit)}</div>
       <div class="tire-temp">${esc(temp)}${esc(fmt.tempUnit)}</div>`;
  return `<div class="tire st-${status}" role="button" tabindex="0" data-panel="${panelId}">
    <div class="tire-pos">${tire.axlePosition}-${tire.tirePosition}</div>
    ${body}
  </div>`;
}

function renderUnassigned(axle, pos, panelId) {
  return `<div class="tire unassigned" role="button" tabindex="0" data-panel="${panelId}">
    <div class="tire-pos">${axle}-${pos}</div>
    <div class="tire-dash">—</div>
    <div class="tire-nosensor">No sensor</div>
  </div>`;
}

function infoRow(label, value, extra = "") {
  return `<div class="between"><span class="body2 secondary">${esc(label)}</span><span class="body2 ${extra}">${value}</span></div>`;
}

function tirePanel(tire, unit, th, fmt, panelId) {
  const ref = tire.referencePressure || 100;
  const lowPsi = Math.round(ref * (1 - th.low / 100));
  const highPsi = Math.round(ref * (1 + th.high / 100));
  const noData = isNewSensor(tire.pressure);
  const pU = fmt.pressureUnit;
  const tU = fmt.tempUnit;

  const metric = (label, value, unitLabel) => `<div class="card">
      <div class="caption secondary spaced">${label}</div>
      <div class="h4">${
        noData
          ? `<span class="body1 disabled" style="font-weight:400">No Data</span>`
          : `${esc(value)}<span class="body2 secondary" style="margin-left:4px;font-weight:400">${esc(unitLabel)}</span>`
      }</div>
    </div>`;

  const signal = noData
    ? `<span class="disabled">No Data</span>`
    : tire.lostSignal
      ? `<span style="color:var(--error)">Lost</span>`
      : `<span style="color:var(--success)">Connected</span>`;

  const last = tire.lastReading
    ? `<div class="body2 secondary center" style="padding-top:8px"><time data-ts="${esc(tire.lastReading)}">${esc(formatUtc(tire.lastReading))}</time></div>`
    : `<div class="body2 disabled center" style="padding-top:8px">No Data</div>`;

  return `<div class="panel" id="${panelId}" hidden>
    <div class="overline secondary spaced" style="margin-bottom:16px">${esc(unit.name)} — Axle ${tire.axlePosition}, Position ${tire.tirePosition}</div>
    <div class="stack" style="gap:16px;margin-bottom:16px">
      ${metric("PRESSURE", noData ? "" : fmt.pressure(tire.pressure), pU)}
      ${metric("TEMPERATURE", noData ? "" : fmt.temp(tire.temperature), tU)}
    </div>
    <div class="card">
      <div class="caption secondary spaced" style="margin-bottom:8px">THRESHOLDS</div>
      <div class="stack" style="gap:8px">
        ${infoRow("Reference Pressure", `${fmt.pressure(ref)} ${pU}`)}
        ${infoRow("Low Threshold", `${fmt.pressure(lowPsi)} ${pU}`)}
        ${infoRow("High Threshold", `${fmt.pressure(highPsi)} ${pU}`)}
        ${infoRow("Temp High Threshold", `${fmt.temp(th.highTemp)} ${tU}`)}
        ${infoRow("Cross-Axle Temp", `±${th.crossTemp} ${tU}`)}
        ${infoRow("Sensor Serial", esc(tire.sensorSerialNo), "mono")}
        ${infoRow("Signal Status", signal)}
        ${last}
      </div>
    </div>
  </div>`;
}

function unassignedPanel(axle, pos, panelId) {
  return `<div class="panel centered" id="${panelId}" hidden>
    <div class="overline disabled spaced">Axle ${axle}, Position ${pos}</div>
    <div class="secondary">No sensor assigned</div>
  </div>`;
}

function statusColorVar(s) {
  return s === NONE ? "var(--success)" : s === MED ? "var(--warning)" : "var(--error)";
}

function axlePanel(unit, axleNumber, slots, cross, th, fmt, panelId) {
  const cmp = sideComparison(unit.data ?? [], axleNumber, slots);
  const overall = Math.max(cross.pressure, cross.temperature);
  const sp = (v) => (v === null ? "—" : `${fmt.pressure(v)} ${fmt.pressureUnit}`);
  const st = (v) => (v === null ? "—" : `${fmt.temp(v)}${fmt.tempUnit}`);
  const headColor = overall === NONE ? "var(--text-secondary)" : statusColorVar(overall);

  return `<div class="panel" id="${panelId}" hidden>
    <div class="overline secondary spaced" style="margin-bottom:8px">${esc(unit.name)} — Axle ${axleNumber} Cross-Axle</div>
    <div class="body2 bold" style="color:${headColor};margin-bottom:16px">${
      overall === NONE ? "No active cross-axle alert" : `${alertLabel(overall)} cross-axle alert`
    }</div>
    <div class="stack" style="gap:16px">
      <div class="card">
        <div class="caption secondary spaced">PRESSURE COMPARISON</div>
        <div class="stack" style="gap:8px;margin-top:12px">
          ${infoRow("Left side avg", sp(cmp.lp))}
          ${infoRow("Right side avg", sp(cmp.rp))}
          ${infoRow("Difference", cmp.pressureDiffPercent === null ? "—" : `${cmp.pressureDiffPercent.toFixed(1)}%`)}
          ${infoRow("Threshold", `${th.crossPressure}%`)}
          <div class="between"><span class="body2 secondary">Status</span><span class="body2" style="color:${statusColorVar(cross.pressure)}">${alertLabel(cross.pressure)}</span></div>
          <div class="caption secondary" style="padding-top:4px">${esc(pressureExplanation(cmp.pressureDiffPercent, th.crossPressure, cross.pressure))}</div>
        </div>
      </div>
      <div class="card">
        <div class="caption secondary spaced">TEMPERATURE COMPARISON</div>
        <div class="stack" style="gap:8px;margin-top:12px">
          ${infoRow("Left side avg", st(cmp.lt))}
          ${infoRow("Right side avg", st(cmp.rt))}
          ${infoRow("Difference", cmp.tempDiff === null ? "—" : `${cmp.tempDiff.toFixed(1)}${fmt.tempUnit}`)}
          ${infoRow("Threshold", `±${th.crossTemp}${fmt.tempUnit}`)}
          <div class="between"><span class="body2 secondary">Status</span><span class="body2" style="color:${statusColorVar(cross.temperature)}">${alertLabel(cross.temperature)}</span></div>
          <div class="caption secondary" style="padding-top:4px">${esc(tempExplanation(cmp.tempDiff, th.crossTemp, cross.temperature, fmt.tempUnit))}</div>
        </div>
      </div>
    </div>
  </div>`;
}

// Returns { html, panels } for one unit's axle diagram
function renderUnitDiagram(unit, idx, fmt, showConnector) {
  const th = thresholdsOf(unit);
  const layout = unit.tireLayout ?? [];
  const data = unit.data ?? [];
  const panels = [];

  const axles = layout
    .map((slots, axleIndex) => {
      const axleNumber = axleIndex + 1;
      const count = slots.filter(Boolean).length;
      const leftPos = count > 2 ? [1, 2] : [1];
      const rightPos = count > 2 ? [3, 4] : [4];

      const cross = resolveAxleCrossAlerts(axleNumber, unit.crossAxleAlerts?.[axleIndex], unit.alerts);
      const crossAlert = Math.max(cross.pressure, cross.temperature);
      const crossTone = alertTone(crossAlert);

      const axlePanelId = `a-${idx}-${axleNumber}`;
      panels.push(axlePanel(unit, axleNumber, slots, cross, th, fmt, axlePanelId));

      const slot = (pos) => {
        const tire = data.find((t) => t.axlePosition === axleNumber && t.tirePosition === pos);
        if (tire) {
          const id = `t-${idx}-${tire.sensorId}`;
          panels.push(tirePanel(tire, unit, th, fmt, id));
          return renderTire(tire, tireStatus(tire, th), fmt, id);
        }
        const id = `u-${idx}-${axleNumber}-${pos}`;
        panels.push(unassignedPanel(axleNumber, pos, id));
        return renderUnassigned(axleNumber, pos, id);
      };

      const spacer = count === 2 ? `<div class="spacer"></div>` : "";
      const connector =
        axleIndex < layout.length - 1 ? `<div class="axle-link"></div>` : "";

      return `<div class="axle-wrap">
  <div class="caption secondary center" style="margin-bottom:8px">Axle ${axleNumber}</div>
  <div class="axle-row${crossAlert !== NONE ? ` has-alert tone-${crossTone}` : ""}" data-axle-panel="${axlePanelId}">
    <div class="row" style="gap:4px">${leftPos.map(slot).join("")}${spacer}</div>
    <div class="axle-bar-hit" role="button" tabindex="0" aria-label="View Axle ${axleNumber} cross-axle details" data-panel="${axlePanelId}"
         title="${crossAlert !== NONE ? esc(`Cross-Axle: ${alertLabel(crossAlert)}`) : "View cross-axle details"}">
      <div class="axle-bar"></div>
    </div>
    <div class="row" style="gap:4px">${spacer}${rightPos.map(slot).join("")}</div>
  </div>
  ${connector}
</div>`;
    })
    .join("\n");

  const html = `<div style="width:100%">
  <div class="overline secondary center" style="margin-bottom:16px;display:block">${esc(unit.name)}</div>
  <div class="axles">${axles}</div>
  ${showConnector ? `<div class="unit-link"></div>` : ""}
</div>`;

  return { html, panels };
}

function renderLegend() {
  const items = [
    ["Normal", "var(--success)"],
    ["Warning", "var(--warning)"],
    ["Critical", "var(--error)"],
    ["Lost Signal", "var(--info)"],
    ["Offline", "var(--grey-500)"],
  ]
    .map(
      ([label, color]) =>
        `<div class="row" style="gap:4px"><span class="dot" style="background:${color};box-shadow:0 0 8px color-mix(in srgb, ${color} 38%, transparent)"></span><span class="caption secondary legend-label">${label}</span></div>`,
    )
    .join("");
  const unassigned = `<div class="row" style="gap:4px"><span class="dot" style="border:2px dashed var(--grey-400)"></span><span class="caption secondary legend-label">Unassigned</span></div>`;
  return `<div class="legend">${items}${unassigned}</div>`;
}

function renderTireDiagram(unit, attachedUnits, fmt) {
  if (!unit.tireLayout || unit.tireLayout.length === 0) {
    return `<details class="acc" open>
  <summary class="acc-sum hoverable"><span class="h6">Tire Diagram</span>${CHEVRON}</summary>
  <div class="acc-det"><div class="secondary center">No tire layout configured for this unit.</div></div>
</details>`;
  }

  const main = renderUnitDiagram(unit, 0, fmt, attachedUnits.length > 0);
  const attached = attachedUnits.map((u, i) =>
    renderUnitDiagram(u, i + 1, fmt, i < attachedUnits.length - 1),
  );
  const panels = [main, ...attached].flatMap((d) => d.panels).join("\n");

  const attachedBlock = attachedUnits.length
    ? `<div class="center" style="margin:8px 0">
        <button type="button" class="text-btn" id="toggle-attached" data-count="${attachedUnits.length}">Show Attached Units (${attachedUnits.length})</button>
      </div>
      <div id="attached" hidden>${attached.map((d) => d.html).join("\n")}</div>`
    : "";

  return `<details class="acc" open>
  <summary class="acc-sum hoverable"><span class="h6">Tire Diagram</span>${CHEVRON}</summary>
  <div class="acc-det">
    <div class="diagram-grid">
      <div class="diagram-box left-box">
        ${main.html}
        ${attachedBlock}
        ${renderLegend()}
      </div>
      <div class="diagram-box">
        <div class="panel centered" id="p-default"><span class="secondary">Click a tire or axle to view details</span></div>
        ${panels}
      </div>
    </div>
  </div>
</details>`;
}

/* ------------------------------------------------------------------ */
/* page                                                               */
/* ------------------------------------------------------------------ */

const CSS = `
:root{
  color-scheme: light dark;
  --bg:#fafafa; --paper:#fff; --text:rgba(0,0,0,.87); --text-secondary:rgba(0,0,0,.6); --text-disabled:rgba(0,0,0,.38);
  --divider:rgba(0,0,0,.12); --hover:rgba(0,0,0,.04); --selected:rgba(0,0,0,.08);
  --primary:#1976d2; --success:#2e7d32; --warning:#ed6c02; --warning-dark:#e65100; --error:#d32f2f; --info:#0288d1;
  --grey-50:#fafafa; --grey-100:#f5f5f5; --grey-400:#bdbdbd; --grey-500:#9e9e9e; --grey-600:#757575; --grey-700:#616161;
  --card:#f5f5f5; --tire-bg:#fff; --tire-sel:rgba(59,130,246,.1); --box-bg:#fafafa; --axle-line:#bdbdbd;
  --shadow:0 2px 1px -1px rgba(0,0,0,.2),0 1px 1px 0 rgba(0,0,0,.14),0 1px 3px 0 rgba(0,0,0,.12);
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#121212; --paper:#1e1e1e; --text:#fff; --text-secondary:rgba(255,255,255,.7); --text-disabled:rgba(255,255,255,.5);
    --divider:rgba(255,255,255,.12); --hover:rgba(255,255,255,.08); --selected:rgba(255,255,255,.16);
    --primary:#90caf9; --success:#66bb6a; --warning:#ffa726; --warning-dark:#f57c00; --error:#f44336; --info:#29b6f6;
    --card:rgba(10,10,10,.8); --tire-bg:rgba(30,30,30,.9); --tire-sel:rgba(59,130,246,.2); --box-bg:rgba(20,20,20,.8); --axle-line:#616161;
    --shadow:none;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Roboto,Helvetica,Arial,sans-serif;font-size:1rem;line-height:1.5}
.page{max-width:1200px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:24px}
.row{display:flex;flex-direction:row;align-items:center}
.wrap{flex-wrap:wrap}
.stack{display:flex;flex-direction:column}
.between{display:flex;justify-content:space-between;gap:8px}
.center{text-align:center}
.bold{font-weight:700}
.mono{font-family:monospace}
.secondary{color:var(--text-secondary)}
.disabled{color:var(--text-disabled)}
.h6{font-size:1.25rem;font-weight:500;line-height:1.6}
.h4{font-size:2.125rem;font-weight:700;line-height:1.235;margin-top:8px}
.body1{font-size:1rem}
.body2{font-size:.875rem;line-height:1.43}
.caption{font-size:.75rem;line-height:1.66;letter-spacing:.03333em}
.overline{font-size:.75rem;line-height:2.66;letter-spacing:1px;text-transform:uppercase}
.spaced{letter-spacing:1px}
hr{border:0;border-top:1px solid var(--divider);margin:0 0 16px}

/* accordion */
.acc{background:var(--paper);border-radius:4px;overflow:hidden;box-shadow:var(--shadow)}
.acc-sum{list-style:none;display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:0 16px;cursor:pointer}
.acc-sum::-webkit-details-marker{display:none}
.acc-sum.hoverable:hover{background:var(--hover)}
.acc-sum .chev{flex:none;transition:transform .2s}
.acc[open]>.acc-sum .chev{transform:rotate(180deg)}
.acc-det{padding:8px 16px 16px}
.bg-error{background:var(--error)} .bg-warning{background:var(--warning)} .bg-warning-dark{background:var(--warning-dark)} .bg-grey{background:var(--grey-500)}

/* header */
.acc-sum.hoverable:has(.header-main){background:var(--hover)}
.acc-sum.hoverable:has(.header-main):hover{background:var(--selected)}
.header-main{display:flex;align-items:center;gap:16px;flex:1;min-width:0;padding:16px 16px 16px 0}
.truck{display:none;align-items:center;justify-content:center;background:var(--primary);color:#fff;padding:12px;border-radius:8px}
.unit-name{margin:0;font-size:1.15rem;font-weight:700;line-height:1.334;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grid-info{display:grid;grid-template-columns:1fr;gap:24px}
.chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:16px;font-size:10px;text-transform:capitalize;background:#e0e0e0;color:rgba(0,0,0,.87);white-space:nowrap}
.chip-success{background:var(--success);color:#fff} .chip-warning{background:var(--warning);color:#fff} .chip-error{background:var(--error);color:#fff}
.chip-outlined{background:transparent;border:1px solid var(--divider);color:var(--text)}
.chip-outlined-primary{background:transparent;border:1px solid var(--primary);color:var(--primary);height:24px;font-size:12px;text-transform:none}

/* alerts */
.alert-item{display:flex;align-items:center;gap:12px;padding:12px;border-radius:4px;background:var(--hover)}

/* diagram */
.diagram-grid{display:grid;grid-template-columns:1fr;gap:24px}
.diagram-box{background:var(--box-bg);border:1px solid var(--divider);border-radius:8px;overflow:hidden}
.left-box{padding:8px}
.axles{display:flex;flex-direction:column;align-items:center;gap:24px;padding:16px 0}
.axle-wrap{width:100%}
.axle-row{display:flex;align-items:center;justify-content:center;gap:8px;width:fit-content;margin:0 auto;border-radius:15px;--c:var(--success)}
.axle-row.has-alert{padding:8px;background:color-mix(in srgb,var(--c) 10%,transparent)}
.axle-row.tone-error{--c:var(--error)} .axle-row.tone-warning{--c:var(--warning)}
.axle-row.selected{outline:2px solid var(--primary);outline-offset:2px;padding:8px}
.axle-bar-hit{display:flex;align-items:center;padding:12px 0;cursor:pointer}
.axle-bar{width:30px;height:4px;margin:0 4px;border-radius:4px;background:var(--axle-line);transition:background-color .2s,box-shadow .2s}
.axle-row.has-alert .axle-bar{background:var(--c);box-shadow:0 0 8px color-mix(in srgb,var(--c) 50%,transparent)}
.axle-link{width:4px;height:24px;margin:8px auto 0;border-radius:4px;background:var(--axle-line)}
.unit-link{width:4px;height:40px;margin:16px auto;border-radius:4px;border:2px dashed var(--grey-600)}
.spacer{width:52px;flex:none}
.tire{width:56px;height:75px;border:2px solid var(--c);border-radius:25%;background:var(--tire-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;transition:all .2s ease;box-shadow:0 0 12px color-mix(in srgb,var(--c) 25%,transparent);user-select:none}
.tire:hover{transform:scale(1.05);box-shadow:0 0 20px color-mix(in srgb,var(--c) 38%,transparent)}
.tire.selected{background:var(--tire-sel)}
.st-good{--c:var(--success)} .st-warning{--c:var(--warning)} .st-critical{--c:var(--error)} .st-offline{--c:var(--grey-500)} .st-lostSignal{--c:var(--info)}
.tire-pos{font-size:8px;font-weight:600;letter-spacing:.5px;color:var(--text-secondary);line-height:1.66}
.tire-pressure{font-family:monospace;font-weight:700;line-height:1}
.pf-l{font-size:16px} .pf-m{font-size:12px} .pf-s{font-size:10px}
.tire-unit{font-size:7px;text-transform:uppercase;color:var(--text-secondary);line-height:1.66}
.tire-temp{font-size:9px;color:var(--text-secondary);margin-top:4px;line-height:1.66}
.tire-nodata{font-size:9px;font-weight:600;font-family:monospace;color:var(--text-disabled);line-height:1}
.tire.unassigned{border:2px dashed var(--grey-500);background:rgba(240,240,240,.8);opacity:.7;box-shadow:none}
@media (prefers-color-scheme: dark){.tire.unassigned{background:rgba(30,30,30,.5)}}
.tire.unassigned:hover{opacity:1;transform:scale(1.03);box-shadow:none}
.tire.unassigned.selected{background:rgba(150,150,150,.1)}
.tire-dash{font-size:9px;font-family:monospace;color:var(--text-disabled);line-height:1}
.tire-nosensor{font-size:7px;color:var(--text-disabled);line-height:1.66}
.legend{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 12px;margin-top:16px;padding:8px;background:var(--hover);border-radius:4px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.legend-label{font-size:10px}
.text-btn{background:none;border:0;color:var(--primary);font:inherit;font-size:.8125rem;font-weight:500;padding:4px 5px;border-radius:4px;cursor:pointer}
.text-btn:hover{background:color-mix(in srgb,var(--primary) 8%,transparent)}

/* detail panel */
.panel{padding:16px}
.panel[hidden]{display:none}
.panel.centered{min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:24px}
.panel.centered[hidden]{display:none}
.card{background:var(--card);border-radius:4px;padding:16px}

@media (min-width:600px){
  .truck{display:flex}
  .unit-name{font-size:1.5rem}
  .header-main{gap:16px}
  .chip{height:24px;font-size:12px}
  .grid-info{grid-template-columns:1fr 1fr}
  .left-box{padding:24px}
  .tire{width:75px;height:100px}
  .tire-pos{font-size:10px} .tire-unit{font-size:9px} .tire-temp{font-size:11px}
  .tire-nodata{font-size:11px} .tire-dash{font-size:11px} .tire-nosensor{font-size:9px}
  .pf-l{font-size:20px} .pf-m{font-size:16px} .pf-s{font-size:12px}
  .spacer{width:70px}
  .axle-bar{width:60px;margin:0 8px}
  .legend{gap:4px 24px;padding:12px}
  .legend-label{font-size:12px}
}
@media (min-width:900px){
  .grid-info{grid-template-columns:1fr 1fr 1fr 1fr}
  .grid-info.two{grid-template-columns:1fr 1fr}
  .diagram-grid{grid-template-columns:1fr 300px}
}
`;

const SCRIPT = `
(function(){
  var active=null;
  function show(id,el){
    document.querySelectorAll('.panel').forEach(function(p){p.hidden=true;});
    var t=document.getElementById(id); if(t) t.hidden=false;
    document.querySelectorAll('.selected').forEach(function(s){s.classList.remove('selected');});
    if(el){ if(el.classList.contains('axle-bar-hit')){ var row=el.closest('.axle-row'); if(row) row.classList.add('selected'); } else el.classList.add('selected'); }
  }
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-panel]'); if(el) show(el.getAttribute('data-panel'),el);
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;
    var el=e.target.closest&&e.target.closest('[data-panel]');
    if(el){e.preventDefault();show(el.getAttribute('data-panel'),el);}
  });
  var btn=document.getElementById('toggle-attached');
  if(btn){btn.addEventListener('click',function(){
    var box=document.getElementById('attached'); var n=btn.getAttribute('data-count');
    box.hidden=!box.hidden;
    btn.textContent=(box.hidden?'Show':'Hide')+' Attached Units ('+n+')';
  });}
  document.querySelectorAll('time[data-ts]').forEach(function(t){
    var d=new Date(Number(t.getAttribute('data-ts'))); if(!isNaN(d)) t.textContent=d.toLocaleString();
  });
})();
`;

function shell(title, body, script = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

export function renderMessagePage(title, message) {
  return shell(
    title,
    `<div class="page"><div class="acc"><div class="acc-det" style="padding-top:16px"><div class="h6">${esc(title)}</div><div class="secondary">${esc(message)}</div></div></div></div>`,
  );
}

/**
 * @param {object} config  response from /api/v1/mobile/units/{id}/configuration
 * @param {number} unitId  the requested unit (first in config.units unless found by id)
 */
export function renderUnitPage(config, unitId) {
  const units = config.units ?? [];
  const unit = units.find((u) => u.id === unitId) ?? units[0];
  if (!unit) return renderMessagePage("Unit not found", "No unit data was returned.");

  const attachedUnits = units.filter((u) => u !== unit);
  const fmt = makeFormatter(config.prefs);

  const body = `<div class="page">
${renderActiveAlerts(unit)}
${renderHeader(unit)}
${renderTireDiagram(unit, attachedUnits, fmt)}
</div>`;

  return shell(`${unit.name} · Unit`, body, SCRIPT);
}
