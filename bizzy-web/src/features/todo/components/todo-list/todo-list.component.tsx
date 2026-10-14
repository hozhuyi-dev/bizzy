import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  LinkIcon,
  NotebookPenIcon,
  PackageCheckIcon,
  PencilLineIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { TODO_FILTERS, TODO_GROUPS } from "../../todo.constant";
import { groupOf, matchesFilter, owedText, packagePayable, sessionPayables, todoKey  } from "../../todo.util";
import type { TodoFilter, TodoItem } from "../../todo.types";
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
import { DeleteSessionDialog } from "~/features/sessions/components/delete-session-dialog/delete-session-dialog.component";
import { LinkClientDialog } from "~/features/sessions/components/link-client-dialog/link-client-dialog.component";
import { isUnmatched } from "~/features/sessions/session-stage.util";
import { SessionsMutation } from "~/features/sessions/sessions.mutation";
import { useConfirmBooking } from "~/features/sessions/sessions-booking.hook";
import { PackagesMutation } from "~/features/packages/packages.mutation";
import { DeletePackageDialog } from "~/features/packages/components/delete-package-dialog/delete-package-dialog.component";
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
import { PackageDocuments } from "~/features/packages/packages.columns";

const REASONS: Record<TodoReason, { label: string; tone: "waiting" | "attention" | "info" | "neutral" }> = {
  confirm: { label: "Confirm", tone: "waiting" },
  record: { label: "Record", tone: "info" },
  collect: { label: "Collect", tone: "attention" },
  fix: { label: "Fix", tone: "attention" },
  deleted: { label: "Deleted", tone: "neutral" },
};

/**
 * Everything that needs her, sessions, packages and follow-ups together,
 * grouped by when: earlier (overdue), today, coming up. Chips filter by what
 * to do. Most jobs are done right here (confirm, a one-line summary, mark
 * paid, tick a follow-up), so she opens a session only for more.
 */
export function TodoList({ items }: { items: ReadonlyArray<TodoItem> }) {
  const [filter, setFilter] = useState<TodoFilter>();
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [linking, setLinking] = useState<Session | null>(null);
  const [paying, setPaying] = useState<Array<Payable> | null>(null);
  const [fixingFollowUp, setFixingFollowUp] = useState<FollowUpTarget | null>(null);

  const counts = useMemo(() => {
    const out = new Map<TodoFilter, number>();
    for (const option of TODO_FILTERS) out.set(option.value, items.filter((item) => matchesFilter(item, option.value)).length);
    return out;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="py-6">
        <EmptyState quips={QUIPS.sessionsTodo}>
          Sessions to confirm, record or collect, packages to collect, follow-ups due and anything to fix show up here.
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
                        <SessionTodo
                          session={item.session}
                          reasons={item.reasons}
                          onCancel={setCancelling}
                          onLink={setLinking}
                          onPayOther={setPaying}
                        />
                      )}
                      {item.kind === "package" && (
                        <PackageTodo pkg={item.package} reasons={item.reasons} onPayOther={setPaying} />
                      )}
                      {item.kind === "followUp" && (
                        <FollowUpRow
                          followUp={item.followUp}
                          showKind
                          onFix={(followUp) => setFixingFollowUp({ mode: "edit", followUp })}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        );
      })}

      <DeleteSessionDialog session={cancelling} onClose={() => setCancelling(null)} onDeleted={() => undefined} />
      <LinkClientDialog session={linking} onClose={() => setLinking(null)} />
      <FollowUpDialog target={fixingFollowUp} onClose={() => setFixingFollowUp(null)} />
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
  onLink: (session: Session) => void;
  onPayOther: (payables: Array<Payable>) => void;
}

function SessionTodo({ session, reasons, onCancel, onLink, onPayOther }: SessionTodoProps) {
  const clientsById = ClientsQuery.useById();
  const [writing, setWriting] = useState(false);
  const client = clientOf(clientsById, session.clientId);
  const detail = session.drift ?? session.reason ?? session.record?.summary;
  const collecting = reasons.includes("collect");
  const payables = collecting ? sessionPayables(session) : [];

  return (
    <div className="flex flex-col gap-2">
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
            {collecting && ` · ${owedText(payables, session.owedCents)}`}
          </span>
          {detail && <span className="line-clamp-1 text-xs text-muted-foreground">{detail}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <QuickActions
            session={session}
            reasons={reasons}
            hasClient={Boolean(client)}
            writing={writing}
            payables={payables}
            onCancel={onCancel}
            onLink={onLink}
            onWrite={() => setWriting(true)}
            onPayOther={onPayOther}
          />
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
      {writing && <SummaryEditor session={session} onDone={() => setWriting(false)} />}
    </div>
  );
}

interface QuickActionsProps {
  session: Session;
  reasons: Array<TodoReason>;
  hasClient: boolean;
  writing: boolean;
  payables: Array<Payable>;
  onCancel: (session: Session) => void;
  onLink: (session: Session) => void;
  onWrite: () => void;
  onPayOther: (payables: Array<Payable>) => void;
}

function QuickActions({ session, reasons, hasClient, writing, payables, onCancel, onLink, onWrite, onPayOther }: QuickActionsProps) {
  const confirm = useConfirmBooking();
  const restore = SessionsMutation.useRestore();
  const fail = (error: Error) => toast.error(error.message);
  // Each button is one of the fixes its to-do rules name (session.fixes).
  const offers = (action: string) => session.fixes.includes(action);

  if (reasons.includes("confirm") && hasClient && offers("sessions.update")) {
    return (
      <>
        <Button size="sm" disabled={confirm.pending} onClick={() => confirm.confirm(session.eventId)}>
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
        {confirm.dialog}
      </>
    );
  }
  if (reasons.includes("deleted") && offers("sessions.restore")) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={restore.isPending || !session.can.restore.ok}
        onClick={() => restore.mutate(session.eventId, { onSuccess: () => toast.success("Restored"), onError: fail })}
      >
        <RotateCcwIcon /> Restore
      </Button>
    );
  }
  if (reasons.includes("fix") && isUnmatched(session) && offers("clients.save")) {
    return (
      <Button size="sm" variant="outline" onClick={() => onLink(session)}>
        <LinkIcon /> Link client
      </Button>
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
          { eventId: session.eventId, summary: trimmed },
          {
            onSuccess: () => {
              toast.success("Summary saved");
              onDone();
            },
            onError: (error) => toast.error(error.message),
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
          render={<Link to="/sessions/$id" params={{ id: session.eventId }} search={{ from: "home" }} hash="record" />}
          nativeButton={false}
        >
          <NotebookPenIcon /> <span className="hidden sm:inline">Full notes</span>
        </Button>
      </div>
    </form>
  );
}

/**
 * Mark paid today in one tap by method: everything due at once, or (with a
 * session's fee and its package both due) either alone. Anything else (an
 * amount, a day, waiving) opens the payment form.
 */
function PaidMenu({ payables, onOther }: { payables: ReadonlyArray<Payable>; onOther: () => void }) {
  const pay = PaymentsMutation.useSet();
  const total = payables.reduce((sum, p) => sum + p.dueCents, 0);
  const several = payables.length > 1;

  const payWith = (list: ReadonlyArray<Payable>, method: (typeof PAYMENT_METHODS)[number]) =>
    pay.mutate(
      { items: list.map((p) => p.item), payment: { status: "paid", method: method.value, paidOn: todayISO() } },
      {
        onSuccess: () => toast.success(`${formatCents(list.reduce((sum, p) => sum + p.dueCents, 0))} paid by ${method.label}`),
        onError: (error) => toast.error(error.message),
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
        <DropdownMenuItem onClick={onOther}>Other amount, day, or waive…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PackageTodoProps {
  pkg: Package;
  reasons: Array<TodoReason>;
  onPayOther: (payables: Array<Payable>) => void;
}

/**
 * A package on the list: one to collect that no session bought (added here,
 * or unlinked from its session), or one an issued document now contradicts.
 */
function PackageTodo({ pkg, reasons, onPayOther }: PackageTodoProps) {
  const clientsById = ClientsQuery.useById();
  const client = clientsById.get(pkg.clientId);
  const payable = packagePayable(pkg);
  const collecting = reasons.includes("collect");
  const makeStandalone = PackagesMutation.useMakeStandalone();
  const [deleting, setDeleting] = useState(false);
  // Each button is one of the fixes its to-do rules name (pkg.fixes).
  const offers = (action: string) => pkg.fixes.includes(action);

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
          {reasons.map((reason) => (
            <Badge key={reason} variant={REASONS[reason].tone}>
              {REASONS[reason].label}
            </Badge>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          Package of {pkg.sessions} · bought {formatDate(pkg.purchasedAt)}
          {collecting && <> · {formatCents(pkg.priceCents)} due</>}
        </span>
        {pkg.unlinked && (
          <span className="text-sm text-muted-foreground">
            The calendar no longer buys it: keep it as its own, or delete it.
          </span>
        )}
        {pkg.drift && (
          <span className="text-sm text-muted-foreground">
            {pkg.drift} · <PackageDocuments pkg={pkg} />
          </span>
        )}
        {pkg.note && <span className="line-clamp-1 text-xs text-muted-foreground">{pkg.note}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {offers("packages.makeStandalone") && pkg.can.makeStandalone.ok && (
          <Button
            size="sm"
            variant="outline"
            disabled={makeStandalone.isPending}
            onClick={() =>
              makeStandalone.mutate(pkg.id, {
                onSuccess: () => toast.success("Kept as its own package"),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            <PackageCheckIcon /> Keep
          </Button>
        )}
        {offers("packages.delete") && (
          <Button
            size="sm"
            variant="outline"
            disabled={!pkg.can.delete.ok}
            title={pkg.can.delete.why}
            onClick={() => setDeleting(true)}
          >
            <Trash2Icon /> Delete
          </Button>
        )}
        {collecting && offers("payments.set") && <PaidMenu payables={[payable]} onOther={() => onPayOther([payable])} />}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open packages"
          render={<Link to="/packages" />}
          nativeButton={false}
        >
          <span className="hidden sm:inline">Packages</span> <ArrowRightIcon />
        </Button>
      </div>
      <DeletePackageDialog
        pkg={deleting ? pkg : null}
        clientName={client?.name ?? "Unknown client"}
        onClose={() => setDeleting(false)}
      />
    </div>
  );
}
