import { useMemo } from "react";
import { DocumentsQuery } from "./documents.query";
import { documentFacets, documentPlace } from "./documents.util";
import type { DocumentSummary } from "./documents.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { usePagesWindow } from "~/core/list/pager.hook";

/** The documents list, for a document's page to step through. */
export const DOCUMENTS_LIST: FilteredPagerList<DocumentSummary> = {
  noun: "document",
  nouns: "documents",
  label: "Search documents",
  dates: true,
  useWindow: (filter) => usePagesWindow(DocumentsQuery.useSearch(filter)),
  useFacets: () => {
    const clients = ClientsQuery.useList();
    return useMemo(() => documentFacets(clients.data ?? []), [clients.data]);
  },
  idOf: (doc) => doc.id,
  placeOf: documentPlace,
};
