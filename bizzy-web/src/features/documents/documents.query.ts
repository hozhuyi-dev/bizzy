import { useQuery } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import type { DocumentType } from "./documents.types";
import { DocumentKeys } from "~/core/constants/query-keys.constant";

export const DocumentsQuery = {
  /** One month ("2026-10") of one type. */
  useList: (type: DocumentType, month: string) =>
    useQuery({
      queryKey: DocumentKeys.list(type, month),
      queryFn: () => DocumentsService.list(type, month),
    }),

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
