import { isPersistenceUnavailableError, listOpenAssessments, resolveWorkflowDependencies } from "../../../lib/telemetry/ingest.ts";

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function serviceUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : "Operational persistence is unavailable.";
  return Response.json({ error: message }, { status: 503 });
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
      return serviceUnavailable(error);
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
