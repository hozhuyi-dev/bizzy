import { hasHappened } from "../../session-stage.util";
import { owedText, sessionPayables } from "../../session-payment.util";
import type { PageStep, StepState } from "~/components/shared/layout/page-steps/page-steps.component";
import type { CoveringCredit, SessionView } from "../../sessions.types";
import type { PackageView } from "~/features/packages/packages.types";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { methodLabel } from "~/features/payments/payments.util";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function paymentStep(
  session: SessionView,
  covering: ReadonlyArray<CoveringCredit>,
  bought: PackageView | undefined,
): PageStep {
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
    parts.push(session.credits.length > 0 ? "Covered by a package" : "Nothing to pay");
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
 * What package credits pay of the session, what was received for its fee
 * and the package its title bought, and what is still owed, paid together.
 */
function SessionPayment({
  session,
  covering,
  bought,
}: {
  session: SessionView;
  covering: ReadonlyArray<CoveringCredit>;
  bought: PackageView | undefined;
}) {
  const payables = sessionPayables(session, bought);

  return (
    <div className="flex flex-col gap-4">
      {covering.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {covering.map(({ pkg, hours }) => (
            <li key={pkg.id}>
              {formatHours(hours)} covered by the package bought {formatDate(pkg.purchasedAt)}
              <span className="text-muted-foreground">
                {" "}
                · {formatHours(pkg.creditsLeft)} of {formatHours(pkg.hours)} left
              </span>
              {pkg.id !== bought?.id && pkg.owedCents > 0 && (
                <span className="text-status-attention-foreground"> · that package is not paid yet</span>
              )}
            </li>
          ))}
          {session.invoice && <li className="text-muted-foreground">The rest is its fee.</li>}
        </ul>
      )}
      {covering.length === 0 && session.feeCents === 0 && !session.paid && (
        <p className="text-sm">Nothing to pay for this session.</p>
      )}
      {payables.length > 0 && <PaymentPanel payables={payables} />}
    </div>
  );
}
