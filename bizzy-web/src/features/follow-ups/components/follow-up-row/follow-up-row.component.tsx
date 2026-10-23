import { cn } from "cn";
import { formatDue, isOverdue } from "../../follow-ups.util";
import { FollowUpDoneButton } from "../follow-up-done-button/follow-up-done-button.component";
import type { FollowUpView } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DataRow } from "~/components/shared/list/data-list/data-list.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { clientOf } from "~/features/clients/clients.util";

interface FollowUpRowProps {
  followUp: FollowUpView;
  /** Opens it to edit, on a click on the row; without it, the row opens Follow-ups instead. */
  onEdit?: (followUp: FollowUpView) => void;
  /** Leaves out the client, on their own page: the summary leads instead. */
  hideClient?: boolean;
  /** Links to the session it came from, unless that is the page it is on. */
  showSession?: boolean;
  /** Says it is a follow-up, in a list mixed with sessions and packages. */
  showKind?: boolean;
}

/**
 * One follow-up, laid out like every to-do row (DataRow): who and what,
 * when below, and Done. A click anywhere on the row opens it to edit (or
 * opens Follow-ups).
 */
export function FollowUpRow({ followUp, onEdit, hideClient, showSession = true, showKind }: FollowUpRowProps) {
  const clientsById = ClientsQuery.useById();
  const client = clientOf(clientsById, followUp.clientId);
  const done = Boolean(followUp.doneAt);
  const overdue = isOverdue(followUp);
  const summary = followUp.summary || "Follow up";
  // Under the client's name; on their own page it leads instead.
  const shownSummary = hideClient ? undefined : followUp.summary;

  return (
    <DataRow
      title={
        <>
          {hideClient ? (
            <span className={cn("font-medium", done && "text-muted-foreground line-through")}>{summary}</span>
          ) : client ? (
            <TextLink to="/clients/$id" params={{ id: client.id }}>
              {client.name}
            </TextLink>
          ) : (
            <span className="text-muted-foreground italic">Unknown client</span>
          )}
          {showKind && <Badge variant="info">Follow up</Badge>}
          {done && <Badge variant="done">Done</Badge>}
        </>
      }
      meta={
        <>
          <span className={overdue ? "font-medium text-status-attention-foreground" : undefined}>{formatDue(followUp)}</span>
          {showSession && followUp.sessionId && (
            <>
              {" · "}
              <TextLink to="/sessions/$id" params={{ id: followUp.sessionId }} className="font-normal">
                from a session
              </TextLink>
            </>
          )}
        </>
      }
      detail={
        <>
          {shownSummary && <span className={cn("text-foreground", done && "line-through")}>{shownSummary}</span>}
          {shownSummary && followUp.notes && " · "}
          {followUp.notes}
        </>
      }
      detailTitle={[shownSummary, followUp.notes].filter(Boolean).join(" · ") || undefined}
      onOpen={onEdit && (() => onEdit(followUp))}
      open={onEdit ? undefined : { to: "/follow-ups" }}
      actions={<FollowUpDoneButton followUp={followUp} />}
    />
  );
}
