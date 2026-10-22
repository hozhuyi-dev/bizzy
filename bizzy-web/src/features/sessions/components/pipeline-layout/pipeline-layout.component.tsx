import { cn } from "cn";
import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon, CircleIcon, CircleMinusIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionBar } from "~/components/shared/actions/action-bar/action-bar.component";
import { Card, CardContent } from "~/components/ui/card";
import { useActiveSection, useCenteredCurrent } from "~/core/scroll-spy/scroll-spy.hook";

/** Where a step stands: done, the one to do now, still ahead, optional and untouched, or not needed at all. */
export type StepState = "done" | "current" | "todo" | "optional" | "none";

export interface PipelineStep {
  /** The anchor; unique on the page. */
  id: string;
  /** Short: it sits in the rail, and under a dot on a phone. */
  title: string;
  state: StepState;
  /** What happened at this step, in the rail under the title (wider screens): dates and a one-line summary. */
  meta?: ReactNode;
  /** How many things it holds (documents, open follow-ups), beside its title; none at 0. */
  count?: number | undefined;
  /** Beside the title: what acts on the step as a whole (Edit booking, Add follow-up). */
  actions?: ReadonlyArray<Action> | undefined;
  /** Beside the title on a wide screen, behind ⋯ below lg: the step shares its width with the rail. */
  more?: ReadonlyArray<Action> | undefined;
  content: ReactNode;
}

interface PipelineLayoutProps {
  steps: ReadonlyArray<PipelineStep>;
}

const ICONS: Record<StepState, typeof CircleIcon> = {
  done: CircleCheckIcon,
  current: CircleDotIcon,
  todo: CircleIcon,
  optional: CircleDashedIcon,
  none: CircleMinusIcon,
};

const STATE_LABELS: Record<StepState, string> = {
  done: "Done",
  current: "To do now",
  todo: "Not yet",
  optional: "Optional",
  none: "Not needed",
};

/**
 * A session's page: a rail of its steps, each with where it stands, its
 * dates and a summary, beside the steps' forms. The rail is the only place
 * that shows progress, so the forms carry no status of their own. It sticks
 * beside the forms on wider screens; on a phone it becomes a timeline under
 * the header (dots joined by a line, titles below), and the summaries go,
 * the forms below saying the same.
 *
 * Kept apart from PageSections (whose contents list is plain links) so the
 * two can grow on their own; they share only the scroll measuring.
 */
export function PipelineLayout({ steps }: PipelineLayoutProps) {
  const [active, jumpTo] = useActiveSection(steps.map((step) => step.id));

  // The phone's timeline is taller than PageSections's links: what sticks
  // and scrolls below it reads --contents-height.
  return (
    <div className="flex flex-col gap-4 [--contents-height:3.25rem] md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-10">
      <Rail steps={steps} active={active} onJump={jumpTo} />
      {/* The last step is at least a screen tall, so its heading reaches the top like the others. */}
      <div className="flex min-w-0 flex-col gap-10 fill-last-section">
        {steps.map((step) => (
          <StepSection key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

function StepIcon({ state, className }: { state: StepState; className?: string }) {
  const Icon = ICONS[state];
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        state === "done" && "text-status-done-foreground",
        state === "current" && "text-foreground",
        (state === "todo" || state === "optional" || state === "none") && "text-muted-foreground",
        className,
      )}
    />
  );
}

interface RailProps {
  steps: ReadonlyArray<PipelineStep>;
  active: string | undefined;
  onJump: (id: string) => void;
}

function Rail({ steps, active, onJump }: RailProps) {
  const ref = useCenteredCurrent<HTMLElement>(active);
  return (
    <nav
      ref={ref}
      aria-label="Steps"
      className={cn(
        // Phones: a sticky timeline, sideways-scrolling once it doesn't fit.
        "sticky top-(--sticky-top) z-(--z-sticky) -mx-(--page-gutter) -mt-(--section-gap) flex h-(--contents-height) overflow-x-auto border-b bg-background px-1 scrollbar-none",
        // Wider: a sticky column of steps with their details.
        "md:top-[calc(var(--sticky-top)+var(--section-gap))] md:mx-0 md:mt-0 md:h-auto md:flex-col md:overflow-visible md:border-b-0 md:bg-transparent md:px-0",
      )}
    >
      {steps.map((step, i) => {
        const next = steps[i + 1];
        // The line on to the next step: done once this one is, dashed before an optional or unneeded one.
        const line =
          next &&
          cn(
            (next.state === "optional" || next.state === "none") && "border-dashed",
            step.state === "done" && "border-status-done-foreground/40",
          );
        const count = step.count || undefined;
        return (
          <a
            key={step.id}
            href={`#${step.id}`}
            aria-current={active === step.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onJump(step.id);
            }}
            className={cn(
              "group relative flex min-w-18 flex-1 flex-col items-center gap-1 pt-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              "aria-[current]:text-foreground md:aria-[current]:bg-muted",
              "md:min-w-0 md:flex-none md:flex-row md:items-start md:gap-2.5 md:rounded-md md:p-2 md:text-sm",
            )}
          >
            {line !== undefined && (
              <>
                {/* Phones: across to the next dot, short of both. */}
                <span
                  aria-hidden="true"
                  className={cn("absolute top-4 left-[calc(50%+0.75rem)] w-[calc(100%-1.5rem)] border-t md:hidden", line)}
                />
                {/* Wider: down to the next step's icon. */}
                <span
                  aria-hidden="true"
                  className={cn("absolute top-7 -bottom-3 left-4 hidden border-l md:block", line)}
                />
              </>
            )}
            <span className="relative md:mt-0.5">
              <StepIcon state={step.state} />
              {count !== undefined && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-3 h-3.5 min-w-3.5 rounded-full bg-muted px-1 text-center text-2xs leading-3.5 font-medium text-foreground tabular-nums md:hidden"
                >
                  {count}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap group-aria-[current]:font-medium md:font-medium",
                  step.state === "current" && "text-foreground",
                )}
              >
                {step.title}
                {count !== undefined && (
                  <span className="hidden rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground tabular-nums md:inline">
                    {count}
                  </span>
                )}
                <span className="sr-only">
                  : {STATE_LABELS[step.state]}
                  {count !== undefined && `, ${count}`}
                </span>
              </span>
              {step.meta && <span className="hidden text-xs leading-snug text-muted-foreground md:block">{step.meta}</span>}
            </span>
            {/* Phones: under the step being read. */}
            <span
              aria-hidden="true"
              className="absolute bottom-0 hidden h-0.5 w-8 rounded-full bg-foreground group-aria-[current]:block md:group-aria-[current]:hidden"
            />
          </a>
        );
      })}
    </nav>
  );
}

function StepSection({ step }: { step: PipelineStep }) {
  const { id, title, actions, more, content } = step;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-below-headers flex flex-col gap-3"
    >
      {/* As PageSections's heading: the title's height whatever sits beside it. */}
      <div className="flex h-6 items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="flex min-w-0 items-center gap-2 type-section-title">
          <StepIcon state={step.state} className="md:hidden" />
          <span className="truncate">{title}</span>
        </h2>
        <ActionBar actions={actions} more={more} size="sm" foldBelow="lg" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">{content}</CardContent>
      </Card>
    </section>
  );
}
