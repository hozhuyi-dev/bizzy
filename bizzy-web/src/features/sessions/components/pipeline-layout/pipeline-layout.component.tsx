import { cn } from "cn";
import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { useActiveSection, useHeight } from "~/core/scroll-spy/scroll-spy.hook";
import { scrollToSection, stickyTop } from "~/core/scroll-spy/scroll-spy.util";

/** Where a step stands: done, the one to do now, still ahead, or optional and untouched. */
export type StepState = "done" | "current" | "todo" | "optional";

export interface PipelineStep {
  /** The anchor; unique on the page. */
  id: string;
  /** Short: it sits in the rail, and as a chip on a phone. */
  title: string;
  state: StepState;
  /**
   * What happened at this step, in the rail under the title: dates and a
   * one-line summary. On a phone, under the section heading instead.
   */
  meta?: ReactNode;
  /** Beside the section heading. */
  actions?: ReactNode;
  content: ReactNode;
}

interface PipelineLayoutProps {
  steps: ReadonlyArray<PipelineStep>;
  /** Notices about the whole session, kept in view under the page header. */
  banner?: ReactNode;
}

const ICONS: Record<StepState, typeof CircleIcon> = {
  done: CircleCheckIcon,
  current: CircleDotIcon,
  todo: CircleIcon,
  optional: CircleDashedIcon,
};

const STATE_LABELS: Record<StepState, string> = {
  done: "Done",
  current: "To do now",
  todo: "Not yet",
  optional: "Optional",
};

/**
 * A session's page: a rail of its steps, each with where it stands, its
 * dates and a summary, beside the steps' forms. The rail is the only place
 * that shows progress, so the forms carry no status of their own. It sticks
 * beside the forms on wider screens and becomes a row of step chips under
 * the header on a phone, where each step's details move under its heading.
 *
 * Kept apart from SectionLayout (whose contents list is plain links) so the
 * two can grow on their own; they share only the scroll measuring.
 */
export function PipelineLayout({ steps, banner }: PipelineLayoutProps) {
  const [bannerRef, bannerHeight] = useHeight<HTMLDivElement>();
  const bannerSpace = banner ? bannerHeight : 0;
  const active = useActiveSection(
    steps.map((step) => step.id),
    bannerSpace,
  );
  const style = { "--sticky-top": stickyTop(bannerSpace) } as CSSProperties;

  return (
    <div style={style}>
      {banner && (
        // Its own background, so the translucent dark-mode border isn't see-through.
        <div ref={bannerRef} className="sticky top-[calc(var(--nav-height)+3.5rem)] z-20 -mx-4 -mt-4 mb-4 flex flex-col border-b bg-background">
          {banner}
        </div>
      )}
      <div className="flex flex-col gap-4 md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-10">
        <Rail steps={steps} active={active} />
        <div className="flex min-w-0 flex-col gap-10 *:last:min-h-[calc(100dvh-var(--sticky-top)-3.75rem)] md:*:last:min-h-[calc(100dvh-var(--sticky-top)-1.5rem)]">
          {steps.map((step) => (
            <StepSection key={step.id} step={step} />
          ))}
        </div>
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
        (state === "todo" || state === "optional") && "text-muted-foreground",
        className,
      )}
    />
  );
}

function Rail({ steps, active }: { steps: ReadonlyArray<PipelineStep>; active: string | undefined }) {
  return (
    <nav
      aria-label="Steps"
      className={cn(
        // Phones: a sticky, sideways-scrolling row of step chips.
        "sticky top-(--sticky-top) z-10 -mx-4 -mt-4 flex h-11 items-center gap-1 overflow-x-auto border-b bg-background px-4 scrollbar-none",
        // Wider: a sticky column of steps with their details.
        "md:top-[calc(var(--sticky-top)+1.5rem)] md:mx-0 md:mt-0 md:h-auto md:flex-col md:items-stretch md:gap-0 md:overflow-visible md:border-b-0 md:bg-transparent md:px-0",
      )}
    >
      {steps.map((step, i) => (
        <a
          key={step.id}
          href={`#${step.id}`}
          aria-current={active === step.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            scrollToSection(step.id);
          }}
          className={cn(
            "group relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            "aria-[current]:bg-muted aria-[current]:text-foreground",
            "md:items-start md:gap-2.5 md:px-2 md:py-2 md:whitespace-normal",
          )}
        >
          {/* The line joining a step to the next, dashed before an optional one. */}
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-7 bottom-[-0.75rem] left-[1rem] hidden border-l md:block",
                steps[i + 1]?.state === "optional" && "border-dashed",
              )}
            />
          )}
          <StepIcon state={step.state} className="md:mt-0.5" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cn("font-medium", step.state === "current" && "text-foreground")}>
              {step.title}
              <span className="sr-only">: {STATE_LABELS[step.state]}</span>
            </span>
            {step.meta && <span className="hidden text-xs leading-snug text-muted-foreground md:block">{step.meta}</span>}
          </span>
        </a>
      ))}
    </nav>
  );
}

function StepSection({ step }: { step: PipelineStep }) {
  const { id, title, meta, actions, content } = step;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-[calc(var(--sticky-top)+3.75rem)] flex-col gap-3 md:scroll-mt-[calc(var(--sticky-top)+1.5rem)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold">
            <StepIcon state={step.state} className="md:hidden" />
            {title}
          </h2>
          {meta && <p className="text-sm text-muted-foreground md:hidden">{meta}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">{content}</CardContent>
      </Card>
    </section>
  );
}
