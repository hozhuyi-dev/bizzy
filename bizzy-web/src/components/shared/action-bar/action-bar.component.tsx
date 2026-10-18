import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import type { LinkOptions } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/**
 * How loud an action is:
 * - primary: filled, the one main job of its bar (Save, Issue, New client).
 * - secondary: outlined, the usual.
 * - quiet: no chrome until hovered, for rows of many (a table's actions).
 * - destructive: red text, for what removes or can't be undone (Delete, Discard).
 */
export type ActionStyle = "primary" | "secondary" | "quiet" | "destructive";

interface ActionCommon {
  /** Short: it sits on a button. Also the accessible name. */
  label: string;
  icon?: LucideIcon | undefined;
  /** Left out, the bar's default: secondary, or quiet in a table row. */
  style?: ActionStyle | undefined;
  disabled?: boolean | undefined;
  /** Only the icon on a phone, for room; the label stays its accessible name. */
  iconOnlyOnPhone?: boolean | undefined;
  /** The icon after the label, for one that points onward (Next to-do →). */
  iconAfter?: boolean | undefined;
}

/** One thing she can do, described rather than built, so any bar can show it. */
export type Action = ActionCommon &
  (
    | { type: "button"; onClick: () => void }
    /** Submits the form with this id, from outside it. */
    | { type: "submit"; form: string }
    /** A page in the app. */
    | { type: "link"; link: LinkOptions }
    /** Opens in a new tab. */
    | { type: "external"; href: string }
    /** On or off; it shows pressed while on. */
    | { type: "toggle"; pressed: boolean; onPressedChange: (pressed: boolean) => void }
  );

export type ActionSize = "default" | "sm" | "xs";

const VARIANTS = {
  primary: "default",
  secondary: "outline",
  quiet: "ghost",
  destructive: "ghost",
} as const satisfies Record<ActionStyle, string>;

interface ActionBarProps {
  /** Always in view. Put the primary one last, nearest the edge. */
  actions?: ReadonlyArray<Action> | undefined;
  /** Before them on wider screens, behind ⋯ on a phone. */
  more?: ReadonlyArray<Action> | undefined;
  size?: ActionSize;
  /** For actions without a style of their own. */
  defaultStyle?: ActionStyle;
  className?: string | undefined;
  /** On every button, e.g. to size them down from a breakpoint. */
  buttonClassName?: string | undefined;
}

/**
 * A row of actions, from their descriptions: page headers, section headings,
 * banners and table rows all lay out and fold the same way. Nothing to do
 * renders nothing.
 */
export function ActionBar({
  actions = [],
  more = [],
  size = "default",
  defaultStyle = "secondary",
  className,
  buttonClassName,
}: ActionBarProps) {
  if (actions.length === 0 && more.length === 0) return null;
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {more.map((action) => (
        <ActionButton
          key={action.label}
          action={action}
          size={size}
          defaultStyle={defaultStyle}
          className={cn("hidden md:inline-flex", buttonClassName)}
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
      {more.length > 0 && <ActionMenu actions={more} size={size} className="md:hidden" />}
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
  const { label, icon: Icon, style = defaultStyle, disabled, iconOnlyOnPhone, iconAfter } = action;
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

function ActionMenuItem({ action }: { action: Action }) {
  const { label, icon: Icon, style, disabled } = action;
  const content = (
    <>
      {Icon && <Icon />} {label}
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
