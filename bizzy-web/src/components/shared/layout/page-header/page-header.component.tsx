import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { DockContext, useAppBanner, useCompactLayout, usePageSlots } from "./page-header.hook";
import type { MouseEvent, ReactNode } from "react";
import type { LinkOptions, LinkProps } from "@tanstack/react-router";
import type { Action, FoldWidth } from "~/components/shared/actions/action-bar/action-bar.types";
import type { Module } from "~/core/navigation/navigation.types";
import { ActionBar } from "~/components/shared/actions/action-bar/action-bar.component";
import { Button } from "~/components/ui/button";
import { useHeight } from "~/core/scroll-spy/scroll-spy.hook";
import { setBannersHeight } from "~/core/scroll-spy/scroll-spy.util";
import { moduleOf } from "~/core/navigation/navigation.util";

/**
 * The list the page steps through, or the page holding it (Home's to-do
 * list, a session's documents): the breadcrumb on a wide screen, linked
 * with its filter. A phone's ← goes back instead, as the browser's Back
 * does, to wherever the page was opened from; to this only when there is
 * nowhere to go back to, as when opened from outside the app.
 */
export interface Parent {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  search?: LinkOptions["search"];
  params?: LinkOptions["params"];
}

interface PageHeaderProps {
  /** The broader of what the page is about: a session's client, a list's name. */
  title: ReactNode;
  /** Where the title is the name of something with a page of its own (a session's client): opens it. */
  titleLink?: LinkOptions | undefined;
  /** What the page is, for one of an item: "Session", "Invoice", "New package". */
  kind?: string | undefined;
  /**
   * What narrows it down: the item's day or number, a list's preset. After
   * the kind, on the line under the title on a phone ("Session · Tue 5
   * Oct") and after the title on a wide screen.
   */
  subtitle?: ReactNode;
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
   * before it come and go. First in a phone's dock, at its other edge.
   */
  pager?: ReactNode;
  /** Everything else: buttons on wider screens, behind ⋯ on a phone. */
  moreActions?: ReadonlyArray<Action> | undefined;
  /** The rare ones, behind ⋯ on every screen, so a wide header stays a few buttons. */
  menuActions?: ReadonlyArray<Action> | undefined;
  /** Where moreActions fold behind ⋯: below md unless a header has many (see ActionBar). */
  foldBelow?: FoldWidth | undefined;
  /**
   * Notices about the whole page (Banners), stacked and kept in view under
   * the header; whatever sticks below (a contents list) sits under them. A
   * banner that renders nothing takes no room. The app's own banner (see
   * AppBannerContext) comes first, on every page.
   */
  banners?: ReactNode;
  /**
   * View tabs and filters, on their own row under the header; at the dock's
   * left edge on a phone, where a FilterBar or SearchInput lays itself out
   * for it (see DockContext).
   */
  toolbar?: ReactNode;
}

/**
 * The top of every page: one row of fixed height with the title on the left
 * and the page's actions on the right, so the title sits in the same place on
 * every page. The title is a breadcrumb: its list for a page inside one (a
 * client, a receipt), or its module for one of a module's several pages
 * ("Documents › Receipts"). Nothing in it wraps: long titles truncate. It
 * sticks under the nav bar (--nav-height) so actions stay in reach on long
 * tables, with the banners under it; the toolbar scrolls with the page.
 *
 * Every page says the same two things, the broader first: what it is about
 * (the title: a client, a list), then what it is and what narrows it down
 * (kind and subtitle: "Invoice · INV260042-00", a list's preset). A phone
 * has no room for that row: the title goes into the nav bar, always on two
 * lines, so it sits in one place on every page, and the way back, the pager
 * and the actions into the dock at the bottom, within a thumb's reach (see
 * PageSlots). Pages say the same either way.
 */
export function PageHeader(props: PageHeaderProps) {
  const { banners, toolbar } = props;
  const { pathname } = useLocation();
  const module = props.parent ? undefined : moduleOf(pathname);
  const appBanner = useAppBanner();
  const compact = useCompactLayout();

  return (
    <>
      {compact ? <CompactHeader {...props} module={module} /> : <WideHeader {...props} module={module} />}
      {(appBanner || banners) && (
        <Banners>
          {appBanner}
          {banners}
        </Banners>
      )}
      {toolbar && !compact && (
        <div className="mb-(--section-gap) flex flex-wrap items-center justify-between gap-2">{toolbar}</div>
      )}
    </>
  );
}

type HeaderProps = PageHeaderProps & { module: Module | undefined };

/** Kind and subtitle, "Session · Tue 5 Oct": the line under a phone's title, after a wide one's. */
function Aside({ kind, subtitle }: Pick<PageHeaderProps, "kind" | "subtitle">) {
  return (
    <>
      {kind}
      {kind && subtitle ? " · " : null}
      {subtitle}
    </>
  );
}

function WideHeader({
  title,
  titleLink,
  kind,
  subtitle,
  parent,
  module,
  badges,
  actions,
  pager,
  moreActions,
  menuActions,
  foldBelow,
}: HeaderProps) {
  const { setActions } = usePageSlots();
  const hasActions = [actions, moreActions, menuActions].some((list) => (list?.length ?? 0) > 0);
  // Nothing the breadcrumb says already: a module named as its page ("Clients ›
  // Clients"), a title that is the parent ("Aisyah › Aisyah"), a kind its list
  // names ("Sessions › Aisyah · Session").
  const moduleCrumb = module && module.pages.length > 1 && module.label !== title ? module.label : undefined;
  const crumb = parent?.label ?? moduleCrumb;
  const shownTitle = crumb !== undefined && title === crumb ? undefined : title;
  const shownKind = kind && crumb?.toLowerCase().startsWith(kind.toLowerCase()) ? undefined : kind;
  const aside = (shownKind || subtitle) && <Aside kind={shownKind} subtitle={subtitle} />;
  return (
    <header className="group/header sticky top-(--nav-height) z-(--z-header) -mx-(--page-gutter) mb-(--section-gap) flex h-(--page-header-height) items-center gap-3 border-b bg-background px-(--page-gutter)">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {parent && <ParentLink {...parent} />}
        {moduleCrumb && <ModuleCrumb label={moduleCrumb} />}
        <h1 className="truncate type-page-title">
          {shownTitle === undefined ? (
            aside
          ) : (
            <>
              {titleLink ? (
                <Link
                  {...titleLink}
                  className="rounded-md underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {shownTitle}
                </Link>
              ) : (
                shownTitle
              )}
              {aside && <span className="font-normal text-muted-foreground"> · {aside}</span>}
            </>
          )}
        </h1>
        {badges && <div className="flex shrink-0 items-center gap-1">{badges}</div>}
      </div>
      {/* What is ticked on the page takes the actions' place while any is (SelectionBar). */}
      <div ref={setActions} className="flex min-w-0 shrink items-center empty:hidden" />
      <ActionBar
        actions={actions}
        more={moreActions}
        menu={menuActions}
        foldBelow={foldBelow}
        className="group-has-data-selecting/header:hidden"
      />
      {pager && (
        <div
          className={cn(
            "flex shrink-0 items-center group-has-data-selecting/header:hidden",
            hasActions && "border-l pl-1.5",
          )}
        >
          {pager}
        </div>
      )}
    </header>
  );
}

/**
 * The header's parts on a phone, wherever those are on screen. The nav bar
 * holds only the title, so it starts in one place on every page, after the
 * bee. The dock holds the rest: at its left edge, ways around the list (back
 * to the one the page is in, then the pager; or a list's own filter, the
 * toolbar); at its right, the actions, which give way to a search being typed.
 */
function CompactHeader({
  title,
  titleLink,
  kind,
  subtitle,
  parent,
  module,
  badges,
  actions,
  pager,
  moreActions,
  menuActions,
  toolbar,
}: HeaderProps) {
  const slots = usePageSlots();
  const dock = dockActions(actions, moreActions);
  const hasActions = [actions, moreActions, menuActions].some((list) => (list?.length ?? 0) > 0);
  // Under the title: what it is and what narrows it down, else where it sits.
  const fallback = parent?.label ?? (module && module.pages.length > 1 ? module.label : undefined);

  return (
    <>
      {slots.title &&
        createPortal(
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              {titleLink ? (
                // A › says it opens, as a phone shows no hover.
                <h1 className="min-w-0 type-bar-title">
                  <Link
                    {...titleLink}
                    className="flex min-w-0 items-center gap-0.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="truncate">{title}</span>
                    <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </h1>
              ) : (
                <h1 className="truncate type-bar-title">{title}</h1>
              )}
              {badges && <div className="flex shrink-0 items-center gap-1">{badges}</div>}
            </div>
            {/* Always there, if only empty, so the title sits in one place on every page. */}
            <p className="truncate text-xs text-muted-foreground">
              {kind || subtitle ? <Aside kind={kind} subtitle={subtitle} /> : (fallback ?? " ")}
            </p>
          </>,
          slots.title,
        )}
      {slots.dock &&
        (hasActions || pager || parent || toolbar) &&
        createPortal(
          <>
            {(parent || pager || toolbar) && (
              <div
                data-dock-start=""
                className="flex min-w-0 flex-1 items-center gap-0.5 group-has-data-selecting/dock:hidden"
              >
                {parent && <BackButton {...parent} />}
                {parent && pager && <div aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />}
                {pager}
                {toolbar && <DockContext value>{toolbar}</DockContext>}
              </div>
            )}
            <ActionBar
              actions={dock.actions}
              more={dock.more}
              menu={menuActions}
              size="lg"
              menus="sheet"
              // A search being typed, or a SelectionBar, takes the dock over. dock-actions:
              // a SelectionHint keeps out of the way of these.
              className="dock-actions ml-auto gap-1 group-has-data-searching/dock:hidden group-has-data-selecting/dock:hidden"
            />
          </>,
          slots.dock,
        )}
    </>
  );
}

/**
 * The header's actions as the dock shows them, each with its label: the dock
 * has the room the header's row lacked. With no main one (an issued receipt,
 * a session), the first of the frequent ones takes its place (WhatsApp ▾),
 * so the dock isn't only ⋯ while a frequent action hides behind it.
 */
function dockActions(
  actions: ReadonlyArray<Action> = [],
  more: ReadonlyArray<Action> = [],
): { actions: ReadonlyArray<Action>; more: ReadonlyArray<Action> } {
  if (actions.length > 0) return { actions: actions.map((action) => ({ ...action, iconOnlyOnPhone: false })), more };
  const [first, ...rest] = more;
  // One it can't take now stays behind ⋯, where a phone can read why.
  if (!first?.icon || first.disabled || first.can?.ok === false) return { actions, more };
  return { actions: [{ ...first, iconOnlyOnPhone: false }], more: rest };
}

/** The list the page steps through, by name before the title on wider screens. */
function ParentLink({ to, label, search, params }: Parent) {
  return (
    <>
      <Link
        {...({ to, search, params } as LinkOptions)}
        className="shrink-0 rounded-md type-page-title text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {label}
      </Link>
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
}

/**
 * A phone's way back, at the dock's left edge: the browser's Back, to the
 * page it was opened from, found as it was left. Opened from outside the
 * app, there is none: the parent's link.
 */
function BackButton({ to, label, search, params }: Parent) {
  const router = useRouter();
  const onClick = (event: MouseEvent) => {
    if (!router.history.canGoBack()) return;
    event.preventDefault();
    router.history.back();
  };
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="shrink-0"
      aria-label="Back"
      title={router.history.canGoBack() ? "Back" : `Back to ${label}`}
      render={<Link {...({ to, search, params } as LinkOptions)} onClick={onClick} />}
      nativeButton={false}
    >
      <ArrowLeftIcon />
    </Button>
  );
}

/** The module a page is one of: text, since its pages are in the nav's menu. */
function ModuleCrumb({ label }: { label: string }) {
  return (
    <>
      <span className="shrink-0 type-page-title text-muted-foreground">{label}</span>
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
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
      className="sticky top-[calc(var(--nav-height)+var(--page-header-height))] z-(--z-header) -mx-(--page-gutter) -mt-(--section-gap) mb-(--section-gap) flex flex-col divide-y border-b bg-background empty:hidden"
    >
      {children}
    </div>
  );
}
