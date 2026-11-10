import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { SensorLastReading } from "./readings.js";

export type UnitSensorRow = {
  unitName: string;
  unitStatus: string;
  axle: number | null;
  tire: number | null;
  lastReading: SensorLastReading | null;
};

type DbRow = RowDataPacket & {
  unitName: string;
  unitStatus: string;
  axle: number | null;
  tire: number | null;
  lastReading: SensorLastReading | string | null;
};

let pool: Pool | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getPool(): Pool {
  if (pool) return pool;

  pool = mysql.createPool({
    host: requireEnv("MYSQL_HOST"),
    user: requireEnv("MYSQL_USER"),
    password: requireEnv("MYSQL_PASS"),
    database: requireEnv("MYSQL_DB"),
    port: Number(process.env.MYSQL_PORT ?? "3306"),
    waitForConnections: true,
    connectionLimit: 2,
    enableKeepAlive: true,
  });

  return pool;
}

function parseLastReading(
  value: SensorLastReading | string | null,
): SensorLastReading | null {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) as SensorLastReading;
  } catch {
    return null;
  }
}

/**
 * Load a unit by id + companyId and its active sensors' last readings.
 * Returns null when the unit is missing or deleted.
 */
export async function loadUnitStatus(
  unitId: number,
  companyId: number,
): Promise<{ unitName: string; unitStatus: string; rows: UnitSensorRow[] } | null> {
  const [rows] = await getPool().query<DbRow[]>(
    `SELECT
       u.name AS unitName,
       u.status AS unitStatus,
       s.axle AS axle,
       s.tire AS tire,
       s.lastReading AS lastReading
     FROM pUnit u
     LEFT JOIN pSensor s
       ON s.unitId = u.id
      AND s.status = 'active'
     WHERE u.id = ?
       AND u.companyId = ?
       AND u.status <> 'deleted'`,
    [unitId, companyId],
  );

  if (rows.length === 0) return null;

  const unitName = rows[0].unitName;
  const unitStatus = rows[0].unitStatus;

  // LEFT JOIN with no sensors returns one row with null axle/tire/lastReading.
  const hasAnySensor = rows.some((r) => r.axle != null || r.tire != null || r.lastReading != null);

  const sensorRows: UnitSensorRow[] = hasAnySensor
    ? rows.map((r) => ({
        unitName: r.unitName,
        unitStatus: r.unitStatus,
        axle: r.axle,
        tire: r.tire,
        lastReading: parseLastReading(r.lastReading),
      }))
    : [];

  return { unitName, unitStatus, rows: sensorRows };
}
