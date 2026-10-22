import type { LinkProps } from "@tanstack/react-router";

/** A page in a module: in its menu, and the last step of its pages' titles. */
export interface Submodule {
  to: NonNullable<LinkProps["to"]>;
  label: string;
}

/**
 * The app's modules, in the nav bar. A module with more than one page opens
 * a menu of them, and their titles read "Module › Page"; a module with one
 * page is a plain link. Settings sits apart, behind the gear.
 */
export interface Module {
  label: string;
  pages: ReadonlyArray<Submodule>;
}
