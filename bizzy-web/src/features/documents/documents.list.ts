import { useMemo } from "react";
import { DOCUMENT_TYPES } from "./documents.constant";
import { DocumentsQuery } from "./documents.query";
import { documentFacets, documentPlace } from "./documents.util";
import type { DocumentSummary, DocumentType } from "./documents.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { usePagesWindow } from "~/core/list/pager.hook";

function documentsList(type: DocumentType): FilteredPagerList<DocumentSummary> {
  const spec = DOCUMENT_TYPES[type];
  return {
    noun: spec.title.toLowerCase(),
    nouns: spec.plural.toLowerCase(),
    label: `Search ${spec.plural.toLowerCase()}`,
    dates: true,
    useWindow: (filter) => usePagesWindow(DocumentsQuery.useSearch(type, filter)),
    useFacets: () => {
      const clients = ClientsQuery.useList();
      return useMemo(() => documentFacets(clients.data ?? []), [clients.data]);
    },
    idOf: (doc) => doc.id,
    placeOf: documentPlace,
  };
}

/** The invoices and receipts lists, for a document's page to step through. */
export const DOCUMENT_LISTS: Record<DocumentType, FilteredPagerList<DocumentSummary>> = {
  invoice: documentsList("invoice"),
  receipt: documentsList("receipt"),
};
