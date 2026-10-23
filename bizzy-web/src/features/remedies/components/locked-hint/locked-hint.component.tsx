import { LockIcon } from "lucide-react";
import { RemedyButtons } from "../remedy-buttons/remedy-buttons.component";
import type { Verdict } from "~/core/lambda/lambda.types";

interface LockedHintProps {
  lock: Verdict | undefined;
  /** A field above already says why, for the same reason (saidAbove): only point back to it. */
  again?: boolean;
}

/**
 * Why a form field is locked (its view's `locked`), under the field, with
 * what would free it as links; the field itself is disabled. Set apart from
 * the field's description, quiet as one. Nothing while it isn't locked.
 * Saving stays the last word: a refusal still says why.
 */
export function LockedHint({ lock, again = false }: LockedHintProps) {
  if (!lock) return null;
  if (again) {
    return (
      <p data-slot="field-description" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3 shrink-0" aria-hidden="true" />
        Locked for the same reason as above.
      </p>
    );
  }
  return (
    <div
      data-slot="field-description"
      className="flex gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs/relaxed text-muted-foreground"
    >
      <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span>{lock.why}</span>
        {lock.remedies && lock.remedies.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RemedyButtons remedies={lock.remedies} size="xs" plain />
          </span>
        )}
      </div>
    </div>
  );
}
