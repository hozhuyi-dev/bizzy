import type { SessionView } from "./sessions.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { Payable } from "~/features/payments/payments.types";
import { formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/** What is owed for the package bought in a session, while it is unpaid. */
function boughtOwedCents(session: SessionView): number {
  return session.bought && !session.bought.paid ? session.bought.priceCents : 0;
}

/**
 * What a session's payment panel shows: what was received for its fee and
 * for the package bought in it (`bought`, for the package's payment), and
 * everything still owed, paid together as the session.
 */
export function sessionPayables(session: SessionView, bought?: PackageView): Array<Payable> {
  const payables: Array<Payable> = [];
  if (session.paid) {
    payables.push({ item: { kind: "session", id: session.id }, label: "Session", dueCents: 0, paid: session.paid });
  }
  if (session.bought?.paid && bought?.paid) {
    payables.push({ item: { kind: "package", id: bought.id }, label: `Package of ${formatHours(bought.hours)}`, dueCents: 0, paid: bought.paid });
  }
  if (session.owedCents > 0) {
    payables.push({ item: { kind: "session", id: session.id }, label: owedLabel(session), dueCents: session.owedCents });
  }
  return payables;
}

/** "Session", "Package of 10 h", or both, as what is owed on a session covers. */
function owedLabel(session: SessionView): string {
  const pkg = boughtOwedCents(session);
  if (pkg === 0) return "Session";
  const pkgLabel = `package of ${formatHours(session.bought?.hours ?? 0)}`;
  return session.owedCents > pkg ? `Session and ${pkgLabel}` : pkgLabel.charAt(0).toUpperCase() + pkgLabel.slice(1);
}

/** "RM 95 due", or "RM 95 + package RM 850 due" when both are. */
export function owedText(session: SessionView): string {
  const pkg = boughtOwedCents(session);
  const fee = session.owedCents - pkg;
  if (pkg > 0 && fee > 0) return `${formatCents(fee)} + package ${formatCents(pkg)} due`;
  if (pkg > 0) return `package ${formatCents(pkg)} due`;
  return `${formatCents(session.owedCents)} due`;
}

