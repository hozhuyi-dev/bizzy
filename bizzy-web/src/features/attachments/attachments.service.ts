import { IMAGE_KEEP_BYTES, IMAGE_QUALITY, THUMBNAIL_MAX_SIDE, THUMBNAIL_QUALITY } from "./attachments.constant";
import { contentTypeOf, fitWithin, shrunkSize } from "./attachments.util";
import type { AttachmentOwner, AttachmentView, UploadTicket } from "./attachments.types";
import { ApiError, invoke } from "~/core/lambda/lambda.client";

/** How to attach a file. */
export interface UploadOptions {
  /** Shrink a photo to IMAGE_MAX_SIDE first; off uploads it as it is. */
  shrink: boolean;
  /** The id of a file beside it this one takes the place of (a photo again, at full size). */
  replaces?: string | undefined;
}

/** A source drawn width × height on white (JPEG has no transparency), as a JPEG. */
async function toJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // A screenshot's clear parts become white.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  // The default ("low", about bilinear) blurs and jags small text, such as
  // a receipt's, when halving a phone photo.
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

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
    const blob = await toJpeg(bitmap, width, height, IMAGE_QUALITY);
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/**
 * The file's thumbnail (THUMBNAIL_MAX_SIDE): a photo, or a PDF's first page
 * (pdf.js, loaded only then). None for what the browser can't draw (HEIC
 * outside Safari); the file is attached all the same.
 */
async function thumbnailOf(file: File): Promise<Blob | undefined> {
  try {
    if (contentTypeOf(file) === "application/pdf") {
      const { drawFirstPage } = await import("~/core/pdf/pdf-render");
      const page = await drawFirstPage(new Uint8Array(await file.arrayBuffer()), THUMBNAIL_MAX_SIDE);
      return (await toJpeg(page, page.width, page.height, THUMBNAIL_QUALITY)) ?? undefined;
    }
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, THUMBNAIL_MAX_SIDE);
    try {
      return (await toJpeg(bitmap, width, height, THUMBNAIL_QUALITY)) ?? undefined;
    } finally {
      bitmap.close();
    }
  } catch {
    return undefined;
  }
}

export const AttachmentsService = {
  list: (owner: AttachmentOwner) => invoke<Array<AttachmentView>>("attachments.list", owner),
  remove: (id: string) => invoke<null>("attachments.delete", { id }),

  /**
   * Attaches one file: shrinks a photo if asked, makes its thumbnail, asks
   * the API where to put them, uploads both straight to storage, then
   * confirms so they are kept. A thumbnail that fails to upload is left out.
   */
  upload: async (owner: AttachmentOwner, original: File, { shrink, replaces }: UploadOptions): Promise<AttachmentView> => {
    const file = shrink ? await shrinkImage(original) : original;
    const thumbnail = await thumbnailOf(file);
    const contentType = contentTypeOf(file);
    const ticket = await invoke<UploadTicket>("attachments.requestUpload", {
      ...owner,
      name: file.name,
      contentType,
      sizeBytes: file.size,
      thumbnailBytes: thumbnail?.size ?? 0,
    });
    const thumbnailUpload = ticket.thumbnailUpload;
    const [response, thumbnailSent] = await Promise.all([
      fetch(ticket.upload.url, { method: "PUT", headers: ticket.upload.headers, body: file }),
      thumbnail && thumbnailUpload
        ? fetch(thumbnailUpload.url, { method: "PUT", headers: thumbnailUpload.headers, body: thumbnail }).then(
            (sent) => sent.ok,
            () => false,
          )
        : false,
    ]);
    if (!response.ok) {
      throw new ApiError("upload", `${original.name} didn't upload. Check the connection and try again.`);
    }
    return invoke<AttachmentView>("attachments.confirm", {
      ...owner,
      id: ticket.id,
      name: file.name,
      contentType,
      thumbnail: thumbnailSent,
      originalBytes: file === original ? 0 : original.size,
      replaces,
    });
  },
};
