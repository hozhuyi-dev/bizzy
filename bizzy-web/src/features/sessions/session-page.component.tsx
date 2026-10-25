import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BanIcon, CalendarPlusIcon, CalendarX2Icon, CheckIcon, CircleHelpIcon, Trash2Icon, XIcon } from "lucide-react";
import { bookingStep } from "./components/booking-step/booking-step.component";
import { useBookingForm } from "./components/booking-form/booking-form.component";
import { SessionPager } from "./components/session-pager/session-pager.component";
import { CancelSessionDialog } from "./components/cancel-session-dialog/cancel-session-dialog.component";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { documentsStep } from "./components/documents-step/documents-step.component";
import { followUpsStep } from "./components/follow-ups-step/follow-ups-step.component";
import { paymentStep } from "./components/payment-step/payment-step.component";
import { useRecordDraft } from "./components/record-editor/record-editor.hook";
import { recordStep } from "./components/record-step/record-step.component";
import { boughtIn, coveringCredits } from "./session-stage.util";
import { draftOf } from "./sessions.form";
import { useBookingSave, useConfirmBooking } from "./session-booking.hook";
import { sessionsUrl } from "./sessions.util";
import { SessionsQuery } from "./sessions.query";
import type { ComponentProps, ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { PageStep } from "~/components/shared/layout/page-steps/page-steps.component";
import type { SessionFullView, SessionReturnTo } from "./sessions.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { ListFilter } from "~/core/list/filter.types";
import { PageSteps } from "~/components/shared/layout/page-steps/page-steps.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ConflictActions } from "~/features/conflicts/components/conflict-actions/conflict-actions.component";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { conflictKind } from "~/features/conflicts/conflicts.util";
import { useOpenFollowUp } from "~/features/follow-ups/follow-ups.hook";
import { PackagesQuery } from "~/features/packages/packages.query";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { clientOf } from "~/features/clients/clients.util";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { allOf } from "~/core/utils/query.util";
import { isApiError } from "~/core/utils/api-error.util";

/**
 * `filter`: the sessions list it steps through (unless opened from Home,
 * which steps through the to-do list). Opened to settle a calendar edit by
 * changing its booking (history's `settle`), it starts changing it.
 */
export interface SessionPageProps {
  id: string;
  returnTo?: SessionReturnTo | undefined;
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
 * on its own page (NewSessionPage), and opens here once it has happened.
 */
export function SessionPage({ id, returnTo, filter, onFilterChange }: SessionPageProps) {
  const detail = SessionsQuery.useDetail(id);
  // What it shows names and credits from: it opens with them, so nothing fills in after.
  const clients = ClientsQuery.useList();
  const packages = PackagesQuery.useList(true);
  const parent = parentOf(returnTo, filter);
  // Steps on while the next one loads, so the header stays put.
  const pager = (
    <SessionPager
      id={id}
      session={detail.data}
      gone={isApiError(detail.error, "not_found")}
      returnTo={returnTo}
      filter={filter}
      onFilterChange={onFilterChange}
    />
  );

  if (detail.data && clients.data && packages.data) {
    return <SessionSteps session={detail.data} returnTo={returnTo} filter={filter} pager={pager} />;
  }
  const page = allOf(detail, clients, packages);
  return (
    <>
      <PageHeader parent={parent} title={page.error ? "Not available" : "…"} pager={pager} />
      {page.error ? (
        <ErrorState
          error={page.error}
          retry={page.refetch}
          size="page"
          back={{ label: `Back to ${parent.label}`, link: parent as LinkOptions }}
        />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

interface SessionStepsProps {
  session: SessionFullView;
  returnTo: SessionReturnTo | undefined;
  filter: ListFilter;
  pager: ReactNode;
}

function SessionSteps({ session, returnTo, filter, pager }: SessionStepsProps) {
  const navigate = useNavigate();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const record = useRecordDraft(session, session.notes);
  const conflicts = SessionsQuery.useConflicts(session.id);
  const followUps = SessionsQuery.useFollowUps(session.id);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const openFollowUp = useOpenFollowUp();
  const settled = useSettleReturn();
  // Changed in place, in its step. Opened to settle a calendar edit by
  // changing the booking: it starts open, and once saved goes back to the to-do list.
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
  const addFollowUp = client && (() => openFollowUp({ mode: "new", clientId: client.id, sessionId: session.id }));
  // Whatever step it is at, so in the header rather than by a step.
  const more: Array<Action> = client
    ? [
        whatsappMenu({
          to: { name: client.name, phone: client.contact?.phone },
          askToPay: { request: { items: session.sources }, can: session.can.askToPay },
          sendRecords: { items: session.sources, can: session.can.sendRecords },
          openChat: true,
        }),
        {
          type: "link",
          label: "Next visit",
          icon: CalendarPlusIcon,
          link: { to: "/sessions/new", state: { after: session.id, from: returnTo } },
        },
      ]
    : [];
  // Rare, and undone only by booking it again: cancel one with history,
  // delete one booked by mistake.
  const menu: Array<Action> = [
    { type: "button", label: "Cancel session", icon: BanIcon, can: session.can.cancel, onClick: () => setCancelling(true) },
    { type: "button", label: "Delete session", icon: Trash2Icon, style: "destructive", can: session.can.delete, onClick: () => setDeleting(true) },
  ];

  const steps: Array<PageStep> = [
    bookingStep(session, () => setEditingBooking(true)),
    recordStep(session, record),
    paymentStep(session, covering, bought),
    documentsStep(session, bought),
    followUpsStep(session, followUps.data, addFollowUp, (f) => openFollowUp({ mode: "edit", followUp: f })),
  ];

  const header: PageHeaderProps = {
    parent,
    title: client?.name ?? session.clientName,
    titleLink: client ? { to: "/clients/$id", params: { id: client.id } } : undefined,
    // The day tells a client's sessions apart.
    subtitle: formatDate(session.start),
    pager,
    moreActions: more,
    menuActions: menu,
    banners:
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
          ),
  };

  return (
    <>
      {editingBooking ? (
        <BookingEditor
          // Restarts whenever the booking changes, here or in the calendar.
          key={JSON.stringify(draftOf(session))}
          session={session}
          header={header}
          steps={steps}
          onClose={() => setEditingBooking(false)}
          onSaved={settled}
        />
      ) : (
        <>
          <PageHeader {...header} />
          <PageSteps steps={steps} />
        </>
      )}
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

type PageHeaderProps = ComponentProps<typeof PageHeader>;

const BOOKING_FORM = "booking-form";

interface BookingEditorProps {
  /** With what its update can't change (`locked`), shown on the form. */
  session: SessionFullView;
  header: PageHeaderProps;
  steps: ReadonlyArray<PageStep>;
  onClose: () => void;
  /** Once saved, with what the toast says; left out, it is toasted here. */
  onSaved?: ((done: string) => void) | undefined;
}

/**
 * The page while its booking is changed, in place: the Booking step is its
 * form, with Cancel beside it, and Save booking is the page's main action
 * (the dock's, on a phone, within reach while typing). Its calendar event
 * changes with it. An edit made in the calendar that bizzy refused is the
 * page's banner, so settling it here can follow what the event says.
 */
function BookingEditor({ session, header, steps, onClose, onSaved }: BookingEditorProps) {
  const draft = draftOf(session);
  const save = useBookingSave(session, draft, (next) => {
    const done = new Date(next.start) > new Date() ? `Booked for ${formatSessionTime(next.start)}` : "Booking saved";
    onClose();
    if (onSaved) onSaved(done);
    else toastWithQuip(done, QUIPS.booked);
  });
  const booking = useBookingForm({
    initial: draft,
    session,
    locked: session.locked,
    onSubmit: (next, updatePayment) => save.submit(next, updatePayment),
  });
  const submit: Action = { type: "submit", form: BOOKING_FORM, label: "Save booking", style: "primary", pending: booking.submitting };
  const editing = steps.map((step) =>
    step.id === "booking"
      ? {
          ...step,
          actions: [{ type: "button", label: "Cancel", icon: XIcon, onClick: onClose }] satisfies Array<Action>,
          content: (
            <form
              id={BOOKING_FORM}
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void booking.form.handleSubmit();
              }}
            >
              {booking.fields}
            </form>
          ),
        }
      : step,
  );

  return (
    <>
      <PageHeader {...header} actions={[submit]} />
      <PageSteps steps={editing} />
      <UnsavedChangesDialog when={booking.hasChanges} />
    </>
  );
}
