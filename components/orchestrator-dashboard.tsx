"use client";

import type {AgentProvider, DashboardSnapshot, Run, Task, TaskStatus} from "@/lib/orchestrator/types";

import {usePathname, useRouter} from "next/navigation";
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
import {Button, Card, Chip, Modal, ScrollShadow} from "@heroui/react";
import {AppLayout, Kanban, Navbar, Sidebar as ProSidebar} from "@heroui-pro/react";

type OrchestratorView = "overview" | "kanban" | "projects" | "tasks" | "runs";

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

const navItems: Array<{href: string; label: string; view: OrchestratorView}> = [
  {href: "/", label: "Visao Geral", view: "overview"},
  {href: "/kanban", label: "Kanban", view: "kanban"},
  {href: "/projects", label: "Projetos", view: "projects"},
  {href: "/tasks", label: "Tasks", view: "tasks"},
  {href: "/runs", label: "Runs", view: "runs"},
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
      : status === "failed" || status === "blocked" || status === "cancelled"
        ? "danger"
        : status === "running" || status === "review"
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

function PageHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <header className="shrink-0">
      <p className="text-sm text-muted">Ralph Orchestrator</p>
      <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">{title}</h1>
      <p className="mt-1 line-clamp-2 max-w-5xl text-sm text-muted">{description}</p>
    </header>
  );
}

function SidebarNavigation({view}: {view: OrchestratorView}) {
  const pathname = usePathname();

  return (
    <>
      <ProSidebar.Header>
        <p className="text-sm text-muted">Ralph</p>
        <p className="text-lg font-semibold">Orquestrador</p>
      </ProSidebar.Header>
      <ProSidebar.Content>
        <ProSidebar.Group>
          <ProSidebar.GroupLabel>Navegacao</ProSidebar.GroupLabel>
          <ProSidebar.Menu aria-label="Navegacao principal">
            {navItems.map((item) => {
              const active = view === item.view || pathname === item.href;
              return (
                <ProSidebar.MenuItem key={item.href} href={item.href} isCurrent={active} tooltip={item.label}>
                  <ProSidebar.MenuLabel>{item.label}</ProSidebar.MenuLabel>
                </ProSidebar.MenuItem>
              );
            })}
          </ProSidebar.Menu>
        </ProSidebar.Group>
      </ProSidebar.Content>
    </>
  );
}

function AppSidebar({view}: {view: OrchestratorView}) {
  return (
    <>
      <ProSidebar>
        <SidebarNavigation view={view} />
        <ProSidebar.Rail />
      </ProSidebar>
      <ProSidebar.Mobile>
        <SidebarNavigation view={view} />
      </ProSidebar.Mobile>
    </>
  );
}

function AppNavbar({description, title}: {description: string; title: string}) {
  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle tooltip="Abrir menu" />
        <ProSidebar.Trigger tooltip="Alternar sidebar" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="hidden truncate text-xs text-muted sm:block">{description}</p>
        </div>
        <Navbar.Spacer />
      </Navbar.Header>
    </Navbar>
  );
}

function ProjectForm({
  activeProjects,
  auth,
  createProject,
  projectState,
  snapshot,
}: {
  activeProjects: DashboardSnapshot["projects"];
  auth: AuthState;
  createProject: (formData: FormData) => void;
  projectState: FormState;
  snapshot: DashboardSnapshot;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Novo Projeto</Card.Title>
        <Card.Description>{activeProjects.length} projetos ativos</Card.Description>
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
  );
}

function TaskForm({
  activeProjects,
  auth,
  createTask,
  snapshot,
  taskState,
}: {
  activeProjects: DashboardSnapshot["projects"];
  auth: AuthState;
  createTask: (formData: FormData) => void;
  snapshot: DashboardSnapshot;
  taskState: FormState;
}) {
  return (
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
  );
}

function ProjectsList({snapshot}: {snapshot: DashboardSnapshot}) {
  return (
    <Card className="min-h-0">
      <Card.Header>
        <Card.Title>Projetos</Card.Title>
        <Card.Description>{snapshot.projects.length} cadastrados</Card.Description>
      </Card.Header>
      <Card.Content className="min-h-0">
        <ScrollShadow className="max-h-full overflow-y-auto">
          <div className="grid gap-3 xl:grid-cols-2">
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
              <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">Nenhum projeto ainda.</p>
            ) : null}
          </div>
        </ScrollShadow>
      </Card.Content>
    </Card>
  );
}

function TaskDetailModal({
  gitAction,
  gitState,
  onAction,
  onClose,
  projectName,
  runs,
  task,
}: {
  gitAction: (runId: string, action: "status" | "commit" | "push" | "pr") => void;
  gitState: FormState;
  onAction: (taskId: string, action: "cancel" | "retry" | "complete-review") => void;
  onClose: () => void;
  projectName: string;
  runs: Run[];
  task: Task | null;
}) {
  const taskRuns = task ? runs.filter((run) => run.taskId === task.id) : [];
  const latestRun = taskRuns.at(-1);

  return (
    <Modal.Backdrop
      isOpen={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="blur"
    >
      <Modal.Container placement="center" scroll="inside" size="cover">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <div className="flex min-w-0 flex-col gap-2">
              <Modal.Heading>{task?.title ?? "Task"}</Modal.Heading>
              <div className="flex flex-wrap gap-2">
                <StatusChip status={task?.status ?? "queued"} />
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{projectName}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{task?.provider ?? "manual"}</Chip.Label>
                </Chip>
              </div>
            </div>
          </Modal.Header>
          <Modal.Body>
            {task ? (
              <div className="grid max-h-[calc(100dvh-220px)] gap-4 overflow-y-auto pr-2">
              <section>
                <p className="text-sm font-semibold">Prompt</p>
                <pre className="mt-2 max-h-56 overflow-auto rounded-2xl bg-surface-secondary p-4 whitespace-pre-wrap text-sm leading-6 text-muted">
                  {task.prompt}
                </pre>
              </section>
              <section className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl bg-surface-secondary p-4">
                  <p className="text-xs text-muted">Criada</p>
                  <p className="mt-1 text-sm">{task.createdAt}</p>
                </div>
                <div className="rounded-2xl bg-surface-secondary p-4">
                  <p className="text-xs text-muted">Atualizada</p>
                  <p className="mt-1 text-sm">{task.updatedAt}</p>
                </div>
                <div className="rounded-2xl bg-surface-secondary p-4">
                  <p className="text-xs text-muted">Branch</p>
                  <p className="mt-1 break-all text-sm">{task.branchName ?? "nao criada"}</p>
                </div>
                <div className="rounded-2xl bg-surface-secondary p-4">
                  <p className="text-xs text-muted">Workspace</p>
                  <p className="mt-1 break-all text-sm">{task.workspacePath ?? "nao iniciado"}</p>
                </div>
              </section>
              <section>
                <p className="text-sm font-semibold">Runs</p>
                <div className="mt-2 grid gap-2">
                  {taskRuns.map((run) => (
                    <div key={run.id} className="rounded-2xl bg-surface-secondary p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{run.id}</p>
                          <p className="truncate text-xs text-muted">{run.workspacePath}</p>
                        </div>
                        <StatusChip status={run.status} />
                      </div>
                      {run.summary ? <p className="mt-2 text-xs leading-5 text-muted">{run.summary}</p> : null}
                      {run.gitStatus ? (
                        <pre className="mt-2 max-h-28 overflow-auto rounded-xl bg-background p-3 text-xs text-muted">
                          {run.gitStatus}
                        </pre>
                      ) : null}
                      {run.commitSha ? <p className="mt-2 break-all text-xs text-muted">Commit: {run.commitSha}</p> : null}
                      {run.remoteBranch ? <p className="mt-1 break-all text-xs text-muted">Remote: {run.remoteBranch}</p> : null}
                      {run.prUrl ? <a className="mt-1 block break-all text-xs text-accent no-underline" href={run.prUrl}>{run.prUrl}</a> : null}
                    </div>
                  ))}
                  {taskRuns.length === 0 ? (
                    <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">Sem runs ainda.</p>
                  ) : null}
                </div>
              </section>
            </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <div className="flex w-full flex-col gap-3">
              {gitState.error ? <p className="rounded-2xl bg-danger/10 p-3 text-sm text-danger">{gitState.error}</p> : null}
              {gitState.ok ? <p className="rounded-2xl bg-success/10 p-3 text-sm text-success">{gitState.ok}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                {latestRun ? (
                  <>
                    <Button size="sm" variant="outline" onPress={() => gitAction(latestRun.id, "status")}>
                      <Gear />
                      Git status
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => gitAction(latestRun.id, "commit")}>
                      <CircleCheck />
                      Commit
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => gitAction(latestRun.id, "push")}>
                      <CirclePlay />
                      Push
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => gitAction(latestRun.id, "pr")}>
                      <CirclePlus />
                      PR
                    </Button>
                  </>
                ) : null}
            {task && (task.status === "failed" || task.status === "blocked" || task.status === "cancelled") ? (
              <Button onPress={() => onAction(task.id, "retry")}>
                <ArrowRotateLeft />
                Retry
              </Button>
            ) : null}
            {task?.status === "review" ? (
              <Button onPress={() => onAction(task.id, "complete-review")}>
                <CircleCheck />
                Marcar Done
              </Button>
            ) : null}
            {task && task.status !== "completed" && task.status !== "cancelled" ? (
              <Button variant="danger-soft" onPress={() => onAction(task.id, "cancel")}>
                <OctagonXmark />
                Cancelar
              </Button>
            ) : null}
              </div>
            </div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function TaskKanbanCard({
  onOpen,
  projectName,
  task,
}: {
  onOpen: (task: Task) => void;
  projectName: string;
  task: Task;
}) {
  return (
    <button
      className="flex w-full flex-col gap-3 text-left outline-none"
      type="button"
      onClick={() => onOpen(task)}
    >
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
    </button>
  );
}

function KanbanBoard({
  onAction,
  onOpenTask,
  snapshot,
}: {
  onAction: (taskId: string, action: "cancel" | "retry" | "complete-review") => void;
  onOpenTask: (task: Task) => void;
  snapshot: DashboardSnapshot;
}) {
  return (
    <Card className="min-h-0 flex-1">
      <Card.Header>
        <Card.Title>Kanban de Tasks</Card.Title>
        <Card.Description>{snapshot.tasks.length} tasks por status</Card.Description>
      </Card.Header>
      <Card.Content className="min-h-0">
        <Kanban hideScrollBar className="h-full min-h-[640px] items-start overflow-visible" isEnabled={false}>
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
                  <Kanban.ScrollShadow className="max-h-[560px]">
                    <Kanban.CardList
                      aria-label={column.label}
                      items={items}
                      renderEmptyState={() => <p className="p-3 text-sm text-muted">Sem tasks.</p>}
                    >
                      {(task: Task) => {
                        const project = snapshot.projects.find((item) => item.id === task.projectId);
                        return (
                          <Kanban.Card id={task.id} textValue={task.title}>
                            <TaskKanbanCard
                              onOpen={onOpenTask}
                              projectName={project?.name ?? task.projectId}
                              task={task}
                            />
                            {(task.status === "failed" || task.status === "blocked") ? (
                              <Button className="mt-3 w-full" size="sm" variant="outline" onPress={() => onAction(task.id, "retry")}>
                                <ArrowRotateLeft />
                                Retry
                              </Button>
                            ) : null}
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
  );
}

function ChatPanel({
  activeProjects,
  auth,
  chatState,
  createChatCommand,
  recentLogs,
  snapshot,
}: {
  activeProjects: DashboardSnapshot["projects"];
  auth: AuthState;
  chatState: FormState;
  createChatCommand: (formData: FormData) => void;
  recentLogs: DashboardSnapshot["logs"];
  snapshot: DashboardSnapshot;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Chat Operacional</Card.Title>
        <Card.Description>Novo comando vira task rastreavel.</Card.Description>
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
          <textarea className={`${inputClass} min-h-28 resize-none`} name="message" placeholder="Digite comando" />
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
                <Chip color={log.level === "error" ? "danger" : log.level === "warn" ? "warning" : "default"} size="sm" variant="soft">
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
  );
}

function RunsPanel({
  gitAction,
  gitState,
  recentLogs,
  revalidateRun,
  snapshot,
}: {
  gitAction: (runId: string, action: "status" | "commit" | "push" | "pr") => void;
  gitState: FormState;
  recentLogs: DashboardSnapshot["logs"];
  revalidateRun: (runId: string) => void;
  snapshot: DashboardSnapshot;
}) {
  return (
    <Card className="min-h-0">
      <Card.Header>
        <Card.Title>Runs e Logs</Card.Title>
        <Card.Description>
          {snapshot.runs.length} runs / {snapshot.logs.length} eventos
        </Card.Description>
      </Card.Header>
      <Card.Content className="grid min-h-0 gap-4 lg:grid-cols-2">
        <ScrollShadow className="max-h-[calc(100vh-260px)] overflow-y-auto">
          <div className="flex flex-col gap-3">
            {gitState.error ? <p className="rounded-2xl bg-danger/10 p-3 text-sm text-danger">{gitState.error}</p> : null}
            {gitState.ok ? <p className="rounded-2xl bg-success/10 p-3 text-sm text-success">{gitState.ok}</p> : null}
            {snapshot.runs.map((run) => {
              const task = snapshot.tasks.find((item) => item.id === run.taskId);
              return (
                <div key={run.id} className="rounded-2xl bg-surface-secondary p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{task?.title ?? run.taskId}</p>
                      <p className="truncate text-xs text-muted">{run.workspacePath}</p>
                    </div>
                    <StatusChip status={run.status} />
                  </div>
                  {run.summary ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{run.summary}</p> : null}
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
                  {run.gitStatus ? (
                    <pre className="mt-3 max-h-20 overflow-auto rounded-xl bg-background p-2 text-xs text-muted">
                      {run.gitStatus}
                    </pre>
                  ) : null}
                  {run.prUrl ? <a className="mt-3 block truncate text-xs text-accent no-underline" href={run.prUrl}>{run.prUrl}</a> : null}
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
            {snapshot.runs.length === 0 ? <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">Nenhum run ainda.</p> : null}
          </div>
        </ScrollShadow>
        <ScrollShadow className="max-h-[calc(100vh-260px)] overflow-y-auto">
          <div className="flex flex-col gap-2">
            {recentLogs.map((log) => (
              <div key={log.id} className="rounded-2xl bg-surface-secondary p-3">
                <div className="flex items-center justify-between gap-3">
                  <Chip color={log.level === "error" ? "danger" : log.level === "warn" ? "warning" : "default"} size="sm" variant="soft">
                    <Chip.Label>{log.level}</Chip.Label>
                  </Chip>
                  <span className="text-xs text-muted">{log.createdAt}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">{log.message}</p>
              </div>
            ))}
            {recentLogs.length === 0 ? <p className="rounded-2xl bg-surface-secondary p-4 text-sm text-muted">Nenhum log ainda.</p> : null}
          </div>
        </ScrollShadow>
      </Card.Content>
    </Card>
  );
}

export function OrchestratorDashboard({
  initialSnapshot,
  view = "overview",
}: {
  initialSnapshot: DashboardSnapshot;
  view?: OrchestratorView;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [auth, setAuth] = useState<AuthState>({checked: false, enabled: false, authorized: false});
  const [projectState, setProjectState] = useState<FormState>({});
  const [taskState, setTaskState] = useState<FormState>({});
  const [chatState, setChatState] = useState<FormState>({});
  const [gitState, setGitState] = useState<FormState>({});
  const activeProjects = useMemo(() => snapshot.projects.filter((project) => project.status === "active"), [snapshot.projects]);
  const recentLogs = snapshot.logs.slice(-12).reverse();
  const selectedProject = selectedTask ? snapshot.projects.find((project) => project.id === selectedTask.projectId) : null;

  useEffect(() => {
    const token = localStorage.getItem("ralph_admin_token");
    fetch("/api/orchestrator/auth", {headers: token ? {Authorization: `Bearer ${token}`} : {}})
      .then((response) => response.json())
      .then((body: {authorized: boolean; enabled: boolean}) =>
        setAuth({checked: true, enabled: body.enabled, authorized: body.authorized}),
      )
      .catch(() => setAuth({checked: true, enabled: true, authorized: false, error: "Falha ao verificar auth."}));
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
    const response = await fetch("/api/orchestrator/auth", {method: "POST", headers: {Authorization: `Bearer ${token}`}});
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
      const prompt = String(formData.get("message") ?? "").trim();
      if (!prompt) throw new Error("Mensagem obrigatoria.");
      await postJson("/api/orchestrator/tasks", {
        projectId: String(formData.get("projectId") ?? ""),
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
    if (action === "retry") setSelectedTask(null);
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
      await postJson("/api/orchestrator/git", {action, runId, message: task ? `ralph: ${task.title}` : undefined});
      setGitState({ok: `Git ${action} executado.`});
      await refresh();
    } catch (error) {
      setGitState({error: error instanceof Error ? error.message : "Erro desconhecido."});
    }
  }

  const headers: Record<OrchestratorView, {description: string; title: string}> = {
    overview: {
      title: "Delegacao 24/7",
      description: "Cadastre repos, envie comandos e acompanhe sinais principais do worker.",
    },
    kanban: {
      title: "Kanban",
      description: "Veja tasks por status, abra detalhes e reenfileire falhas.",
    },
    projects: {
      title: "Projetos",
      description: "Gerencie repositorios e defaults de execucao.",
    },
    tasks: {
      title: "Tasks",
      description: "Delegue novas atividades e confira fila tabular.",
    },
    runs: {
      title: "Runs",
      description: "Acompanhe logs, diffs e acoes Git de cada execucao.",
    },
  };

  return (
    <AppLayout
      className="h-dvh overflow-hidden bg-background text-foreground"
      navigate={router.push}
      navbar={<AppNavbar {...headers[view]} />}
      sidebar={<AppSidebar view={view} />}
      sidebarCollapsible="offcanvas"
    >
      <div className="h-full overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <section className="flex min-h-full w-full flex-col gap-4">
          <PageHeader {...headers[view]} />

          {auth.checked && auth.enabled && !auth.authorized ? (
            <Card className="shrink-0">
              <Card.Header>
                <Card.Title>Acesso Admin</Card.Title>
                <Card.Description>Informe token configurado em RALPH_ADMIN_TOKEN.</Card.Description>
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
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {view === "overview" ? (
                <>
                  <Summary snapshot={snapshot} />
                  <div className="grid min-h-0 gap-4 xl:grid-cols-[420px_1fr]">
                    <ChatPanel
                      activeProjects={activeProjects}
                      auth={auth}
                      chatState={chatState}
                      createChatCommand={createChatCommand}
                      recentLogs={recentLogs}
                      snapshot={snapshot}
                    />
                    <div className="grid gap-4">
                      <ProjectsList snapshot={{...snapshot, projects: snapshot.projects.slice(0, 4)}} />
                      <KanbanBoard onAction={taskAction} onOpenTask={setSelectedTask} snapshot={{...snapshot, tasks: snapshot.tasks.slice(0, 12)}} />
                    </div>
                  </div>
                </>
              ) : null}

              {view === "kanban" ? (
                <KanbanBoard onAction={taskAction} onOpenTask={setSelectedTask} snapshot={snapshot} />
              ) : null}

              {view === "projects" ? (
                <div className="grid min-h-0 gap-4 xl:grid-cols-[420px_1fr]">
                  <ProjectForm
                    activeProjects={activeProjects}
                    auth={auth}
                    createProject={createProject}
                    projectState={projectState}
                    snapshot={snapshot}
                  />
                  <ProjectsList snapshot={snapshot} />
                </div>
              ) : null}

              {view === "tasks" ? (
                <div className="grid min-h-0 gap-4 xl:grid-cols-[420px_1fr]">
                  <TaskForm
                    activeProjects={activeProjects}
                    auth={auth}
                    createTask={createTask}
                    snapshot={snapshot}
                    taskState={taskState}
                  />
                  <Card className="min-h-0">
                    <Card.Header>
                      <Card.Title>Fila de Tasks</Card.Title>
                      <Card.Description>{snapshot.tasks.length} tasks</Card.Description>
                    </Card.Header>
                    <Card.Content className="min-h-0">
                      <ScrollShadow className="max-h-[calc(100vh-260px)] overflow-y-auto">
                        <div className="flex flex-col gap-3">
                          {snapshot.tasks.map((task) => {
                            const project = snapshot.projects.find((item) => item.id === task.projectId);
                            return (
                              <button
                                key={task.id}
                                className="rounded-2xl bg-surface-secondary p-4 text-left outline-none"
                                type="button"
                                onClick={() => setSelectedTask(task)}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">{task.title}</p>
                                    <p className="truncate text-xs text-muted">{project?.name ?? task.projectId}</p>
                                  </div>
                                  <StatusChip status={task.status} />
                                </div>
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{task.prompt}</p>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollShadow>
                    </Card.Content>
                  </Card>
                </div>
              ) : null}

              {view === "runs" ? (
                <RunsPanel
                  gitAction={gitAction}
                  gitState={gitState}
                  recentLogs={recentLogs}
                  revalidateRun={revalidateRun}
                  snapshot={snapshot}
                />
              ) : null}
            </div>
          )}
        </section>
      </div>
      <TaskDetailModal
        gitAction={gitAction}
        gitState={gitState}
        onAction={taskAction}
        onClose={() => setSelectedTask(null)}
        projectName={selectedProject?.name ?? selectedTask?.projectId ?? ""}
        runs={snapshot.runs}
        task={selectedTask}
      />
    </AppLayout>
  );
}
