import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { decodeTagCode } from "./decode.js";
import { loadUnitStatus } from "./db.js";
import {
  renderErrorPage,
  renderNotFoundPage,
  renderStatusPage,
} from "./html.js";
import { toDisplayReading } from "./readings.js";

function htmlResponse(statusCode: number, body: string) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const code = event.pathParameters?.code;
    if (!code) {
      return htmlResponse(404, renderNotFoundPage());
    }

    const ids = decodeTagCode(code);
    if (!ids) {
      return htmlResponse(404, renderNotFoundPage());
    }

    const unit = await loadUnitStatus(ids.unitId, ids.companyId);
    if (!unit) {
      return htmlResponse(404, renderNotFoundPage());
    }

    const readings = unit.rows
      .map((row) => toDisplayReading(row.axle, row.tire, row.lastReading))
      .sort((a, b) => {
        const axleDiff = (a.axle ?? 0) - (b.axle ?? 0);
        if (axleDiff !== 0) return axleDiff;
        return (a.tire ?? 0) - (b.tire ?? 0);
      });

    return htmlResponse(
      200,
      renderStatusPage({
        unitName: unit.unitName,
        unitStatus: unit.unitStatus,
        readings,
      }),
    );
  } catch (err) {
    console.error("tag-status failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return htmlResponse(503, renderErrorPage());
  }
};
