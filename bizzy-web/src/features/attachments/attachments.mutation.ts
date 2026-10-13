import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AttachmentsService } from "./attachments.service";
import type { QueryClient } from "@tanstack/react-query";
import type { AttachmentOwner } from "./attachments.types";
import { AttachmentKeys, ExpenseKeys, SessionKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

/**
 * Refreshes the owner's files, and the owner, whose file count changed. A
 * session's own page is left alone: refetching it would restart the notes
 * being typed.
 */
function invalidateOwner(queryClient: QueryClient, { ownerKind, ownerId }: AttachmentOwner) {
  void queryClient.invalidateQueries({ queryKey: AttachmentKeys.owner(ownerKind, ownerId) });
  if (ownerKind === "session") void invalidateBilling(queryClient, SessionKeys.detail(ownerId));
  else void queryClient.invalidateQueries({ queryKey: ExpenseKeys.all });
}

export const AttachmentsMutation = {
  useUpload: (owner: AttachmentOwner) => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (file: File) => AttachmentsService.upload(owner, file),
      onSettled: () => invalidateOwner(queryClient, owner),
    });
  },

  useRemove: (owner: AttachmentOwner) => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => AttachmentsService.remove(owner, id),
      onSettled: () => invalidateOwner(queryClient, owner),
    });
  },
};
