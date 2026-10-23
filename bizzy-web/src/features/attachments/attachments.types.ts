// Mirrors bizzy-lambda/internal/features/attachments.

/** What files hang off. */
export type OwnerKind = "session" | "expense";

export interface AttachmentOwner {
  ownerKind: OwnerKind;
  ownerId: string;
}

/** One attached file, with short-lived links to it. */
export interface AttachmentView extends AttachmentOwner {
  id: string;
  /** The file name as she uploaded it. */
  name: string;
  contentType: string;
  sizeBytes: number;
  /** A photo's size before it was shrunk; absent for a file uploaded as it was. */
  originalBytes?: number;
  uploadedAt: string;
  /** Shows the file in the browser; valid for an hour. */
  url: string;
  /** Saves it under its name; valid for an hour. */
  downloadUrl: string;
  /** Its small JPEG (THUMBNAIL_MAX_SIDE); absent for a file without one. */
  thumbnailUrl?: string;
}

/** A presigned PUT: the URL, and the headers its signature covers. */
export interface Upload {
  url: string;
  headers: Record<string, string>;
}

/** Where to upload a file and its thumbnail, and the id to confirm them under. */
export interface UploadTicket {
  id: string;
  upload: Upload;
  /** Absent when no thumbnail was asked for, or it is too big to keep. */
  thumbnailUpload?: Upload;
}
