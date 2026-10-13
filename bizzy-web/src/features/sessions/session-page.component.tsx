import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BanIcon,
  CalendarPlusIcon,
  CheckIcon,
  CircleAlertIcon,
  FileTextIcon,
  LockIcon,
  MessageCircleIcon,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { BookingForm } from "./components/booking-form/booking-form.component";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { NextVisitDialog } from "./components/next-visit-dialog/next-visit-dialog.component";
import { PipelineLayout } from "./components/pipeline-layout/pipeline-layout.component";
import { RecordEditor, useRecordDraft } from "./components/record-editor/record-editor.component";
import { DiscardDialog } from "./deleted-sessions-page.component";
import {
  allSessionDocuments,
  documentItems,
  dueCents,
  hasHappened,
  isBoughtDue,
  isDelivered,
  isPaid,
  needsFix,
  owedCents,
  sessionDocuments,
} from "./session-stage";
import { SessionsMutation, isStaleEdit } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { PipelineStep, StepState } from "./components/pipeline-layout/pipeline-layout.component";
import type { RecordDraft } from "./components/record-editor/record-editor.component";
import type { DocumentItem, SessionDocument } from "./session-stage";
import type { Session, SessionDraft, StoredSession } from "./sessions.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { Client } from "~/features/clients/clients.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { FollowUpTarget } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import type { FollowUp } from "~/features/follow-ups/follow-ups.types";
import type { Package } from "~/features/packages/packages.types";
import type { Payable } from "~/features/payments/components/payment-panel/payment-panel.component";
import { boughtIn, creditsLeft } from "~/features/packages/packages.types";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { methodLabel } from "~/features/payments/payments.types";
import { Checkbox } from "~/components/ui/checkbox";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { DOCUMENT_TYPES, documentLabel, documentRoute } from "~/features/documents/documents.registry";
import { useCreateDocument } from "~/features/documents/use-create-document";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow, formatDue } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { FollowUpsQuery } from "~/features/follow-ups/follow-ups.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { SettingsQuery } from "~/features/settings/settings.query";
import { TodoQuery, nextTodoSession } from "~/features/todo/todo.query";
import { useSendDocuments } from "~/features/whatsapp/use-whatsapp";
import { openWhatsApp, whatsappLink } from "~/features/whatsapp/whatsapp.link";
import { documentsTitle, paymentMessage } from "~/features/whatsapp/whatsapp.message";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/** Where the session was opened from, to go back there. */
export type SessionReturnTo = "home";

export type SessionPageProps = { returnTo?: SessionReturnTo | undefined } & (
  | { mode: "new" }
  | { mode: "edit"; eventId: string }
);

function parentOf(returnTo: SessionReturnTo | undefined) {
  return returnTo === "home" ? ({ to: "/", label: "Home" } as const) : ({ to: "/sessions", label: "Sessions" } as const);
}

/**
 * A session's own page. A new one is just its booking; an existing one
 * walks through its steps: booking, notes, payment, then the optional
 * documents and follow-ups.
 */
export function SessionPage(props: SessionPageProps) {
  if (props.mode === "new") return <NewSession returnTo={props.returnTo} />;
  return <ExistingSession eventId={props.eventId} returnTo={props.returnTo} />;
}

/** Now, on the hour: most often she's adding the session she just had. */
function newDraft(): SessionDraft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  return { clientId: "", start: start.toISOString(), minutes: 60, homeVisit: false, tentative: false };
}

function NewSession({ returnTo }: { returnTo: SessionReturnTo | undefined }) {
  const create = SessionsMutation.useCreate();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader parent={parentOf(returnTo)} title="New session" />
      {create.error && (
        <div className="-mx-4 -mt-4 mb-4">
          <Banner tone="attention" icon={CircleAlertIcon} title={create.error.message} role="alert" />
        </div>
      )}
      <Card className="max-w-3xl">
        <CardContent>
          <BookingForm
            initial={newDraft()}
            submitLabel="Add session"
            onSubmit={async (draft) => {
              const created = await create.mutateAsync(draft);
              const booked = new Date(draft.start) > new Date();
              toast.success(booked ? `Booked for ${formatSessionTime(draft.start)}` : "Session added");
              // Straight to its notes and payment.
              void navigate({ to: "/sessions/$id", params: { id: created.eventId }, search: { from: returnTo }, replace: true });
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}

function ExistingSession({ eventId, returnTo }: { eventId: string; returnTo: SessionReturnTo | undefined }) {
  const detail = SessionsQuery.useDetail(eventId);
  const parent = parentOf(returnTo);

  if (detail.isPending) {
    return (
      <>
        <PageHeader parent={parent} title="…" />
        <Loading />
      </>
    );
  }
  if (detail.error) {
    return (
      <>
        <PageHeader parent={parent} title="Not available" />
        <p role="alert" className="text-sm text-destructive">
          {detail.error.message}
        </p>
      </>
    );
  }
  return <SessionPipeline stored={detail.data} returnTo={returnTo} />;
}

function SessionPipeline({ stored, returnTo }: { stored: StoredSession; returnTo: SessionReturnTo | undefined }) {
  const { session } = stored;
  const navigate = useNavigate();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const todo = TodoQuery.useList();
  const record = useRecordDraft(session, stored.notes);
  const [deleting, setDeleting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [nextVisit, setNextVisit] = useState<SessionDraft | null>(null);
  const restore = SessionsMutation.useRestore();

  const parent = parentOf(returnTo);
  const client = session.clientId ? clientsById.get(session.clientId) : undefined;
  const bought = boughtIn(session.eventId, packages.data?.find((pkg) => pkg.id === session.eventId));
  const covering = session.packageId ? packages.data?.find((pkg) => pkg.id === session.packageId) : undefined;
  const documents = allSessionDocuments(session, bought);
  const locked = documents.length > 0;
  const next = nextTodoSession(todo.data, session.eventId);
  const leave = () => void navigate(returnTo === "home" ? { to: "/" } : { to: "/sessions" });

  const messages = useMessageActions(session, client, documents);
  const more: Array<RowAction> = [...messages];
  if (!locked && !session.removedAt) {
    more.push({ label: "Delete", icon: Trash2Icon, destructive: true, onClick: () => setDeleting(true) });
  }

  const steps: Array<PipelineStep> = [
    bookingStep(session, stored.draft, locked, () => setDeleting(true)),
    recordStep(session, record),
    paymentStep(session, covering, bought),
    documentsStep(session, bought),
    followUpsStep(session, client, stored.draft, setFollowUp, setNextVisit),
  ];

  const problem = session.drift ?? (needsFix(session) ? session.reason : undefined);

  return (
    <>
      <PageHeader
        parent={parent}
        title={client?.name ?? (session.name || session.title)}
        actions={
          next && (
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/sessions/$id" params={{ id: next }} search={{ from: returnTo ?? "home" }} />}
              nativeButton={false}
            >
              <span className="hidden sm:inline">Next to-do</span> <ArrowRightIcon />
            </Button>
          )
        }
        moreActions={more}
      />
      <PipelineLayout
        banner={
          (session.removedAt || locked || problem) && (
            <>
              {session.removedAt && (
                <Banner tone="attention" icon={BanIcon} title="Deleted from your calendar.">
                  Kept for what you recorded.{" "}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-4"
                    disabled={restore.isPending}
                    onClick={() =>
                      restore.mutate(session.eventId, {
                        onSuccess: () => toast.success("Restored to your calendar"),
                        onError: (error) => toast.error(error.message),
                      })
                    }
                  >
                    Restore
                  </button>{" "}
                  or{" "}
                  <button type="button" className="font-medium underline underline-offset-4" onClick={() => setDiscarding(true)}>
                    discard
                  </button>
                  .
                </Banner>
              )}
              {locked && !session.removedAt && (
                <Banner tone="neutral" icon={LockIcon} title="The booking is on a document.">
                  Cancel {documentLinks(documents)} to change it.
                </Banner>
              )}
              {problem && <Banner tone="attention" icon={CircleAlertIcon} title={problem} />}
            </>
          )
        }
        steps={steps}
      />
      <DeleteSessionDialog session={deleting ? session : null} onClose={() => setDeleting(false)} onDeleted={leave} />
      <DiscardDialog session={discarding ? session : null} onClose={() => setDiscarding(false)} onDiscarded={leave} />
      <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
      <NextVisitDialog from={nextVisit} clientName={client?.name ?? "the client"} onClose={() => setNextVisit(null)} />
    </>
  );
}

function documentLinks(documents: ReadonlyArray<SessionDocument>) {
  return documents.map(({ type, ref }, i) => (
    <span key={ref.documentId}>
      {i > 0 && " and "}
      <TextLink to={documentRoute(type)} params={{ id: ref.documentId }}>
        {ref.number ? documentLabel(ref.number, ref.revision) : `the draft ${DOCUMENT_TYPES[type].title.toLowerCase()}`}
      </TextLink>
    </span>
  ));
}

function Lines({ children }: { children: Array<string | false | undefined> }) {
  return (
    <>
      {children.filter(Boolean).map((line) => (
        <span key={line as string} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

// Steps.

function bookingStep(session: Session, draft: SessionDraft, locked: boolean, onCancel: () => void): PipelineStep {
  const tentative = session.status === "tentative";
  const problem = tentative || needsFix(session);
  const happened = hasHappened(session);
  return {
    id: "booking",
    title: "Booking",
    state: problem ? "current" : "done",
    meta: (
      <Lines>
        {[
          tentative ? "Not confirmed" : session.confirmedAt ? `Confirmed ${formatDate(session.confirmedAt)}` : undefined,
          session.removedAt
            ? `Deleted ${formatDate(session.removedAt)}`
            : happened
              ? `Happened ${formatDate(session.start)}`
              : `Booked for ${formatSessionTime(session.start)}`,
        ]}
      </Lines>
    ),
    content: <BookingStep session={session} draft={draft} locked={locked} onCancel={onCancel} />,
  };
}

function BookingStep({
  session,
  draft,
  locked,
  onCancel,
}: {
  session: Session;
  draft: SessionDraft;
  locked: boolean;
  onCancel: () => void;
}) {
  const update = SessionsMutation.useUpdate();
  const confirm = SessionsMutation.useConfirm();
  const [editing, setEditing] = useState(needsFix(session));
  const tentative = session.status === "tentative";
  const end = new Date(session.end);
  const minutes = Math.round((end.getTime() - new Date(session.start).getTime()) / 60_000);
  // Restarts from the calendar whenever the event changes.
  const calendarKey = `${session.title}|${session.start}|${session.end}|${session.colorId ?? ""}`;

  return (
    <>
      {tentative && !session.removedAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-waiting px-3 py-2 text-sm text-status-waiting-foreground">
          <span>Not confirmed with the client yet.</span>
          <span className="flex gap-2">
            <Button
              size="sm"
              disabled={confirm.isPending || locked}
              onClick={() =>
                confirm.mutate(session.eventId, {
                  onSuccess: () => toast.success("Confirmed"),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              <CheckIcon /> Confirm
            </Button>
            <Button size="sm" variant="outline" disabled={locked} onClick={onCancel}>
              Cancel booking
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {formatSessionTime(session.start)} · {minutes} min · {session.location === "home" ? "Home visit" : "Your place"}
          {session.feeCents !== undefined && <> · {formatCents(session.feeCents)}</>}
          {session.status === "package" && <> · package credit</>}
        </span>
        {!locked && !session.removedAt && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon /> Edit booking
          </Button>
        )}
      </div>

      {editing && (
        <BookingForm
          key={calendarKey}
          initial={draft}
          session={session}
          locked={locked}
          submitLabel="Save booking"
          onSubmit={async (next) => {
            try {
              await update.mutateAsync({ eventId: session.eventId, draft: next });
            } catch (error) {
              toast.error((error as Error).message);
              throw error;
            }
            toast.success(new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved");
            setEditing(false);
          }}
          extraActions={
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          }
        />
      )}
      {update.error && !isStaleEdit(update.error) && <p className="text-sm text-destructive">{update.error.message}</p>}
    </>
  );
}

function recordStep(session: Session, record: RecordDraft): PipelineStep {
  const started = new Date(session.start) <= new Date();
  const blocked = session.status === "tentative" || needsFix(session);
  const summary = record.summary.trim();
  let state: StepState = "todo";
  if (summary) state = "done";
  else if (started && !blocked) state = "current";
  return {
    id: "record",
    title: "Notes",
    state,
    meta: summary ? <span className="line-clamp-2">{summary}</span> : started ? "Not written yet" : "Once it has started",
    content: (
      <RecordEditor draft={record} disabled={started ? undefined : "Notes open once the session has started."} />
    ),
  };
}

function paymentStep(session: Session, covering: Package | undefined, bought: Package | undefined): PipelineStep {
  const due = dueCents(session);
  const delivered = isDelivered(session);
  const { payment } = session;
  let blocked: string | undefined;
  if (session.removedAt) blocked = "Restore the session to record its payment.";
  else if (session.status === "tentative") blocked = "Confirm the booking first.";
  else if (!delivered) blocked = "Fix the calendar entry first.";

  let state: StepState = "todo";
  if (delivered && isPaid(session)) state = "done";
  else if (!blocked && hasHappened(session)) state = "current";

  const parts: Array<string> = [];
  if (payment?.status === "paid") {
    parts.push(`${formatCents(payment.amountCents)} · ${methodLabel(payment.method)} · ${formatDate(payment.paidOn)}`);
  } else if (payment?.status === "waived") {
    parts.push(`Waived ${formatDate(payment.paidOn)}`);
  } else if (delivered && due === 0) {
    parts.push("Covered by a package");
  } else {
    parts.push(due > 0 ? `${formatCents(due)} due` : "Fee not known yet");
  }
  if (isBoughtDue(session)) parts.push(`package ${formatCents(session.boughtCents ?? 0)} due`);
  else if (session.boughtCents) parts.push("package settled");

  return {
    id: "payment",
    title: "Payment",
    state,
    meta: parts.join(" · "),
    content: blocked ? (
      <p className="text-sm text-muted-foreground">{blocked}</p>
    ) : (
      <SessionPayment session={session} covering={covering} bought={bought} />
    ),
  };
}

/**
 * The session's fee and the package its title bought, each settled on its
 * own: together or one at a time.
 */
function SessionPayment({
  session,
  covering,
  bought,
}: {
  session: Session;
  covering: Package | undefined;
  bought: Package | undefined;
}) {
  const due = dueCents(session);
  const payables: Array<Payable> = [];
  if (due > 0 || session.payment) {
    payables.push({
      item: { kind: "session", id: session.eventId },
      label: "Session fee",
      dueCents: due,
      payment: session.payment,
      receipted: Boolean(session.receipt),
    });
  }
  if (bought) {
    payables.push({
      item: { kind: "package", id: bought.id },
      label: `Package of ${bought.sessions}`,
      dueCents: bought.priceCents,
      payment: bought.payment,
      receipted: Boolean(bought.receipt),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {due === 0 && !session.payment && (
        <p className="text-sm">
          {covering ? (
            <>
              Covered by the package bought {formatDate(covering.purchasedAt)}
              <span className="text-muted-foreground">
                {" "}
                · {creditsLeft(covering)} of {covering.sessions} credits left
              </span>
              {covering.id !== bought?.id && !covering.payment && covering.priceCents > 0 && (
                <span className="text-status-attention-foreground"> · that package is not paid yet</span>
              )}
            </>
          ) : (
            "Nothing to pay for this session."
          )}
        </p>
      )}
      {payables.length > 0 && <PaymentPanel payables={payables} />}
    </div>
  );
}

function documentsStep(session: Session, bought: Package | undefined): PipelineStep {
  const docs = allSessionDocuments(session, bought);
  const issued = docs.filter(({ ref }) => ref.number);
  return {
    id: "documents",
    title: "Documents",
    state: issued.length > 0 ? "done" : "optional",
    meta:
      docs.length > 0
        ? docs.map(({ ref }) => documentLabel(ref.number, ref.revision)).join(", ")
        : "Invoice and receipt, if asked",
    content: <DocumentsStep session={session} bought={bought} />,
  };
}

const DOCUMENT_HINTS: Record<DocumentType, string> = {
  invoice: "Once confirmed, with a fee.",
  receipt: "Once paid.",
};

function DocumentsStep({ session, bought }: { session: Session; bought: Package | undefined }) {
  const nothingDue = dueCents(session) === 0 && !bought;

  return (
    <ul className="flex flex-col divide-y text-sm">
      {(["invoice", "receipt"] as const).map((type) => (
        <DocumentRow key={type} type={type} session={session} bought={bought} nothingDue={nothingDue} />
      ))}
    </ul>
  );
}

/**
 * One document type: the ones made, and a new one for what is left. With
 * the fee and a package to cover, she ticks what goes on it; the rest can
 * go on another.
 */
function DocumentRow({
  type,
  session,
  bought,
  nothingDue,
}: {
  type: DocumentType;
  session: Session;
  bought: Package | undefined;
  nothingDue: boolean;
}) {
  const { create, isPending } = useCreateDocument();
  const [picking, setPicking] = useState(false);
  const spec = DOCUMENT_TYPES[type];
  const existing = sessionDocuments(type, session, bought);
  const items = documentItems(type, session, bought);
  const available = items.filter((item) => !item.unavailable);
  const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;
  const label = existing.length > 0 ? `Another ${spec.title.toLowerCase()}` : `Make ${spec.title.toLowerCase()}`;

  return (
    <li className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{spec.title}</span>
          {existing.map(({ ref }) => (
            <TextLink key={ref.documentId} to={documentRoute(type)} params={{ id: ref.documentId }}>
              {ref.number ? documentLabel(ref.number, ref.revision) : "Draft"}
            </TextLink>
          ))}
        </span>
        {picking ? null : available.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => (items.length > 1 ? setPicking(true) : create(type, available.map((item) => item.source)))}
          >
            <PlusIcon /> {label}
          </Button>
        ) : (
          existing.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {nothingDue ? "Nothing to bill: a package credit covers it." : DOCUMENT_HINTS[type]}
            </span>
          )
        )}
      </div>
      {picking && (
        <DocumentPicker
          items={items}
          submitLabel={label}
          disabled={isPending}
          onSubmit={(sources) => create(type, sources)}
          onCancel={() => setPicking(false)}
        />
      )}
    </li>
  );
}

/** Ticks what a new document covers; what is already on one, or unpaid for a receipt, can't be ticked. */
function DocumentPicker({
  items,
  submitLabel,
  disabled,
  onSubmit,
  onCancel,
}: {
  items: ReadonlyArray<DocumentItem>;
  submitLabel: string;
  disabled: boolean;
  onSubmit: (sources: Array<DocumentItem["source"]>) => void;
  onCancel: () => void;
}) {
  const key = (item: DocumentItem) => `${item.source.kind}:${item.source.id}`;
  const [chosen, setChosen] = useState(() => new Set(items.filter((item) => !item.unavailable).map(key)));
  const selected = items.filter((item) => !item.unavailable && chosen.has(key(item)));
  const total = selected.reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const id = `doc-${key(item)}`;
          return (
            <li key={key(item)} className="flex items-center gap-2">
              <Checkbox
                id={id}
                disabled={Boolean(item.unavailable)}
                checked={!item.unavailable && chosen.has(key(item))}
                onCheckedChange={(checked) =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (checked) next.add(key(item));
                    else next.delete(key(item));
                    return next;
                  })
                }
              />
              <label htmlFor={id} className={cn("flex grow justify-between gap-2", item.unavailable && "text-muted-foreground")}>
                <span>
                  {item.label}
                  {item.unavailable && <span className="text-xs"> · {item.unavailable}</span>}
                </span>
                <span className="tabular-nums">{formatCents(item.amountCents)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || selected.length === 0} onClick={() => onSubmit(selected.map((item) => item.source))}>
          {submitLabel}
          {selected.length > 0 && <> · {formatCents(total)}</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function followUpsStep(
  session: Session,
  client: Client | undefined,
  draft: SessionDraft,
  onFollowUp: (target: FollowUpTarget) => void,
  onNextVisit: (draft: SessionDraft) => void,
): PipelineStep {
  return {
    id: "follow-ups",
    title: "Follow-ups",
    state: "optional",
    meta: <FollowUpsMeta sessionId={session.eventId} />,
    actions: client && !session.removedAt && (
      <>
        <Button variant="outline" size="sm" onClick={() => onNextVisit(draft)}>
          <CalendarPlusIcon /> Next visit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onFollowUp({ mode: "new", clientId: client.id, sessionId: session.eventId })}
        >
          <PlusIcon /> Follow-up
        </Button>
      </>
    ),
    content: <FollowUpsStep sessionId={session.eventId} onEdit={(f) => onFollowUp({ mode: "edit", followUp: f })} />,
  };
}

function FollowUpsMeta({ sessionId }: { sessionId: string }) {
  const followUps = FollowUpsQuery.useBySession(sessionId);
  const open = (followUps.data ?? []).filter((f) => !f.doneAt);
  const [first] = open;
  if (!first) return <>{followUps.data?.length ? "All done" : "Reminders and the next visit"}</>;
  return <>{open.length === 1 ? `Due ${formatDue(first)}` : `${open.length}, next ${formatDue(first)}`}</>;
}

function FollowUpsStep({ sessionId, onEdit }: { sessionId: string; onEdit: (followUp: FollowUp) => void }) {
  const followUps = FollowUpsQuery.useBySession(sessionId);
  if (followUps.isPending) return <Loading />;
  if (!followUps.data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Anything to get back to the client about, like results to check. It goes in your calendar as a reminder.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y">
      {followUps.data.map((f) => (
        <li key={f.eventId} className="py-3 first:pt-0 last:pb-0">
          <FollowUpRow followUp={f} onEdit={onEdit} hideClient showSession={false} />
        </li>
      ))}
    </ul>
  );
}

/**
 * WhatsApp messages to the client (the app on her phone, WhatsApp Web on her
 * computer): asking to pay (with her bank details) while it is unpaid, and
 * sending the issued documents that cover it.
 */
function useMessageActions(
  session: Session,
  client: Client | undefined,
  documents: ReadonlyArray<SessionDocument>,
): Array<RowAction> {
  const settings = SettingsQuery.useGet();
  const issuedIds = documents.filter(({ ref }) => ref.number).map(({ ref }) => ref.documentId);
  const docs = DocumentsQuery.useByClient(client?.id ?? "", issuedIds.length > 0);
  const { send, busy } = useSendDocuments();

  if (!client) return [];
  const to = { name: client.name, phone: client.contact?.phone };
  const actions: Array<RowAction> = [];

  const due = owedCents(session);
  if (due > 0 && settings.data) {
    const text = paymentMessage(settings.data, { clientName: client.name, start: session.start, amountCents: due });
    actions.push({
      label: "Ask to pay",
      icon: MessageCircleIcon,
      onClick: () => {
        const url = whatsappLink(to.phone, text);
        if (url) openWhatsApp(url);
        else toast.error(`${client.name} has no phone number WhatsApp can use.`);
      },
    });
  }

  const issued = (docs.data ?? []).filter((doc) => doc.status === "issued" && issuedIds.includes(doc.id));
  if (issued.length > 0) {
    actions.push({
      label: `Send ${documentsTitle(issued)}`,
      icon: SendIcon,
      disabled: busy,
      onClick: () => send(to, issued),
    });
  }
  return actions;
}
