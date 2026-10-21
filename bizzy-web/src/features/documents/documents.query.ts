import { useQuery } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import { searchDocumentsRequest } from "./documents.util";
import type { DocumentType } from "./documents.types";
import type { ListFilter } from "~/core/list/filter.types";
import { DocumentKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/filter.hook";

export const DocumentsQuery = {
  /** The documents of a type a filter finds, latest first, a page at a time. */
  useSearch: (type: DocumentType, filter: ListFilter) => {
    const request = searchDocumentsRequest(type, filter);
    return usePages(DocumentKeys.search(request), (after) => DocumentsService.search({ ...request, after }));
  },

  useDetail: (id: string) =>
    useQuery({
      queryKey: DocumentKeys.detail(id),
      queryFn: () => DocumentsService.get(id),
    }),

  /** Every document for a client, of any type. */
  useByClient: (clientId: string, enabled = true) =>
    useQuery({
      queryKey: DocumentKeys.client(clientId),
      queryFn: () => DocumentsService.listByClient(clientId),
      enabled: enabled && clientId !== "",
    }),

  /** A shared document, for the public page. */
  useShared: (token: string) =>
    useQuery({
      queryKey: DocumentKeys.shared(token),
      queryFn: () => DocumentsService.readShared(token),
      retry: false,
    }),
};
