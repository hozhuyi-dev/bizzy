import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DocumentsService } from "./documents.service";
import type { DocumentContent, DocumentSource, DocumentType, DocumentView } from "./documents.types";
import { DocumentKeys } from "~/core/constants/query-keys.constant";
import { keeping } from "~/core/lambda/lambda.client";

// Every step can change sessions and packages (their fee and payment are
// the documents') and client activity: read again as the API says
// (refreshChanged).
export const DocumentsMutation = {
  useSaveDraft: () =>
    useMutation({
      mutationFn: ({ id, content }: { id: string; content: DocumentContent }) => DocumentsService.saveDraft(id, content),
    }),
  useIssue: () => useMutation({ mutationFn: (id: string) => DocumentsService.issue(id) }),
  useRevise: () => useMutation({ mutationFn: (id: string) => DocumentsService.revise(id) }),
  useDiscardDraft: () => {
    const queryClient = useQueryClient();
    return useMutation({
      // A never-issued draft is deleted: not read again while its page closes.
      mutationFn: (id: string) => keeping(DocumentKeys.detail(id), () => DocumentsService.discardDraft(id)),
      onSuccess: (result: DocumentView | null, id) => {
        if (result) void queryClient.invalidateQueries({ queryKey: DocumentKeys.detail(id) });
      },
    });
  },
  useCancel: () =>
    useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => DocumentsService.cancel(id, reason),
    }),
  useMoveLines: () =>
    useMutation({
      mutationFn: ({ from, to, lineIds }: { from: string; to?: string | undefined; lineIds: Array<string> }) =>
        DocumentsService.moveLines(from, to, lineIds),
    }),
  useCombine: () => useMutation({ mutationFn: (ids: Array<string>) => DocumentsService.combine(ids) }),
  usePlace: () =>
    useMutation({
      mutationFn: ({ type, into, items }: { type: DocumentType; into?: string | undefined; items: Array<DocumentSource> }) =>
        DocumentsService.place(type, into, items),
    }),
  /** Share tokens by id; only writes for documents issued before links. */
  useShare: () => useMutation({ mutationFn: (ids: Array<string>) => DocumentsService.share(ids) }),
  useResetShare: () => useMutation({ mutationFn: (id: string) => DocumentsService.resetShare(id) }),
};
