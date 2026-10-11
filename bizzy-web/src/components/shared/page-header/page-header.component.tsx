import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkProps } from "@tanstack/react-router";

interface PageHeaderProps {
  title: ReactNode;
  /** Shown above the title, e.g. <BackLink to="/receipts">Receipts</BackLink>. */
  back?: ReactNode;
  /** Next to the title: status badges. */
  badges?: ReactNode;
  /** The page's buttons, on the title row. */
  actions?: ReactNode;
  /** A second row for view tabs and filters. */
  toolbar?: ReactNode;
}

/**
 * The top of every page: title and the page's actions on one row, view
 * switches below. It sticks under the nav bar (h-12) so actions stay in
 * reach on long tables.
 */
export function PageHeader({ title, back, badges, actions, toolbar }: PageHeaderProps) {
  return (
    <div className="sticky top-12 z-20 -mx-4 mb-4 flex flex-col gap-3 border-b bg-background px-4 py-3">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          {badges}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {toolbar && <div className="flex flex-wrap items-center justify-between gap-2">{toolbar}</div>}
    </div>
  );
}

export function BackLink({ to, children }: { to: NonNullable<LinkProps["to"]>; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" /> {children}
    </Link>
  );
}
