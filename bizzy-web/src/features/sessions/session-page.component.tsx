import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BanIcon, CalendarPlusIcon, CalendarX2Icon, CheckIcon, CircleHelpIcon, Trash2Icon } from "lucide-react";
import { bookingStep } from "./components/booking-step/booking-step.component";
import { EditBookingDialog } from "./components/booking-dialog/booking-dialog.component";
import { SessionPager } from "./components/session-pager/session-pager.component";
import { CancelSessionDialog } from "./components/cancel-session-dialog/cancel-session-dialog.component";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { documentsStep } from "./components/documents-step/documents-step.component";
import { followUpsStep } from "./components/follow-ups-step/follow-ups-step.component";
import { NextVisitDialog } from "./components/next-visit-dialog/next-visit-dialog.component";
import { paymentStep } from "./components/payment-step/payment-step.component";
import { PipelineLayout } from "./components/pipeline-layout/pipeline-layout.component";
import { useRecordDraft } from "./components/record-editor/record-editor.hook";
import { recordStep } from "./components/record-step/record-step.component";
import { boughtIn, coveringCredits } from "./session-stage.util";
import { draftOf } from "./sessions.form";
import { useConfirmBooking } from "./session-booking.hook";
import { sessionsUrl } from "./sessions.util";
import { SessionsQuery } from "./sessions.query";
import type { ReactNode } from "react";
import type { PipelineStep } from "./components/pipeline-layout/pipeline-layout.component";
import type { SessionDraft, SessionFullView, SessionReturnTo } from "./sessions.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ConflictActions } from "~/features/conflicts/components/conflict-actions/conflict-actions.component";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { conflictKind } from "~/features/conflicts/conflicts.util";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { clientOf } from "~/features/clients/clients.util";
import { formatDate } from "~/core/utils/date.util";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

/**
 * `settle`: the calendar edit it was opened to settle, by changing its
 * booking. `filter`: the sessions list it steps through (unless opened
 * from Home, which steps through the to-do list).
 */
export interface SessionPageProps {
  id: string;
  returnTo?: SessionReturnTo | undefined;
  settle?: string | undefined;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/** Home, or the sessions list with the filter it was left at. */
function parentOf(returnTo: SessionReturnTo | undefined, filter?: ListFilter) {
  if (returnTo === "home") return { to: "/", label: "Home" } as const;
  return { to: "/sessions", label: "Sessions", search: filter ? sessionsUrl.toSearch(filter) : {} } as const;
}

/**
 * A session's own page, walking through its steps: booking, notes,
 * payment, then the optional documents and follow-ups. A new one is added
 * in a dialog (NewSessionDialog), and opens here once it has happened.
 */
export function SessionPage({ id, returnTo, settle, filter, onFilterChange }: SessionPageProps) {
  const detail = SessionsQuery.useDetail(id);
  const parent = parentOf(returnTo, filter);
  // Steps on while the next one loads, so the header stays put.
  const pager = (
    <SessionPager id={id} session={detail.data} returnTo={returnTo} filter={filter} onFilterChange={onFilterChange} />
  );

  if (detail.isPending) {
    return (
      <>
        <PageHeader parent={parent} title="…" pager={pager} />
        <LoadingState />
      </>
    );
  }
  if (detail.error) {
    return (
      <>
        <PageHeader parent={parent} title="Not available" pager={pager} />
        <ErrorMessage>{detail.error.message}</ErrorMessage>
      </>
    );
  }
  return <SessionPipeline session={detail.data} returnTo={returnTo} settle={settle} filter={filter} pager={pager} />;
}

interface SessionPipelineProps {
  session: SessionFullView;
  returnTo: SessionReturnTo | undefined;
  settle: string | undefined;
  filter: ListFilter;
  pager: ReactNode;
}

function SessionPipeline({ session, returnTo, settle, filter, pager }: SessionPipelineProps) {
  const navigate = useNavigate();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const record = useRecordDraft(session, session.notes);
  const conflicts = SessionsQuery.useConflicts(session.id);
  const followUps = SessionsQuery.useFollowUps(session.id);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [nextVisit, setNextVisit] = useState<SessionDraft | null>(null);
  const settled = useSettleReturn(settle);
  // Opened to settle a calendar edit by changing the booking: it starts open, and once saved goes back to the to-do list.
  const [editingBooking, setEditingBooking] = useState(Boolean(settled) && session.can.update.ok);
  const confirm = useConfirmBooking();

  const parent = parentOf(returnTo, filter);
  const client = clientOf(clientsById, session.clientId);
  const bought = boughtIn(session, packages.data);
  const covering = coveringCredits(session, packages.data);
  // Only after deleting it, so an open booking edit is moot.
  const leave = () => void navigate({ ...parent, ignoreBlocker: true });
  const waiting = conflicts.data ?? [];
  const unconfirmed = session.tentative && !session.cancelledAt;

  const whatsappMenu = useWhatsAppMenu();
  const addFollowUp = client && (() => setFollowUp({ mode: "new", clientId: client.id, sessionId: session.id }));
  // Whatever step it is at, so in the header rather than by a step.
  const more: Array<Action> = client
    ? [
        whatsappMenu({
          to: { name: client.name, phone: client.contact?.phone },
          askToPay: { request: { items: session.sources }, can: session.can.askToPay },
          sendRecords: { items: session.sources, can: session.can.sendRecords },
          openChat: true,
        }),
        { type: "button", label: "Next visit", icon: CalendarPlusIcon, onClick: () => setNextVisit(draftOf(session)) },
      ]
    : [];
  // Rare, and undone only by booking it again: cancel one with history,
  // delete one booked by mistake.
  const menu: Array<Action> = [
    { type: "button", label: "Cancel session", icon: BanIcon, can: session.can.cancel, onClick: () => setCancelling(true) },
    { type: "button", label: "Delete session", icon: Trash2Icon, style: "destructive", can: session.can.delete, onClick: () => setDeleting(true) },
  ];

  const steps: Array<PipelineStep> = [
    bookingStep(session, () => setEditingBooking(true)),
    recordStep(session, record),
    paymentStep(session, covering, bought),
    documentsStep(session, bought),
    followUpsStep(session, followUps.data, addFollowUp, (f) => setFollowUp({ mode: "edit", followUp: f })),
  ];

  return (
    <>
      <PageHeader
        parent={parent}
        title={
          // The day tells a client's sessions apart; it truncates first on a phone.
          <>
            {client?.name ?? session.clientName}
            <span className="font-normal text-muted-foreground"> · {formatDate(session.start)}</span>
          </>
        }
        pager={pager}
        moreActions={more}
        menuActions={menu}
        banners={
          (session.cancelledAt || unconfirmed || waiting.length > 0) && (
            <>
              {/* A question it waits on, with its answers: the rest of the page doesn't depend on it. */}
              {unconfirmed && (
                <Banner
                  tone="waiting"
                  icon={CircleHelpIcon}
                  title="Not confirmed"
                  actions={[
                    {
                      type: "button",
                      label: "Confirm",
                      icon: CheckIcon,
                      disabled: confirm.pending,
                      can: session.can.update,
                      onClick: () => void confirm.confirm(session.id).catch(toastRefusal),
                    },
                    { type: "button", label: "Cancel booking", icon: BanIcon, can: session.can.cancel, onClick: () => setCancelling(true) },
                  ]}
                >
                  with the client yet.
                </Banner>
              )}
              {session.cancelledAt && (
                <Banner tone="neutral" icon={BanIcon} title={`Cancelled ${formatDate(session.cancelledAt)}.`}>
                  {session.cancelReason ? `${session.cancelReason}. ` : ""}It stays as it was, with what was recorded on it.
                </Banner>
              )}
              {waiting.map((conflict) => (
                <ConflictBanner key={conflict.eventId} conflict={conflict} />
              ))}
            </>
          )
        }
      />
      <PipelineLayout steps={steps} />
      <EditBookingDialog session={session} open={editingBooking} onClose={() => setEditingBooking(false)} onSaved={settled} />
      <DeleteSessionDialog
        session={deleting ? session : null}
        clientName={client?.name ?? session.clientName}
        onClose={() => setDeleting(false)}
        onDeleted={leave}
      />
      <CancelSessionDialog
        session={cancelling ? session : null}
        clientName={client?.name ?? session.clientName}
        onClose={() => setCancelling(false)}
      />
      <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
      <NextVisitDialog from={nextVisit} clientName={client?.name ?? session.clientName} onClose={() => setNextVisit(null)} />
    </>
  );
}

/**
 * An edit made to this session's event in the calendar that bizzy refused:
 * what the event says, why not, and how to settle it.
 */
function ConflictBanner({ conflict }: { conflict: ConflictView }) {
  const title = conflict.gone ? `${conflictKind(conflict)}, but kept here.` : `${conflictKind(conflict)}, but not here.`;
  return (
    <Banner tone="attention" icon={CalendarX2Icon} title={title}>
      <span className="flex flex-col gap-2">
        {!conflict.gone && <span>It says “{conflict.title}”.</span>}
        <span>{conflict.message}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <ConflictActions conflict={conflict} size="xs" />
        </span>
      </span>
    </Banner>
  );
}
