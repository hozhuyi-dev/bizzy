import type { Remedy } from "~/core/lambda/lambda.types";
import type { PayItem } from "~/features/payments/payments.types";

/**
 * How the app takes a remedy the API offered with a refusal. Some it takes
 * right there (cancel the invoice, undo the payment, put bizzy's version
 * back in the calendar, confirm the session); the rest open the page where
 * the user does it, as there is more to fill in (a fee, a client's details).
 */
export type RemedyStep =
  | { kind: "call"; action: CallAction; target: string; request: Record<string, unknown> }
  | { kind: "open"; to: "/sessions/$id" | "/clients/$id"; id: string }
  | { kind: "open-new-client"; name?: string | undefined }
  | { kind: "open-packages" };

export type CallAction =
  | "calendar.revert"
  | "documents.cancel"
  | "payments.set"
  | "packages.makeStandalone"
  | "sessions.delete"
  | "sessions.update";

/** How to take a remedy; undefined for one the app doesn't know. */
export function remedyStep(remedy: Remedy): RemedyStep | undefined {
  const target = remedy.target ?? "";
  const request = remedy.request ?? {};
  switch (remedy.action) {
    case "calendar.revert":
    case "documents.cancel":
    case "payments.set":
    case "packages.makeStandalone":
    case "sessions.delete":
      return { kind: "call", action: remedy.action, target, request };
    case "sessions.update":
      // With what to change (confirm it), it is taken right there.
      return remedy.request
        ? { kind: "call", action: remedy.action, target, request }
        : { kind: "open", to: "/sessions/$id", id: target };
    case "clients.update":
      return { kind: "open", to: "/clients/$id", id: target };
    case "clients.create":
      return { kind: "open-new-client", name: typeof request.name === "string" ? request.name : undefined };
    case "packages.create":
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
