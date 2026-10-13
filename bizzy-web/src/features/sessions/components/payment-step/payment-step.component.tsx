import { dueCents, hasHappened, isBoughtDue, isDelivered, isPaid } from "../../session-stage.util";
import { sessionPayables } from "../../session-payment.util";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { Session } from "../../sessions.types";
import type { Package } from "~/features/packages/packages.types";
import { creditsLeft } from "~/features/packages/packages.util";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { methodLabel } from "~/features/payments/payments.util";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function paymentStep(session: Session, covering: Package | undefined, bought: Package | undefined): PipelineStep {
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
  const payables = sessionPayables(session, bought);

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
