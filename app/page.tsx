import {OrchestratorDashboard} from "@/components/orchestrator-dashboard";
import {getSnapshot} from "@/lib/orchestrator/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getSnapshot();

  return (
    <main className="h-screen overflow-hidden bg-background px-4 py-4 text-foreground sm:px-6 sm:py-6">
      <div className="flex h-full w-full min-w-0 flex-col gap-4">
        <header className="shrink-0">
          <p className="text-sm text-muted">Ralph Orchestrator</p>
          <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">Delegacao 24/7</h1>
          <p className="mt-1 line-clamp-2 max-w-5xl text-sm text-muted">
            Cadastre repos, crie tasks, acompanhe fila e deixe worker processar em VPS.
          </p>
        </header>

        <OrchestratorDashboard initialSnapshot={snapshot} />
      </div>
    </main>
  );
}
