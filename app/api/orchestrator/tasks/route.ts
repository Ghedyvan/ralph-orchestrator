import type {AgentProvider} from "@/lib/orchestrator/types";

import {isAuthorized, unauthorized} from "@/lib/orchestrator/auth";
import {createTaskPlan, patchTask, readState} from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  return Response.json({tasks: state.tasks});
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as {
      priority?: number;
      decompose?: boolean;
      projectId?: string;
      prompt?: string;
      provider?: AgentProvider;
      title?: string;
    };
    const tasks = await createTaskPlan({
      decompose: body.decompose,
      projectId: body.projectId ?? "",
      title: body.title ?? "",
      prompt: body.prompt ?? "",
      provider: body.provider,
      priority: body.priority,
    });

    return Response.json({task: tasks[0], tasks}, {status: 201});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return Response.json({error: message}, {status: 400});
  }
}

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as {
      action?: "cancel" | "retry" | "complete-review";
      taskId?: string;
    };
    if (!body.taskId) throw new Error("taskId obrigatorio.");
    if (body.action === "cancel") await patchTask(body.taskId, {status: "cancelled"});
    else if (body.action === "retry") await patchTask(body.taskId, {branchName: undefined, status: "queued", workspacePath: undefined});
    else if (body.action === "complete-review") await patchTask(body.taskId, {status: "completed"});
    else throw new Error("Acao invalida.");

    return Response.json({ok: true});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return Response.json({error: message}, {status: 400});
  }
}
