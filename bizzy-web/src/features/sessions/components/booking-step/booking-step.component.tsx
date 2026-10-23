import { PencilIcon } from "lucide-react";
import { hasHappened, sessionMinutes } from "../../session-stage.util";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { SessionFullView } from "../../sessions.types";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

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

/**
 * Changing the booking is the step's own action, beside its title; the page
 * holds the dialog (`onEdit`), so it can open straight away to settle a
 * calendar edit. Not being confirmed yet is the page's banner.
 */
export function bookingStep(session: SessionFullView, onEdit: () => void): PipelineStep {
  const happened = hasHappened(session);
  return {
    id: "booking",
    title: "Booking",
    state: session.tentative && !session.cancelledAt ? "current" : "done",
    meta: (
      <Lines>
        {[
          session.cancelledAt ? `Cancelled ${formatDate(session.cancelledAt)}` : undefined,
          session.tentative ? "Not confirmed" : session.confirmedAt ? `Confirmed ${formatDate(session.confirmedAt)}` : undefined,
          happened ? `Happened ${formatDate(session.start)}` : `Booked for ${formatSessionTime(session.start)}`,
        ]}
      </Lines>
    ),
    actions: [{ type: "button", label: "Edit booking", icon: PencilIcon, can: session.can.update, onClick: onEdit }],
    content: (
      <p className="text-sm">
        {formatSessionTime(session.start)} · {sessionMinutes(session)} min ·{" "}
        {session.location === "visit" ? "Home visit" : "Your place"}
        {session.credits.length > 0 && <> · package credit</>}
        {session.invoice && <> · {formatCents(session.feeCents)}</>}
        {!session.tentative && session.confirmedAt && <> · confirmed {formatDate(session.confirmedAt)}</>}
      </p>
    ),
  };
}
