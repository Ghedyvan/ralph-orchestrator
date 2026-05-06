import {isAuthorized, unauthorized} from "@/lib/orchestrator/auth";
import {
  commitRunChanges,
  createRunPullRequest,
  getGitStatus,
  pushRunBranch,
} from "@/lib/orchestrator/git-actions";
import {readState, updateRun} from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GitAction = "status" | "commit" | "push" | "pr";

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as {
      action?: GitAction;
      message?: string;
      runId?: string;
    };
    if (!body.runId) throw new Error("runId obrigatorio.");
    if (!body.action) throw new Error("action obrigatoria.");

    const state = await readState();
    const run = state.runs.find((item) => item.id === body.runId);
    if (!run) throw new Error("Run nao encontrado.");
    const task = state.tasks.find((item) => item.id === run.taskId);
    if (!task) throw new Error("Task nao encontrada.");
    const project = state.projects.find((item) => item.id === run.projectId);
    if (!project) throw new Error("Projeto nao encontrado.");

    const result =
      body.action === "status"
        ? await getGitStatus(run)
        : body.action === "commit"
          ? await commitRunChanges(run, task, body.message)
          : body.action === "push"
            ? await pushRunBranch(run, task)
            : body.action === "pr"
              ? await createRunPullRequest(run, task, project.defaultBranch)
              : null;

    if (!result) throw new Error("Acao invalida.");
    await updateRun({
      ...run,
      commitSha: result.commitSha ?? run.commitSha,
      gitStatus: result.gitStatus ?? run.gitStatus,
      prUrl: result.prUrl ?? run.prUrl,
      remoteBranch: result.remoteBranch ?? run.remoteBranch,
      summary: `${run.summary ?? ""}\nGit ${body.action}: ${result.output}`.trim(),
    });
    return Response.json({result});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return Response.json({error: message}, {status: 400});
  }
}
