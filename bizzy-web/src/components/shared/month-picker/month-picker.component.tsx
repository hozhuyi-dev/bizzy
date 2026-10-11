import { useState } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { addMonths, formatMonth, monthKey } from "~/core/utils/date.util";
import { LOCALE } from "~/core/constants/app.constant";

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(LOCALE, { month: "short" }).format(new Date(2000, i, 1)),
);

interface MonthPickerProps {
  /** "2026-10". */
  value: string;
  onChange: (month: string) => void;
  /** The latest month that can be chosen; defaults to this month. */
  max?: string | undefined;
}

// Matches the tabs beside it: a muted pill holding equal-height segments.
const SEGMENT =
  "inline-flex h-full items-center justify-center rounded-md text-sm font-medium text-foreground/70 outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * [‹ Oct 2026 ⌄ › | This month] as one control, in the tabs' style: the
 * arrows step a month at a time, the label opens a year of months to jump
 * further back, and This month comes straight back.
 */
export function MonthPicker({ value, onChange, max = monthKey(new Date()) }: MonthPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div data-slot="month-picker" className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-[3px]">
      <button type="button" className={cn(SEGMENT, "w-7")} aria-label="Previous month" onClick={() => onChange(addMonths(value, -1))}>
        <ChevronLeftIcon />
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<button type="button" className={cn(SEGMENT, "min-w-26 gap-1 px-2 tabular-nums")} />}
          aria-label={`Month: ${formatMonth(value)}. Choose another`}
        >
          {formatMonth(value)}
          <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="w-64">
          {/* Keyed so the year resets to the chosen month's each time it opens. */}
          <MonthGrid
            key={String(open)}
            value={value}
            max={max}
            onPick={(month) => {
              onChange(month);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        className={cn(SEGMENT, "w-7")}
        aria-label="Next month"
        disabled={value >= max}
        onClick={() => onChange(addMonths(value, 1))}
      >
        <ChevronRightIcon />
      </button>
      {/* Always there, dimmed on this month, so the control never changes width. */}
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
      <button type="button" className={cn(SEGMENT, "px-2")} disabled={value === max} onClick={() => onChange(max)}>
        This month
      </button>
    </div>
  );
}

function MonthGrid({ value, max, onPick }: { value: string; max: string; onPick: (month: string) => void }) {
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const maxYear = Number(max.slice(0, 4));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" aria-label="Previous year" onClick={() => setYear(year - 1)}>
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm font-medium tabular-nums">{year}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next year"
          disabled={year >= maxYear}
          onClick={() => setYear(year + 1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_NAMES.map((name, i) => {
          const month = `${year}-${String(i + 1).padStart(2, "0")}`;
          const selected = month === value;
          return (
            <Button
              key={month}
              variant={selected ? "default" : "ghost"}
              size="sm"
              disabled={month > max}
              aria-pressed={selected}
              className={cn(!selected && month === max && "ring-1 ring-border")}
              onClick={() => onPick(month)}
            >
              {name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
