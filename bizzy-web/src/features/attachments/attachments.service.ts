import { IMAGE_KEEP_BYTES, IMAGE_QUALITY } from "./attachments.constant";
import { contentTypeOf, shrunkSize } from "./attachments.util";
import type { AttachmentOwner, AttachmentView, UploadTicket } from "./attachments.types";
import { ApiError, invoke } from "~/core/lambda/lambda.client";

/**
 * A phone photo shrunk to a JPEG of IMAGE_MAX_SIDE, which keeps uploads fast
 * and storage cheap. Anything else (a PDF, a GIF, HEIC the browser can't
 * read, an image already small) is returned as it is.
 */
async function shrinkImage(file: File): Promise<File> {
  const type = contentTypeOf(file);
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = shrunkSize(bitmap.width, bitmap.height);
    if (width === bitmap.width && file.size <= IMAGE_KEEP_BYTES) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    // JPEG has no transparency: a screenshot's clear parts become white.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    // The default ("low", about bilinear) blurs and jags small text, such as
    // a receipt's, when halving a phone photo.
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export const AttachmentsService = {
  list: (owner: AttachmentOwner) => invoke<Array<AttachmentView>>("attachments.list", owner),
  remove: (id: string) => invoke<null>("attachments.delete", { id }),

  /**
   * Attaches one file: shrinks a photo, asks the API where to put it,
   * uploads it straight to storage, then confirms it so it is kept.
   */
  upload: async (owner: AttachmentOwner, original: File): Promise<AttachmentView> => {
    const file = await shrinkImage(original);
    const contentType = contentTypeOf(file);
    const ticket = await invoke<UploadTicket>("attachments.requestUpload", {
      ...owner,
      name: file.name,
      contentType,
      sizeBytes: file.size,
    });
    const response = await fetch(ticket.upload.url, { method: "PUT", headers: ticket.upload.headers, body: file });
    if (!response.ok) {
      throw new ApiError("upload", `${original.name} didn't upload. Check the connection and try again.`);
    }
    return invoke<AttachmentView>("attachments.confirm", { ...owner, id: ticket.id, name: file.name, contentType });
  },
};
