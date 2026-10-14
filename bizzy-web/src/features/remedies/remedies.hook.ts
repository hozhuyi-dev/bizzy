import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { payItemOf, remedyStep } from "./remedies.util";
import type { CallAction } from "./remedies.util";
import type { Remedy } from "~/core/lambda/lambda.types";
import { ConflictsService } from "~/features/conflicts/conflicts.service";
import { DocumentsService } from "~/features/documents/documents.service";
import { PackagesService } from "~/features/packages/packages.service";
import { PaymentsService } from "~/features/payments/payments.service";
import { SessionsService } from "~/features/sessions/sessions.service";
import { invalidateBilling } from "~/core/utils/query.util";

/** What each remedy the app takes right there does. */
const CALLS: Record<CallAction, (target: string) => Promise<unknown>> = {
  "calendar.revert": ConflictsService.revert,
  "conflicts.apply": ConflictsService.apply,
  "calendar.ignore": ConflictsService.ignore,
  "documents.cancel": async (id) => {
    const { document } = await DocumentsService.get(id);
    return DocumentsService.cancel(document, "To change what it says");
  },
  "payments.set": (target) => {
    const item = payItemOf(target);
    if (!item) throw new Error("There is no payment to undo.");
    return PaymentsService.set([item], null);
  },
  "packages.makeStandalone": PackagesService.makeStandalone,
  "sessions.delete": (id) => SessionsService.delete(id, true),
};

/** The remedies that settle a conflict themselves, rather than what refused it. */
const CONFLICT_ACTIONS: ReadonlyArray<string> = ["calendar.revert", "conflicts.apply", "calendar.ignore"];

/**
 * Takes the remedies the API offers with a refusal: right there, or by
 * opening the page where she does it. `name` is the name a new client
 * starts with, when one is to be added. `applyAfter` is the conflict the
 * remedy was taken from: once a remedy taken right there lets its edit
 * through, the edit is applied too (an edit made allowed any other way
 * waits for her to apply it).
 */
export function useRemedy() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const run = async (remedy: Remedy, name?: string, applyAfter?: string) => {
    const step = remedyStep(remedy, name);
    switch (step?.kind) {
      case "call":
        setPending(true);
        try {
          await CALLS[step.action](step.target);
          if (applyAfter && !CONFLICT_ACTIONS.includes(step.action)) await ConflictsService.apply(applyAfter);
        } finally {
          setPending(false);
          void invalidateBilling(queryClient);
        }
        return;
      case "open":
        return void navigate({ to: step.to, params: { id: step.id } });
      case "open-new-client":
        return void navigate({ to: "/clients/new", search: { name: step.name } });
      case "open-packages":
        return void navigate({ to: "/packages" });
    }
  };

  return { run, pending };
}
