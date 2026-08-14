import {
  ingestTelemetry,
  isKnownAssetId,
  isPersistenceUnavailableError,
  isTelemetryRequestRecord,
  PERSISTENCE_UNAVAILABLE_MESSAGE,
  resolveWorkflowDependencies,
  UNEXPECTED_ERROR_MESSAGE,
} from "../../../lib/telemetry/ingest.ts";

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function serviceUnavailable() {
  return Response.json({ error: PERSISTENCE_UNAVAILABLE_MESSAGE }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { records?: unknown[] }).records)) {
      return badRequest("records must be an array");
    }

    const dependencies = await resolveWorkflowDependencies();
    const records = (payload as { records: unknown[] }).records;

    for (const record of records) {
      if (!isTelemetryRequestRecord(record)) {
        return badRequest("each telemetry record must include assetId, observedAt, sourceType, and values");
      }

      if (!isKnownAssetId(record.assetId, dependencies)) {
        return badRequest(`unknown assetId: ${record.assetId}`);
      }
    }

    const result = await ingestTelemetry(records, dependencies);
    return Response.json(result);
  } catch (error) {
    if (isPersistenceUnavailableError(error)) {
      return serviceUnavailable();
    }

    if (error instanceof SyntaxError) {
      return badRequest("request body must be valid JSON");
    }

    return Response.json({ error: UNEXPECTED_ERROR_MESSAGE }, { status: 500 });
  }
}
