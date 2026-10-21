import { LockIcon } from "lucide-react";
import { RemedyButtons } from "../remedy-buttons/remedy-buttons.component";
import type { Verdict } from "~/core/lambda/lambda.types";

/**
 * Why a form field is locked (its view's `locked`), under the field, with
 * what would free it; the field itself is disabled. Nothing while it isn't
 * locked. Saving stays the last word: a refusal still says why.
 */
export function LockedHint({ lock }: { lock: Verdict | undefined }) {
  if (!lock) return null;
  return (
    <div data-slot="field-description" className="flex flex-col items-start gap-1.5 text-sm text-muted-foreground">
      <span className="flex gap-1.5">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {lock.why}
      </span>
      {lock.remedies && lock.remedies.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          <RemedyButtons remedies={lock.remedies} size="xs" />
        </span>
      )}
    </div>
  );
}
