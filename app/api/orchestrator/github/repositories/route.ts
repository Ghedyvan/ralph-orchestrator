import {isAuthorized, unauthorized} from "@/lib/orchestrator/auth";
import {listGithubRepositories} from "@/lib/orchestrator/github-repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  try {
    const repositories = await listGithubRepositories();
    return Response.json({repositories});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return Response.json({error: `Falha ao listar repositorios do GitHub. ${message}`}, {status: 400});
  }
}
