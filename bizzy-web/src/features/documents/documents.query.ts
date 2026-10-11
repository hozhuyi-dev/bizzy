import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import type { Versioned } from "./documents.service";
import type { BizDocument, DocumentContent, DocumentSource, DocumentType } from "./documents.types";
import { DocumentKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

export const DocumentsQuery = {
  useList: (type: DocumentType) =>
    useQuery({
      queryKey: DocumentKeys.list(type),
      queryFn: () => DocumentsService.list(type),
    }),

  useDetail: (id: string) =>
    useQuery({
      queryKey: DocumentKeys.detail(id),
      queryFn: () => DocumentsService.get(id),
    }),

  useNumbering: (type: DocumentType) =>
    useQuery({
      queryKey: DocumentKeys.numbering(type),
      queryFn: () => DocumentsService.numbering(type),
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
  useSetNextNumber: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ type, next }: { type: DocumentType; next: number }) =>
        DocumentsService.setNextNumber(type, next),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: DocumentKeys.all }),
    });
  },
};
