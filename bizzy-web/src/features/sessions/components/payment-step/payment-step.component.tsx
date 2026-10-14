import { hasHappened } from "../../session-stage.util";
import { sessionPayables } from "../../session-payment.util";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { Session } from "../../sessions.types";
import type { Package } from "~/features/packages/packages.types";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { methodLabel } from "~/features/payments/payments.util";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function paymentStep(session: Session, covering: Package | undefined, bought: Package | undefined): PipelineStep {
  const { paid } = session;

  let state: StepState = "todo";
  if (session.settled && (paid || session.feeCents === 0)) state = "done";
  else if (!session.tentative && hasHappened(session)) state = "current";

  const parts: Array<string> = [];
  if (paid) {
    parts.push(`${formatCents(paid.amountCents)} · ${methodLabel(paid.method)} · ${formatDate(paid.paidOn)}`);
  } else if (session.packageId) {
    parts.push("Covered by a package");
  } else {
    parts.push(session.feeCents > 0 ? `${formatCents(session.feeCents)} due` : "Nothing to pay");
  }
  if ((session.boughtOwedCents ?? 0) > 0) parts.push(`package ${formatCents(session.boughtOwedCents ?? 0)} due`);
  else if (session.boughtPackageId) parts.push("package paid");

  return {
    id: "payment",
    title: "Payment",
    state,
    meta: parts.join(" · "),
    content: session.tentative ? (
      <p className="text-sm text-muted-foreground">Confirm the session before recording its payment.</p>
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
  const payables = sessionPayables(session, bought);

  return (
    <div className="flex flex-col gap-4">
      {session.feeCents === 0 && !session.paid && (
        <p className="text-sm">
          {covering ? (
            <>
              Covered by the package bought {formatDate(covering.purchasedAt)}
              <span className="text-muted-foreground">
                {" "}
                · {covering.creditsLeft} of {covering.sessions} credits left
              </span>
              {covering.id !== bought?.id && covering.owedCents > 0 && (
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
