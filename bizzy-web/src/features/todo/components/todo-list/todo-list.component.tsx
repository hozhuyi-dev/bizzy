import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRightIcon, BanknoteIcon, CalendarX2Icon, CheckIcon, ChevronDownIcon, NotebookPenIcon, PencilLineIcon, XIcon } from "lucide-react";
import { TODO_FILTERS, TODO_GROUPS } from "../../todo.constant";
import { groupOf, matchesFilter, todoKey } from "../../todo.util";
import type { TodoFilter, TodoView } from "../../todo.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { Payable } from "~/features/payments/payments.types";
import type { SessionReason, SessionView } from "~/features/sessions/sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ConflictActions } from "~/features/conflicts/components/conflict-actions/conflict-actions.component";
import { conflictKind, conflictTime } from "~/features/conflicts/conflicts.util";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { packagePayables } from "~/features/packages/packages.util";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { PaymentsMutation } from "~/features/payments/payments.mutation";
import { PAYMENT_METHODS } from "~/features/payments/payments.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DeleteSessionDialog } from "~/features/sessions/components/delete-session-dialog/delete-session-dialog.component";
import { owedText, sessionPayables } from "~/features/sessions/session-payment.util";
import { SessionsMutation } from "~/features/sessions/sessions.mutation";
import { useConfirmBooking } from "~/features/sessions/sessions-booking.hook";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { EmptyState } from "~/components/shared/quip/quip.component";
import { formatDate, formatSessionTime, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

const REASONS: Record<SessionReason | "fix", { label: string; tone: "waiting" | "attention" | "info" }> = {
  confirm: { label: "Confirm", tone: "waiting" },
  record: { label: "Record", tone: "info" },
  collect: { label: "Collect", tone: "attention" },
  fix: { label: "Fix", tone: "attention" },
};

/**
 * Everything that needs the user, sessions, packages, follow-ups and edits
 * made in the calendar that bizzy refused, grouped by when: earlier
 * (overdue), today, coming up. Chips filter by what to do. Most jobs are
 * done right here (confirm, a one-line summary, mark paid, tick a
 * follow-up, settle a calendar edit), so a session is opened only for more.
 */
export function TodoList({ items }: { items: ReadonlyArray<TodoView> }) {
  const [filter, setFilter] = useState<TodoFilter>();
  const [cancelling, setCancelling] = useState<SessionView | null>(null);
  const [paying, setPaying] = useState<Array<Payable> | null>(null);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUpTarget | null>(null);

  const counts = useMemo(() => {
    const out = new Map<TodoFilter, number>();
    for (const option of TODO_FILTERS) out.set(option.value, items.filter((item) => matchesFilter(item, option.value)).length);
    return out;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="py-6">
        <EmptyState quips={QUIPS.sessionsTodo}>
          Sessions to confirm, record or collect, packages to collect, follow-ups due and calendar edits to settle show
          up here.
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
                      {item.kind === "session" && (
                        <SessionTodo session={item.session} onCancel={setCancelling} onPayOther={setPaying} />
                      )}
                      {item.kind === "package" && <PackageTodo pkg={item.package} onPayOther={setPaying} />}
                      {item.kind === "followUp" && (
                        <FollowUpRow followUp={item.followUp} showKind onEdit={(followUp) => setEditingFollowUp({ mode: "edit", followUp })} />
                      )}
                      {item.kind === "conflict" && <ConflictTodo conflict={item.conflict} />}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        );
      })}

      <DeleteSessionDialog
        session={cancelling}
        clientName={cancelling?.clientName ?? "the client"}
        onClose={() => setCancelling(null)}
        onDeleted={() => undefined}
      />
      <FollowUpDialog target={editingFollowUp} onClose={() => setEditingFollowUp(null)} />
      <Dialog open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment</DialogTitle>
          </DialogHeader>
          {paying && <PaymentPanel payables={paying} onPaid={() => setPaying(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SessionTodoProps {
  session: SessionView;
  onCancel: (session: SessionView) => void;
  onPayOther: (payables: Array<Payable>) => void;
}

function SessionTodo({ session, onCancel, onPayOther }: SessionTodoProps) {
  const [writing, setWriting] = useState(false);
  const collecting = session.todo.includes("collect");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TextLink to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }}>
              {session.clientName}
            </TextLink>
            {session.todo.map((reason) => (
              <Badge key={reason} variant={REASONS[reason].tone}>
                {REASONS[reason].label}
              </Badge>
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {formatSessionTime(session.start)}
            {collecting && ` · ${owedText(session)}`}
          </span>
          {session.record.summary && <span className="line-clamp-1 text-xs text-muted-foreground">{session.record.summary}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <QuickActions
            session={session}
            writing={writing}
            onCancel={onCancel}
            onWrite={() => setWriting(true)}
            onPayOther={onPayOther}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Open session"
            render={<Link to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }} />}
            nativeButton={false}
          >
            <span className="hidden sm:inline">Open</span> <ArrowRightIcon />
          </Button>
        </div>
      </div>
      {writing && <SummaryEditor session={session} onDone={() => setWriting(false)} />}
    </div>
  );
}

interface QuickActionsProps {
  session: SessionView;
  writing: boolean;
  onCancel: (session: SessionView) => void;
  onWrite: () => void;
  onPayOther: (payables: Array<Payable>) => void;
}

/** The fix for each reason it is on the list, as far as its `can` allows. */
function QuickActions({ session, writing, onCancel, onWrite, onPayOther }: QuickActionsProps) {
  const confirm = useConfirmBooking();
  const { todo, can } = session;

  if (todo.includes("confirm")) {
    return (
      <>
        <Button size="sm" disabled={confirm.pending} onClick={() => void confirm.confirm(session.id).catch(toastRefusal)}>
          <CheckIcon /> Confirm
        </Button>
        <Button size="sm" variant="outline" disabled={!can.delete.ok} title={can.delete.why} onClick={() => onCancel(session)}>
          <XIcon /> Cancel
        </Button>
      </>
    );
  }
  const payables = sessionPayables(session).filter((p) => !p.paid);
  return (
    <>
      {todo.includes("record") && can.record.ok && !writing && (
        <Button size="sm" variant="outline" onClick={onWrite}>
          <PencilLineIcon /> Add summary
        </Button>
      )}
      {todo.includes("collect") && can.pay.ok && payables.length > 0 && (
        <PaidMenu payables={payables} onOther={() => onPayOther(payables)} />
      )}
    </>
  );
}

/**
 * The one line that clears "Record", saved from the list. Long notes are on
 * the session's page; the summary alone leaves them as they are.
 */
function SummaryEditor({ session, onDone }: { session: SessionView; onDone: () => void }) {
  const save = SessionsMutation.useSaveSummary();
  const [summary, setSummary] = useState("");
  const trimmed = summary.trim();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        save.mutate(
          { id: session.id, summary: trimmed },
          {
            onSuccess: () => {
              toast.success("Summary saved");
              onDone();
            },
            onError: toastRefusal,
          },
        );
      }}
    >
      <Input
        autoFocus
        aria-label="Summary"
        placeholder="One line on the session"
        maxLength={300}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        className="min-w-48 flex-1"
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={!trimmed || save.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Write full notes"
          title="Write full notes"
          render={<Link to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }} hash="record" />}
          nativeButton={false}
        >
          <NotebookPenIcon /> <span className="hidden sm:inline">Full notes</span>
        </Button>
      </div>
    </form>
  );
}

/**
 * Mark paid today in one tap by method: everything owed at once. Another
 * day opens the payment form.
 */
function PaidMenu({ payables, onOther }: { payables: ReadonlyArray<Payable>; onOther: () => void }) {
  const pay = PaymentsMutation.useSet();
  const total = payables.reduce((sum, p) => sum + p.dueCents, 0);
  const label = payables.map((p) => p.label).join(" and ");

  const payWith = (method: (typeof PAYMENT_METHODS)[number]) =>
    pay.mutate(
      { items: payables.map((p) => p.item), payment: { method: method.value, paidOn: todayISO() } },
      {
        onSuccess: () => toast.success(`${formatCents(total)} paid by ${method.label}`),
        onError: toastRefusal,
      },
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={pay.isPending} />}>
        <BanknoteIcon /> Paid <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {label} · {formatCents(total)} today, by
          </DropdownMenuLabel>
          {PAYMENT_METHODS.map((method) => (
            <DropdownMenuItem key={method.value} onClick={() => payWith(method)}>
              {method.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOther}>Another day…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A package bought on its own, to collect. */
function PackageTodo({ pkg, onPayOther }: { pkg: PackageView; onPayOther: (payables: Array<Payable>) => void }) {
  const clientsById = ClientsQuery.useById();
  const client = clientsById.get(pkg.clientId);
  const payables = packagePayables(pkg).filter((p) => !p.paid);

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {client ? (
            <TextLink to="/clients/$id" params={{ id: client.id }}>
              {client.name}
            </TextLink>
          ) : (
            <span className="text-muted-foreground italic">Unknown client</span>
          )}
          <Badge variant={REASONS.collect.tone}>{REASONS.collect.label}</Badge>
        </div>
        <span className="text-sm text-muted-foreground">
          Package of {pkg.sessions} · bought {formatDate(pkg.purchasedAt)} · {formatCents(pkg.owedCents)} due
        </span>
        {pkg.note && <span className="line-clamp-1 text-xs text-muted-foreground">{pkg.note}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {payables.length > 0 && <PaidMenu payables={payables} onOther={() => onPayOther(payables)} />}
        <Button variant="ghost" size="sm" aria-label="Open packages" render={<Link to="/packages" />} nativeButton={false}>
          <span className="hidden sm:inline">Packages</span> <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}

/**
 * An edit made in the calendar that bizzy refused: what the event says, why
 * not, and the ways out (its remedies, or applying it once settled).
 */
function ConflictTodo({ conflict }: { conflict: ConflictView }) {
  const time = conflictTime(conflict);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CalendarX2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {conflict.itemId && conflict.itemKind === "followUp" ? (
            <TextLink to="/follow-ups">“{conflict.title}”</TextLink>
          ) : conflict.itemId ? (
            <TextLink to="/sessions/$id" params={{ id: conflict.itemId }} search={{ from: "home" }}>
              “{conflict.title}”
            </TextLink>
          ) : (
            <span className="font-medium">“{conflict.title}”</span>
          )}
          <Badge variant={REASONS.fix.tone}>{conflictKind(conflict)}</Badge>
        </div>
        {time && <span className="text-sm text-muted-foreground">{time}</span>}
        <span className="text-xs text-status-attention-foreground">{conflict.message}</span>
      </div>
      <ConflictActions conflict={conflict} />
    </div>
  );
}
