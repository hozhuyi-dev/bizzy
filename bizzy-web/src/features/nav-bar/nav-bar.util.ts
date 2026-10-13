import { MODULES, SETTINGS } from "./nav-bar.constant";
import type { Module, Submodule } from "./nav-bar.types";

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
