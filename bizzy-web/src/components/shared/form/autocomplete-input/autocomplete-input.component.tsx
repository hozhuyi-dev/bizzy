import { Autocomplete } from "@base-ui/react/autocomplete";
import { cn } from "cn";
import type { ComponentProps } from "react";
import { Input } from "~/components/ui/input";

/** What an AutocompleteInput offers: a value to fill in, and a word on it. */
export interface Suggestion {
  value: string;
  /** Beside it, muted: "Supplies · RM 25.00". */
  detail?: string | undefined;
}

type InputProps = Pick<
  ComponentProps<"input">,
  "id" | "placeholder" | "maxLength" | "form" | "onBlur" | "aria-invalid" | "aria-describedby"
>;

interface AutocompleteInputProps extends InputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** In the order to offer them; those matching what is typed are shown. */
  suggestions: ReadonlyArray<Suggestion>;
  className?: string | undefined;
}

/** How many suggestions show at once: typing narrows them. */
const SUGGESTED = 8;

/**
 * A line of text that suggests as it is typed: those matching what is
 * typed, or the first few once the box is clicked. Anything may be typed;
 * a suggestion only fills it in. The form kit's AutocompleteField is this,
 * bound to a field.
 */
export function AutocompleteInput({ value, onValueChange, suggestions, className, ...input }: AutocompleteInputProps) {
  return (
    <Autocomplete.Root
      items={suggestions}
      itemToStringValue={(suggestion: Suggestion) => suggestion.value}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      limit={SUGGESTED}
      openOnInputClick
    >
      <Autocomplete.Input autoComplete="off" render={<Input className={cn("h-(--control-height)", className)} />} {...input} />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="isolate z-50 outline-none" sideOffset={4} align="start">
          <Autocomplete.Popup className="max-h-[min(20rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) min-w-48 origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-empty:hidden">
            <Autocomplete.List>
              {(suggestion: Suggestion) => (
                <Autocomplete.Item
                  key={suggestion.value}
                  value={suggestion}
                  className="flex cursor-default items-baseline justify-between gap-3 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="truncate">{suggestion.value}</span>
                  {suggestion.detail && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{suggestion.detail}</span>
                  )}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
