import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  applySuggestion,
  chipsOf,
  removeChip,
  suggest,
} from "./filter-bar.util";
import type { ReactNode } from "react";
import type { Suggestion } from "./filter-bar.util";
import type { Facet, FilterPreset, ListFilter } from "~/core/list/filter.types";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";
import { DrawerDialog } from "~/components/shared/dialog/drawer-dialog/drawer-dialog.component";
import { DRAWER_ROW } from "~/components/shared/dialog/drawer-dialog/drawer-dialog.constant";
import {
  useInDock,
  usePageSlots,
} from "~/components/shared/layout/page-header/page-header.hook";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  applyPreset,
  formatWhen,
  presetOf,
  stepWhen,
  whenDays,
} from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

/** How long typing pauses before the words are searched. */
const TEXT_DELAY = 300;

interface FilterBarProps {
  value: ListFilter;
  onChange: (filter: ListFilter) => void;
  /** Says what is searched, e.g. "Search sessions"; the placeholder is a quip. */
  label: string;
  /** What the list can be narrowed by, offered as she types. */
  facets?: ReadonlyArray<Facet> | undefined;
  /** Offers days to filter by: typed ("oct", "last month") or picked. */
  dates?: boolean | undefined;
  /** Filters ready made, the list's default first: picked from a button before the box, which names the one shown. */
  presets?: ReadonlyArray<FilterPreset> | undefined;
  /** The chips under the box at every width, for a narrow panel. */
  stacked?: boolean | undefined;
  /** How long typing pauses before the words go up; 0 for a draft that is applied later. */
  textDelay?: number | undefined;
  className?: string | undefined;
}

/**
 * One box to search a list and narrow it. What she types searches the
 * words; it also offers what it could mean as a filter (a client, a stage,
 * a month), taken as a chip under the box. Every chip can be removed, and
 * a month or year chip steps back and forth. A list's presets are on a
 * button before the box, named for the one the filter is (or Custom), so
 * the ways a list is usually looked at are a tap away and any of them can
 * be narrowed further.
 *
 * The chips keep to one row that scrolls sideways, beside the box from a
 * small screen up (so taking one moves nothing) and under it on a phone
 * (so only the first one moves the list, and only once). The newest chip
 * scrolls into view; Clear all stays put at the end.
 *
 * In a phone's dock (the page header's toolbar there; see DockContext) it is
 * the presets' button and the box drawn as a ⌕, which grows over the dock
 * while it has the focus (the actions give way), its suggestions opening
 * upward over the list. The box itself is the ⌕, so a tap focuses it at once
 * and the keyboard comes up. The chips, the words among them, sit in the
 * tray above the dock while no search is being typed.
 */
export function FilterBar({
  value,
  onChange,
  label,
  facets = [],
  dates = false,
  presets = [],
  stacked = false,
  textDelay = TEXT_DELAY,
  className,
}: FilterBarProps) {
  const placeholder = useQuip(QUIPS.searchPlaceholder);
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value.text);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pickingDays, setPickingDays] = useState(false);
  const [focused, setFocused] = useState(false);
  const inDock = useInDock();
  const { tray } = usePageSlots();
  // In the dock: typing (the box covers the dock), or folded to a ⌕ beside the actions.
  const searching = inDock && focused;
  const folded = inDock && !focused;

  // The words go up after a pause. Words coming back down (back, or a
  // chip that clears them) replace the draft, unless they are the ones
  // sent: she may have typed on since.
  const [sent, setSent] = useState(value.text);
  const [seen, setSeen] = useState(value.text);
  if (value.text !== seen) {
    setSeen(value.text);
    if (value.text !== sent) setDraft(value.text);
  }
  const sendText = (text: string) => {
    setSent(text);
    onChange({ ...value, text });
  };
  const sendLater = useEffectEvent(sendText);
  useEffect(() => {
    if (draft === value.text) return;
    const timer = setTimeout(() => sendLater(draft), textDelay);
    return () => clearTimeout(timer);
  }, [draft, value.text, textDelay]);

  const groups = useMemo(
    () => suggest(draft, value, facets, dates),
    [draft, value, facets, dates],
  );
  const options = groups.flatMap((group) => group.items);
  const chips = chipsOf(value, facets);
  const showList = open && !pickingDays && options.length > 0;
  // In the dock the box folds away, so the words it holds are a chip too.
  const wordsChip = inDock && value.text !== "";
  const chipCount = chips.length + (value.when ? 1 : 0) + (wordsChip ? 1 : 0);

  // A chip just taken is added at the end, maybe out of view: bring it in.
  const scroller = useRef<HTMLDivElement>(null);
  const shownChips = useRef(chipCount);
  useEffect(() => {
    const row = scroller.current;
    if (row && chipCount > shownChips.current)
      row.scrollTo({ left: row.scrollWidth, behavior: "smooth" });
    shownChips.current = chipCount;
  }, [chipCount]);

  const change = (next: ListFilter) => {
    setDraft(next.text);
    setSent(next.text);
    onChange(next);
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
    setPickingDays(false);
  };
  // In the dock, done searching: the box folds back and the keyboard goes.
  const done = () => {
    close();
    if (!inDock) return;
    setFocused(false);
    input.current?.blur();
  };
  const choose = (suggestion: Suggestion) => {
    if (suggestion.type === "days") {
      setPickingDays(true);
      return;
    }
    change(applySuggestion(value, suggestion));
    done();
  };

  const chipRow = (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        !stacked && !inDock && "sm:flex-1",
      )}
    >
      <div
        ref={scroller}
        className="-my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        {wordsChip && (
          <ChipShell
            removeLabel="Remove the words searched"
            onRemove={() => change({ ...value, text: "" })}
          >
            “{value.text}”
          </ChipShell>
        )}
        {value.when && (
          <WhenChip
            when={value.when}
            onChange={(when) => change({ ...value, when })}
          />
        )}
        {chips.map((chip) => (
          <ChipShell
            key={`${chip.facet}:${chip.value}`}
            removeLabel={`Remove ${chip.facetLabel.toLowerCase()} ${chip.label}`}
            onRemove={() => change(removeChip(value, chip.facet, chip.value))}
          >
            <span className="text-muted-foreground">{chip.facetLabel}:</span>{" "}
            {chip.label}
          </ChipShell>
        ))}
      </div>
      {chipCount > 1 && (
        <Button
          variant="link"
          size="sm"
          className="h-7 shrink-0 px-1"
          onClick={() =>
            change({ ...value, text: "", when: undefined, chips: {} })
          }
        >
          Clear all
        </Button>
      )}
    </div>
  );

  return (
    <div
      ref={container}
      data-searching={searching || undefined}
      className={cn(
        inDock
          ? "flex min-w-0 flex-1 items-center gap-1"
          : cn(
              "relative flex w-full flex-col gap-2",
              !stacked && "sm:flex-row sm:items-center",
            ),
        className,
      )}
      onBlur={(event) => {
        if (container.current?.contains(event.relatedTarget)) return;
        close();
        setFocused(false);
      }}
    >
      <div
        className={cn(
          "flex",
          inDock
            ? "min-w-0 flex-1 items-center gap-1"
            : cn("gap-2", !stacked && "sm:shrink-0"),
        )}
      >
        {searching && (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Done searching"
            // Keeps the focus in the box until the click lands, so it isn't taken as leaving.
            onMouseDown={(event) => event.preventDefault()}
            onClick={done}
          >
            <ArrowLeftIcon />
          </Button>
        )}
        {presets.length > 0 &&
          !searching &&
          (inDock ? (
            <PresetSheet value={value} presets={presets} onChange={change} />
          ) : (
            <PresetMenu value={value} presets={presets} onChange={change} />
          ))}
        <div
          className={cn(
            "relative min-w-0",
            folded ? "size-9 shrink-0" : "flex-1",
            !stacked && !inDock && "sm:w-80 sm:flex-none",
          )}
        >
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={input}
            type="search"
            role="combobox"
            aria-label={label}
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              showList && active >= 0 ? `${listId}-${active}` : undefined
            }
            placeholder={placeholder}
            className={cn(
              "pl-8 [&::-webkit-search-cancel-button]:hidden",
              draft && !folded && "pr-8",
              inDock && "h-9",
              // Folded to a ⌕: the same box, so a tap focuses it and brings up the keyboard.
              folded &&
                "cursor-pointer px-0 text-transparent caret-transparent placeholder:text-transparent",
            )}
            value={draft}
            autoComplete="off"
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
              setActive(-1);
              setPickingDays(false);
            }}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowDown":
                  event.preventDefault();
                  setOpen(true);
                  setActive(Math.min(active + 1, options.length - 1));
                  break;
                case "ArrowUp":
                  event.preventDefault();
                  setActive(Math.max(active - 1, -1));
                  break;
                case "Enter": {
                  const picked = showList ? options[active] : undefined;
                  if (picked) {
                    event.preventDefault();
                    choose(picked);
                  } else {
                    sendText(draft);
                    done();
                  }
                  break;
                }
                case "Escape":
                  if (open) close();
                  else if (inDock) done();
                  else if (draft) change({ ...value, text: "" });
                  break;
                case "Backspace": {
                  // An empty box takes back the last chip.
                  const last = chips.at(-1);
                  if (!draft && last)
                    change(removeChip(value, last.facet, last.value));
                  break;
                }
              }
            }}
          />
          {folded && value.text && (
            <span
              aria-hidden="true"
              className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
            />
          )}
          {draft && !folded && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              onClick={() => change({ ...value, text: "" })}
            >
              <XIcon />
            </Button>
          )}
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label={`Filter ${label.toLowerCase()}`}
              className={cn(
                "absolute inset-x-0 z-(--z-popover) overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
                // Over the list from the dock, as the keyboard is under it.
                inDock
                  ? "bottom-full mb-2.5 max-h-60"
                  : "top-full mt-1 max-h-80",
              )}
              // Keeps the focus in the box while an option is clicked.
              onMouseDown={(event) => event.preventDefault()}
            >
              {groups.map((group) => (
                <li key={group.label} role="presentation">
                  <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  <ul role="presentation">
                    {group.items.map((item) => {
                      const index = options.indexOf(item);
                      return (
                        <li
                          key={`${item.type}:${item.label}`}
                          id={`${listId}-${index}`}
                          role="option"
                          aria-selected={index === active}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5",
                            inDock && "py-2.5",
                            index === active
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted",
                          )}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => choose(item)}
                        >
                          <span className="truncate">{item.label}</span>
                          {item.type === "when" && item.hint && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {item.hint}
                            </span>
                          )}
                          {item.type === "days" && (
                            <CalendarIcon
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {open && pickingDays && (
            <DaysPicker
              initial={value.when}
              up={inDock}
              onPick={(when) => {
                change({ ...value, text: "", when });
                done();
              }}
            />
          )}
        </div>
      </div>

      {chipCount > 0 &&
        (!inDock ? chipRow : !searching && tray && createPortal(chipRow, tray))}
    </div>
  );
}

/** The presets, on a button named for the one the filter is; Custom once she narrows it her own way. */
function PresetMenu({
  value,
  presets,
  onChange,
}: {
  value: ListFilter;
  presets: ReadonlyArray<FilterPreset>;
  onChange: (filter: ListFilter) => void;
}) {
  const current = presetOf(value, presets);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="max-w-40 shrink-0 sm:max-w-56" />
        }
      >
        <span className="truncate">{current?.label ?? "Custom"}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current?.label ?? null}
            onValueChange={(label) => {
              const picked = presets.find((preset) => preset.label === label);
              if (picked) onChange(applyPreset(value, picked));
            }}
          >
            {presets.map((preset) => (
              <DropdownMenuRadioItem key={preset.label} value={preset.label}>
                {preset.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The presets in a phone's dock: the same button, opening them as a sheet from the bottom. */
function PresetSheet({
  value,
  presets,
  onChange,
}: {
  value: ListFilter;
  presets: ReadonlyArray<FilterPreset>;
  onChange: (filter: ListFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = presetOf(value, presets);
  return (
    <>
      <Button
        variant="outline"
        size="lg"
        className="max-w-40 min-w-0 shrink"
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{current?.label ?? "Custom"}</span>
        <ChevronDownIcon />
      </Button>
      <DrawerDialog
        open={open}
        onClose={() => setOpen(false)}
        side="bottom"
        title="Show"
      >
        <div role="radiogroup" aria-label="Show" className="flex flex-col">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              role="radio"
              aria-checked={preset === current}
              className={cn(DRAWER_ROW, preset === current && "font-medium")}
              onClick={() => {
                onChange(applyPreset(value, preset));
                setOpen(false);
              }}
            >
              <span className="flex-1">{preset.label}</span>
              {preset === current && <CheckIcon />}
            </button>
          ))}
        </div>
      </DrawerDialog>
    </>
  );
}

function ChipShell({
  children,
  removeLabel,
  onRemove,
}: {
  children: ReactNode;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-7 max-w-64 shrink-0 items-center gap-0.5 rounded-full border bg-muted/40 pr-0.5 pl-2.5 text-sm whitespace-nowrap">
      <span className="truncate">{children}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-full"
        aria-label={removeLabel}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </span>
  );
}

/** The days shown, which a year, month or day steps back and forth from. */
function WhenChip({
  when,
  onChange,
}: {
  when: string;
  onChange: (when: string | undefined) => void;
}) {
  const earlier = stepWhen(when, -1);
  const later = stepWhen(when, 1);
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full border bg-muted/40 px-0.5 text-sm whitespace-nowrap">
      {earlier && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label="Earlier"
          onClick={() => onChange(earlier)}
        >
          <ChevronLeftIcon />
        </Button>
      )}
      <span className={cn("px-1 tabular-nums", !earlier && "pl-2")}>
        {formatWhen(when)}
      </span>
      {later && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label="Later"
          onClick={() => onChange(later)}
        >
          <ChevronRightIcon />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-full"
        aria-label="Show all dates"
        onClick={() => onChange(undefined)}
      >
        <XIcon />
      </Button>
    </span>
  );
}

/** Two days, both included, under the box (over it from the dock). */
function DaysPicker({
  initial,
  up,
  onPick,
}: {
  initial: string | undefined;
  up: boolean;
  onPick: (when: string) => void;
}) {
  const [from, setFrom] = useState(initial ? whenDays(initial).from : "");
  const [to, setTo] = useState(initial ? whenDays(initial).to : "");
  const ready = from !== "" && to !== "" && from <= to;
  return (
    <form
      className={cn(
        "absolute inset-x-0 z-(--z-popover) flex flex-wrap items-end gap-2 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
        up ? "bottom-full mb-2.5" : "top-full mt-1",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onPick(from === to ? from : `${from}~${to}`);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">From</span>
        <Input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">To</span>
        <Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      <Button type="submit" size="sm" disabled={!ready}>
        Show
      </Button>
    </form>
  );
}
