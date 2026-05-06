import {readState} from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  return Response.json({runs: state.runs, logs: state.logs});
}
