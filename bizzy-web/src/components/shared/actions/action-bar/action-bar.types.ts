import type { LinkOptions } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { Verdict } from "~/core/lambda/lambda.types";

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
  /**
   * What the API says of it now (a view's `can`): a no disables it and
   * says why. Every action on an entity passes its verdict here, so the web
   * never decides what is allowed.
   */
  can?: Verdict | undefined;
  /** Only the icon on a phone, for room; the label stays its accessible name. */
  iconOnlyOnPhone?: boolean | undefined;
  /** The icon after the label, for one that points onward (Next to-do →). */
  iconAfter?: boolean | undefined;
}

/** One thing the user can do, described rather than built, so any bar can show it. */
export type Action =
  | MenuItemAction
  | (ActionCommon & {
      /**
       * A few ways to do one thing behind one button (WhatsApp ▾: ask to
       * pay, send documents, open the chat), so a bar keeps few buttons.
       * Behind ⋯ they are a group under its label.
       */
      type: "menu";
      actions: ReadonlyArray<MenuItemAction>;
    });

/** An action a menu can hold: any but another menu. */
export type MenuItemAction = ActionCommon &
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

/** lg is the phone's dock, sized for a thumb. */
export type ActionSize = "lg" | "default" | "sm" | "xs";

/** How a bar's ⋯ and menus open: dropdowns, or sheets from the bottom (the phone's dock). */
export type MenuStyle = "dropdown" | "sheet";

/** The width below which a bar's `more` folds behind ⋯ (see ActionBar). */
export type FoldWidth = "md" | "lg";
