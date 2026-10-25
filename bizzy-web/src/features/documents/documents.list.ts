import { useMemo } from "react";
import { DocumentsQuery } from "./documents.query";
import { documentFacets, documentPlace, documentsOfClient, oneClientOf } from "./documents.util";
import type { DocumentSummary } from "./documents.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { useAllWindow, usePagesWindow } from "~/core/list/pager.hook";

/** The documents list, for a document's page to step through. */
export const DOCUMENTS_LIST: FilteredPagerList<DocumentSummary> = {
  noun: "document",
  nouns: "documents",
  label: "Search documents",
  dates: true,
  useWindow: (filter) => {
    // A client's, as their page lists them: from the read their page made.
    const clientId = oneClientOf(filter);
    const byClient = DocumentsQuery.useByClient(clientId ?? "", clientId !== undefined);
    // Routes make a new filter each render: its chips, as text, say when it changed.
    const chips = JSON.stringify(filter.chips);
    const docs = useMemo(
      () => byClient.data && documentsOfClient(byClient.data, JSON.parse(chips) as ListFilter["chips"]),
      [byClient.data, chips],
    );
    const whole = useAllWindow(docs);
    const paged = usePagesWindow(DocumentsQuery.useSearch(filter, clientId === undefined));
    return clientId ? whole : paged;
  },
  useFacets: () => {
    const clients = ClientsQuery.useList();
    return useMemo(() => documentFacets(clients.data ?? []), [clients.data]);
  },
  idOf: (doc) => doc.id,
  placeOf: documentPlace,
};
