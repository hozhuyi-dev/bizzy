import { useMemo } from "react";
import { PACKAGES_LIST } from "../../packages.list";
import { packagesUrl } from "../../packages.util";
import type { PackageSearch } from "../../packages.types";
import type { LinkOptions } from "@tanstack/react-router";
import type { ListFilter } from "~/core/list/filter.types";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { TODO_PACKAGES } from "~/features/todo/todo.list";
import { timelineList, timelineParent } from "~/features/timeline/timeline.list";

/** What a package's page steps through: Home's to-do list, a client's timeline, else the packages list's filter. */
export interface PackageStepping {
  from: PackageSearch["from"];
  timeline: PackageSearch["timeline"];
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/** A package's page, stepping through a list. */
export function packageLink(id: string, search: PackageSearch): LinkOptions {
  return { to: "/packages/$id", params: { id }, search };
}

/** The list a package's page steps through, as its breadcrumb: Home, the client's page, else the packages list with its filter. */
export function packageParent({ from, timeline, filter }: PackageStepping): Parent {
  if (from === "home") return { to: "/", label: "Home" };
  if (timeline) return timelineParent(timeline);
  return { to: "/packages", label: "Packages", search: packagesUrl.toSearch(filter) };
}

/**
 * Steps through the list the package was opened from: Home's to-do list,
 * a client's timeline, or the packages list with its filter and sort (a
 * client's, from their page's packages).
 */
export function PackagePager({ id, gone, stepping }: { id: string; gone?: boolean | undefined; stepping: PackageStepping }) {
  const { from, timeline, filter, onFilterChange } = stepping;
  const ofTimeline = useMemo(() => timeline && timelineList(timeline, "package"), [timeline]);
  if (from === "home") {
    return (
      <ListPager key="home" list={TODO_PACKAGES} filter={NO_FILTER} current={{ id, gone }} itemLink={(next) => packageLink(next, { from })} />
    );
  }
  if (ofTimeline) {
    return (
      <ListPager
        key={timeline}
        list={ofTimeline}
        filter={NO_FILTER}
        current={{ id, gone }}
        itemLink={(next) => packageLink(next, { timeline })}
      />
    );
  }
  return (
    <ListPager
      key="packages"
      list={PACKAGES_LIST}
      filter={filter}
      current={{ id, gone }}
      itemLink={(next) => packageLink(next, packagesUrl.toSearch(filter))}
      panel={{ onApply: onFilterChange, listLink: (next) => ({ to: "/packages", search: packagesUrl.toSearch(next) }) }}
    />
  );
}
