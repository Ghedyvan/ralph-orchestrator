import {readState} from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const state = await readState();
    return Response.json({
      ok: true,
      checks: {
        datastore: "ok",
        projects: state.projects.length,
        tasks: state.tasks.length,
      },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro desconhecido.",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      {status: 500},
    );
  }
}
