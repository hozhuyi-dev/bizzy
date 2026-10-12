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
import { BookingForm } from "./components/booking-form/booking-form.component";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { NextVisitDialog } from "./components/next-visit-dialog/next-visit-dialog.component";
import { PaymentEditor } from "./components/payment-editor/payment-editor.component";
import { PipelineLayout } from "./components/pipeline-layout/pipeline-layout.component";
import { RecordEditor, useRecordDraft } from "./components/record-editor/record-editor.component";
import { DiscardDialog } from "./deleted-sessions-page.component";
import {
  allSessionDocuments,
  documentSources,
  dueCents,
  hasHappened,
  isPaid,
  needsFix,
  sessionDocuments,
} from "./session-stage";
import { SessionsMutation, isStaleEdit } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import { methodLabel } from "./sessions.types";
import type { PipelineStep, StepState } from "./components/pipeline-layout/pipeline-layout.component";
import type { RecordDraft } from "./components/record-editor/record-editor.component";
import type { SessionDocument } from "./session-stage";
import type { Session, SessionDraft, StoredSession } from "./sessions.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { Client } from "~/features/clients/clients.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { FollowUpTarget } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import type { Package } from "~/features/packages/packages.types";
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
  const bought = packages.data?.find((pkg) => pkg.id === session.eventId);
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
    paymentStep(session, covering),
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

function paymentStep(session: Session, covering: Package | undefined): PipelineStep {
  const due = dueCents(session);
  const delivered = session.status === "priced" || session.status === "package" || session.status === "missing_fee";
  const { payment } = session;
  let blocked: string | undefined;
  if (session.removedAt) blocked = "Restore the session to record its payment.";
  else if (session.status === "tentative") blocked = "Confirm the booking first.";
  else if (!delivered) blocked = "Fix the calendar entry first.";

  let state: StepState = "todo";
  if (session.untracked || (delivered && isPaid(session))) state = "done";
  else if (!blocked && hasHappened(session)) state = "current";

  let meta: string;
  if (payment?.status === "paid") {
    meta = `${formatCents(payment.amountCents)} · ${methodLabel(payment.method)} · ${formatDate(payment.paidOn)}`;
  } else if (payment?.status === "waived") {
    meta = `Waived ${formatDate(payment.paidOn)}`;
  } else if (session.untracked) {
    meta = "Before you tracked payments here";
  } else if (delivered && due === 0) {
    meta = "Covered by a package";
  } else {
    meta = due > 0 ? `${formatCents(due)} due` : "Fee not known yet";
  }

  return {
    id: "payment",
    title: "Payment",
    state,
    meta,
    content: <PaymentEditor session={session} coveringPackage={covering} blocked={blocked} />,
  };
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
  const { create, isPending } = useCreateDocument();
  const nothingDue = dueCents(session) === 0 && !bought;

  return (
    <ul className="flex flex-col divide-y text-sm">
      {(["invoice", "receipt"] as const).map((type) => {
        const spec = DOCUMENT_TYPES[type];
        const existing = sessionDocuments(type, session, bought);
        const sources = session.removedAt ? [] : documentSources(type, session, bought);
        const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;
        return (
          <li key={type} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
            <span className="flex flex-wrap items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{spec.title}</span>
              {existing.map(({ ref }) => (
                <TextLink key={ref.documentId} to={documentRoute(type)} params={{ id: ref.documentId }}>
                  {ref.number ? documentLabel(ref.number, ref.revision) : "Draft"}
                </TextLink>
              ))}
            </span>
            {sources.length > 0 ? (
              <Button variant="outline" size="sm" disabled={isPending} onClick={() => create(type, sources)}>
                <PlusIcon /> {existing.length > 0 ? `Another ${spec.title.toLowerCase()}` : `Make ${spec.title.toLowerCase()}`}
              </Button>
            ) : (
              existing.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  {nothingDue ? "Nothing to bill: a package credit covers it." : DOCUMENT_HINTS[type]}
                </span>
              )
            )}
          </li>
        );
      })}
    </ul>
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

function FollowUpsStep({ sessionId, onEdit }: { sessionId: string; onEdit: Parameters<typeof FollowUpRow>[0]["onEdit"] }) {
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

  const due = dueCents(session);
  if (!isPaid(session) && due > 0 && settings.data) {
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
