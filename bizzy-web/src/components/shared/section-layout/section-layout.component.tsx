import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { CSSProperties, ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";

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
  actions?: ReactNode;
  content: ReactNode;
  /** Content that brings its own surface (a receipt's paper) skips the card. */
  bare?: boolean;
}

interface SectionLayoutProps {
  sections: ReadonlyArray<PageSection>;
  /**
   * Notices about the whole page (one or more Banners), kept in view under
   * the page header; the contents list sticks below them.
   */
  banner?: ReactNode;
  /** Where the contents list sits on wider screens. */
  side?: "left" | "right";
}

// The nav bar (h-12) and the page header (h-14) stick above everything here.
const HEADERS = 104;
// Air between the stuck headers and a section heading scrolled to.
const DESKTOP_GAP = 24;
// Phones also have the sticky row of section links (h-11), plus air.
const PHONE_GAP = 44 + 16;

/**
 * A long page split into sections, with a contents list to jump between them:
 * a sticky column beside the sections on wider screens, a sticky row of links
 * under the header on phones. The list marks the section being read. An
 * optional banner sticks under the page header, and everything sticky here
 * sits below it. One section needs no contents, so it renders on its own.
 */
export function SectionLayout({ sections, banner, side = "left" }: SectionLayoutProps) {
  const [bannerRef, bannerHeight] = useHeight<HTMLDivElement>();
  const stickyTop = HEADERS + (banner ? bannerHeight : 0);
  const active = useActiveSection(sections, stickyTop);
  // Read by the sticky and scroll-margin classes below.
  const style = { "--sticky-top": `${stickyTop}px` } as CSSProperties;
  const withContents = sections.length > 1;

  return (
    <div style={style}>
      {banner && (
        // Its own background, so the translucent dark-mode border isn't see-through.
        <div ref={bannerRef} className="sticky top-26 z-20 -mx-4 -mt-4 mb-4 flex flex-col border-b bg-background">
          {banner}
        </div>
      )}
      <div
        className={cn(
          "flex flex-col gap-4",
          withContents && "md:grid md:items-start md:gap-10",
          withContents &&
            (side === "left" ? "md:grid-cols-[10rem_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1fr)_10rem]"),
        )}
      >
        {withContents && <Contents sections={sections} active={active} side={side} />}
        <div
          className={cn(
            "flex min-w-0 flex-col gap-10",
            // The last section is at least a screen tall (less the sticky bars),
            // so jumping to it brings its heading to the top like the others.
            withContents &&
              "*:last:min-h-[calc(100dvh-var(--sticky-top)-3.75rem)] md:*:last:min-h-[calc(100dvh-var(--sticky-top)-1.5rem)]",
          )}
        >
          {sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Contents({
  sections,
  active,
  side,
}: {
  sections: ReadonlyArray<PageSection>;
  active: string | undefined;
  side: "left" | "right";
}) {
  return (
    <nav
      aria-label="On this page"
      className={cn(
        // Phones: a sticky, sideways-scrolling row under the headers.
        "sticky top-(--sticky-top) z-10 -mx-4 -mt-4 flex h-11 items-center gap-1 overflow-x-auto border-b bg-background px-4 scrollbar-none",
        // Wider: a sticky column beside the sections.
        "md:top-[calc(var(--sticky-top)+1.5rem)] md:mx-0 md:mt-0 md:h-auto md:flex-col md:items-stretch md:gap-0 md:overflow-visible md:border-b-0 md:border-l md:bg-transparent md:px-0",
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
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document.getElementById(section.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
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

/** One section: heading and description, then its content on a card. */
function SectionBlock({ section }: { section: PageSection }) {
  const { id, title, description, actions, content, bare } = section;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-[calc(var(--sticky-top)+3.75rem)] flex-col gap-3 md:scroll-mt-[calc(var(--sticky-top)+1.5rem)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
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

/** An element's height, kept current as its content changes. */
function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    // Rounded down: a fractional height (high-density phones) would otherwise
    // leave a sliver between the banner and what sticks below it, and content
    // would show through. Tucking under by a fraction is invisible.
    const observer = new ResizeObserver(() => setHeight(Math.floor(element.getBoundingClientRect().height)));
    observer.observe(element);
    return () => observer.disconnect();
  });
  return [ref, height] as const;
}

/**
 * The section being read: the last whose top has passed under the sticky
 * bars, or the last section once the page is scrolled to the bottom (a short
 * last section never reaches the top).
 */
function useActiveSection(sections: ReadonlyArray<PageSection>, stickyTop: number): string | undefined {
  const [active, setActive] = useState(sections[0]?.id);
  const ids = sections.map((section) => section.id).join(" ");

  useEffect(() => {
    const list = ids.split(" ");
    // A handful of sections: measuring on every scroll event is cheap.
    const update = () => {
      const offset = stickyTop + (window.matchMedia("(min-width: 48rem)").matches ? DESKTOP_GAP : PHONE_GAP);
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = list[0];
      for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top - offset <= 8) current = id;
      }
      setActive(atBottom ? list.at(-1) : current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ids, stickyTop]);

  return active;
}
