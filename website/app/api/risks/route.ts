import {
  isPersistenceUnavailableError,
  listOpenAssessments,
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim().toLowerCase() ?? "open";

    if (!siteId) {
      return badRequest("siteId is required");
    }

    if (status !== "open") {
      return badRequest("only status=open is supported");
    }

    const dependencies = await resolveWorkflowDependencies();
    if (siteId !== dependencies.siteId) {
      return badRequest(`unknown siteId: ${siteId}`);
    }

    const assessments = await listOpenAssessments(siteId, dependencies);
    return Response.json({ assessments });
  } catch (error) {
    if (isPersistenceUnavailableError(error)) {
      return serviceUnavailable();
    }

    return Response.json({ error: UNEXPECTED_ERROR_MESSAGE }, { status: 500 });
  }
}
