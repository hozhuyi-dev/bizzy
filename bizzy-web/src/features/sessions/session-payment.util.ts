import type { Session } from "./sessions.types";
import type { Payable } from "~/features/payments/payments.types";
import type { Package } from "~/features/packages/packages.types";

/**
 * What a session's payment panel settles: the session's fee (or its
 * payment, once made) and the package its title bought, each on its own.
 */
export function sessionPayables(session: Session, bought: Package | undefined): Array<Payable> {
  const due = session.dueCents;
  const payables: Array<Payable> = [];
  if (due > 0 || session.payment) {
    payables.push({
      item: { kind: "session", id: session.eventId },
      label: "Session fee",
      dueCents: due,
      payment: session.payment,
      receipted: Boolean(session.receipt),
    });
  }
  if (bought) {
    payables.push({
      item: { kind: "package", id: bought.id },
      label: `Package of ${bought.sessions}`,
      dueCents: bought.priceCents,
      payment: bought.payment,
      receipted: Boolean(bought.receipt),
    });
  }
  return payables;
}
