import { useNavigate } from "@tanstack/react-router";
import { catalogueUrl } from "./expenses.util";
import type { ListFilter } from "~/core/list/filter.types";

/** Moves the items' or shops' list to another filter, kept in its URL; typing replaces the entry rather than adding one. */
export function useCatalogueNavigate(to: "/expenses/items" | "/expenses/vendors", filter: ListFilter): (next: ListFilter) => void {
  const navigate = useNavigate();
  return (next) => void navigate({ to, search: catalogueUrl.toSearch(next), replace: next.text !== filter.text });
}
