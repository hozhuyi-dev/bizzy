import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import { useRemedy } from "../../remedies.hook";
import { remedyStep } from "../../remedies.util";
import type { CallStep, RemedyStep } from "../../remedies.util";
import type { Remedy } from "~/core/lambda/lambda.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import { InlineConfirm, InlineField } from "~/components/shared/inline-action/inline-action.component";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { parseCents } from "~/core/utils/money.util";

interface RemedyButtonsProps {
  remedies: ReadonlyArray<Remedy>;
  /** The calendar edit they are offered for: their toast says whether it went in. */
  conflict?: ConflictView | undefined;
  /** After one is taken right there. */
  onDone?: () => void;
  /** Only the first as a button, the rest in a menu with `more`: for a row with little room. */
  first?: boolean;
  /** Further ways out, at the end of that menu. */
  more?: ReadonlyArray<{ label: string; onClick: () => void }>;
  size?: "xs" | "sm";
}

/**
 * A refusal's remedies, each a button that takes it: what would let the
 * action through. One that needs a value or can't be taken back swaps the
 * buttons, in place, for its field or its question.
 */
export function RemedyButtons({ remedies, conflict, onDone, first = false, more = [], size = "sm" }: RemedyButtonsProps) {
  const remedy = useRemedy(conflict);
  const [asking, setAsking] = useState<CallStep | null>(null);
  const known = remedies.flatMap((r) => {
    const step = remedyStep(r, conflict);
    return step ? [{ remedy: r, step }] : [];
  });

  const send = (step: CallStep, cents?: number) =>
    void remedy
      .call(step, cents)
      .then(() => {
        setAsking(null);
        onDone?.();
      })
      .catch((error: unknown) => {
        setAsking(null);
        toastRefusal(error);
      });

  // A page to fill in says, once saved, what came of it.
  const take = (step: RemedyStep) => {
    if (step.kind !== "call") remedy.open(step);
    else if (step.ask || step.confirm) setAsking(step);
    else send(step);
  };

  if (asking?.ask === "fee") {
    return (
      <InlineField
        label="Usual hourly fee"
        placeholder="Usual hourly fee, e.g. 95"
        inputMode="decimal"
        valid={(value) => parseCents(value) !== null}
        pending={remedy.pending}
        onSave={(value) => send(asking, parseCents(value) ?? undefined)}
        onCancel={() => setAsking(null)}
        size={size}
      />
    );
  }
  if (asking?.confirm) {
    return (
      <InlineConfirm
        question={asking.confirm.question}
        yes={asking.confirm.yes}
        pending={remedy.pending}
        onYes={() => send(asking)}
        onNo={() => setAsking(null)}
        size={size}
      />
    );
  }

  const shown = first ? known.slice(0, 1) : known;
  const inMenu = first ? known.slice(1) : [];
  return (
    <>
      {shown.map(({ remedy: r, step }) => (
        <Button
          key={`${r.action}:${r.target ?? ""}:${r.label}`}
          size={size}
          // The way out first, unless it can't be taken back.
          variant={first && !(step.kind === "call" && step.confirm) ? "default" : "outline"}
          disabled={remedy.pending}
          onClick={() => take(step)}
        >
          {r.label}
        </Button>
      ))}
      {(inMenu.length > 0 || more.length > 0) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size={size} variant="ghost" aria-label="More ways to settle it" disabled={remedy.pending} />}
          >
            <span className="hidden sm:inline">More</span> <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {inMenu.map(({ remedy: r, step }) => (
              <DropdownMenuItem key={`${r.action}:${r.target ?? ""}:${r.label}`} onClick={() => take(step)}>
                {r.label}
              </DropdownMenuItem>
            ))}
            {inMenu.length > 0 && more.length > 0 && <DropdownMenuSeparator />}
            {more.map((item) => (
              <DropdownMenuItem key={item.label} onClick={item.onClick}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

/**
 * Shows why an action was refused, with its remedies as buttons when the
 * API offered any: the app's way to say what to do instead.
 */
export function toastRefusal(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const remedies = error instanceof Error && "remedies" in error ? (error.remedies as Array<Remedy>) : [];
  if (remedies.length === 0) {
    toast.error(message);
    return;
  }
  const id = toast.error(message, {
    duration: 15_000,
    description: (
      <span className="flex flex-wrap gap-1.5">
        <RemedyButtons remedies={remedies} size="xs" onDone={() => toast.dismiss(id)} />
      </span>
    ),
  });
}
