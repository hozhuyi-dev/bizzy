import { dueCents } from "./session-stage.util";
import type { PaymentCover, Session } from "./sessions.types";
import type { Payable } from "~/features/payments/payments.types";
import type { Client } from "~/features/clients/clients.types";
import type { Package } from "~/features/packages/packages.types";
import { creditsLeft } from "~/features/packages/packages.util";

interface PaymentCoverInput {
  client: Client | undefined;
  /** When the session starts; only packages bought by then cover it. */
  start: Date;
  packages: ReadonlyArray<Package>;
  /** She is buying a package in this session, which then uses its first credit. */
  boughtHere: boolean;
  /** The session being edited, which may already hold a credit. */
  session?: Session | undefined;
}

/**
 * The reconcile's order for a session with no amount (billing.Allocate): a
 * package bought in it, else the oldest package bought by then with a
 * credit left, else the client's default fee. Credits left are as of now, so
 * a session added in the past may take a credit a later session was using.
 */
export function paymentCover({ client, start, packages, boughtHere, session }: PaymentCoverInput): PaymentCover {
  if (!client) return { kind: "none" };
  if (boughtHere) return { kind: "bought" };

  const own = packages.filter((pkg) => pkg.clientId === client.id);
  const held = session?.packageId && session.clientId === client.id && own.find((pkg) => pkg.id === session.packageId);
  if (held) return { kind: "credit", pkg: held };

  const available = own
    // One bought in this session is the form's to say, not the stored one's.
    .filter((pkg) => pkg.id !== session?.eventId && creditsLeft(pkg) > 0 && new Date(pkg.purchasedAt) <= start)
    .sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
  if (available[0]) return { kind: "credit", pkg: available[0] };

  if (client.defaultFeeCents !== undefined) return { kind: "default", feeCents: client.defaultFeeCents };
  return { kind: "none" };
}

/**
 * What a session's payment panel settles: the session's fee (or its
 * payment, once made) and the package its title bought, each on its own.
 */
export function sessionPayables(session: Session, bought: Package | undefined): Array<Payable> {
  const due = dueCents(session);
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
