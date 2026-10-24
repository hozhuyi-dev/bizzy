import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Action, MenuItemAction } from "~/components/shared/actions/action-bar/action-bar.types";
import { DrawerDialog } from "~/components/shared/dialog/drawer-dialog/drawer-dialog.component";
import {
  DRAWER_LABEL,
  DRAWER_ROW,
  DRAWER_SEPARATOR,
} from "~/components/shared/dialog/drawer-dialog/drawer-dialog.constant";

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the sheet holds: a menu's label (WhatsApp), or said only to a screen reader (More actions). */
  title: string;
  hideTitle?: boolean | undefined;
  actions: ReadonlyArray<Action>;
}

/**
 * A menu of actions as a sheet from the bottom, for the phone's dock: the
 * same actions as ActionMenu, as rows for a thumb. A menu is a group under
 * its label; one its verdict says no to is dimmed, with why under it.
 */
export function ActionSheet({ open, onClose, title, hideTitle, actions }: ActionSheetProps) {
  return (
    <DrawerDialog open={open} onClose={onClose} side="bottom" title={title} hideTitle={hideTitle}>
      {actions.map((action, i) =>
        action.type === "menu" ? (
          <div key={action.label} role="group" aria-label={action.label} className="flex flex-col">
            {i > 0 && <div className={DRAWER_SEPARATOR} />}
            <p aria-hidden="true" className={DRAWER_LABEL}>
              {action.label}
            </p>
            {action.actions.map((item) => (
              <ActionSheetItem key={item.label} action={item} onDone={onClose} />
            ))}
            {i < actions.length - 1 && <div className={DRAWER_SEPARATOR} />}
          </div>
        ) : (
          <ActionSheetItem key={action.label} action={action} onDone={onClose} />
        ),
      )}
    </DrawerDialog>
  );
}

/** One action as a row; taking it closes the sheet first, so a dialog it opens comes up alone. */
function ActionSheetItem({ action, onDone }: { action: MenuItemAction; onDone: () => void }) {
  const { label, icon: Icon, style } = action;
  const why = action.can?.ok === false ? action.can.why : undefined;
  const disabled = Boolean(action.disabled) || Boolean(why);
  const className = cn(DRAWER_ROW, style === "destructive" && "text-destructive");
  const content: ReactNode = (
    <>
      {Icon ? <Icon className={style === "destructive" ? undefined : "text-muted-foreground"} /> : <span className="size-4" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {why && <span className="text-xs text-muted-foreground">{why}</span>}
      </span>
      {action.type === "toggle" && action.pressed && <CheckIcon />}
    </>
  );

  switch (action.type) {
    case "button":
      return (
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={() => {
            onDone();
            action.onClick();
          }}
        >
          {content}
        </button>
      );
    case "submit":
      return (
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={() => {
            onDone();
            (document.getElementById(action.form) as HTMLFormElement | null)?.requestSubmit();
          }}
        >
          {content}
        </button>
      );
    case "toggle":
      return (
        <button
          type="button"
          aria-pressed={action.pressed}
          className={className}
          disabled={disabled}
          onClick={() => {
            onDone();
            action.onPressedChange(!action.pressed);
          }}
        >
          {content}
        </button>
      );
    case "link":
      return disabled ? (
        <button type="button" className={className} disabled>
          {content}
        </button>
      ) : (
        <Link {...action.link} className={className} onClick={onDone}>
          {content}
        </Link>
      );
    case "external":
      return disabled ? (
        <button type="button" className={className} disabled>
          {content}
        </button>
      ) : (
        <a href={action.href} target="_blank" rel="noreferrer" className={className} onClick={onDone}>
          {content}
        </a>
      );
  }
}
