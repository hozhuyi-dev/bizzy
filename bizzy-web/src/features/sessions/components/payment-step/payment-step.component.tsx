import { hasHappened } from "../../session-stage.util";
import { owedText, sessionPayables } from "../../session-payment.util";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { SessionView } from "../../sessions.types";
import type { PackageView } from "~/features/packages/packages.types";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { methodLabel } from "~/features/payments/payments.util";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function paymentStep(session: SessionView, covering: PackageView | undefined, bought: PackageView | undefined): PipelineStep {
  const { paid } = session;

  let state: StepState = "todo";
  if (session.owedCents === 0 && (paid || session.feeCents === 0)) state = "done";
  else if (!session.tentative && hasHappened(session)) state = "current";

  const parts: Array<string> = [];
  if (session.owedCents > 0) {
    parts.push(owedText(session));
  } else if (paid) {
    parts.push(`${formatCents(paid.amountCents)} · ${methodLabel(paid.method)} · ${formatDate(paid.paidOn)}`);
  } else {
    parts.push(session.packageId ? "Covered by a package" : "Nothing to pay");
  }
  if (session.bought?.paid) parts.push("package paid");

  return {
    id: "payment",
    title: "Payment",
    state,
    meta: parts.join(" · "),
    content: session.tentative ? (
      <p className="text-sm text-muted-foreground">{session.can.pay.why ?? "Confirm the session before recording its payment."}</p>
    ) : (
      <SessionPayment session={session} covering={covering} bought={bought} />
    ),
  };
}

/**
 * What was received for the session's fee and the package its title
 * bought, and what is still owed, paid together.
 */
function SessionPayment({
  session,
  covering,
  bought,
}: {
  session: SessionView;
  covering: PackageView | undefined;
  bought: PackageView | undefined;
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
