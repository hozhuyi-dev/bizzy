import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import type { Action, ActionSize, ActionStyle, FoldWidth } from "./action-bar.types";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
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
        />
      ))}
      {actions.map((action) => (
        <ActionButton
          key={action.label}
          action={action}
          size={size}
          defaultStyle={defaultStyle}
          className={buttonClassName}
        />
      ))}
      {/* One ⋯ either way: with `more` in it on a phone, without on wider screens. */}
      <ActionMenu actions={[...more, ...menu]} size={size} className={fold.folded} />
      <ActionMenu actions={menu} size={size} className={fold.wide} />
    </div>
  );
}

interface ActionButtonProps {
  action: Action;
  size?: ActionSize;
  defaultStyle?: ActionStyle;
  className?: string | undefined;
}

/** One action as a button. */
export function ActionButton({ action, size = "default", defaultStyle = "secondary", className }: ActionButtonProps) {
  const { label, icon: Icon, style = defaultStyle, iconOnlyOnPhone, iconAfter } = action;
  const disabled = isDisabled(action);
  const content = (
    <>
      {Icon && !iconAfter && <Icon />}
      {iconOnlyOnPhone && Icon ? <span className="hidden sm:inline">{label}</span> : label}
      {Icon && iconAfter && <Icon />}
    </>
  );
  const common = {
    variant: VARIANTS[style],
    size,
    disabled,
    title: action.can?.why,
    "aria-label": iconOnlyOnPhone && Icon ? label : undefined,
    className: cn(
      style === "destructive" && "text-destructive hover:text-destructive",
      action.type === "toggle" && "aria-pressed:bg-muted aria-pressed:text-foreground",
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
  }
}

interface ActionMenuProps {
  actions: ReadonlyArray<Action>;
  size?: ActionSize;
  className?: string | undefined;
}

const ICON_SIZES = { default: "icon", sm: "icon-sm", xs: "icon-xs" } as const satisfies Record<ActionSize, string>;

/** The same actions behind ⋯: a toggle ticks, a destructive one is red. */
export function ActionMenu({ actions, size = "default", className }: ActionMenuProps) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size={ICON_SIZES[size]} aria-label="More actions" className={className} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {actions.map((action) => (
          <ActionMenuItem key={action.label} action={action} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Whether an action can't be taken now: disabled by its caller, or its verdict says no. */
function isDisabled(action: Action): boolean {
  return Boolean(action.disabled) || action.can?.ok === false;
}

function ActionMenuItem({ action }: { action: Action }) {
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
