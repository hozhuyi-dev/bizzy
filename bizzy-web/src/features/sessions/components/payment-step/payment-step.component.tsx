import { PencilIcon } from "lucide-react";
import { hasHappened } from "../../session-stage.util";
import { owedText, sessionPayables } from "../../session-payment.util";
import type { PageStep, StepState } from "~/components/shared/layout/page-steps/page-steps.component";
import type { CoveringCredit, SessionFullView } from "../../sessions.types";
import type { PackageView } from "~/features/packages/packages.types";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { paidText } from "~/features/payments/payments.util";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/**
 * How it is paid, what was received, and what is owed. Changing how it is
 * paid (package or its fee) is the step's own action, beside its title:
 * the page turns the step into its form (`onChangePay`), as the booking's.
 */
export function paymentStep(
  session: SessionFullView,
  covering: ReadonlyArray<CoveringCredit>,
  bought: PackageView | undefined,
  onChangePay: () => void,
): PageStep {
  const { paid } = session;

  let state: StepState = "todo";
  if (session.owedCents === 0 && (paid || session.feeCents === 0)) state = "done";
  else if (!session.tentative && hasHappened(session)) state = "current";

  const parts: Array<string> = [];
  if (session.owedCents > 0) {
    parts.push(owedText(session));
  } else if (paid) {
    parts.push(paidText(paid));
  } else {
    parts.push(session.credits.length > 0 ? "Covered by a package" : "Nothing to pay");
  }
  if (session.bought?.paid) parts.push("package paid");

  return {
    id: "payment",
    title: "Payment",
    state,
    meta: parts.join(" · "),
    actions: [{ type: "button", label: "Change how it's paid", icon: PencilIcon, can: session.can.update, onClick: onChangePay }],
    content: session.tentative ? (
      <p className="text-sm text-muted-foreground">{session.can.pay.why ?? "Confirm the session before recording its payment."}</p>
    ) : (
      <SessionPayment session={session} covering={covering} bought={bought} />
    ),
  };
}

/**
 * What package credits pay of the session (anyone's shared with its
 * client), what was received for its fee and the package its title bought,
 * and what is still owed, paid together; and who pays.
 */
function SessionPayment({
  session,
  covering,
  bought,
}: {
  session: SessionFullView;
  covering: ReadonlyArray<CoveringCredit>;
  bought: PackageView | undefined;
}) {
  const payables = sessionPayables(session, bought);
  const clientsById = ClientsQuery.useById();
  const whose = (clientId: string) => (clientId === session.clientId ? "the" : `${clientsById.get(clientId)?.name ?? "someone"}'s`);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{payText(session)}</p>
      {covering.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {covering.map(({ pkg, hours }) => (
            <li key={pkg.id}>
              {formatHours(hours)} covered by {whose(pkg.clientId)} package bought {formatDate(pkg.purchasedAt)}
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
      {session.payer !== session.clientId && (
        <p className="text-sm text-muted-foreground">Billed to {clientsById.get(session.payer)?.name ?? "someone else"}.</p>
      )}
    </div>
  );
}

/** "Paid by package, oldest first": how it is paid, as chosen. */
function payText(session: SessionFullView): string {
  if (session.pay.by === "fee") return session.feeTyped ? "Paid by its own fee, entered for it." : "Paid by its own fee: the client's usual one.";
  return session.pay.packageId ? "Paid by package: the one chosen first." : "Paid by package, oldest first.";
}
