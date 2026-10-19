import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRightIcon, BanknoteIcon, CalendarX2Icon, CheckIcon, ChevronDownIcon, NotebookPenIcon, PencilLineIcon, SparklesIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { TODO_FILTERS, TODO_GROUPS } from "../../todo.constant";
import { byTodoOrder, groupOf, matchesFilter, progressOf, todoKey } from "../../todo.util";
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
import { InlineField } from "~/components/shared/inline-action/inline-action.component";
import { ListRow } from "~/components/shared/list-row/list-row.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { EmptyState } from "~/components/shared/quip/quip.component";
import { toastWithQuip } from "~/components/shared/quip/quip-toast";
import { formatDate, formatHours, formatSessionTime, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

const REASONS: Record<SessionReason | "calendar", { label: string; tone: "waiting" | "attention" | "info" }> = {
  confirm: { label: "Confirm", tone: "waiting" },
  record: { label: "Record", tone: "info" },
  collect: { label: "Collect", tone: "attention" },
  calendar: { label: "Calendar", tone: "attention" },
};

/** How long a row done takes to fold away; the CSS below matches it. */
const LEAVE_MS = 300;

/**
 * Everything that needs the user: calendar edits bizzy refused first, then
 * sessions, packages and follow-ups by when (earlier, today, coming up).
 * Chips filter by what to do. Most jobs are done right here (confirm, a
 * one-line summary, mark paid, tick a follow-up, settle a calendar edit),
 * in place: a row's buttons swap for what they need, and a row done folds
 * away, so the list never jumps. A bar counts what was cleared today.
 */
export function TodoList({ items }: { items: ReadonlyArray<TodoView> }) {
  const [filter, setFilter] = useState<TodoFilter>();
  const [cancelling, setCancelling] = useState<SessionView | null>(null);
  const [paying, setPaying] = useState<Array<Payable> | null>(null);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUpTarget | null>(null);
  const leaving = useLeaving(items);
  const progress = progressOf(items, todayISO());

  const counts = useMemo(() => {
    const out = new Map<TodoFilter, number>();
    for (const option of TODO_FILTERS) out.set(option.value, items.filter((item) => matchesFilter(item, option.value)).length);
    return out;
  }, [items]);

  const dialogs = (
    <>
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
    </>
  );

  if (items.length === 0 && leaving.length === 0) {
    return (
      <div className="py-6">
        {progress.cleared > 0 ? (
          <AllCleared cleared={progress.cleared} />
        ) : (
          <EmptyState quips={QUIPS.sessionsTodo}>
            Sessions to confirm, record or collect, packages to collect, follow-ups due and calendar edits to settle show
            up here.
          </EmptyState>
        )}
        {dialogs}
      </div>
    );
  }

  const rows = [...items.map((item) => ({ item, gone: false })), ...leaving.map((item) => ({ item, gone: true }))].sort(
    (a, b) => byTodoOrder(a.item, b.item),
  );
  const shown = rows.filter(({ item }) => matchesFilter(item, filter));
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <Progress cleared={progress.cleared} left={progress.left} />

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
        const inGroup = shown.filter(({ item }) => groupOf(item, now) === group.value);
        if (inGroup.length === 0) return null;
        return (
          <section key={group.value} className="flex flex-col gap-2" aria-labelledby={`todo-${group.value}`}>
            <h3 id={`todo-${group.value}`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </h3>
            <Card>
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {inGroup.map(({ item, gone }) => (
                    <li
                      key={todoKey(item)}
                      inert={gone}
                      className={cn(
                        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                        "first:[&>div>div]:pt-0 last:[&>div>div]:pb-0",
                        gone ? "grid-rows-[0fr] border-transparent opacity-0" : "grid-rows-[1fr]",
                      )}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="py-3">
                          {item.kind === "session" && (
                            <SessionTodo session={item.session} onCancel={setCancelling} onPayOther={setPaying} />
                          )}
                          {item.kind === "package" && <PackageTodo pkg={item.package} onPayOther={setPaying} />}
                          {item.kind === "followUp" && (
                            <FollowUpRow
                              followUp={item.followUp}
                              showKind
                              onEdit={(followUp) => setEditingFollowUp({ mode: "edit", followUp })}
                            />
                          )}
                          {item.kind === "conflict" && <ConflictTodo conflict={item.conflict} />}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        );
      })}

      {dialogs}
    </div>
  );
}

/**
 * The items just gone from the list, kept a moment so their rows fold away
 * instead of the list jumping. One back on the list (an undo) stays.
 */
function useLeaving(items: ReadonlyArray<TodoView>): ReadonlyArray<TodoView> {
  const [prev, setPrev] = useState(items);
  const [leaving, setLeaving] = useState<ReadonlyArray<TodoView>>([]);
  if (prev !== items) {
    const now = new Set(items.map(todoKey));
    setPrev(items);
    setLeaving([...leaving.filter((item) => !now.has(todoKey(item))), ...prev.filter((item) => !now.has(todoKey(item)))]);
  }
  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = setTimeout(() => setLeaving([]), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  return leaving;
}

/**
 * What was cleared today, as a bar filling with honey. Shown empty from the
 * start, so the first one cleared fills it instead of pushing the list down.
 */
function Progress({ cleared, left }: { cleared: number; left: number }) {
  const total = cleared + left;
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label="Cleared today"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={cleared}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${total === 0 ? 0 : (cleared / total) * 100}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {cleared > 0 ? `${cleared} cleared · ${left} to go` : `${left} to go`}
      </span>
    </div>
  );
}

/** The last one cleared: a quiet moment, then the usual empty list next time. */
function AllCleared({ cleared }: { cleared: number }) {
  return (
    <div className="flex flex-col items-center gap-2 duration-500 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none">
      <SparklesIcon className="size-5 text-brand" aria-hidden="true" />
      <EmptyState quips={QUIPS.todoCleared}>
        {cleared === 1 ? "One thing cleared today." : `${cleared} things cleared today.`} Nothing else needs you.
      </EmptyState>
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
    <ListRow
      title={
        <>
          <TextLink to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }}>
            {session.clientName}
          </TextLink>
          {session.todo.map((reason) => (
            <Badge key={reason} variant={REASONS[reason].tone}>
              {REASONS[reason].label}
            </Badge>
          ))}
        </>
      }
      meta={
        <>
          {formatSessionTime(session.start)}
          {collecting && ` · ${owedText(session)}`}
        </>
      }
      detail={session.record.summary}
      detailTitle={session.record.summary}
      actions={
        writing ? (
          <SummaryField session={session} onDone={() => setWriting(false)} />
        ) : (
          <>
            <QuickActions session={session} onCancel={onCancel} onWrite={() => setWriting(true)} onPayOther={onPayOther} />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open session"
              render={<Link to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }} />}
              nativeButton={false}
            >
              <span className="hidden sm:inline">Open</span> <ArrowRightIcon />
            </Button>
          </>
        )
      }
    />
  );
}

interface QuickActionsProps {
  session: SessionView;
  onCancel: (session: SessionView) => void;
  onWrite: () => void;
  onPayOther: (payables: Array<Payable>) => void;
}

/** The fix for each reason it is on the list, as far as its `can` allows. */
function QuickActions({ session, onCancel, onWrite, onPayOther }: QuickActionsProps) {
  const confirm = useConfirmBooking();
  const { todo, can } = session;

  if (todo.includes("confirm")) {
    return (
      <>
        <Button size="sm" disabled={confirm.pending} onClick={() => void confirm.confirm(session.id).catch(toastRefusal)}>
          <CheckIcon /> Confirm
        </Button>
        <Button size="sm" variant="outline" disabled={!can.delete.ok} title={can.delete.why} onClick={() => onCancel(session)}>
          <XIcon /> Cancel session
        </Button>
      </>
    );
  }
  const payables = sessionPayables(session).filter((p) => !p.paid);
  return (
    <>
      {todo.includes("record") && can.record.ok && (
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
 * The one line that clears "Record", written in place of the row's
 * buttons. Long notes are on the session's page; the summary alone leaves
 * them as they are.
 */
function SummaryField({ session, onDone }: { session: SessionView; onDone: () => void }) {
  const save = SessionsMutation.useSaveSummary();

  return (
    <InlineField
      label="Summary"
      placeholder="One line on the session"
      maxLength={300}
      pending={save.isPending}
      onCancel={onDone}
      onSave={(summary) =>
        save.mutate(
          { id: session.id, summary },
          {
            onSuccess: () => {
              toastWithQuip("Summary saved", QUIPS.todoDone);
              onDone();
            },
            onError: toastRefusal,
          },
        )
      }
      extra={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Write full notes"
          title="Write full notes"
          render={<Link to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }} hash="record" />}
          nativeButton={false}
        >
          <NotebookPenIcon />
        </Button>
      }
    />
  );
}

/**
 * Mark paid today in one tap by method: everything owed at once, with an
 * Undo in the toast. Another day opens the payment form.
 */
function PaidMenu({ payables, onOther }: { payables: ReadonlyArray<Payable>; onOther: () => void }) {
  const pay = PaymentsMutation.useSet();
  const total = payables.reduce((sum, p) => sum + p.dueCents, 0);
  const label = payables.map((p) => p.label).join(" and ");
  const items = payables.map((p) => p.item);

  const payWith = (method: (typeof PAYMENT_METHODS)[number]) =>
    pay.mutate(
      { items, payment: { method: method.value, paidOn: todayISO() } },
      {
        onSuccess: () =>
          toast.success(`${formatCents(total)} paid by ${method.label}`, {
            action: {
              label: "Undo",
              onClick: () =>
                pay.mutate({ items, payment: null }, { onSuccess: () => toast.success("Payment undone"), onError: toastRefusal }),
            },
          }),
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
    <ListRow
      title={
        <>
          {client ? (
            <TextLink to="/clients/$id" params={{ id: client.id }}>
              {client.name}
            </TextLink>
          ) : (
            <span className="text-muted-foreground italic">Unknown client</span>
          )}
          <Badge variant={REASONS.collect.tone}>{REASONS.collect.label}</Badge>
        </>
      }
      meta={`Package of ${formatHours(pkg.hours)} · bought ${formatDate(pkg.purchasedAt)} · ${formatCents(pkg.owedCents)} due`}
      detail={pkg.note}
      detailTitle={pkg.note}
      actions={
        <>
          {payables.length > 0 && <PaidMenu payables={payables} onOther={() => onPayOther(payables)} />}
          <Button variant="ghost" size="sm" aria-label="Open packages" render={<Link to="/packages" />} nativeButton={false}>
            <span className="hidden sm:inline">Packages</span> <ArrowRightIcon />
          </Button>
        </>
      }
    />
  );
}

/**
 * An edit made in the calendar that bizzy refused: what the event says, why
 * not, and the ways out (its remedies, or trying it again once settled).
 */
function ConflictTodo({ conflict }: { conflict: ConflictView }) {
  const time = conflictTime(conflict);

  return (
    <ListRow
      title={
        <>
          <CalendarX2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {conflict.itemId && conflict.itemKind === "followUp" ? (
            <TextLink to="/follow-ups" search={{ open: conflict.itemId }}>
              “{conflict.title}”
            </TextLink>
          ) : conflict.itemId ? (
            <TextLink to="/sessions/$id" params={{ id: conflict.itemId }} search={{ from: "home" }}>
              “{conflict.title}”
            </TextLink>
          ) : (
            <span className="font-medium">“{conflict.title}”</span>
          )}
          <Badge variant={REASONS.calendar.tone}>{conflictKind(conflict)}</Badge>
        </>
      }
      meta={time}
      detail={<span className="text-status-attention-foreground">{conflict.message}</span>}
      detailTitle={conflict.message}
      actions={<ConflictActions conflict={conflict} />}
    />
  );
}
