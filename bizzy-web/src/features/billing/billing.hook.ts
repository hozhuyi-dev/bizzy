import { useState } from "react";
import type { Impact } from "./billing.types";

/** How a previewed save went. */
export type ImpactOutcome =
  /** Saved: nothing was brought on. */
  | { kind: "saved" }
  /** Waiting in `impact` for her to confirm or cancel. */
  | { kind: "pending" }
  /** Refused whatever she confirms (the preview says why), or needing a field filled in. */
  | { kind: "refused"; impact: Impact };

/**
 * Saves a form the way the API asks: its preview first (what saving would
 * bring on, see Impact). Nothing brought on saves straight away; something
 * waits in `impact` for her to confirm, which saves with `confirm: true`;
 * a refusal comes back for the form to show. The API refuses an unconfirmed
 * save that brings something on, so this is the only way through.
 */
export function useImpactSave() {
  const [pending, setPending] = useState<{ impact: Impact; save: (confirm: boolean) => Promise<void> } | null>(null);
  const [saving, setSaving] = useState(false);

  const run = async (preview: () => Promise<Impact>, save: (confirm: boolean) => Promise<void>): Promise<ImpactOutcome> => {
    const impact = await preview();
    if (impact.refused) return { kind: "refused", impact };
    if (impact.needsConfirm) {
      setPending({ impact, save });
      return { kind: "pending" };
    }
    await save(false);
    return { kind: "saved" };
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await pending.save(true);
    } finally {
      setSaving(false);
      setPending(null);
    }
  };

  return {
    run,
    /** What a save waiting for her confirmation would bring on. */
    impact: pending?.impact ?? null,
    confirm,
    cancel: () => setPending(null),
    saving,
  };
}
