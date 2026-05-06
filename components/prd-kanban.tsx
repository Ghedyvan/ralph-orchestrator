"use client";

import type {PrdData, PrdStory, StoryStatus} from "@/lib/prd";

import {useState} from "react";
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleExclamation,
  CirclePlay,
  CircleXmark,
  FileText,
} from "@gravity-ui/icons";
import {Button, Chip, Modal, Separator, Tooltip} from "@heroui/react";
import {EmptyState, Kanban} from "@heroui-pro/react";

const columns: Array<{
  color: string;
  icon: React.ReactNode;
  label: string;
  status: StoryStatus;
}> = [
  {
    color: "bg-accent",
    icon: <CircleDashed className="size-4 text-accent" />,
    label: "Pending",
    status: "pending",
  },
  {
    color: "bg-warning",
    icon: <CirclePlay className="size-4 text-warning" />,
    label: "In Progress",
    status: "in_progress",
  },
  {
    color: "bg-danger",
    icon: <CircleExclamation className="size-4 text-danger" />,
    label: "Blocked",
    status: "blocked",
  },
  {
    color: "bg-success",
    icon: <CircleCheck className="size-4 text-success" />,
    label: "Done",
    status: "done",
  },
  {
    color: "bg-danger",
    icon: <CircleXmark className="size-4 text-danger" />,
    label: "Failed",
    status: "failed",
  },
];

const passColor = (story: PrdStory) => {
  if (story.status === "failed") return "danger";
  if (story.status === "blocked") return "warning";
  return story.passes ? "success" : "default";
};

function StoryCard({requestText, story}: {requestText?: string; story: PrdStory}) {
  const firstCriterion = story.acceptanceCriteria[0];

  return (
    <article className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {story.title}
          </h4>
          {story.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{story.description}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip color={passColor(story)} size="sm" variant="soft">
          <Chip.Label>{story.passes ? "Validada" : "Pendente"}</Chip.Label>
        </Chip>
        <Chip size="sm" variant="secondary">
          <Chip.Label>{story.id}</Chip.Label>
        </Chip>
      </div>

      {firstCriterion ? (
        <p className="line-clamp-2 text-xs leading-5 text-muted">{firstCriterion}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted">{requestText ?? story.requestId}</span>
        {story.passes ? <Check className="size-4 shrink-0 text-success" /> : null}
      </div>
    </article>
  );
}

function PrdColumn({
  color,
  icon,
  items,
  label,
  onSelectStory,
  requestTextById,
}: {
  color: string;
  icon: React.ReactNode;
  items: PrdStory[];
  label: string;
  onSelectStory: (story: PrdStory) => void;
  requestTextById: Map<string, string>;
}) {
  return (
    <Kanban.Column className="h-full">
      <Kanban.ColumnHeader>
        <Kanban.ColumnIndicator className={color} />
        <span className="flex items-center gap-2">
          {icon}
          <Kanban.ColumnTitle>{label}</Kanban.ColumnTitle>
        </span>
        <Kanban.ColumnCount>{items.length}</Kanban.ColumnCount>
        <Kanban.ColumnActions>
          <Tooltip delay={300}>
            <Button isIconOnly aria-label={`Ver detalhes de ${label}`} size="sm" variant="ghost">
              <FileText />
            </Button>
            <Tooltip.Content>Somente leitura</Tooltip.Content>
          </Tooltip>
        </Kanban.ColumnActions>
      </Kanban.ColumnHeader>
      <Kanban.ColumnBody className="min-h-0 flex-1">
        <Kanban.ScrollShadow className="h-full min-h-0">
          <Kanban.CardList
            aria-label={label}
            className="min-h-full pb-2"
            items={items}
            renderEmptyState={() => (
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>Nenhuma story</EmptyState.Title>
                  <EmptyState.Description>Este status ainda nao possui cards.</EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            )}
          >
            {(story) => (
              <Kanban.Card
                id={story.id}
                className="cursor-[var(--cursor-interactive)]"
                textValue={story.title}
                onAction={() => onSelectStory(story)}
              >
                <StoryCard requestText={requestTextById.get(story.requestId)} story={story} />
              </Kanban.Card>
            )}
          </Kanban.CardList>
        </Kanban.ScrollShadow>
      </Kanban.ColumnBody>
    </Kanban.Column>
  );
}

function DetailRow({label, value}: {label: string; value?: React.ReactNode}) {
  if (!value) return null;

  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm leading-6 text-foreground">{value}</dd>
    </div>
  );
}

function StoryDetailModal({
  requestText,
  story,
  onOpenChange,
}: {
  requestText?: string;
  story: PrdStory | null;
  onOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <Modal.Backdrop isOpen={Boolean(story)} variant="blur" onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          {story ? (
            <>
              <Modal.Header>
                <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                  <FileText className="size-5" />
                </Modal.Icon>
                <div className="flex min-w-0 flex-col gap-2 pr-8">
                  <Modal.Heading>{story.title}</Modal.Heading>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip color={passColor(story)} size="sm" variant="soft">
                      <Chip.Label>{story.passes ? "Validada" : "Pendente"}</Chip.Label>
                    </Chip>
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{story.status}</Chip.Label>
                    </Chip>
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{story.id}</Chip.Label>
                    </Chip>
                  </div>
                </div>
              </Modal.Header>
              <Modal.Body>
                <dl className="flex flex-col gap-4">
                  <DetailRow label="Request" value={requestText ?? story.requestId} />
                  <DetailRow label="Descricao" value={story.description} />
                  <DetailRow label="Atualizada em" value={story.updatedAt} />
                </dl>

                <Separator className="my-5" />

                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Critérios de Aceite</h3>
                  {story.acceptanceCriteria.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {story.acceptanceCriteria.map((criterion) => (
                        <li key={criterion} className="flex gap-2 text-sm leading-6 text-muted">
                          <Check className="mt-1 size-4 shrink-0 text-success" />
                          <span>{criterion}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Nenhum critério registrado.</p>
                  )}
                </section>

                <Separator className="my-5" />

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Notas</h3>
                  <p className="whitespace-pre-wrap rounded-2xl bg-surface-secondary p-4 text-sm leading-6 text-muted">
                    {story.notes || "Nenhuma nota registrada."}
                  </p>
                </section>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="secondary">
                  Fechar
                </Button>
              </Modal.Footer>
            </>
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function PrdKanban({prd}: {prd: PrdData}) {
  const [selectedStory, setSelectedStory] = useState<PrdStory | null>(null);
  const requestTextById = new Map(prd.requests.map((request) => [request.id, request.text]));

  if (prd.loadError || prd.stories.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-border bg-surface-secondary p-6">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <FileText />
            </EmptyState.Media>
            <EmptyState.Title>
              {prd.loadError ? "Nao foi possivel ler o prd.json" : "Nenhuma story encontrada"}
            </EmptyState.Title>
            <EmptyState.Description className="max-w-md text-pretty">
              {prd.loadError ??
                "Crie ou atualize o prd.json com requests e stories para preencher o quadro."}
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <Kanban hideScrollBar className="h-full items-stretch overflow-x-auto pb-2" size="md">
        {columns.map((column) => (
          <PrdColumn
            key={column.status}
            color={column.color}
            icon={column.icon}
            items={prd.storiesByStatus[column.status]}
            label={column.label}
            requestTextById={requestTextById}
            onSelectStory={setSelectedStory}
          />
        ))}
      </Kanban>
      <StoryDetailModal
        requestText={selectedStory ? requestTextById.get(selectedStory.requestId) : undefined}
        story={selectedStory}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedStory(null);
        }}
      />
    </div>
  );
}
