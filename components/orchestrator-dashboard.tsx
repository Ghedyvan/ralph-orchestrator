"use client";

import type {AgentProvider, DashboardSnapshot, Task, TaskStatus} from "@/lib/orchestrator/types";

import {useEffect, useMemo, useState} from "react";
import {
  ArrowRotateLeft,
  CircleCheck,
  CirclePlay,
  CirclePlus,
  Clock,
  Gear,
  OctagonXmark,
  TriangleExclamation,
} from "@gravity-ui/icons";
import {Button, Card, Chip, ScrollShadow} from "@heroui/react";
import {Kanban} from "@heroui-pro/react";

type FormState = {
  error?: string;
  ok?: string;
};

type AuthState = {
  checked: boolean;
  enabled: boolean;
  authorized: boolean;
  error?: string;
};

const inputClass =
  "min-h-10 rounded-xl bg-surface-secondary px-3 py-2 text-sm text-foreground outline-none ring-1 ring-border focus:ring-2 focus:ring-accent";
const taskTemplates = {
  bug: "Corrija o bug abaixo. Reproduza, implemente menor fix seguro, rode validacoes e documente risco.",
  feature: "Implemente a funcionalidade abaixo em etapas pequenas, com validacoes e sem alterar escopo nao relacionado.",
  refactor: "Refatore o trecho abaixo mantendo comportamento, melhorando legibilidade e rodando validacoes.",
  docs: "Atualize documentacao abaixo com exemplos claros, comandos de uso e riscos conhecidos.",
};
const taskColumns: Array<{color: string; label: string; status: TaskStatus}> = [
  {color: "bg-default", label: "Queued", status: "queued"},
  {color: "bg-warning", label: "Running", status: "running"},
  {color: "bg-danger", label: "Blocked", status: "blocked"},
  {color: "bg-danger", label: "Failed", status: "failed"},
  {color: "bg-accent", label: "Review", status: "review"},
  {color: "bg-success", label: "Done", status: "completed"},
];

async function postJson(url: string, payload: unknown) {
  const token = typeof window === "undefined" ? "" : localStorage.getItem("ralph_admin_token");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as {error?: string};
  if (!response.ok) throw new Error(body.error ?? "Falha na requisicao.");
  return body;
}

async function patchJson(url: string, payload: unknown) {
  const token = typeof window === "undefined" ? "" : localStorage.getItem("ralph_admin_token");
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as {error?: string};
  if (!response.ok) throw new Error(body.error ?? "Falha na requisicao.");
  return body;
}

function StatusChip({status}: {status: string}) {
  const color =
    status === "completed" || status === "active"
      ? "success"
      : status === "failed" || status === "blocked"
        ? "danger"
        : status === "running"
          ? "warning"
          : "default";

  return (
    <Chip color={color} size="sm" variant="soft">
      <Chip.Label>{status}</Chip.Label>
    </Chip>
  );
}

function Summary({snapshot}: {snapshot: DashboardSnapshot}) {
  const items = [
    {icon: <Gear />, label: "Projetos", status: "success", value: snapshot.totals.projects},
    {icon: <Clock />, label: "Fila", status: "warning", value: snapshot.totals.queued},
    {icon: <CirclePlay />, label: "Rodando", status: "warning", value: snapshot.totals.running},
    {icon: <CircleCheck />, label: "Concluidas", status: "success", value: snapshot.totals.completed},
    {
      icon: <TriangleExclamation />,
      label: "Falhas",
      status: snapshot.totals.failed > 0 ? "danger" : "success",
      value: snapshot.totals.failed,
    },
  ];

  return (
    <div className="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <Card.Content className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm text-muted">{item.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{item.value}</p>
            </div>
            <Chip color={item.status as "success" | "warning" | "danger"} size="sm" variant="soft">
              {item.icon}
            </Chip>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

function TaskKanbanCard({
  onAction,
  projectName,
  task,
}: {
  onAction: (taskId: string, action: "cancel" | "retry" | "complete-review") => void;
  projectName: string;
  task: Task;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-semibold">{task.title}</p>
        <p className="truncate text-xs text-muted">{projectName}</p>
      </div>
      <p className="line-clamp-3 text-xs leading-5 text-muted">{task.prompt}</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip size="sm" variant="secondary">
          <Chip.Label>{task.provider}</Chip.Label>
        </Chip>
        {task.branchName ? (
          <Chip size="sm" variant="secondary">
            <Chip.Label>{task.branchName}</Chip.Label>
          </Chip>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onPress={() => onAction(task.id, "retry")}>
          <ArrowRotateLeft />
          Retry
        </Button>
        <Button size="sm" variant="outline" onPress={() => onAction(task.id, "complete-review")}>
          <CircleCheck />
          OK
        </Button>
        <Button size="sm" variant="danger-soft" onPress={() => onAction(task.id, "cancel")}>
          <OctagonXmark />
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function OrchestratorDashboard({initialSnapshot}: {initialSnapshot: DashboardSnapshot}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [auth, setAuth] = useState<AuthState>({
    checked: false,
    enabled: false,
    authorized: false,
  });
  const [projectState, setProjectState] = useState<FormState>({});
  const [taskState, setTaskState] = useState<FormState>({});
  const [chatState, setChatState] = useState<FormState>({});
  const [gitState, setGitState] = useState<FormState>({});
  const activeProjects = useMemo(
    () => snapshot.projects.filter((project) => project.status === "active"),
    [snapshot.projects],
  );

  useEffect(() => {
    const token = localStorage.getItem("ralph_admin_token");
    fetch("/api/orchestrator/auth", {
      headers: token ? {Authorization: `Bearer ${token}`} : {},
    })
      .then((response) => response.json())
      .then((body: {authorized: boolean; enabled: boolean}) =>
        setAuth({checked: true, enabled: body.enabled, authorized: body.authorized}),
      )
      .catch(() =>
        setAuth({checked: true, enabled: true, authorized: false, error: "Falha ao verificar auth."}),
      );
  }, []);

  useEffect(() => {
    const events = new EventSource("/api/orchestrator/logs/stream");
    events.addEventListener("logs", () => {
      refresh().catch(() => undefined);
    });
    return () => events.close();
  }, []);

  async function login(formData: FormData) {
    const token = String(formData.get("token") ?? "");
    localStorage.setItem("ralph_admin_token", token);
    const response = await fetch("/api/orchestrator/auth", {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!response.ok) {
      localStorage.removeItem("ralph_admin_token");
      setAuth({checked: true, enabled: true, authorized: false, error: "Token invalido."});
      return;
    }
    setAuth({checked: true, enabled: true, authorized: true});
  }

  async function refresh() {
    const response = await fetch("/api/orchestrator/snapshot", {cache: "no-store"});
    setSnapshot((await response.json()) as DashboardSnapshot);
  }

  async function createProject(formData: FormData) {
    setProjectState({});
    try {
      await postJson("/api/orchestrator/projects", {
        name: formData.get("name"),
        repoUrl: formData.get("repoUrl"),
        defaultBranch: formData.get("defaultBranch"),
        localPath: formData.get("localPath"),
        defaultProvider: formData.get("defaultProvider"),
        autonomyLevel: formData.get("autonomyLevel"),
        validationCommands: formData.get("validationCommands"),
      });
      setProjectState({ok: "Projeto criado."});
      await refresh();
    } catch (error) {
      setProjectState({error: error instanceof Error ? error.message : "Erro desconhecido."});
    }
  }

  async function createTask(formData: FormData) {
    setTaskState({});
    try {
      await postJson("/api/orchestrator/tasks", {
        projectId: formData.get("projectId"),
        title: formData.get("title"),
        prompt: `${taskTemplates[String(formData.get("template")) as keyof typeof taskTemplates] ?? ""}\n\n${formData.get("prompt")}`,
        provider: formData.get("provider") as AgentProvider,
      });
      setTaskState({ok: "Task enviada para fila."});
      await refresh();
    } catch (error) {
      setTaskState({error: error instanceof Error ? error.message : "Erro desconhecido."});
    }
  }

  async function createChatCommand(formData: FormData) {
    setChatState({});
    try {
      const projectId = String(formData.get("projectId") ?? "");
      const prompt = String(formData.get("message") ?? "").trim();
      if (!prompt) throw new Error("Mensagem obrigatoria.");
      await postJson("/api/orchestrator/tasks", {
        projectId,
        title: prompt.slice(0, 80),
        prompt: `Comando enviado pelo chat operacional:\n\n${prompt}`,
        provider: formData.get("provider") as AgentProvider,
      });
      setChatState({ok: "Comando enviado para fila."});
      await refresh();
    } catch (error) {
      setChatState({error: error instanceof Error ? error.message : "Erro desconhecido."});
    }
  }

  async function taskAction(taskId: string, action: "cancel" | "retry" | "complete-review") {
    await patchJson("/api/orchestrator/tasks", {taskId, action});
    await refresh();
  }

  async function revalidateRun(runId: string) {
    const run = snapshot.runs.find((item) => item.id === runId);
    const task = run ? snapshot.tasks.find((item) => item.id === run.taskId) : null;
    if (!run || !task) return;

    await postJson("/api/orchestrator/tasks", {
      projectId: run.projectId,
      title: `Revalidar: ${task.title}`,
      provider: "opencode-go",
      prompt: `Rode novamente as validacoes configuradas para a task ${task.id}. Workspace: ${run.workspacePath}. Arquivos alterados: ${(run.changedFiles ?? []).join(", ") || "nenhum registrado"}.`,
    });
    await refresh();
  }

  async function gitAction(runId: string, action: "status" | "commit" | "push" | "pr") {
    setGitState({});
    try {
      const run = snapshot.runs.find((item) => item.id === runId);
      const task = run ? snapshot.tasks.find((item) => item.id === run.taskId) : null;
      await postJson("/api/orchestrator/git", {
        action,
        runId,
        message: task ? `ralph: ${task.title}` : undefined,
      });
      setGitState({ok: `Git ${action} executado.`});
      await refresh();
    } catch (error) {
      setGitState({error: error instanceof Error ? error.message : "Erro desconhecido."});
    }
  }

  const recentLogs = snapshot.logs.slice(-8).reverse();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {auth.checked && auth.enabled && !auth.authorized ? (
        <Card className="shrink-0">
          <Card.Header>
            <Card.Title>Acesso Admin</Card.Title>
            <Card.Description>Informe token configurado em `RALPH_ADMIN_TOKEN`.</Card.Description>
          </Card.Header>
          <Card.Content>
            <form action={login} className="flex flex-col gap-3 sm:max-w-md">
              <input className={inputClass} name="token" placeholder="Token admin" type="password" />
              {auth.error ? <p className="text-sm text-danger">{auth.error}</p> : null}
              <Button type="submit">Entrar</Button>
            </form>
          </Card.Content>
        </Card>
      ) : null}

      {auth.checked && auth.enabled && !auth.authorized ? null : (
        <>
      <Summary snapshot={snapshot} />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[420px_1fr]">
        <ScrollShadow className="min-h-0 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            <Card>
              <Card.Header>
                <Card.Title>Novo Projeto</Card.Title>
                <Card.Description>Repo que worker usara como alvo.</Card.Description>
              </Card.Header>
              <Card.Content>
                <form action={createProject} className="flex flex-col gap-3">
                  <input className={inputClass} name="name" placeholder="Nome" />
                  <input className={inputClass} name="repoUrl" placeholder="Git URL ou caminho" />
                  <input className={inputClass} name="defaultBranch" placeholder="Branch: main" />
                  <input className={inputClass} name="localPath" placeholder="Path local opcional" />
                  <select className={inputClass} name="defaultProvider" defaultValue="manual">
                    {snapshot.providers.map((provider) => (
                      <option key={provider.provider} value={provider.provider}>
                        Provider padrao: {provider.label}
                      </option>
                    ))}
                  </select>
                  <select className={inputClass} name="autonomyLevel" defaultValue="medium">
                    <option value="low">Autonomia baixa</option>
                    <option value="medium">Autonomia media</option>
                    <option value="high">Autonomia alta</option>
                  </select>
                  <textarea
                    className={`${inputClass} min-h-20 resize-none`}
                    name="validationCommands"
                    placeholder={"yarn lint\nyarn typecheck\nyarn build"}
                  />
                  {projectState.error ? <p className="text-sm text-danger">{projectState.error}</p> : null}
                  {projectState.ok ? <p className="text-sm text-success">{projectState.ok}</p> : null}
                  <Button isDisabled={auth.enabled && !auth.authorized} type="submit">
                    <CirclePlus />
                    Criar Projeto
                  </Button>
                </form>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>Nova Task</Card.Title>
                <Card.Description>Entra na fila do worker 24/7.</Card.Description>
              </Card.Header>
              <Card.Content>
                <form action={createTask} className="flex flex-col gap-3">
                  <select className={inputClass} name="projectId" defaultValue="">
                    <option value="" disabled>
                      Escolha projeto
                    </option>
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <select className={inputClass} name="provider" defaultValue="manual">
                    {snapshot.providers.map((provider) => (
                      <option key={provider.provider} value={provider.provider}>
                        {provider.label} {provider.enabled ? "" : "(dry/disabled)"}
                      </option>
                    ))}
                  </select>
                  <select className={inputClass} name="template" defaultValue="feature">
                    <option value="bug">Template: bug</option>
                    <option value="feature">Template: feature</option>
                    <option value="refactor">Template: refactor</option>
                    <option value="docs">Template: docs</option>
                  </select>
                  <input className={inputClass} name="title" placeholder="Titulo curto" />
                  <textarea
                    className={`${inputClass} min-h-32 resize-none`}
                    name="prompt"
                    placeholder="Descreva atividade para delegar"
                  />
                  {taskState.error ? <p className="text-sm text-danger">{taskState.error}</p> : null}
                  {taskState.ok ? <p className="text-sm text-success">{taskState.ok}</p> : null}
                  <Button isDisabled={auth.enabled && !auth.authorized} type="submit">
                    <CirclePlay />
                    Delegar Task
                  </Button>
                </form>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>Chat Operacional</Card.Title>
                <Card.Description>Envie novo comando e acompanhe respostas pelo log.</Card.Description>
              </Card.Header>
              <Card.Content>
                <form action={createChatCommand} className="flex flex-col gap-3">
                  <select className={inputClass} name="projectId" defaultValue={activeProjects[0]?.id ?? ""}>
                    <option value="" disabled>
                      Escolha projeto
                    </option>
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <select className={inputClass} name="provider" defaultValue="codex">
                    {snapshot.providers.map((provider) => (
                      <option key={provider.provider} value={provider.provider}>
                        {provider.label} {provider.enabled ? "" : "(dry/disabled)"}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className={`${inputClass} min-h-28 resize-none`}
                    name="message"
                    placeholder="Digite comando para agente"
                  />
                  {chatState.error ? <p className="text-sm text-danger">{chatState.error}</p> : null}
                  {chatState.ok ? <p className="text-sm text-success">{chatState.ok}</p> : null}
                  <Button isDisabled={auth.enabled && !auth.authorized} type="submit">
                    <CirclePlay />
                    Enviar Comando
                  </Button>
                </form>
                <div className="mt-4 flex flex-col gap-2">
                  {recentLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="rounded-2xl bg-surface-secondary p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Chip
                          color={log.level === "error" ? "danger" : log.level === "warn" ? "warning" : "default"}
                          size="sm"
                          variant="soft"
                        >
                          <Chip.Label>{log.level}</Chip.Label>
                        </Chip>
                        <span className="text-xs text-muted">{log.createdAt}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted">{log.message}</p>
                    </div>
                  ))}
                </div>
              </Card.Content>
            </Card>
          </div>
        </ScrollShadow>

        <div className="grid min-h-0 gap-4 lg:grid-cols-2">
          <Card className="min-h-0">
            <Card.Header>
              <Card.Title>Projetos</Card.Title>
              <Card.Description>{snapshot.projects.length} cadastrados</Card.Description>
            </Card.Header>
            <Card.Content className="min-h-0">
              <ScrollShadow className="max-h-full overflow-y-auto">
                <div className="flex flex-col gap-3">
                  {snapshot.projects.map((project) => (
                    <div key={project.id} className="rounded-2xl bg-surface-secondary p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{project.name}</p>
                          <p className="truncate text-xs text-muted">{project.repoUrl}</p>
                        </div>
                        <StatusChip status={project.status} />
                      </div>
                      <p className="mt-2 text-xs text-muted">Branch: {project.defaultBranch}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip size="sm" variant="secondary">
                          <Chip.Label>{project.defaultProvider ?? "manual"}</Chip.Label>
                        </Chip>
                        <Chip size="sm" variant="secondary">
                          <Chip.Label>{project.autonomyLevel ?? "medium"}</Chip.Label>
                        </Chip>
                      </div>
                    </div>
                  ))}
                  {snapshot.projects.length === 0 ? (
                    <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">
                      Nenhum projeto ainda.
                    </p>
                  ) : null}
                </div>
              </ScrollShadow>
            </Card.Content>
          </Card>

          <Card className="min-h-0 lg:col-span-2">
            <Card.Header>
              <Card.Title>Kanban de Tasks</Card.Title>
              <Card.Description>{snapshot.tasks.length} tasks por status</Card.Description>
            </Card.Header>
            <Card.Content className="min-h-0">
              <Kanban hideScrollBar className="h-full min-h-[520px] items-start overflow-visible" isEnabled={false}>
                {taskColumns.map((column) => {
                  const items = snapshot.tasks.filter((task) => task.status === column.status);
                  return (
                    <Kanban.Column key={column.status} className="h-full min-w-72">
                      <Kanban.ColumnHeader>
                        <Kanban.ColumnIndicator className={column.color} />
                        <Kanban.ColumnTitle>{column.label}</Kanban.ColumnTitle>
                        <Kanban.ColumnCount>{items.length}</Kanban.ColumnCount>
                      </Kanban.ColumnHeader>
                      <Kanban.ColumnBody className="min-h-0">
                        <Kanban.ScrollShadow className="max-h-[460px]">
                          <Kanban.CardList
                            aria-label={column.label}
                            items={items}
                            renderEmptyState={() => (
                              <p className="p-3 text-sm text-muted">Sem tasks.</p>
                            )}
                          >
                            {(task: Task) => {
                              const project = snapshot.projects.find((item) => item.id === task.projectId);
                              return (
                                <Kanban.Card id={task.id} textValue={task.title}>
                                  <TaskKanbanCard
                                    onAction={taskAction}
                                    projectName={project?.name ?? task.projectId}
                                    task={task}
                                  />
                                </Kanban.Card>
                              );
                            }}
                          </Kanban.CardList>
                        </Kanban.ScrollShadow>
                      </Kanban.ColumnBody>
                    </Kanban.Column>
                  );
                })}
              </Kanban>
            </Card.Content>
          </Card>

          <Card className="min-h-0 lg:col-span-2">
            <Card.Header>
              <Card.Title>Runs e Logs</Card.Title>
              <Card.Description>
                {snapshot.runs.length} runs / {snapshot.logs.length} eventos
              </Card.Description>
            </Card.Header>
            <Card.Content className="grid min-h-0 gap-4 lg:grid-cols-2">
              <ScrollShadow className="max-h-64 overflow-y-auto">
                <div className="flex flex-col gap-3">
                  {gitState.error ? (
                    <p className="rounded-2xl bg-danger/10 p-3 text-sm text-danger">{gitState.error}</p>
                  ) : null}
                  {gitState.ok ? (
                    <p className="rounded-2xl bg-success/10 p-3 text-sm text-success">{gitState.ok}</p>
                  ) : null}
                  {snapshot.runs.slice(0, 8).map((run) => {
                    const task = snapshot.tasks.find((item) => item.id === run.taskId);
                    return (
                      <div key={run.id} className="rounded-2xl bg-surface-secondary p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {task?.title ?? run.taskId}
                            </p>
                            <p className="truncate text-xs text-muted">{run.workspacePath}</p>
                          </div>
                          <StatusChip status={run.status} />
                        </div>
                        {run.summary ? (
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
                            {run.summary}
                          </p>
                        ) : null}
                        {run.changedFiles?.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {run.changedFiles.slice(0, 6).map((file) => (
                              <Chip key={file} size="sm" variant="secondary">
                                <Chip.Label>{file}</Chip.Label>
                              </Chip>
                            ))}
                          </div>
                        ) : null}
                        {run.diffSummary ? (
                          <pre className="mt-3 max-h-24 overflow-auto rounded-xl bg-background p-3 text-xs text-muted">
                            {run.diffSummary}
                          </pre>
                        ) : null}
                        <div className="mt-3 grid gap-2 rounded-2xl bg-background p-3">
                          <div className="flex flex-wrap gap-1.5">
                            {run.commitSha ? (
                              <Chip size="sm" variant="secondary">
                                <Chip.Label>{run.commitSha.slice(0, 12)}</Chip.Label>
                              </Chip>
                            ) : null}
                            {run.remoteBranch ? (
                              <Chip size="sm" variant="secondary">
                                <Chip.Label>{run.remoteBranch}</Chip.Label>
                              </Chip>
                            ) : null}
                            {run.prUrl ? (
                              <Chip color="success" size="sm" variant="soft">
                                <Chip.Label>PR pronto</Chip.Label>
                              </Chip>
                            ) : null}
                          </div>
                          {run.gitStatus ? (
                            <pre className="max-h-20 overflow-auto rounded-xl bg-surface-secondary p-2 text-xs text-muted">
                              {run.gitStatus}
                            </pre>
                          ) : null}
                          {run.prUrl ? (
                            <a className="truncate text-xs text-accent no-underline" href={run.prUrl}>
                              {run.prUrl}
                            </a>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onPress={() => revalidateRun(run.id)}>
                            <ArrowRotateLeft />
                            Revalidar
                          </Button>
                          <Button size="sm" variant="outline" onPress={() => gitAction(run.id, "status")}>
                            <Gear />
                            Git status
                          </Button>
                          <Button size="sm" variant="outline" onPress={() => gitAction(run.id, "commit")}>
                            <CircleCheck />
                            Commit
                          </Button>
                          <Button size="sm" variant="outline" onPress={() => gitAction(run.id, "push")}>
                            <CirclePlay />
                            Push
                          </Button>
                          <Button size="sm" variant="outline" onPress={() => gitAction(run.id, "pr")}>
                            <CirclePlus />
                            PR
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {snapshot.runs.length === 0 ? (
                    <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">
                      Nenhum run ainda.
                    </p>
                  ) : null}
                </div>
              </ScrollShadow>
              <ScrollShadow className="max-h-64 overflow-y-auto">
                <div className="flex flex-col gap-2">
                  {recentLogs.map((log) => (
                    <div key={log.id} className="rounded-2xl bg-surface-secondary p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Chip
                          color={
                            log.level === "error"
                              ? "danger"
                              : log.level === "warn"
                                ? "warning"
                                : "default"
                          }
                          size="sm"
                          variant="soft"
                        >
                          <Chip.Label>{log.level}</Chip.Label>
                        </Chip>
                        <span className="text-xs text-muted">{log.createdAt}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted">{log.message}</p>
                    </div>
                  ))}
                  {recentLogs.length === 0 ? (
                    <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">
                      Nenhum log ainda.
                    </p>
                  ) : null}
                </div>
              </ScrollShadow>
            </Card.Content>
          </Card>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
