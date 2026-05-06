import {OrchestratorDashboard} from "@/components/orchestrator-dashboard";
import {getSnapshot} from "@/lib/orchestrator/store";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const snapshot = await getSnapshot();

  return <OrchestratorDashboard initialSnapshot={snapshot} view="runs" />;
}
