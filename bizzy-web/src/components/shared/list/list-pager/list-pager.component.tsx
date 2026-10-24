import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronUpIcon, ListFilterIcon, LoaderCircleIcon } from "lucide-react";
import type { LinkOptions } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { FilteredPagerList, PagerList, Side } from "~/core/list/pager.types";
import type { Current } from "~/core/list/pager.util";
import type { ListFilter } from "~/core/list/filter.types";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { usePager, useStepKeys } from "~/core/list/pager.hook";

/** How long the panel's filter rests before it counts what it finds. */
const COUNT_DELAY = 300;

/** Thumb-sized in a phone's dock (PageDock), where the header puts it. */
const IN_DOCK = "in-data-[slot=page-dock]:size-9";

interface PanelOptions {
  /** Makes the panel's filter the one stepped through. */
  onApply: (filter: ListFilter) => void;
  /** The list's own page, with a filter. */
  listLink: (filter: ListFilter) => LinkOptions;
}

type ListPagerProps<T> = {
  filter: ListFilter;
  current: Current;
  /** An item's page, keeping the list it is stepped through. */
  itemLink: (id: string) => LinkOptions;
} & (
  | { list: FilteredPagerList<T>; panel: PanelOptions }
  /** A list it doesn't filter (the to-do list): its count is just a count. */
  | { list: PagerList<T>; panel?: undefined }
);

/**
 * ˄ 3 of 12 ˅ in an entity page's header: steps to the item above or below
 * in the list it was opened from (K and J too), and says where it is. One
 * not in the list is "– of 12", and a step goes to its neighbours. The
 * count opens the list's filter, to change and apply, or to open the list.
 */
export function ListPager<T>({ list, filter, current, itemLink, panel }: ListPagerProps<T>) {
  const window = list.useWindow(filter);
  const pager = usePager({ list, window, current, filterKey: JSON.stringify(filter), itemLink });
  useStepKeys(pager.step);

  // Stays where it is while a step goes: the button stepped with spins
  // instead (and, still enabled so it stays bright, does nothing more).
  const at = pager.position?.at ?? "…";
  const stepIcon = (side: Side, Icon: typeof ChevronUpIcon) =>
    pager.stepping === side ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <Icon />;
  const of = pager.position?.of ?? "…";
  const count = (
    <span className="tabular-nums">
      <span className="hidden sm:inline">
        {at} of {of}
      </span>
      <span className="sm:hidden">
        {at}/{of}
      </span>
    </span>
  );

  return (
    <nav aria-label={`Step through ${list.nouns}`} className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        className={IN_DOCK}
        aria-label={`Previous ${list.noun}`}
        title={`Previous ${list.noun} (K)`}
        disabled={!pager.canStep.before || (pager.stepping !== undefined && pager.stepping !== "before")}
        aria-busy={pager.stepping === "before"}
        onClick={() => pager.step("before")}
      >
        {stepIcon("before", ChevronUpIcon)}
      </Button>
      {panel ? (
        <FilterPanel list={list} filter={filter} panel={panel}>
          {count}
        </FilterPanel>
      ) : (
        <span className="px-1.5 text-sm text-muted-foreground">{count}</span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className={IN_DOCK}
        aria-label={`Next ${list.noun}`}
        title={`Next ${list.noun} (J)`}
        disabled={!pager.canStep.after || (pager.stepping !== undefined && pager.stepping !== "after")}
        aria-busy={pager.stepping === "after"}
        onClick={() => pager.step("after")}
      >
        {stepIcon("after", ChevronDownIcon)}
      </Button>
    </nav>
  );
}

interface FilterPanelProps<T> {
  list: FilteredPagerList<T>;
  filter: ListFilter;
  panel: PanelOptions;
  children: ReactNode;
}

/** The count, opening the list's filter as a draft: Apply steps through what it finds. */
function FilterPanel<T>({ list, filter, panel, children }: FilterPanelProps<T>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filter);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Each opening starts from the filter stepped through.
        if (next) setDraft(filter);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="in-data-[slot=page-dock]:h-9 in-data-[slot=page-dock]:px-3"
            aria-label={`Filter ${list.nouns}`}
            title={`Filter ${list.nouns}`}
          />
        }
      >
        <ListFilterIcon className="hidden sm:block" />
        {children}
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-3">
        <PanelBody
          list={list}
          draft={draft}
          onDraftChange={setDraft}
          panel={panel}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

interface PanelBodyProps<T> {
  list: FilteredPagerList<T>;
  draft: ListFilter;
  onDraftChange: (filter: ListFilter) => void;
  panel: PanelOptions;
  onClose: () => void;
}

/** Only there while the panel is open, so its facets and count load only then. */
function PanelBody<T>({ list, draft, onDraftChange, panel, onClose }: PanelBodyProps<T>) {
  const facets = list.useFacets();
  const counted = useSettled(draft, COUNT_DELAY);
  const found = list.useWindow(counted);
  const n = found.items.length;
  const more = found.hasAfter || found.hasBefore;

  return (
    <>
      <FilterBar
        label={list.label}
        value={draft}
        onChange={onDraftChange}
        facets={facets}
        dates={list.dates}
        stacked
        // Applied with the button, so each key can go straight into it.
        textDelay={0}
      />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {found.pending || counted !== draft
          ? "Counting…"
          : `${n}${more ? "+" : ""} ${n === 1 && !more ? list.noun : list.nouns} found`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="link"
          size="sm"
          className="mr-auto px-0"
          render={<Link {...panel.listLink(draft)} />}
          nativeButton={false}
          onClick={onClose}
        >
          Open list
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            panel.onApply(draft);
            onClose();
          }}
        >
          Apply
        </Button>
      </div>
    </>
  );
}

/** The value once it has stopped changing for a while. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
