import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { LinkOptions, LinkProps } from "@tanstack/react-router";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import { ActionBar } from "~/components/shared/action-bar/action-bar.component";
import { Button } from "~/components/ui/button";
import { useHeight } from "~/core/scroll-spy/scroll-spy.hook";
import { setBannersHeight } from "~/core/scroll-spy/scroll-spy.util";
import { moduleOf } from "~/features/nav-bar/nav-bar.util";

interface Parent {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  search?: LinkOptions["search"];
}

interface PageHeaderProps {
  title: ReactNode;
  /** The list this page sits under, linked before the title as a breadcrumb; with its filter, when it has one. */
  parent?: Parent;
  /** Next to the title: status badges. */
  badges?: ReactNode;
  /**
   * The page's main job (New client, Issue, Save), always in view. Keep it to
   * one button, styled primary, so it fits beside the title on a phone.
   */
  actions?: ReadonlyArray<Action> | undefined;
  /**
   * Steps through the list the page is one of (a ListPager): last, at the
   * edge, so it stays in one place from page to page while the actions
   * before it come and go.
   */
  pager?: ReactNode;
  /** Everything else: buttons on wider screens, behind ⋯ on a phone. */
  moreActions?: ReadonlyArray<Action> | undefined;
  /** The rare ones, behind ⋯ on every screen, so a wide header stays a few buttons. */
  menuActions?: ReadonlyArray<Action> | undefined;
  /**
   * Notices about the whole page (Banners), stacked and kept in view under
   * the header; whatever sticks below (a contents list) sits under them. A
   * banner that renders nothing takes no room.
   */
  banners?: ReactNode;
  /** View tabs and filters, on their own row under the header. */
  toolbar?: ReactNode;
}

/**
 * The top of every page: one row of fixed height with the title on the left
 * and the page's actions on the right, so the title sits in the same place on
 * every page. The title is a breadcrumb: its list for a page inside one (a
 * client, a receipt), or its module for one of a module's several pages
 * ("Documents › Receipts"). Nothing in it wraps: long titles truncate, and extra actions
 * fold into a menu on phones. It sticks under the nav bar (--nav-height) so
 * actions stay in reach on long tables, with the banners under it; the
 * toolbar scrolls with the page.
 */
export function PageHeader({
  title,
  parent,
  badges,
  actions,
  pager,
  moreActions,
  menuActions,
  banners,
  toolbar,
}: PageHeaderProps) {
  const { pathname } = useLocation();
  const module = parent ? undefined : moduleOf(pathname);
  const hasActions = [actions, moreActions, menuActions].some((list) => (list?.length ?? 0) > 0);

  return (
    <>
      <header className="sticky top-(--nav-height) z-20 -mx-4 mb-4 flex h-14 items-center gap-3 border-b bg-background px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {parent && <ParentLink {...parent} />}
          {module && module.pages.length > 1 && <ModuleCrumb label={module.label} />}
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {badges && <div className="flex shrink-0 items-center gap-1">{badges}</div>}
        </div>
        <ActionBar actions={actions} more={moreActions} menu={menuActions} />
        {pager && (
          <div className={cn("flex shrink-0 items-center", hasActions && "border-l pl-1.5")}>{pager}</div>
        )}
      </header>
      {banners && <Banners>{banners}</Banners>}
      {toolbar && <div className="mb-4 flex flex-wrap items-center justify-between gap-2">{toolbar}</div>}
    </>
  );
}

/** The way back: the list's name on wider screens, an arrow on a phone. */
function ParentLink({ to, label, search }: Parent) {
  const link = { to, search } as LinkOptions;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="-ml-1.5 sm:hidden"
        aria-label={`Back to ${label}`}
        render={<Link {...link} />}
        nativeButton={false}
      >
        <ArrowLeftIcon />
      </Button>
      <Link
        {...link}
        className="hidden shrink-0 rounded-md text-lg font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:inline"
      >
        {label}
      </Link>
      <ChevronRightIcon aria-hidden="true" className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
    </>
  );
}

/** The module a page is one of: text, since its pages are in the nav's menu. Hidden on a phone, for room. */
function ModuleCrumb({ label }: { label: string }) {
  return (
    <>
      <span className="hidden shrink-0 text-lg font-semibold text-muted-foreground sm:inline">{label}</span>
      <ChevronRightIcon aria-hidden="true" className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
    </>
  );
}

/**
 * The page's banners, stuck under the header, their height published as
 * --banners-height for what sticks below. Hidden while every banner in it
 * renders nothing. Its own background, so the translucent dark-mode border
 * isn't see-through.
 */
function Banners({ children }: { children: ReactNode }) {
  const [ref, height] = useHeight<HTMLDivElement>();
  useEffect(() => {
    setBannersHeight(height);
    return () => setBannersHeight(undefined);
  }, [height]);
  return (
    <div
      ref={ref}
      className="sticky top-[calc(var(--nav-height)+3.5rem)] z-20 -mx-4 -mt-4 mb-4 flex flex-col divide-y border-b bg-background empty:hidden"
    >
      {children}
    </div>
  );
}
