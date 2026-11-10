const BAD_PRESSURE_HEX = "FF";
const BAD_TEMP_HEX = "FE";
const NO_TEMP_HEX = "FFF";

export type SensorLastReading = {
  pressure?: string;
  temperature?: string;
  timeStamp?: number;
  latitude?: number;
  longitude?: number;
};

export type DisplayReading = {
  axle: number | null;
  tire: number | null;
  pressurePsi: number | null;
  temperatureF: number | null;
  timeStampSeconds: number | null;
};

/**
 * Pressure hex on pSensor.lastReading is PSI as a hex integer.
 * "FF" means no reading.
 */
export function parsePressureHex(pressureHex: string | undefined): number | null {
  if (!pressureHex) return null;
  if (pressureHex.toUpperCase() === BAD_PRESSURE_HEX) return null;
  const psi = parseInt(pressureHex, 16);
  return Number.isFinite(psi) ? psi : null;
}

/**
 * Temperature protocol used by IQ (see phoenix-rapid unitFormatters.parseTemp).
 * Values >= 128 have 128 subtracted, then °F = -50 + 2.5 * n.
 * "FFF" / "FE" mean no reading.
 */
export function parseTempHex(tempHex: string | undefined): number | null {
  if (!tempHex) return null;
  const normalized = tempHex.toUpperCase();
  if (normalized === NO_TEMP_HEX || normalized === BAD_TEMP_HEX) return null;

  let t = parseInt(tempHex, 16);
  if (!Number.isFinite(t)) return null;
  if (t >= 128) t -= 128;

  return -50 + 2.5 * t;
}

export function toDisplayReading(
  axle: number | null,
  tire: number | null,
  lastReading: SensorLastReading | null,
): DisplayReading {
  if (!lastReading) {
    return {
      axle,
      tire,
      pressurePsi: null,
      temperatureF: null,
      timeStampSeconds: null,
    };
  }

  const timeStampSeconds =
    typeof lastReading.timeStamp === "number" && lastReading.timeStamp > 0
      ? lastReading.timeStamp
      : null;

  return {
    axle,
    tire,
    pressurePsi: parsePressureHex(lastReading.pressure),
    temperatureF: parseTempHex(lastReading.temperature),
    timeStampSeconds,
  };
}
