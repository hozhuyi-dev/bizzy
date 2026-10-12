import { Link, useLocation } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkProps } from "@tanstack/react-router";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Button } from "~/components/ui/button";
import { moduleOf } from "~/features/nav-bar/modules";

interface PageHeaderProps {
  title: ReactNode;
  /** The list this page sits under, linked before the title as a breadcrumb. */
  parent?: { to: NonNullable<LinkProps["to"]>; label: string };
  /** Next to the title: status badges. */
  badges?: ReactNode;
  /**
   * The page's main job (New client, Issue, Save), always in view. Keep it to
   * one button so it fits beside the title on a phone.
   */
  actions?: ReactNode;
  /** Everything else: buttons on wider screens, behind ⋯ on a phone. */
  moreActions?: Array<RowAction> | undefined;
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
 * actions stay in reach on long tables; the toolbar scrolls with the page.
 */
export function PageHeader({ title, parent, badges, actions, moreActions, toolbar }: PageHeaderProps) {
  const more = moreActions ?? [];
  const { pathname } = useLocation();
  const module = parent ? undefined : moduleOf(pathname);

  return (
    <>
      <header className="sticky top-(--nav-height) z-20 -mx-4 mb-4 flex h-14 items-center gap-3 border-b bg-background px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {parent && <ParentLink {...parent} />}
          {module && module.pages.length > 1 && <ModuleCrumb label={module.label} />}
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {badges && <div className="flex shrink-0 items-center gap-1">{badges}</div>}
        </div>
        {(actions || more.length > 0) && (
          <div className="flex shrink-0 items-center gap-2">
            {more.length > 0 && (
              <div className="hidden items-center gap-2 md:flex">
                {more.map((action) => (
                  <HeaderButton key={action.label} action={action} />
                ))}
              </div>
            )}
            {actions}
            <div className="md:hidden">
              <RowActionMenu actions={more} />
            </div>
          </div>
        )}
      </header>
      {toolbar && <div className="mb-4 flex flex-wrap items-center justify-between gap-2">{toolbar}</div>}
    </>
  );
}

/** The way back: the list's name on wider screens, an arrow on a phone. */
function ParentLink({ to, label }: { to: NonNullable<LinkProps["to"]>; label: string }) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="-ml-1.5 sm:hidden"
        aria-label={`Back to ${label}`}
        render={<Link to={to} />}
        nativeButton={false}
      >
        <ArrowLeftIcon />
      </Button>
      <Link
        to={to}
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

function HeaderButton({ action }: { action: RowAction }) {
  const { label, icon: Icon, href, onClick, destructive, disabled } = action;
  return (
    <Button
      variant={destructive ? "ghost" : "outline"}
      className={destructive ? "text-destructive hover:text-destructive" : undefined}
      disabled={disabled}
      {...(href
        ? { render: <a href={href} target="_blank" rel="noreferrer" />, nativeButton: false }
        : { type: "button" as const, onClick })}
    >
      <Icon /> {label}
    </Button>
  );
}
