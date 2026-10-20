import { CheckIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "cn";
import { formatDue, isOverdue } from "./follow-ups.util";
import type { FollowUpView } from "./follow-ups.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { RowActionSet } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { CellText } from "~/components/shared/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { DataCard } from "~/components/shared/data-card/data-card.component";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { clientOf } from "~/features/clients/clients.util";
import { formatDate } from "~/core/utils/date.util";

export interface FollowUpHandlers {
  clientsById: ReadonlyMap<string, ClientView>;
  onEdit: (followUp: FollowUpView) => void;
  onMark: (followUp: FollowUpView, done?: boolean) => void;
  /** A tick is on its way: the buttons wait. */
  marking: boolean;
}

const helper = createDataTableColumnHelper<FollowUpView>();

/** "Overdue", "Done 12 Oct 2026", "All day", "30 min": what to know besides the day. */
function dueNote(followUp: FollowUpView): string | undefined {
  if (followUp.doneAt) return `Done ${formatDate(followUp.doneAt)}`;
  if (isOverdue(followUp)) return "Overdue";
  if (followUp.allDay) return "All day";
  return followUp.minutes ? `${followUp.minutes} min` : undefined;
}

function FollowUpClient({ followUp, handlers }: { followUp: FollowUpView; handlers: FollowUpHandlers }) {
  const client = clientOf(handlers.clientsById, followUp.clientId);
  if (!client) return <span className="text-muted-foreground italic">{followUp.clientName || "Unknown client"}</span>;
  return (
    <TextLink to="/clients/$id" params={{ id: client.id }}>
      {client.name}
    </TextLink>
  );
}

/**
 * Done (or Not done); Edit behind ⋯, as a click on the row does the same
 * (a follow-up has no page of its own), kept there for the keyboard.
 */
export function followUpActions(followUp: FollowUpView, handlers: FollowUpHandlers): RowActionSet {
  const done = Boolean(followUp.doneAt);
  return {
    actions: [
      done
        ? { type: "button", label: "Not done", icon: RotateCcwIcon, disabled: handlers.marking, onClick: () => handlers.onMark(followUp, false) }
        : { type: "button", label: "Done", icon: CheckIcon, disabled: handlers.marking, onClick: () => handlers.onMark(followUp) },
    ],
    more: [{ type: "button", label: "Edit", icon: PencilIcon, onClick: () => handlers.onEdit(followUp) }],
  };
}

/** The phone layout of a row, like a follow-up on Home: who, when, what; then Done. A tap opens it to edit. */
export function FollowUpCard({ followUp, handlers }: { followUp: FollowUpView; handlers: FollowUpHandlers }) {
  const overdue = isOverdue(followUp);
  const detail = [followUp.summary, followUp.notes].filter(Boolean).join(" · ");
  return (
    <DataCard
      title={
        <>
          <FollowUpClient followUp={followUp} handlers={handlers} />
          {followUp.doneAt && <Badge variant="done">Done</Badge>}
          {overdue && <Badge variant="attention">Overdue</Badge>}
        </>
      }
      meta={
        <>
          {formatDue(followUp)}
          {followUp.sessionId && (
            <>
              {" · "}
              <TextLink to="/sessions/$id" params={{ id: followUp.sessionId }} className="font-normal">
                from a session
              </TextLink>
            </>
          )}
        </>
      }
      detail={detail || "Follow up"}
      detailTitle={detail || undefined}
      {...followUpActions(followUp, handlers)}
      onOpen={() => handlers.onEdit(followUp)}
    />
  );
}

export function createFollowUpColumns(handlers: FollowUpHandlers) {
  return helper.columns([
    helper.accessor("due", {
      header: "Due",
      sortFn: "alphanumeric",
      meta: { search: (followUp: FollowUpView) => [formatDue(followUp), dueNote(followUp)] },
      cell: ({ row }) => {
        const overdue = isOverdue(row.original);
        return (
          <CellText sub={<span className={cn(overdue && "font-medium text-status-attention-foreground")}>{dueNote(row.original)}</span>}>
            {formatDue(row.original)}
          </CellText>
        );
      },
    }),
    helper.display({
      id: "client",
      header: "Client",
      meta: {
        search: (followUp: FollowUpView) => clientOf(handlers.clientsById, followUp.clientId)?.name ?? followUp.clientName,
      },
      cell: ({ row }) => (
        <CellText
          className="max-w-48"
          sub={
            row.original.sessionId && (
              <TextLink to="/sessions/$id" params={{ id: row.original.sessionId }} className="font-normal">
                from a session
              </TextLink>
            )
          }
        >
          <FollowUpClient followUp={row.original} handlers={handlers} />
        </CellText>
      ),
    }),
    helper.display({
      id: "what",
      header: "What",
      meta: {
        width: "grow",
        search: (followUp: FollowUpView) => [followUp.summary, followUp.notes],
      },
      cell: ({ row }) => {
        const { summary, notes, doneAt } = row.original;
        return (
          <CellText sub={notes} title={[summary, notes].filter(Boolean).join(" · ") || undefined}>
            {summary ? (
              <span className={cn(doneAt && "text-muted-foreground line-through")}>{summary}</span>
            ) : (
              <span className="text-muted-foreground/60">Follow up</span>
            )}
          </CellText>
        );
      },
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: "fit" },
      cell: ({ row }) => <RowActionButtons {...followUpActions(row.original, handlers)} />,
    }),
  ]);
}
