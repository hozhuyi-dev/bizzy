import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import type { DocumentContent, DocumentView } from "./documents.types";
import { DocumentKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

/**
 * Every lifecycle step can change sessions and packages (their fee and
 * payment are the documents') and client activity, so all billing queries
 * are refreshed.
 */
function useDocumentMutation<TInput>(fn: (input: TInput) => Promise<DocumentView | null>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidateBilling(queryClient),
  });
}

export const DocumentsMutation = {
  useSaveDraft: () =>
    useDocumentMutation(({ id, content }: { id: string; content: DocumentContent }) =>
      DocumentsService.saveDraft(id, content),
    ),
  useIssue: () => useDocumentMutation((id: string) => DocumentsService.issue(id)),
  useRevise: () => useDocumentMutation((id: string) => DocumentsService.revise(id)),
  useDiscardDraft: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => DocumentsService.discardDraft(id),
      // A never-issued draft is deleted: don't refetch it while its page closes.
      onSuccess: (result, id) => invalidateBilling(queryClient, result ? undefined : DocumentKeys.detail(id)),
    });
  },
  useCancel: () =>
    useDocumentMutation(({ id, reason }: { id: string; reason: string }) => DocumentsService.cancel(id, reason)),
  useMoveLines: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ from, to, lineIds }: { from: string; to?: string | undefined; lineIds: Array<string> }) =>
        DocumentsService.moveLines(from, to, lineIds),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },
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
      mutationFn: (id: string) => DocumentsService.resetShare(id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: DocumentKeys.all }),
    });
  },
};
