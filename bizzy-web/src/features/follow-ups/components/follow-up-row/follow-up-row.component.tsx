import { PencilIcon } from "lucide-react";
import { cn } from "cn";
import { useMarkDone } from "../../follow-ups.query";
import type { FollowUp } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUp): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}

interface FollowUpRowProps {
  followUp: FollowUp;
  onEdit: (followUp: FollowUp) => void;
  /** Leaves out the client, on their own page. */
  hideClient?: boolean;
  /** Links to the session it came from, unless that is the page it is on. */
  showSession?: boolean;
}

/** One follow-up: tick it done, see what and when, open it to edit. */
export function FollowUpRow({ followUp, onEdit, hideClient, showSession = true }: FollowUpRowProps) {
  const clientsById = ClientsQuery.useById();
  const { mark, isPending } = useMarkDone();
  const client = followUp.clientId ? clientsById.get(followUp.clientId) : undefined;
  const done = Boolean(followUp.doneAt);
  const overdue = !done && new Date(followUp.due) < startOfToday();
  const id = `done-${followUp.eventId}`;

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        aria-label={done ? "Mark not done" : "Mark done"}
        checked={done}
        disabled={isPending}
        onCheckedChange={(checked) => mark(followUp, checked)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {!hideClient &&
            (client ? (
              <TextLink to="/clients/$id" params={{ id: client.id }}>
                {client.name}
              </TextLink>
            ) : (
              <span className="font-medium text-muted-foreground italic">{followUp.name || followUp.title}</span>
            ))}
          <span className={cn("text-sm", done && "text-muted-foreground line-through")}>
            {followUp.summary || (hideClient ? "Follow up" : "")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className={overdue ? "font-medium text-status-attention-foreground" : undefined}>{formatDue(followUp)}</span>
          {showSession && followUp.sessionId && (
            <TextLink to="/sessions/$id" params={{ id: followUp.sessionId }} className="text-xs font-normal">
              From a session
            </TextLink>
          )}
          {followUp.problem && <Badge variant="attention">{followUp.problem}</Badge>}
        </div>
        {followUp.notes && <p className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{followUp.notes}</p>}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Edit follow-up" onClick={() => onEdit(followUp)}>
        <PencilIcon />
      </Button>
    </div>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
