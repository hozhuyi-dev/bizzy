import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "cn";
import { useMarkDone } from "../../follow-ups.query";
import type { FollowUp } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUp): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}

interface FollowUpRowProps {
  followUp: FollowUp;
  /** Opens it to edit; without it, the row links to Follow-ups instead. */
  onEdit?: (followUp: FollowUp) => void;
  /** Leaves out the client, on their own page: the summary leads instead. */
  hideClient?: boolean;
  /** Links to the session it came from, unless that is the page it is on. */
  showSession?: boolean;
  /** Says it is a follow-up, in a list mixed with sessions and packages. */
  showKind?: boolean;
}

/**
 * One follow-up, laid out like every to-do row: who and what on the left,
 * when below, and Done and Edit (or a link to Follow-ups) on the right.
 */
export function FollowUpRow({ followUp, onEdit, hideClient, showSession = true, showKind }: FollowUpRowProps) {
  const clientsById = ClientsQuery.useById();
  const { mark, isPending } = useMarkDone();
  const client = followUp.clientId ? clientsById.get(followUp.clientId) : undefined;
  const done = Boolean(followUp.doneAt);
  const overdue = !done && new Date(followUp.due) < startOfToday();
  const summary = followUp.summary || "Follow up";

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {hideClient ? (
            <span className={cn("font-medium", done && "text-muted-foreground line-through")}>{summary}</span>
          ) : client ? (
            <TextLink to="/clients/$id" params={{ id: client.id }}>
              {client.name}
            </TextLink>
          ) : (
            <span className="text-muted-foreground italic">{followUp.name || followUp.title}</span>
          )}
          {showKind && <Badge variant="info">Follow up</Badge>}
          {done && <Badge variant="done">Done</Badge>}
          {followUp.problem && <Badge variant="attention">{followUp.problem}</Badge>}
        </div>
        <span className="text-sm text-muted-foreground">
          <span className={overdue ? "font-medium text-status-attention-foreground" : undefined}>{formatDue(followUp)}</span>
          {showSession && followUp.sessionId && (
            <>
              {" · "}
              <TextLink to="/sessions/$id" params={{ id: followUp.sessionId }} className="font-normal">
                from a session
              </TextLink>
            </>
          )}
        </span>
        {!hideClient && followUp.summary && (
          <span className={cn("line-clamp-1 text-sm", done && "text-muted-foreground line-through")}>{followUp.summary}</span>
        )}
        {followUp.notes && <span className="line-clamp-1 text-xs text-muted-foreground">{followUp.notes}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
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
      </div>
    </div>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
