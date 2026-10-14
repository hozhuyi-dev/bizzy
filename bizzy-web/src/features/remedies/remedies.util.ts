import type { Remedy } from "~/core/lambda/lambda.types";
import type { PayItem } from "~/features/payments/payments.types";

/**
 * How the app takes a remedy the API offered with a refusal. Some it takes
 * right there (cancel the invoice, undo the payment, undo her edit in the
 * calendar); the rest open the page where she does it, as there is more to
 * fill in (a fee, a client's details).
 */
export type RemedyStep =
  | { kind: "call"; action: CallAction; target: string }
  | { kind: "open"; to: "/sessions/$id" | "/clients/$id"; id: string }
  | { kind: "open-new-client"; name?: string | undefined }
  | { kind: "open-packages" };

export type CallAction =
  | "calendar.revert"
  | "conflicts.apply"
  | "calendar.ignore"
  | "documents.cancel"
  | "payments.set"
  | "packages.makeStandalone"
  | "sessions.delete";

const CALLS: ReadonlyArray<string> = [
  "calendar.revert",
  "conflicts.apply",
  "calendar.ignore",
  "documents.cancel",
  "payments.set",
  "packages.makeStandalone",
  "sessions.delete",
];

/** How to take a remedy; undefined for one the app doesn't know. */
export function remedyStep(remedy: Remedy, name?: string): RemedyStep | undefined {
  const target = remedy.target ?? "";
  if (CALLS.includes(remedy.action)) return { kind: "call", action: remedy.action as CallAction, target };
  switch (remedy.action) {
    case "sessions.update":
      return { kind: "open", to: "/sessions/$id", id: target };
    case "clients.save":
      return target ? { kind: "open", to: "/clients/$id", id: target } : { kind: "open-new-client", name };
    case "packages.save":
      return { kind: "open-packages" };
  }
  return undefined;
}

/** The item a payment remedy undoes: "session:<id>" or "package:<id>". */
export function payItemOf(target: string): PayItem | undefined {
  const [kind, id] = target.split(":");
  if ((kind === "session" || kind === "package") && id) return { kind, id };
  return undefined;
}
