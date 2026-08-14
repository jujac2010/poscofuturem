import {
  createMaintenanceAction,
  isCreateMaintenanceAction,
  isKnownAssetId,
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

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    if (!isCreateMaintenanceAction(payload)) {
      return badRequest("siteId, assetId, riskAssessmentId, assignee, and note are required");
    }

    const dependencies = await resolveWorkflowDependencies();
    if (payload.siteId !== dependencies.siteId) {
      return badRequest(`unknown siteId: ${payload.siteId}`);
    }

    if (!isKnownAssetId(payload.assetId, dependencies)) {
      return badRequest(`unknown assetId: ${payload.assetId}`);
    }

    const assessments = await listOpenAssessments(payload.siteId, dependencies);
    if (!assessments.some((assessment) => assessment.id === payload.riskAssessmentId && assessment.assetId === payload.assetId)) {
      return badRequest(`unknown riskAssessmentId: ${payload.riskAssessmentId}`);
    }

    const action = await createMaintenanceAction(payload, dependencies);
    return Response.json(action, { status: 201 });
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
