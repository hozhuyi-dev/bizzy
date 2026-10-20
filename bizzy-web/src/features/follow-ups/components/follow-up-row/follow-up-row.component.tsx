import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "cn";
import { useMarkDone } from "../../follow-ups.hook";
import { formatDue, isOverdue } from "../../follow-ups.util";
import type { FollowUpView } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ListRow } from "~/components/shared/list-row/list-row.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { clientOf } from "~/features/clients/clients.util";

interface FollowUpRowProps {
  followUp: FollowUpView;
  /** Opens it to edit; without it, the row links to Follow-ups instead. */
  onEdit?: (followUp: FollowUpView) => void;
  /** Leaves out the client, on their own page: the summary leads instead. */
  hideClient?: boolean;
  /** Links to the session it came from, unless that is the page it is on. */
  showSession?: boolean;
  /** Says it is a follow-up, in a list mixed with sessions and packages. */
  showKind?: boolean;
}

/**
 * One follow-up, laid out like every to-do row (ListRow): who and what,
 * when below, and Done and Edit (or a link to Follow-ups).
 */
export function FollowUpRow({ followUp, onEdit, hideClient, showSession = true, showKind }: FollowUpRowProps) {
  const clientsById = ClientsQuery.useById();
  const { mark, isPending } = useMarkDone();
  const client = clientOf(clientsById, followUp.clientId);
  const done = Boolean(followUp.doneAt);
  const overdue = isOverdue(followUp);
  const summary = followUp.summary || "Follow up";
  // Under the client's name; on their own page it leads instead.
  const shownSummary = hideClient ? undefined : followUp.summary;

  return (
    <ListRow
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
      actions={
        <>
          {done ? (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => mark(followUp, false)}>
              <RotateCcwIcon /> Not done
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => mark(followUp)}>
              <CheckIcon /> Done
            </Button>
          )}
          {onEdit ? (
            <Button size="sm" variant="ghost" aria-label="Edit follow-up" onClick={() => onEdit(followUp)}>
              <PencilIcon /> <span className="hidden sm:inline">Edit</span>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open follow-ups"
              render={<Link to="/follow-ups" />}
              nativeButton={false}
            >
              <span className="hidden sm:inline">Follow-ups</span> <ArrowRightIcon />
            </Button>
          )}
        </>
      }
    />
  );
}
