import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, BanIcon, CircleAlertIcon, LockIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { BookingForm } from "./components/booking-form/booking-form.component";
import { bookingStep } from "./components/booking-step/booking-step.component";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { DiscardSessionDialog } from "./components/discard-session-dialog/discard-session-dialog.component";
import { documentsStep } from "./components/documents-step/documents-step.component";
import { followUpsStep } from "./components/follow-ups-step/follow-ups-step.component";
import { NextVisitDialog } from "./components/next-visit-dialog/next-visit-dialog.component";
import { paymentStep } from "./components/payment-step/payment-step.component";
import { PipelineLayout } from "./components/pipeline-layout/pipeline-layout.component";
import { useRecordDraft } from "./components/record-editor/record-editor.hook";
import { recordStep } from "./components/record-step/record-step.component";
import { allSessionDocuments, needsFix } from "./session-stage.util";
import { newSessionDraft } from "./sessions.form";
import { useSessionMessageActions } from "./sessions.hook";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { PipelineStep } from "./components/pipeline-layout/pipeline-layout.component";
import type { SessionDocument, SessionDraft, SessionReturnTo, StoredSession } from "./sessions.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { boughtIn } from "~/features/packages/packages.util";
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
            initial={newSessionDraft()}
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
  const client = clientOf(clientsById, session.clientId);
  const bought = boughtIn(session.eventId, packages.data?.find((pkg) => pkg.id === session.eventId));
  const covering = session.packageId ? packages.data?.find((pkg) => pkg.id === session.packageId) : undefined;
  const documents = allSessionDocuments(session, bought);
  const locked = documents.length > 0;
  const next = nextTodoSession(todo.data, session.eventId);
  const leave = () => void navigate(returnTo === "home" ? { to: "/" } : { to: "/sessions" });

  const messages = useSessionMessageActions(session, client, documents);
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
      <DiscardSessionDialog session={discarding ? session : null} onClose={() => setDiscarding(false)} onDiscarded={leave} />
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
