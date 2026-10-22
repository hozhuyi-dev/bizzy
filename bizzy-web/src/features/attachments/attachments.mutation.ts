import { useMutation } from "@tanstack/react-query";
import { AttachmentsService } from "./attachments.service";
import type { AttachmentOwner } from "./attachments.types";
import { SessionKeys } from "~/core/constants/query-keys.constant";
import { keeping } from "~/core/lambda/lambda.client";

/**
 * A session's own page is kept as it is meanwhile: reading it again would
 * restart the notes being typed. Everything else showing the files is read
 * again for what the API says changed.
 */
const keepOwner = ({ ownerKind, ownerId }: AttachmentOwner) =>
  ownerKind === "session" ? SessionKeys.detail(ownerId) : undefined;

export const AttachmentsMutation = {
  useUpload: (owner: AttachmentOwner) =>
    useMutation({
      mutationFn: (file: File) => keeping(keepOwner(owner), () => AttachmentsService.upload(owner, file)),
    }),

  useRemove: (owner: AttachmentOwner) =>
    useMutation({
      mutationFn: (id: string) => keeping(keepOwner(owner), () => AttachmentsService.remove(id)),
    }),
};
