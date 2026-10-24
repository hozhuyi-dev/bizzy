import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronDownIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Action, ActionSize, ActionStyle, FoldWidth, MenuItemAction, MenuStyle } from "./action-bar.types";
import { Button } from "~/components/ui/button";
import { HintTooltip } from "~/components/shared/feedback/hint-tooltip/hint-tooltip.component";
import { ActionSheet } from "~/components/shared/actions/action-sheet/action-sheet.component";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

const VARIANTS = {
  primary: "default",
  secondary: "outline",
  quiet: "ghost",
  destructive: "ghost",
} as const satisfies Record<ActionStyle, string>;

interface ActionBarProps {
  /** Always in view. Put the primary one last, nearest the edge. */
  actions?: ReadonlyArray<Action> | undefined;
  /** Before them on wider screens, behind ⋯ on a phone (below `foldBelow`). */
  more?: ReadonlyArray<Action> | undefined;
  /** Behind ⋯ on every screen, after `more`: the rare ones (Reset link, Cancel). */
  menu?: ReadonlyArray<Action> | undefined;
  size?: ActionSize;
  /** For actions without a style of their own. */
  defaultStyle?: ActionStyle;
  className?: string | undefined;
  /** On every button, e.g. to size them down from a breakpoint. */
  buttonClassName?: string | undefined;
  /**
   * The width below which `more` folds behind ⋯: md (a phone) unless said;
   * lg for a bar that shares its row with much else (a header with a pager,
   * a section beside its contents).
   */
  foldBelow?: FoldWidth | undefined;
  /** How ⋯ and menus open: dropdowns, or sheets in the phone's dock. */
  menus?: MenuStyle | undefined;
}

// Whole class names, so Tailwind sees them: `more` shown inline from the
// width, the ⋯ holding it below the width, and the ⋯ of `menu` alone from it.
const FOLDS = {
  md: { inline: "hidden md:inline-flex", folded: "md:hidden", wide: "hidden md:inline-flex" },
  lg: { inline: "hidden lg:inline-flex", folded: "lg:hidden", wide: "hidden lg:inline-flex" },
} as const satisfies Record<FoldWidth, Record<string, string>>;

/**
 * A row of actions, from their descriptions: page headers, section headings,
 * banners and table rows all lay out and fold the same way. Nothing to do
 * renders nothing.
 */
export function ActionBar({
  actions = [],
  more = [],
  menu = [],
  size = "default",
  defaultStyle = "secondary",
  className,
  buttonClassName,
  foldBelow = "md",
  menus = "dropdown",
}: ActionBarProps) {
  if (actions.length === 0 && more.length === 0 && menu.length === 0) return null;
  const fold = FOLDS[foldBelow];
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {more.map((action) => (
        <ActionButton
          key={action.label}
          action={action}
          size={size}
          defaultStyle={defaultStyle}
          className={cn(fold.inline, buttonClassName)}
          menus={menus}
        />
      ))}
      {actions.map((action) => (
        <ActionButton
          key={action.label}
          action={action}
          size={size}
          defaultStyle={defaultStyle}
          className={buttonClassName}
          menus={menus}
        />
      ))}
      {/* One ⋯ either way: with `more` in it on a phone, without on wider screens. */}
      <ActionMenu actions={[...more, ...menu]} size={size} className={fold.folded} menus={menus} />
      <ActionMenu actions={menu} size={size} className={fold.wide} menus={menus} />
    </div>
  );
}

interface ActionButtonProps {
  action: Action;
  size?: ActionSize;
  defaultStyle?: ActionStyle;
  className?: string | undefined;
  menus?: MenuStyle | undefined;
}

/** One action as a button; one its verdict says no to says why in a tooltip. */
export function ActionButton(props: ActionButtonProps) {
  const { action } = props;
  const why = action.can?.ok === false ? action.can.why : undefined;
  // A menu that can't open is only its button.
  const button = why && action.type === "menu" ? <PlainButton {...props} /> : <ActionButtonOnly {...props} />;
  return <HintTooltip hint={why}>{button}</HintTooltip>;
}

/** A disabled menu's button: nothing to open, but its tooltip still says why. */
function PlainButton(props: ActionButtonProps) {
  return <ActionButtonOnly {...props} action={{ ...props.action, type: "button", onClick: () => undefined }} />;
}

function ActionButtonOnly({
  action,
  size = "default",
  defaultStyle = "secondary",
  className,
  menus = "dropdown",
  ...rest
}: ActionButtonProps) {
  const { label, icon: Icon, style = defaultStyle, iconOnlyOnPhone, iconAfter } = action;
  const disabled = isDisabled(action);
  const why = action.can?.ok === false;
  const content = (
    <>
      {Icon && !iconAfter && <Icon />}
      {iconOnlyOnPhone && Icon ? <span className="hidden sm:inline">{label}</span> : label}
      {Icon && iconAfter && <Icon />}
    </>
  );
  const common = {
    // A tooltip's trigger props, when one says why.
    ...rest,
    variant: VARIANTS[style],
    size,
    disabled,
    // Hovered and focused still, so its tooltip says why; dimmed as a disabled one.
    focusableWhenDisabled: why,
    "aria-label": iconOnlyOnPhone && Icon ? label : undefined,
    className: cn(
      style === "destructive" && "text-destructive hover:text-destructive",
      action.type === "toggle" && "aria-pressed:bg-muted aria-pressed:text-foreground",
      why && "data-disabled:cursor-not-allowed data-disabled:opacity-50",
      className,
    ),
  };

  switch (action.type) {
    case "button":
      return (
        <Button type="button" onClick={action.onClick} {...common}>
          {content}
        </Button>
      );
    case "submit":
      return (
        <Button type="submit" form={action.form} {...common}>
          {content}
        </Button>
      );
    case "link":
      return (
        <Button render={<Link {...action.link} />} nativeButton={false} {...common}>
          {content}
        </Button>
      );
    case "external":
      return (
        <Button render={<a href={action.href} target="_blank" rel="noreferrer" />} nativeButton={false} {...common}>
          {content}
        </Button>
      );
    case "toggle":
      return (
        <Button
          type="button"
          aria-pressed={action.pressed}
          onClick={() => action.onPressedChange(!action.pressed)}
          {...common}
        >
          {content}
        </Button>
      );
    case "menu":
      if (menus === "sheet") {
        return (
          <SheetTrigger title={action.heading ?? label} actions={action.actions}>
            {(open) => (
              <Button type="button" onClick={open} {...common}>
                {content}
                <ChevronDownIcon />
              </Button>
            )}
          </SheetTrigger>
        );
      }
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button {...common} />}>
            {content}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuGroup>
              {action.heading && <DropdownMenuLabel>{action.heading}</DropdownMenuLabel>}
              {action.actions.map((item) => (
                <ActionMenuItem key={item.label} action={item} />
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
  }
}

interface SheetTriggerProps {
  title: string;
  hideTitle?: boolean;
  actions: ReadonlyArray<Action>;
  /** The button, given what opens the sheet. */
  children: (open: () => void) => ReactNode;
}

/** A button opening its actions as a sheet from the bottom. */
function SheetTrigger({ title, hideTitle, actions, children }: SheetTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      <ActionSheet open={open} onClose={() => setOpen(false)} title={title} hideTitle={hideTitle} actions={actions} />
    </>
  );
}

interface ActionMenuProps {
  actions: ReadonlyArray<Action>;
  size?: ActionSize;
  className?: string | undefined;
  menus?: MenuStyle | undefined;
}

const ICON_SIZES = { lg: "icon-lg", default: "icon", sm: "icon-sm", xs: "icon-xs" } as const satisfies Record<
  ActionSize,
  string
>;

/** The same actions behind ⋯: a toggle ticks, a destructive one is red, a menu is a group under its label. */
export function ActionMenu({ actions, size = "default", className, menus = "dropdown" }: ActionMenuProps) {
  if (actions.length === 0) return null;
  if (menus === "sheet") {
    return (
      <SheetTrigger title="More actions" hideTitle actions={actions}>
        {(open) => (
          <Button variant="ghost" size={ICON_SIZES[size]} aria-label="More actions" className={className} onClick={open}>
            <MoreHorizontalIcon />
          </Button>
        )}
      </SheetTrigger>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size={ICON_SIZES[size]} aria-label="More actions" className={className} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {actions.map((action, i) =>
          action.type === "menu" ? (
            <DropdownMenuGroup key={action.label}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{action.heading ?? action.label}</DropdownMenuLabel>
              {action.actions.map((item) => (
                <ActionMenuItem key={item.label} action={item} />
              ))}
              {i < actions.length - 1 && <DropdownMenuSeparator />}
            </DropdownMenuGroup>
          ) : (
            <ActionMenuItem key={action.label} action={action} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Whether an action can't be taken now: disabled by its caller, or its verdict says no. */
function isDisabled(action: Action): boolean {
  return Boolean(action.disabled) || action.can?.ok === false;
}

function ActionMenuItem({ action }: { action: MenuItemAction }) {
  const { label, icon: Icon, style } = action;
  const disabled = isDisabled(action);
  // Said under it, as a phone shows no tooltip.
  const why = action.can?.ok === false ? action.can.why : undefined;
  const content = (
    <>
      {Icon && <Icon />}{" "}
      {why ? (
        <span className="flex flex-col">
          <span>{label}</span>
          <span className="max-w-64 text-xs text-muted-foreground">{why}</span>
        </span>
      ) : (
        label
      )}
    </>
  );
  const common = { variant: style === "destructive" ? "destructive" : "default", disabled } as const;

  switch (action.type) {
    case "button":
      return (
        <DropdownMenuItem onClick={action.onClick} {...common}>
          {content}
        </DropdownMenuItem>
      );
    case "submit":
      return (
        <DropdownMenuItem
          onClick={() => (document.getElementById(action.form) as HTMLFormElement | null)?.requestSubmit()}
          {...common}
        >
          {content}
        </DropdownMenuItem>
      );
    case "link":
      return (
        <DropdownMenuItem render={<Link {...action.link} />} {...common}>
          {content}
        </DropdownMenuItem>
      );
    case "external":
      return (
        <DropdownMenuItem render={<a href={action.href} target="_blank" rel="noreferrer" />} {...common}>
          {content}
        </DropdownMenuItem>
      );
    case "toggle":
      return (
        <DropdownMenuCheckboxItem checked={action.pressed} onCheckedChange={action.onPressedChange} disabled={disabled}>
          {content}
        </DropdownMenuCheckboxItem>
      );
  }
}
