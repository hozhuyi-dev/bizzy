import type { Session } from "./sessions.types";
import type { Client } from "~/features/clients/clients.types";
import type { Package } from "~/features/packages/packages.types";
import { creditsLeft } from "~/features/packages/packages.types";

/** What pays for a session when no amount is written in its title. */
export type PaymentCover =
  | { kind: "bought" }
  | { kind: "credit"; pkg: Package }
  | { kind: "default"; feeCents: number }
  | { kind: "none" };

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

  const own = packages.filter((pkg) => pkg.clientId === client.id && !pkg.removed);
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
