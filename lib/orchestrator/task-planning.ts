import type {AgentProvider, Project, Task, TaskStoryArea} from "@/lib/orchestrator/types";

import {randomUUID} from "node:crypto";

type BuildTaskPlanInput = {
  decompose?: boolean;
  priority?: number;
  project: Project;
  prompt: string;
  provider?: AgentProvider;
  timestamp: string;
  title: string;
};

type StoryDraft = {
  area: TaskStoryArea;
  title: string;
  work: string;
};

type AreaAssignment = {
  modelHint?: string;
  provider: AgentProvider;
};

const providerAliases: Array<{aliases: string[]; provider: AgentProvider}> = [
  {aliases: ["opencode-go", "opencode go", "opencode"], provider: "opencode-go"},
  {aliases: ["minimax", "mini max"], provider: "minimax"},
  {aliases: ["deepseek", "deep seek"], provider: "deepseek"},
  {aliases: ["z.ai", "zai"], provider: "zai"},
  {aliases: ["mimo"], provider: "mimo"},
  {aliases: ["codex"], provider: "codex"},
];

const areaAliases: Record<TaskStoryArea, string[]> = {
  backend: ["backend", "back-end", "back end", "api", "server", "servidor", "banco", "db", "database"],
  docs: ["docs", "documentacao", "documentação", "readme"],
  frontend: ["frontend", "front-end", "front end", "ui", "interface", "tela", "visual"],
  general: ["geral", "implementacao", "implementação"],
  review: ["review", "revisao", "revisão"],
  scope: ["escopo", "planejamento", "plano", "arquitetura"],
  validation: ["validacao", "validação", "teste", "testes", "lint", "typecheck", "build", "qa"],
};

const defaultStories: StoryDraft[] = [
  {
    area: "scope",
    title: "Escopo e plano",
    work: "Entender a solicitacao, confirmar arquivos provaveis e definir abordagem pequena.",
  },
  {
    area: "backend",
    title: "Backend e dados",
    work: "Ajustar tipos, APIs, persistencia ou regras de backend necessarias.",
  },
  {
    area: "frontend",
    title: "Frontend e experiencia",
    work: "Atualizar telas, cards, formularios e modal para refletir a funcionalidade.",
  },
  {
    area: "validation",
    title: "Validacao e acabamento",
    work: "Rodar validacoes disponiveis, corrigir falhas pequenas e registrar resultado.",
  },
];

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clipTitle(value: string, max = 82) {
  const normalized = compact(value);
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function sentenceParts(text: string) {
  return text
    .split(/[\n.;!?]+/)
    .map((part) => compact(part.toLowerCase()))
    .filter(Boolean);
}

function includesArea(sentence: string, area: TaskStoryArea) {
  return areaAliases[area].some((alias) => sentence.includes(alias));
}

function providerFromSentence(sentence: string) {
  for (const entry of providerAliases) {
    const alias = entry.aliases.find((item) => sentence.includes(item));
    if (alias) return {alias, provider: entry.provider};
  }
  return null;
}

function modelHintFromSentence(sentence: string, alias: string) {
  const start = sentence.indexOf(alias);
  if (start < 0) return alias;

  const words = sentence
    .slice(start)
    .split(/\s+/)
    .filter(Boolean);
  const stopWords = new Set([
    "a",
    "ao",
    "da",
    "de",
    "deve",
    "do",
    "e",
    "ficar",
    "o",
    "para",
    "pela",
    "pelo",
    "responsavel",
    "responsável",
    "ser",
  ]);
  const hint: string[] = [];

  for (const word of words) {
    const cleaned = word.replace(/[,:"'()]/g, "");
    if (!cleaned || stopWords.has(cleaned)) break;
    hint.push(cleaned);
    if (hint.length >= 4) break;
  }

  return hint.length ? hint.join(" ") : alias;
}

function assignmentForArea(text: string, area: TaskStoryArea): AreaAssignment | null {
  for (const sentence of sentenceParts(text)) {
    if (!includesArea(sentence, area)) continue;

    const providerMatch = providerFromSentence(sentence);
    if (!providerMatch) continue;

    return {
      provider: providerMatch.provider,
      modelHint: modelHintFromSentence(sentence, providerMatch.alias),
    };
  }

  return null;
}

function defaultProvider(input: BuildTaskPlanInput) {
  return input.provider ?? input.project.defaultProvider ?? "manual";
}

function storyPrompt(input: BuildTaskPlanInput, draft: StoryDraft, index: number, total: number, assignment: AreaAssignment | null) {
  return [
    `Microprocesso Ralph ${index}/${total}: ${draft.title}`,
    `Task original: ${input.title}`,
    `Area: ${draft.area}`,
    assignment?.modelHint ? `Modelo solicitado: ${assignment.modelHint}` : null,
    "",
    "Objetivo deste microprocesso:",
    draft.work,
    "",
    "Prompt original:",
    input.prompt,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildTaskPlan(input: BuildTaskPlanInput): Task[] {
  const provider = defaultProvider(input);

  if (!input.decompose) {
    return [
      {
        id: randomUUID(),
        projectId: input.project.id,
        title: input.title,
        prompt: input.prompt,
        provider,
        status: "queued",
        priority: input.priority ?? 0,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      },
    ];
  }

  const storyGroupId = randomUUID();
  const total = defaultStories.length;

  return defaultStories.map((draft, index) => {
    const storyIndex = index + 1;
    const assignment = assignmentForArea(`${input.title}\n${input.prompt}`, draft.area);

    return {
      id: randomUUID(),
      projectId: input.project.id,
      title: clipTitle(`${storyIndex}/${total} ${draft.title}: ${input.title}`),
      prompt: storyPrompt(input, draft, storyIndex, total, assignment),
      provider: assignment?.provider ?? provider,
      status: "queued",
      priority: (input.priority ?? 0) - index,
      storyArea: draft.area,
      storyCount: total,
      storyGroupId,
      storyIndex,
      storyParentTitle: input.title,
      modelHint: assignment?.modelHint,
      progressPercent: 0,
      currentWork: "Aguardando execucao na fila.",
      aiThought: "Story criada pela decomposicao Ralph; aguardando worker.",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    };
  });
}
