import { MODULES, SETTINGS } from "./navigation.constant";
import type { Module, Submodule } from "./navigation.types";

function trim(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function within(path: string, to: string): boolean {
  return to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
}

/** How closely a path is on or under a page: the length of what it matched, or 0 for not at all. */
function match(path: string, page: Submodule): number {
  return Math.max(0, ...[page.to, ...(page.under ?? [])].filter((to) => within(path, to)).map((to) => to.length));
}

/** The module a path belongs to: one of its pages, or a page under one (a client, a receipt). */
export function moduleOf(pathname: string): Module | undefined {
  const path = trim(pathname);
  return [...MODULES, SETTINGS].find((module) => module.pages.some((page) => match(path, page) > 0));
}

/** The module's page a path is on or under: the closest match wins (Items over Expenses). */
export function pageOf(module: Module, pathname: string): Submodule | undefined {
  const path = trim(pathname);
  return module.pages
    .filter((page) => match(path, page) > 0)
    .sort((a, b) => match(path, b) - match(path, a))[0];
}
