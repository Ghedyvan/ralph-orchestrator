import {readFile} from "node:fs/promises";
import path from "node:path";

export const STORY_STATUSES = ["pending", "in_progress", "blocked", "done", "failed"] as const;

export type StoryStatus = (typeof STORY_STATUSES)[number];

export type PrdRequest = {
  id: string;
  text: string;
  createdAt?: string;
  status?: string;
};

export type PrdStory = {
  id: string;
  requestId: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  status: StoryStatus;
  passes: boolean;
  notes?: string;
  updatedAt?: string;
};

export type PrdData = {
  project: string;
  version?: string;
  updatedAt?: string;
  activeRequest?: PrdRequest;
  requests: PrdRequest[];
  stories: PrdStory[];
  storiesByStatus: Record<StoryStatus, PrdStory[]>;
  totals: Record<StoryStatus, number> & {
    all: number;
    passing: number;
  };
  loadError?: string;
};

type RawRecord = Record<string, unknown>;

const emptyBuckets = (): Record<StoryStatus, PrdStory[]> => ({
  blocked: [],
  done: [],
  failed: [],
  in_progress: [],
  pending: [],
});

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = "") => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
};

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : [];

const normalizeStatus = (value: unknown): StoryStatus => {
  const status = asString(value);
  return STORY_STATUSES.includes(status as StoryStatus) ? (status as StoryStatus) : "pending";
};

const normalizeRequest = (value: unknown): PrdRequest | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;

  return {
    id,
    text: asString(value.text, "Solicitacao sem descricao"),
    createdAt: asString(value.createdAt) || undefined,
    status: asString(value.status) || undefined,
  };
};

const normalizeStory = (value: unknown): PrdStory | null => {
  if (!isRecord(value)) return null;

  const id = asString(value.id);
  const title = asString(value.title);
  if (!id || !title) return null;

  return {
    id,
    requestId: asString(value.requestId, "sem-request"),
    title,
    description: asString(value.description) || undefined,
    acceptanceCriteria: asStringArray(value.acceptanceCriteria),
    status: normalizeStatus(value.status),
    passes: value.passes === true,
    notes: asString(value.notes) || undefined,
    updatedAt: asString(value.updatedAt) || undefined,
  };
};

const buildPrdData = (raw: unknown, loadError?: string): PrdData => {
  const record = isRecord(raw) ? raw : {};
  const requests = Array.isArray(record.requests)
    ? record.requests.map(normalizeRequest).filter((item): item is PrdRequest => Boolean(item))
    : [];
  const stories = Array.isArray(record.stories)
    ? record.stories.map(normalizeStory).filter((item): item is PrdStory => Boolean(item))
    : [];
  const storiesByStatus = emptyBuckets();

  for (const story of stories) {
    storiesByStatus[story.status].push(story);
  }

  const activeRequest = normalizeRequest(record.activeRequest);

  return {
    project: asString(record.project, "ralph-kanban"),
    version: asString(record.version) || undefined,
    updatedAt: asString(record.updatedAt) || undefined,
    activeRequest: activeRequest ?? undefined,
    requests,
    stories,
    storiesByStatus,
    totals: {
      all: stories.length,
      blocked: storiesByStatus.blocked.length,
      done: storiesByStatus.done.length,
      failed: storiesByStatus.failed.length,
      in_progress: storiesByStatus.in_progress.length,
      passing: stories.filter((story) => story.passes).length,
      pending: storiesByStatus.pending.length,
    },
    loadError,
  };
};

export async function loadPrdData(): Promise<PrdData> {
  const prdPath = path.join(process.cwd(), "prd.json");

  try {
    const content = await readFile(prdPath, "utf8");
    return buildPrdData(JSON.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return buildPrdData({}, message);
  }
}
