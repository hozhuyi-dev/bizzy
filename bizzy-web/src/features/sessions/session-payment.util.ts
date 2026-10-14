import type { Session } from "./sessions.types";
import type { Payable } from "~/features/payments/payments.types";
import type { Package } from "~/features/packages/packages.types";

/**
 * What a session's payment panel settles: the session's fee (or what was
 * received for it) and the package bought in it, each on its own.
 */
export function sessionPayables(session: Session, bought: Package | undefined): Array<Payable> {
  const payables: Array<Payable> = [];
  if (session.feeCents > 0 || session.paid) {
    payables.push({
      item: { kind: "session", id: session.id },
      label: "Session fee",
      dueCents: session.feeCents,
      paid: session.paid,
      receipt: session.receipt,
    });
  }
  if (bought && (bought.priceCents > 0 || bought.paid)) {
    payables.push({
      item: { kind: "package", id: bought.id },
      label: `Package of ${bought.sessions}`,
      dueCents: bought.priceCents,
      paid: bought.paid,
      receipt: bought.receipt,
    });
  }
  return payables;
}
