import { queryOptions, useQuery } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import { searchDocumentsRequest } from "./documents.util";
import type { DocumentStatus, DocumentType } from "./documents.types";
import type { ListFilter } from "~/core/list/filter.types";
import { DocumentKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/pages.hook";

const detail = (id: string) => queryOptions({ queryKey: DocumentKeys.detail(id), queryFn: () => DocumentsService.get(id) });

const byClient = (clientId: string) =>
  queryOptions({ queryKey: DocumentKeys.client(clientId), queryFn: () => DocumentsService.listByClient(clientId) });

export const DocumentsQuery = {
  /** For a route's loader (see pageData). */
  detail,
  byClient,

  /** The documents of a type a filter finds, latest first, a page at a time. */
  useSearch: (type: DocumentType, filter: ListFilter) => {
    const request = searchDocumentsRequest(type, filter);
    return usePages(DocumentKeys.search(request), (after) => DocumentsService.search({ ...request, after }));
  },

  useDetail: (id: string) => useQuery(detail(id)),

  /** Every document for a client, of any type. */
  useByClient: (clientId: string, enabled = true) =>
    useQuery({ ...byClient(clientId), enabled: enabled && clientId !== "" }),

  /** An issued revision's PDF as kept (undefined: the latest); the key moves with its status, as cancelling stamps it. */
  usePdf: (id: string, revision: number | undefined, status: DocumentStatus) =>
    useQuery({
      queryKey: DocumentKeys.pdf(id, revision, status),
      queryFn: () => DocumentsService.pdf(id, revision),
      // An issued PDF never changes under a key.
      staleTime: Infinity,
    }),

  /** A shared document, for the public page. */
  useShared: (token: string) =>
    useQuery({
      queryKey: DocumentKeys.shared(token),
      queryFn: () => DocumentsService.readShared(token),
      retry: false,
    }),
};
