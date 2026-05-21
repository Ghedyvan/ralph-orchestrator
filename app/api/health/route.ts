import {getSnapshot} from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const snapshot = await getSnapshot();
    return Response.json({
      ok: true,
      checks: {
        datastore: "ok",
        projects: snapshot.projects.length,
        tasks: snapshot.tasks.length,
        worker: snapshot.worker.status,
      },
      worker: snapshot.worker,
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
