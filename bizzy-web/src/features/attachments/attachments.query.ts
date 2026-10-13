import { useQuery } from "@tanstack/react-query";
import { AttachmentsService } from "./attachments.service";
import { LINKS_STALE_MS } from "./attachments.constant";
import type { AttachmentOwner } from "./attachments.types";
import { AttachmentKeys } from "~/core/constants/query-keys.constant";

export const AttachmentsQuery = {
  /** An owner's files; refetched before their links expire. */
  useList: ({ ownerKind, ownerId }: AttachmentOwner) =>
    useQuery({
      queryKey: AttachmentKeys.owner(ownerKind, ownerId),
      queryFn: () => AttachmentsService.list({ ownerKind, ownerId }),
      staleTime: LINKS_STALE_MS,
      refetchInterval: LINKS_STALE_MS,
    }),
};
