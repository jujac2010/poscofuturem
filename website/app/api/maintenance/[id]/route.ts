import {
  completeMaintenanceAction,
  isMaintenanceOutcome,
  isPersistenceUnavailableError,
  PERSISTENCE_UNAVAILABLE_MESSAGE,
  resolveWorkflowDependencies,
  UNEXPECTED_ERROR_MESSAGE,
} from "../../../../lib/telemetry/ingest.ts";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function serviceUnavailable() {
  return Response.json({ error: PERSISTENCE_UNAVAILABLE_MESSAGE }, { status: 503 });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const id = params?.id?.trim() ?? "";
    if (!id) {
      return badRequest("maintenance action id is required");
    }

    const payload = await request.json();
    if (!isMaintenanceOutcome(payload)) {
      return badRequest("status, inspectionNote, actionTaken, partsReplaced, canReturnToService, and actualOverheat are required");
    }

    const dependencies = await resolveWorkflowDependencies();
    const action = await completeMaintenanceAction(id, payload, dependencies);
    return Response.json(action);
  } catch (error) {
    if (isPersistenceUnavailableError(error)) {
      return serviceUnavailable();
    }

    if (error instanceof SyntaxError) {
      return badRequest("request body must be valid JSON");
    }

    if (error instanceof Error && error.message.includes("not found")) {
      return Response.json({ error: "Maintenance action not found." }, { status: 404 });
    }

    return Response.json({ error: UNEXPECTED_ERROR_MESSAGE }, { status: 500 });
  }
}
