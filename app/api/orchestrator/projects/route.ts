import type {AgentProvider} from "@/lib/orchestrator/types";

import {createProject, readState} from "@/lib/orchestrator/store";
import {isAuthorized, unauthorized} from "@/lib/orchestrator/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readState();
  return Response.json({projects: state.projects});
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as {
      autonomyLevel?: "low" | "medium" | "high";
      defaultBranch?: string;
      defaultProvider?: AgentProvider;
      localPath?: string;
      name?: string;
      repoUrl?: string;
      validationCommands?: string;
    };
    const project = await createProject({
      name: body.name ?? "",
      repoUrl: body.repoUrl ?? "",
      defaultBranch: body.defaultBranch,
      defaultProvider: body.defaultProvider,
      localPath: body.localPath,
      autonomyLevel: body.autonomyLevel,
      validationCommands: body.validationCommands
        ?.split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    });

    return Response.json({project}, {status: 201});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return Response.json({error: message}, {status: 400});
  }
}
