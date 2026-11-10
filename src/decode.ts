export type TagIds = {
  unitId: number;
  companyId: number;
};

/**
 * Decode a base64url sticker path of the form unitId.companyId.
 * Accepts padded or unpadded base64 / base64url.
 */
export function decodeTagCode(code: string): TagIds | null {
  if (!code || code.length > 128) return null;

  try {
    const normalized = code.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const decoded = Buffer.from(padded, "base64").toString("utf8");

    const match = /^(\d+)\.(\d+)$/.exec(decoded);
    if (!match) return null;

    const unitId = Number(match[1]);
    const companyId = Number(match[2]);
    if (!Number.isInteger(unitId) || !Number.isInteger(companyId)) return null;
    if (unitId <= 0 || companyId <= 0) return null;

    return { unitId, companyId };
  } catch {
    return null;
  }
}

/** Build the base64url path segment for a unit + company. */
export function encodeTagCode(unitId: number, companyId: number): string {
  return Buffer.from(`${unitId}.${companyId}`).toString("base64url");
}
