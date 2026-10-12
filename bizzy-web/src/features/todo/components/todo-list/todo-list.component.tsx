import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRightIcon, BanknoteIcon, CheckIcon, ChevronDownIcon, LinkIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { TODO_FILTERS, TODO_GROUPS, groupOf, matchesFilter, todoKey } from "../../todo.types";
import type { TodoFilter, TodoItem } from "../../todo.types";
import type { FollowUpTarget } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { DeleteSessionDialog } from "~/features/sessions/components/delete-session-dialog/delete-session-dialog.component";
import { LinkClientDialog } from "~/features/sessions/components/link-client-dialog/link-client-dialog.component";
import { dueCents } from "~/features/sessions/session-stage";
import { SessionsMutation } from "~/features/sessions/sessions.mutation";
import { PAYMENT_METHODS } from "~/features/sessions/sessions.types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { EmptyState } from "~/components/shared/quip/quip.component";
import { formatSessionTime, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

const REASONS: Record<TodoReason, { label: string; tone: "waiting" | "attention" | "info" | "neutral" }> = {
  confirm: { label: "Confirm", tone: "waiting" },
  record: { label: "Record", tone: "info" },
  collect: { label: "Collect", tone: "attention" },
  fix: { label: "Fix", tone: "attention" },
  deleted: { label: "Deleted", tone: "neutral" },
};

/**
 * Everything that needs her, sessions and follow-ups together, grouped by
 * when: earlier (overdue), today, coming up. Chips filter by what to do.
 * One-tap jobs (confirm, mark paid, tick a follow-up) happen right here;
 * anything to type opens the session.
 */
export function TodoList({ items }: { items: ReadonlyArray<TodoItem> }) {
  const [filter, setFilter] = useState<TodoFilter>();
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [linking, setLinking] = useState<Session | null>(null);

  const counts = useMemo(() => {
    const out = new Map<TodoFilter, number>();
    for (const option of TODO_FILTERS) out.set(option.value, items.filter((item) => matchesFilter(item, option.value)).length);
    return out;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="py-6">
        <EmptyState quips={QUIPS.sessionsTodo}>
          Sessions to confirm, record or collect, follow-ups due and anything to fix show up here.
        </EmptyState>
      </div>
    );
  }

  const shown = items.filter((item) => matchesFilter(item, filter));
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        <Button size="xs" variant={filter ? "outline" : "default"} onClick={() => setFilter(undefined)}>
          All {items.length}
        </Button>
        {TODO_FILTERS.filter((option) => (counts.get(option.value) ?? 0) > 0).map((option) => (
          <Button
            key={option.value}
            size="xs"
            variant={filter === option.value ? "default" : "outline"}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(filter === option.value ? undefined : option.value)}
          >
            {option.label} {counts.get(option.value)}
          </Button>
        ))}
      </div>

      {TODO_GROUPS.map((group) => {
        const inGroup = shown.filter((item) => groupOf(item, now) === group.value);
        if (inGroup.length === 0) return null;
        return (
          <section key={group.value} className="flex flex-col gap-2" aria-labelledby={`todo-${group.value}`}>
            <h3 id={`todo-${group.value}`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </h3>
            <Card>
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {inGroup.map((item) => (
                    <li key={todoKey(item)} className="py-3 first:pt-0 last:pb-0">
                      {item.kind === "session" ? (
                        <SessionTodo
                          session={item.session}
                          reasons={item.reasons}
                          onCancel={setCancelling}
                          onLink={setLinking}
                        />
                      ) : (
                        <FollowUpRow followUp={item.followUp} onEdit={(f) => setFollowUp({ mode: "edit", followUp: f })} />
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        );
      })}

      <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
      <DeleteSessionDialog session={cancelling} onClose={() => setCancelling(null)} onDeleted={() => undefined} />
      <LinkClientDialog session={linking} onClose={() => setLinking(null)} />
    </div>
  );
}

interface SessionTodoProps {
  session: Session;
  reasons: Array<TodoReason>;
  onCancel: (session: Session) => void;
  onLink: (session: Session) => void;
}

function SessionTodo({ session, reasons, onCancel, onLink }: SessionTodoProps) {
  const clientsById = ClientsQuery.useById();
  const client = session.clientId ? clientsById.get(session.clientId) : undefined;
  const detail = session.drift ?? session.reason ?? session.record?.summary;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TextLink
            to="/sessions/$id"
            params={{ id: session.eventId }}
            search={{ from: "home" }}
            className={client ? undefined : "text-muted-foreground italic"}
          >
            {client?.name ?? (session.name || session.title)}
          </TextLink>
          {reasons.map((reason) => (
            <Badge key={reason} variant={REASONS[reason].tone}>
              {REASONS[reason].label}
            </Badge>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {formatSessionTime(session.start)}
          {reasons.includes("collect") && ` · ${formatCents(dueCents(session))} due`}
        </span>
        {detail && <span className="line-clamp-1 text-xs text-muted-foreground">{detail}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <QuickActions session={session} reasons={reasons} onCancel={onCancel} onLink={onLink} hasClient={Boolean(client)} />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open session"
          render={<Link to="/sessions/$id" params={{ id: session.eventId }} search={{ from: "home" }} />}
          nativeButton={false}
        >
          <span className="hidden sm:inline">Open</span> <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}

function QuickActions({
  session,
  reasons,
  onCancel,
  onLink,
  hasClient,
}: SessionTodoProps & { hasClient: boolean }) {
  const confirm = SessionsMutation.useConfirm();
  const setPayment = SessionsMutation.useSetPayment();
  const restore = SessionsMutation.useRestore();
  const fail = (error: Error) => toast.error(error.message);

  if (reasons.includes("confirm") && hasClient) {
    return (
      <>
        <Button
          size="sm"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate(session.eventId, { onSuccess: () => toast.success("Confirmed"), onError: fail })}
        >
          <CheckIcon /> Confirm
        </Button>
        <Button size="sm" variant="outline" onClick={() => onCancel(session)}>
          <XIcon /> Cancel
        </Button>
      </>
    );
  }
  if (reasons.includes("deleted")) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={restore.isPending}
        onClick={() => restore.mutate(session.eventId, { onSuccess: () => toast.success("Restored"), onError: fail })}
      >
        <RotateCcwIcon /> Restore
      </Button>
    );
  }
  if (reasons.includes("fix") && session.status === "unmatched") {
    return (
      <Button size="sm" variant="outline" onClick={() => onLink(session)}>
        <LinkIcon /> Link client
      </Button>
    );
  }
  if (reasons.includes("collect")) {
    const due = dueCents(session);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={setPayment.isPending} />}>
          <BanknoteIcon /> Paid <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuLabel>{formatCents(due)} today, by</DropdownMenuLabel>
          {PAYMENT_METHODS.map((method) => (
            <DropdownMenuItem
              key={method.value}
              onClick={() =>
                setPayment.mutate(
                  {
                    eventId: session.eventId,
                    payment: { status: "paid", method: method.value, amountCents: due, paidOn: todayISO() },
                  },
                  { onSuccess: () => toast.success(`Marked paid by ${method.label}`), onError: fail },
                )
              }
            >
              {method.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return null;
}
