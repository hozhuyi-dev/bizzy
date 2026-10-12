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

export const MODULES: ReadonlyArray<Module> = [
  { label: "Home", pages: [{ to: "/", label: "Home" }] },
  {
    label: "Sessions",
    pages: [
      { to: "/sessions", label: "All sessions" },
      { to: "/sessions/deleted", label: "Deleted" },
    ],
  },
  {
    label: "Follow-ups",
    pages: [
      { to: "/follow-ups", label: "Upcoming" },
      { to: "/follow-ups/done", label: "Done" },
    ],
  },
  {
    label: "Clients",
    pages: [
      { to: "/clients", label: "All clients" },
      { to: "/clients/reconnect", label: "Reconnect" },
      { to: "/packages", label: "Packages" },
    ],
  },
  {
    label: "Documents",
    pages: [
      { to: "/invoices", label: "Invoices" },
      { to: "/receipts", label: "Receipts" },
    ],
  },
  { label: "Insights", pages: [{ to: "/insights", label: "Insights" }] },
];

/** Settings is no module in the bar (it sits behind the gear) but is matched like one. */
export const SETTINGS: Module = { label: "Settings", pages: [{ to: "/settings", label: "Settings" }] };

function trim(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function within(path: string, to: string): boolean {
  return to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
}

/** The module a path belongs to: one of its pages, or a page under one (a client, a receipt). */
export function moduleOf(pathname: string): Module | undefined {
  const path = trim(pathname);
  return [...MODULES, SETTINGS].find((module) => module.pages.some(({ to }) => within(path, to)));
}

/** The module's page a path is on or under: the closest match wins (Deleted over All sessions). */
export function pageOf(module: Module, pathname: string): Submodule | undefined {
  const path = trim(pathname);
  return module.pages
    .filter(({ to }) => within(path, to))
    .sort((a, b) => b.to.length - a.to.length)[0];
}
