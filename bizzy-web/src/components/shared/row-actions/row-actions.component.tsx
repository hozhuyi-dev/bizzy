import { MoreHorizontalIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/** One thing she can do to a table row. */
export interface RowAction {
  /** Short: it sits on a button in a table row. */
  label: string;
  icon: LucideIcon;
  /** Opens in a new tab instead of running onClick. */
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The table's actions column: each action as an icon-and-label button. A row
 * with nothing to do renders nothing.
 */
export function RowActionButtons({ actions }: { actions: Array<RowAction> }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex justify-end">
      {actions.map(({ label, icon: Icon, href, onClick, destructive, disabled }) => (
        <Button
          key={label}
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={destructive ? "text-destructive hover:text-destructive" : undefined}
          {...(href
            ? { render: <a href={href} target="_blank" rel="noreferrer" />, nativeButton: false }
            : { type: "button" as const, onClick })}
        >
          <Icon /> {label}
        </Button>
      ))}
    </div>
  );
}

/** The phone card's version of the actions column: the same actions behind ⋯. */
export function RowActionMenu({ actions }: { actions: Array<RowAction> }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {actions.map(({ label, icon: Icon, href, onClick, destructive, disabled }) => (
          <DropdownMenuItem
            key={label}
            variant={destructive ? "destructive" : "default"}
            disabled={disabled}
            {...(href ? { render: <a href={href} target="_blank" rel="noreferrer" /> } : { onClick })}
          >
            <Icon /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
