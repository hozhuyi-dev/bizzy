import { cn } from "cn";
import type { ReactNode } from "react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionBar } from "~/components/shared/actions/action-bar/action-bar.component";
import { Card, CardContent } from "~/components/ui/card";
import { useActiveSection, useCenteredCurrent } from "~/core/scroll-spy/scroll-spy.hook";

export interface PageSection {
  /** Used for the anchor; unique on the page. */
  id: string;
  /**
   * Also the contents label, on one line in a 10rem column: keep it to about
   * 16 characters ("Receipt numbers") so it never truncates.
   */
  title: string;
  description?: ReactNode;
  /** Beside the title, e.g. a section's own Save. */
  actions?: ReadonlyArray<Action> | undefined;
  /**
   * Beside the title on a wide screen, behind ⋯ below lg: the section
   * shares its width with the contents list.
   */
  more?: ReadonlyArray<Action> | undefined;
  content: ReactNode;
  /** Content that brings its own surface (a receipt's paper) skips the card. */
  bare?: boolean;
}

interface PageSectionsProps {
  sections: ReadonlyArray<PageSection>;
  /** Where the contents list sits on wider screens. */
  side?: "left" | "right";
}

/**
 * A long page split into sections, with a contents list to jump between them:
 * a sticky column beside the sections on wider screens, a sticky row of links
 * under the header on phones. The list marks the section being read. Page
 * banners (PageHeader's) stick above, and everything sticky here sits below
 * them, through --sticky-top. One section needs no contents, so it renders on
 * its own.
 */
export function PageSections({ sections, side = "left" }: PageSectionsProps) {
  const [active, jumpTo] = useActiveSection(sections.map((section) => section.id));
  const withContents = sections.length > 1;

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        withContents && "md:grid md:items-start md:gap-10",
        withContents &&
          (side === "left" ? "md:grid-cols-[10rem_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1fr)_10rem]"),
      )}
    >
      {withContents && <Contents sections={sections} active={active} onJump={jumpTo} side={side} />}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-10",
          // Jumping to the last section brings its heading to the top like the others.
          withContents && "fill-last-section",
        )}
      >
        {sections.map((section) => (
          <SectionBlock key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}

function Contents({
  sections,
  active,
  onJump,
  side,
}: {
  sections: ReadonlyArray<PageSection>;
  active: string | undefined;
  onJump: (id: string) => void;
  side: "left" | "right";
}) {
  const ref = useCenteredCurrent<HTMLElement>(active);
  return (
    <nav
      ref={ref}
      aria-label="On this page"
      className={cn(
        // Phones: a sticky, sideways-scrolling row under the headers.
        "sticky top-(--sticky-top) z-(--z-sticky) -mx-(--page-gutter) -mt-(--section-gap) flex h-(--contents-height) items-center gap-1 overflow-x-auto border-b bg-background px-(--page-gutter) scrollbar-none",
        // Wider: a sticky column beside the sections.
        "md:top-[calc(var(--sticky-top)+var(--section-gap))] md:mx-0 md:mt-0 md:h-auto md:flex-col md:items-stretch md:gap-0 md:overflow-visible md:border-b-0 md:border-l md:bg-transparent md:px-0",
        side === "right" && "md:order-last",
      )}
    >
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          aria-current={active === section.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onJump(section.id);
          }}
          className={cn(
            "grid shrink-0 grid-cols-[minmax(0,1fr)] rounded-md px-2.5 py-1 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            "md:-ml-px md:rounded-none md:border-l-2 md:border-transparent md:py-1.5 md:pl-3",
            "aria-[current]:bg-muted aria-[current]:font-medium aria-[current]:text-foreground md:aria-[current]:border-foreground md:aria-[current]:bg-transparent",
          )}
        >
          {/* Sized for the bold label, so marking it current never changes its
              width (the phone row shifting) or its lines (the column jumping).
              One line always; a label too long for the column truncates. */}
          <span aria-hidden="true" className="invisible col-start-1 row-start-1 truncate font-medium">
            {section.title}
          </span>
          <span className="col-start-1 row-start-1 truncate">{section.title}</span>
        </a>
      ))}
    </nav>
  );
}

/**
 * One section: heading and description, then its content on a card. The
 * heading's row is the title's height, so its top is the section's top
 * whatever actions sit beside it, and every title lands in the same place.
 */
function SectionBlock({ section }: { section: PageSection }) {
  const { id, title, description, actions, more, content, bare } = section;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-below-headers flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex h-6 items-center justify-between gap-2">
          <h2 id={`${id}-title`} className="truncate type-section-title">
            {title}
          </h2>
          <ActionBar actions={actions} more={more} size="sm" foldBelow="lg" />
        </div>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {bare ? (
        content
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4">{content}</CardContent>
        </Card>
      )}
    </section>
  );
}
