import { useState } from "react";
import { BanIcon, CalendarPlusIcon, CalendarX2Icon, CheckIcon, CircleHelpIcon, Trash2Icon, XIcon } from "lucide-react";
import { bookingStep } from "./components/booking-step/booking-step.component";
import { useBookingForm } from "./components/booking-form/booking-form.component";
import { usePayForm } from "./components/pay-form/pay-form.component";
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
import { SessionsMutation } from "./sessions.mutation";
import type { ComponentProps, ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { PageStep } from "~/components/shared/layout/page-steps/page-steps.component";
import type { SessionFullView, SessionReturnTo } from "./sessions.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { ListFilter } from "~/core/list/filter.types";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import { PageSteps } from "~/components/shared/layout/page-steps/page-steps.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ConflictActions } from "~/features/conflicts/components/conflict-actions/conflict-actions.component";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { conflictKind } from "~/features/conflicts/conflicts.util";
import { useOpenFollowUp } from "~/features/follow-ups/follow-ups.hook";
import { PackagesQuery } from "~/features/packages/packages.query";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { recipientOf } from "~/features/whatsapp/whatsapp.util";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { timelineParent } from "~/features/timeline/timeline.list";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { clientOf } from "~/features/clients/clients.util";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { allOf } from "~/core/utils/query.util";
import { useGoBack } from "~/core/navigation/go-back.hook";
import { isApiError } from "~/core/utils/api-error.util";

/**
 * `filter`: the sessions list it steps through, unless opened from Home
 * (`returnTo`) or a client's timeline (`timeline`, their id), whose
 * sessions it steps through instead. Opened to settle a calendar edit by
 * changing its booking (history's `settle`), it starts changing it.
 */
export interface SessionPageProps {
  id: string;
  returnTo?: SessionReturnTo | undefined;
  timeline?: string | undefined;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/** The list it steps through, as its breadcrumb: Home's, the client's timeline, or the sessions list with its filter. */
function parentOf(returnTo: SessionReturnTo | undefined, timeline: string | undefined, filter: ListFilter): Parent {
  if (returnTo) return { to: "/", label: "Home" };
  if (timeline) return timelineParent(timeline);
  return { to: "/sessions", label: "Sessions", search: sessionsUrl.toSearch(filter) };
}

/**
 * A session's own page, walking through its steps: booking, notes,
 * payment, then the optional documents and follow-ups. A new one is added
 * on its own page (NewSessionPage), and opens here once it has happened.
 */
export function SessionPage({ id, returnTo, timeline, filter, onFilterChange }: SessionPageProps) {
  const detail = SessionsQuery.useDetail(id);
  // What it shows names and credits from: it opens with them, so nothing fills in after.
  const clients = ClientsQuery.useList();
  const packages = PackagesQuery.useList(true);
  const parent = parentOf(returnTo, timeline, filter);
  // Steps on while the next one loads, so the header stays put.
  const pager = (
    <SessionPager
      id={id}
      session={detail.data}
      gone={isApiError(detail.error, "not_found")}
      returnTo={returnTo}
      timeline={timeline}
      filter={filter}
      onFilterChange={onFilterChange}
    />
  );

  if (detail.data && clients.data && packages.data) {
    return <SessionSteps session={detail.data} returnTo={returnTo} parent={parent} pager={pager} />;
  }
  const page = allOf(detail, clients, packages);
  return (
    <>
      <PageHeader parent={parent} title={page.error ? "Not available" : "…"} kind="Session" pager={pager} />
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
  parent: Parent;
  pager: ReactNode;
}

function SessionSteps({ session, returnTo, parent, pager }: SessionStepsProps) {
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
  const [editing, setEditing] = useState<"booking" | "payment" | undefined>(
    Boolean(settled) && session.can.update.ok ? "booking" : undefined,
  );
  const confirm = useConfirmBooking();

  const client = clientOf(clientsById, session.clientId);
  const bought = boughtIn(session, packages.data);
  const covering = coveringCredits(session, packages.data);
  const goBack = useGoBack(parent as LinkOptions);
  // Only after deleting it, so an open booking edit is moot.
  const leave = () => goBack({ leaving: true });
  const waiting = conflicts.data ?? [];
  const unconfirmed = session.tentative && !session.cancelledAt;

  const whatsappMenu = useWhatsAppMenu();
  const addFollowUp = client && (() => openFollowUp({ mode: "new", clientId: client.id, sessionId: session.id }));
  // Whatever step it is at, so in the header rather than by a step.
  const more: Array<Action> = client
    ? [
        whatsappMenu({
          to: recipientOf(clientsById.get(session.payer) ?? client),
          about: recipientOf(client),
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
    bookingStep(session, () => setEditing("booking"), clientsById.get(session.payer)?.name),
    recordStep(session, record),
    paymentStep(session, covering, bought, () => setEditing("payment")),
    documentsStep(session, bought),
    followUpsStep(session, followUps.data, addFollowUp, (f) =>
      openFollowUp({ mode: "edit", followUp: f, search: { session: session.id } }),
    ),
  ];

  const header: PageHeaderProps = {
    parent,
    title: client?.name ?? session.clientName,
    titleLink: client ? { to: "/clients/$id", params: { id: client.id } } : undefined,
    kind: "Session",
    // The day and time tell a client's sessions apart.
    subtitle: formatSessionTime(session.start),
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
      {editing === "booking" ? (
        <BookingEditor
          // Restarts whenever the booking changes, here or in the calendar.
          key={JSON.stringify(draftOf(session))}
          session={session}
          header={header}
          steps={steps}
          onClose={() => setEditing(undefined)}
          onSaved={settled}
        />
      ) : editing === "payment" ? (
        <PayEditor
          key={JSON.stringify(session.pay)}
          session={session}
          header={header}
          steps={steps}
          onClose={() => setEditing(undefined)}
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
  return (
    <StepEditor
      header={header}
      steps={steps}
      stepId="booking"
      formId={BOOKING_FORM}
      submitLabel="Save booking"
      form={booking}
      onClose={onClose}
    />
  );
}

const PAY_FORM = "pay-form";

/**
 * The page while how it is paid is changed, in place: the Payment step is
 * its form, and Save is the page's main action, as the booking's.
 */
function PayEditor({ session, header, steps, onClose }: Omit<BookingEditorProps, "onSaved">) {
  const update = SessionsMutation.useUpdate();
  const pay = usePayForm({
    session,
    onSubmit: async (fields, values) => {
      await update.mutateAsync({ id: session.id, fields });
      onClose();
      toastWithQuip(values.by === "package" ? "Paid by package" : "Paid by its own fee", QUIPS.saved);
    },
  });
  return (
    <StepEditor header={header} steps={steps} stepId="payment" formId={PAY_FORM} submitLabel="Save" form={pay} onClose={onClose} />
  );
}

interface StepEditorProps {
  header: PageHeaderProps;
  steps: ReadonlyArray<PageStep>;
  /** The step that is the form. */
  stepId: string;
  formId: string;
  submitLabel: string;
  form: { form: { handleSubmit: () => Promise<void> }; fields: ReactNode; hasChanges: boolean; submitting: boolean };
  onClose: () => void;
}

/**
 * The page while one of its steps is changed in place: that step is the
 * form, with Cancel beside its title, and Save is the page's main action
 * (the dock's, on a phone, within reach while typing).
 */
function StepEditor({ header, steps, stepId, formId, submitLabel, form, onClose }: StepEditorProps) {
  const submit: Action = { type: "submit", form: formId, label: submitLabel, style: "primary", pending: form.submitting };
  const editing = steps.map((step) =>
    step.id === stepId
      ? {
          ...step,
          actions: [{ type: "button", label: "Cancel", icon: XIcon, onClick: onClose }] satisfies Array<Action>,
          content: (
            <form
              id={formId}
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void form.form.handleSubmit();
              }}
            >
              {form.fields}
            </form>
          ),
        }
      : step,
  );

  return (
    <>
      <PageHeader {...header} actions={[submit]} />
      <PageSteps steps={editing} />
      <UnsavedChangesDialog when={form.hasChanges} />
    </>
  );
}
