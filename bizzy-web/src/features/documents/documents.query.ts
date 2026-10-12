import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import type { Versioned } from "./documents.service";
import type { BizDocument, DocumentContent, DocumentSource, DocumentType } from "./documents.types";
import { DocumentKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

export const DocumentsQuery = {
  /** One month ("2026-10") of one type. */
  useList: (type: DocumentType, month: string) =>
    useQuery({
      queryKey: [...DocumentKeys.list(type), month],
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

/**
 * Every lifecycle step can change sessions and packages (their receipt link)
 * and client activity, so all billing queries are refreshed.
 */
function useDocumentMutation<TInput>(fn: (input: TInput) => Promise<BizDocument | null>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export const DocumentsMutation = {
  useCreateDraft: () =>
    useDocumentMutation(({ type, sources }: { type: DocumentType; sources: Array<DocumentSource> }) =>
      DocumentsService.createDraft(type, sources),
    ),
  useSaveDraft: () =>
    useDocumentMutation(({ doc, content }: { doc: Versioned; content: DocumentContent }) =>
      DocumentsService.saveDraft(doc, content),
    ),
  useIssue: () => useDocumentMutation((doc: Versioned) => DocumentsService.issue(doc)),
  useRevise: () => useDocumentMutation((doc: Versioned) => DocumentsService.revise(doc)),
  useDiscardDraft: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (doc: Versioned) => DocumentsService.discardDraft(doc),
      // A never-issued draft is deleted: don't refetch it while its page closes.
      onSuccess: (result, doc) =>
        invalidateBilling(queryClient, result ? undefined : DocumentKeys.detail(doc.id)),
    });
  },
  useCancel: () =>
    useDocumentMutation(({ doc, reason }: { doc: Versioned; reason: string }) =>
      DocumentsService.cancel(doc, reason),
    ),
  /** Share tokens by id; only writes for documents issued before links. */
  useShare: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (ids: Array<string>) => DocumentsService.share(ids),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: DocumentKeys.all }),
    });
  },
  useResetShare: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (doc: Versioned) => DocumentsService.resetShare(doc),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: DocumentKeys.all }),
    });
  },
};
