import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CalendarX2Icon, CircleAlertIcon, LockIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useBookingSave } from "./sessions-booking.hook";
import { BookingForm } from "./components/booking-form/booking-form.component";
import { bookingStep } from "./components/booking-step/booking-step.component";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { documentsStep } from "./components/documents-step/documents-step.component";
import { followUpsStep } from "./components/follow-ups-step/follow-ups-step.component";
import { NextVisitDialog } from "./components/next-visit-dialog/next-visit-dialog.component";
import { paymentStep } from "./components/payment-step/payment-step.component";
import { PipelineLayout } from "./components/pipeline-layout/pipeline-layout.component";
import { useRecordDraft } from "./components/record-editor/record-editor.hook";
import { recordStep } from "./components/record-step/record-step.component";
import { allSessionDocuments, boughtIn } from "./session-stage.util";
import { newSessionDraft } from "./sessions.form";
import { useSessionMessageActions } from "./sessions.hook";
import { SessionsQuery } from "./sessions.query";
import type { PipelineStep } from "./components/pipeline-layout/pipeline-layout.component";
import type { SessionDocument, SessionDraft, SessionReturnTo, StoredSession } from "./sessions.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import type { Conflict } from "~/features/conflicts/conflicts.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ConflictsQuery } from "~/features/conflicts/conflicts.query";
import { RemedyButtons } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { TodoQuery } from "~/features/todo/todo.query";
import { nextTodoSession } from "~/features/todo/todo.util";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatSessionTime } from "~/core/utils/date.util";
import { clientOf } from "~/features/clients/clients.util";

export type SessionPageProps = { returnTo?: SessionReturnTo | undefined } & (
  | { mode: "new" }
  | { mode: "edit"; id: string }
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
  return <ExistingSession id={props.id} returnTo={props.returnTo} />;
}

function NewSession({ returnTo }: { returnTo: SessionReturnTo | undefined }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const save = useBookingSave(undefined, (draft, id) => {
    const booked = new Date(draft.start) > new Date();
    toast.success(booked ? `Booked for ${formatSessionTime(draft.start)}` : "Session added");
    // Straight to its notes and payment.
    void navigate({ to: "/sessions/$id", params: { id }, search: { from: returnTo }, replace: true });
  });

  return (
    <>
      <PageHeader parent={parentOf(returnTo)} title="New session" />
      {error && (
        <div className="-mx-4 -mt-4 mb-4">
          <Banner tone="attention" icon={CircleAlertIcon} title={error} role="alert" />
        </div>
      )}
      <Card className="max-w-3xl">
        <CardContent>
          <BookingForm
            initial={newSessionDraft()}
            submitLabel="Add session"
            onSubmit={async (draft) => {
              setError(null);
              try {
                await save.submit(draft);
              } catch (e) {
                setError((e as Error).message);
                throw e;
              }
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}

function ExistingSession({ id, returnTo }: { id: string; returnTo: SessionReturnTo | undefined }) {
  const detail = SessionsQuery.useDetail(id);
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
  const conflicts = ConflictsQuery.useByTarget(session.id);
  const [deleting, setDeleting] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [nextVisit, setNextVisit] = useState<SessionDraft | null>(null);

  const parent = parentOf(returnTo);
  const client = clientOf(clientsById, session.clientId);
  const bought = boughtIn(session, packages.data);
  const covering = session.packageId ? packages.data?.find((pkg) => pkg.id === session.packageId) : undefined;
  const documents = allSessionDocuments(session, bought);
  // An issued document stays as it says: an edit that would change it is
  // refused, with cancelling it as the remedy.
  const issued = documents.filter(({ ref }) => ref.number);
  const next = nextTodoSession(todo.data, session.id);
  const leave = () => void navigate(returnTo === "home" ? { to: "/" } : { to: "/sessions" });
  const waiting = conflicts.data ?? [];

  const messages = useSessionMessageActions(session, client, documents);
  const more: Array<RowAction> = [
    ...messages,
    {
      label: "Delete",
      icon: Trash2Icon,
      destructive: true,
      disabled: !session.can.delete.ok,
      onClick: () => setDeleting(true),
    },
  ];

  const steps: Array<PipelineStep> = [
    bookingStep(session, stored.draft, () => setDeleting(true)),
    recordStep(session, record),
    paymentStep(session, covering, bought),
    documentsStep(session, bought),
    followUpsStep(session, client, stored.draft, setFollowUp, setNextVisit),
  ];

  return (
    <>
      <PageHeader
        parent={parent}
        title={client?.name ?? "Unknown client"}
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
          (waiting.length > 0 || issued.length > 0) && (
            <>
              {waiting.map((conflict) => (
                <ConflictBanner key={conflict.key} conflict={conflict} />
              ))}
              {issued.length > 0 && (
                <Banner tone="neutral" icon={LockIcon} title="On an issued document.">
                  What {documentLinks(issued)} says stays as it is: its client, fee and payment change only once it is
                  cancelled.
                </Banner>
              )}
            </>
          )
        }
        steps={steps}
      />
      <DeleteSessionDialog
        session={deleting ? session : null}
        clientName={client?.name ?? "the client"}
        onClose={() => setDeleting(false)}
        onDeleted={leave}
      />
      <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
      <NextVisitDialog from={nextVisit} clientName={client?.name ?? "the client"} onClose={() => setNextVisit(null)} />
    </>
  );
}

/**
 * An edit she made to this session's event in the calendar that bizzy
 * didn't apply: what it asks, why not, and how to settle it.
 */
function ConflictBanner({ conflict }: { conflict: Conflict }) {
  const title = conflict.kind === "gone" ? "Deleted in your calendar, but kept here." : "Changed in your calendar, but not here.";
  return (
    <Banner tone="attention" icon={CalendarX2Icon} title={title}>
      <span className="flex flex-col gap-2">
        {conflict.asks.length > 0 && <span>It asks: {conflict.asks.join(", ")}.</span>}
        {conflict.violations.map((v) => (
          <span key={v.guard}>{v.message}</span>
        ))}
        <RemedyButtons remedies={conflict.fixes} size="xs" onDone={() => toast.success("Done")} />
      </span>
    </Banner>
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
