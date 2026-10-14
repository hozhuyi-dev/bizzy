import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRightIcon, BanknoteIcon, CalendarX2Icon, CheckIcon, ChevronDownIcon, NotebookPenIcon, PencilLineIcon, XIcon } from "lucide-react";
import { TODO_FILTERS, TODO_GROUPS } from "../../todo.constant";
import { groupOf, matchesFilter, owedText, packagePayable, sessionPayables, todoKey } from "../../todo.util";
import type { TodoFilter, TodoItem } from "../../todo.types";
import type { Conflict } from "~/features/conflicts/conflicts.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import type { Package } from "~/features/packages/packages.types";
import type { Payable } from "~/features/payments/payments.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { PaymentsMutation } from "~/features/payments/payments.mutation";
import { PAYMENT_METHODS } from "~/features/payments/payments.constant";
import { RemedyButtons, toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DeleteSessionDialog } from "~/features/sessions/components/delete-session-dialog/delete-session-dialog.component";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { EmptyState } from "~/components/shared/quip/quip.component";
import { formatDate, formatSessionTime, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { clientOf } from "~/features/clients/clients.util";

const REASONS: Record<TodoReason | "fix", { label: string; tone: "waiting" | "attention" | "info" }> = {
  confirm: { label: "Confirm", tone: "waiting" },
  record: { label: "Record", tone: "info" },
  collect: { label: "Collect", tone: "attention" },
  fix: { label: "Fix", tone: "attention" },
};

/**
 * Everything that needs her, sessions, packages, follow-ups and edits made
 * in the calendar that weren't applied, grouped by when: earlier (overdue),
 * today, coming up. Chips filter by what to do. Most jobs are done right
 * here (confirm, a one-line summary, mark paid, tick a follow-up, settle a
 * calendar edit), so she opens a session only for more.
 */
export function TodoList({ items }: { items: ReadonlyArray<TodoItem> }) {
  const clientsById = ClientsQuery.useById();
  const [filter, setFilter] = useState<TodoFilter>();
  const [cancelling, setCancelling] = useState<Session | null>(null);
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
                        <SessionTodo session={item.session} reasons={item.reasons} onCancel={setCancelling} onPayOther={setPaying} />
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
        clientName={clientOf(clientsById, cancelling?.clientId)?.name ?? "the client"}
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
  session: Session;
  reasons: Array<TodoReason>;
  onCancel: (session: Session) => void;
  onPayOther: (payables: Array<Payable>) => void;
}

function SessionTodo({ session, reasons, onCancel, onPayOther }: SessionTodoProps) {
  const clientsById = ClientsQuery.useById();
  const [writing, setWriting] = useState(false);
  const client = clientOf(clientsById, session.clientId);
  const collecting = reasons.includes("collect");
  const payables = collecting ? sessionPayables(session) : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TextLink to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }}>
              {client?.name ?? "Unknown client"}
            </TextLink>
            {reasons.map((reason) => (
              <Badge key={reason} variant={REASONS[reason].tone}>
                {REASONS[reason].label}
              </Badge>
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {formatSessionTime(session.start)}
            {collecting && ` · ${owedText(payables, session.owedCents)}`}
          </span>
          {session.record?.summary && <span className="line-clamp-1 text-xs text-muted-foreground">{session.record.summary}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <QuickActions
            session={session}
            reasons={reasons}
            writing={writing}
            payables={payables}
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
  session: Session;
  reasons: Array<TodoReason>;
  writing: boolean;
  payables: Array<Payable>;
  onCancel: (session: Session) => void;
  onWrite: () => void;
  onPayOther: (payables: Array<Payable>) => void;
}

function QuickActions({ session, reasons, writing, payables, onCancel, onWrite, onPayOther }: QuickActionsProps) {
  const confirm = useConfirmBooking();
  // Each button is one of the fixes its to-do rules name (session.fixes).
  const offers = (action: string) => session.fixes.includes(action);

  if (reasons.includes("confirm") && offers("sessions.update")) {
    return (
      <>
        <Button size="sm" disabled={confirm.pending} onClick={() => confirm.confirm(session.id)}>
          <CheckIcon /> Confirm
        </Button>
        {offers("sessions.delete") && (
          <Button
            size="sm"
            variant="outline"
            disabled={!session.can.delete.ok}
            title={session.can.delete.why}
            onClick={() => onCancel(session)}
          >
            <XIcon /> Cancel
          </Button>
        )}
      </>
    );
  }
  return (
    <>
      {reasons.includes("record") && offers("sessions.saveRecord") && !writing && (
        <Button size="sm" variant="outline" onClick={onWrite}>
          <PencilLineIcon /> Add summary
        </Button>
      )}
      {payables.length > 0 && offers("payments.set") && <PaidMenu payables={payables} onOther={() => onPayOther(payables)} />}
    </>
  );
}

/**
 * The one line that clears "Record", saved from the list. Long notes are on
 * the session's page; the summary alone leaves them as they are.
 */
function SummaryEditor({ session, onDone }: { session: Session; onDone: () => void }) {
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
 * Mark paid today in one tap by method: everything owed at once, or (with a
 * session's fee and its package both owed) either alone. Another day opens
 * the payment form.
 */
function PaidMenu({ payables, onOther }: { payables: ReadonlyArray<Payable>; onOther: () => void }) {
  const pay = PaymentsMutation.useSet();
  const total = payables.reduce((sum, p) => sum + p.dueCents, 0);
  const several = payables.length > 1;

  const payWith = (list: ReadonlyArray<Payable>, method: (typeof PAYMENT_METHODS)[number]) =>
    pay.mutate(
      { items: list.map((p) => p.item), payment: { method: method.value, paidOn: todayISO() } },
      {
        onSuccess: () => toast.success(`${formatCents(list.reduce((sum, p) => sum + p.dueCents, 0))} paid by ${method.label}`),
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
            {several ? "Both" : payables[0]?.item.kind === "package" ? "Package" : "Session"} · {formatCents(total)} today, by
          </DropdownMenuLabel>
          {PAYMENT_METHODS.map((method) => (
            <DropdownMenuItem key={method.value} onClick={() => payWith(payables, method)}>
              {method.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {several &&
          payables.map((p) => (
            <DropdownMenuSub key={p.item.kind}>
              <DropdownMenuSubTrigger>
                {p.label} only · {formatCents(p.dueCents)}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PAYMENT_METHODS.map((method) => (
                  <DropdownMenuItem key={method.value} onClick={() => payWith([p], method)}>
                    {method.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOther}>Another day…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A package bought on its own, to collect. */
function PackageTodo({ pkg, onPayOther }: { pkg: Package; onPayOther: (payables: Array<Payable>) => void }) {
  const clientsById = ClientsQuery.useById();
  const client = clientsById.get(pkg.clientId);
  const payable = packagePayable(pkg);

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
          Package of {pkg.sessions} · bought {formatDate(pkg.purchasedAt)} · {formatCents(pkg.priceCents)} due
        </span>
        {pkg.note && <span className="line-clamp-1 text-xs text-muted-foreground">{pkg.note}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pkg.fixes.includes("payments.set") && <PaidMenu payables={[payable]} onOther={() => onPayOther([payable])} />}
        <Button variant="ghost" size="sm" aria-label="Open packages" render={<Link to="/packages" />} nativeButton={false}>
          <span className="hidden sm:inline">Packages</span> <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}

/**
 * An edit she made in the calendar that bizzy didn't apply: what it asks,
 * why not, and her ways out (its fixes, the guards' remedies first). Once
 * nothing refuses it, it is ready: she applies it, or undoes it.
 */
function ConflictTodo({ conflict }: { conflict: Conflict }) {
  const clientsById = ClientsQuery.useById();
  const client = conflict.clientId ? clientsById.get(conflict.clientId) : undefined;
  const event = conflict.now ?? conflict.seen;
  const what = { new: "New in your calendar", changed: "Changed in your calendar", gone: "Deleted in your calendar" }[conflict.kind];
  const name = event && conflictName(event.title);
  const ready = conflict.rules.includes("edit-ready");
  const followUp = conflict.targetKind === "followUp";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CalendarX2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {conflict.targetId && followUp ? (
            <TextLink to="/follow-ups">{client?.name ?? event?.title ?? "A follow-up"}</TextLink>
          ) : conflict.targetId ? (
            <TextLink to="/sessions/$id" params={{ id: conflict.targetId }} search={{ from: "home" }}>
              {client?.name ?? event?.title ?? "A session"}
            </TextLink>
          ) : (
            <span className="font-medium">“{event?.title}”</span>
          )}
          <Badge variant={REASONS.fix.tone}>{what}</Badge>
          {ready && <Badge variant="info">Ready to apply</Badge>}
        </div>
        {event?.start && <span className="text-sm text-muted-foreground">{formatSessionTime(event.start)}</span>}
        {event?.date && <span className="text-sm text-muted-foreground">{formatDate(event.date)}</span>}
        {conflict.asks.length > 0 && <span className="text-xs text-muted-foreground">It asks: {conflict.asks.join(", ")}.</span>}
        {conflict.violations.map((v) => (
          <span key={v.guard} className="text-xs text-status-attention-foreground">
            {v.message}
          </span>
        ))}
      </div>
      {ready && (
        <span className="text-xs text-muted-foreground">
          Nothing stands in its way now. Apply it if you still want it, or undo it in the calendar.
        </span>
      )}
      <RemedyButtons remedies={conflict.fixes} name={name} applyAfter={conflict.key} onDone={() => toast.success("Done")} />
    </div>
  );
}

/** The name an event's title gives: a session's (`? Jane 95 (V)`) or a follow-up's (`! Jane: call`). */
function conflictName(title: string): string | undefined {
  const bare = title.trim();
  if (bare.startsWith("!")) return bare.slice(1).split(":")[0]?.trim();
  return bare.replace(/^\?\s*/, "").split(/\s+(?:\d|\()/)[0];
}
