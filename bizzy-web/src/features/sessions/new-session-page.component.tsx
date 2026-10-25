import { useLocation, useNavigate } from "@tanstack/react-router";
import { useBookingForm } from "./components/booking-form/booking-form.component";
import { useBookingSave } from "./session-booking.hook";
import { newSessionDraft, nextVisitDraft } from "./sessions.form";
import { SessionsQuery } from "./sessions.query";
import type { LinkOptions } from "@tanstack/react-router";
import type { SessionDraft, SessionReturnTo } from "./sessions.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageStep } from "~/components/shared/layout/page-steps/page-steps.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { PageSteps } from "~/components/shared/layout/page-steps/page-steps.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { useGoBack } from "~/core/navigation/go-back.hook";
import { formatSessionTime } from "~/core/utils/date.util";
import { allOf } from "~/core/utils/query.util";

const FORM_ID = "booking-form";

/** Home, or the sessions list: where a session's page goes back to. Opened from elsewhere, it goes back there. */
function parentOf(from: SessionReturnTo | undefined) {
  return from === "home"
    ? ({ to: "/", label: "Home", back: true } as const)
    : ({ to: "/sessions", label: "Sessions", back: true } as const);
}

/**
 * A new session, laid out as the session it becomes: its booking to fill
 * in, the steps after it waiting. It starts with the client it was opened
 * for, or as the next visit after a session (`after`: a week on, the same
 * length and place), as the page that opened it left them in history. One
 * booked ahead goes back to where it was added from, with Open in the
 * toast; one that already happened goes on to its page, for its notes and
 * payment.
 */
export function NewSessionPage() {
  const clientId = useLocation({ select: (location) => location.state.clientId });
  const after = useLocation({ select: (location) => location.state.after });
  const from = useLocation({ select: (location) => location.state.from });
  const previous = SessionsQuery.useDetail(after ?? "", after !== undefined);
  // What the form names and prices from: it opens with them, so nothing fills in after.
  const clients = ClientsQuery.useList();
  const packages = PackagesQuery.useList(true);
  const parent = parentOf(from);

  const page = after === undefined ? allOf(clients, packages) : allOf(clients, packages, previous);
  if (clients.data && packages.data && (after === undefined || previous.data)) {
    const initial = previous.data ? nextVisitDraft(previous.data) : { ...newSessionDraft(), clientId: clientId ?? "" };
    return <NewSession initial={initial} from={from} nextVisit={previous.data !== undefined} />;
  }
  return (
    <>
      <PageHeader parent={parent} title={page.error ? "Not available" : "…"} />
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

interface NewSessionProps {
  initial: SessionDraft;
  from: SessionReturnTo | undefined;
  nextVisit: boolean;
}

function NewSession({ initial, from, nextVisit }: NewSessionProps) {
  const navigate = useNavigate();
  const parent = parentOf(from);
  const goBack = useGoBack(parent);
  const clientsById = ClientsQuery.useById();
  const open = (id: string, replace: boolean) =>
    void navigate({ to: "/sessions/$id", params: { id }, search: { from }, replace, ignoreBlocker: true });
  const save = useBookingSave(undefined, undefined, (draft, id) => {
    if (new Date(draft.start) <= new Date()) {
      toastWithQuip("Session added", QUIPS.booked);
      // In this page's place: Back from it is where it was added from.
      open(id, true);
      return;
    }
    toastWithQuip(`Booked for ${formatSessionTime(draft.start)}`, QUIPS.booked, {
      action: { label: "Open", onClick: () => open(id, false) },
    });
    goBack({ leaving: true });
  });
  const booking = useBookingForm({ initial, onSubmit: (draft) => save.submit(draft) });
  const clientName = clientsById.get(initial.clientId)?.name;

  const submit: Action = { type: "submit", form: FORM_ID, label: "Add session", style: "primary", pending: booking.submitting };
  const waiting = (id: string, title: string, text: string, state: PageStep["state"] = "todo"): PageStep => ({
    id,
    title,
    state,
    content: <p className="text-sm text-muted-foreground">{text}</p>,
  });
  const steps: Array<PageStep> = [
    { id: "booking", title: "Booking", state: "current", meta: "Added to your calendar", content: booking.fields },
    waiting("record", "Notes", "Written once it has happened."),
    waiting("payment", "Payment", "Recorded once it is paid."),
    waiting("documents", "Documents", "Its invoice is drafted with the booking, its receipt with the payment.", "optional"),
    waiting("follow-ups", "Follow-ups", "Added from its page, once it is booked.", "optional"),
  ];

  return (
    <>
      <PageHeader
        parent={parent}
        title={nextVisit && clientName ? `Next visit for ${clientName}` : "New session"}
        actions={[submit]}
      />
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void booking.form.handleSubmit();
        }}
      >
        <PageSteps steps={steps} />
      </form>
      <UnsavedChangesDialog when={booking.hasChanges} />
    </>
  );
}
