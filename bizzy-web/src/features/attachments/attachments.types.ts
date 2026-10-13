// Mirrors bizzy-lambda/internal/features/attachments.

/** What files hang off. */
export type OwnerKind = "session" | "expense";

export interface AttachmentOwner {
  ownerKind: OwnerKind;
  ownerId: string;
}

/** One attached file, with short-lived links to it. */
export interface Attachment extends AttachmentOwner {
  id: string;
  /** The file name as she uploaded it. */
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  /** Shows the file in the browser; valid for an hour. */
  url: string;
  /** Saves it under its name; valid for an hour. */
  downloadUrl: string;
}

/** Where to upload a file, and the id to confirm it under. */
export interface UploadTicket {
  id: string;
  upload: { url: string; headers: Record<string, string> };
}
