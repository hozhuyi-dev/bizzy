/** What the file picker offers: photos (the camera, on a phone) and PDFs. */
export const ATTACHMENT_ACCEPT = "image/*,application/pdf,.heic,.heif";

/**
 * Photos are shrunk before upload to this many pixels on the longer side:
 * plenty to read a receipt or see a swelling, a tenth of a phone photo's size.
 */
export const IMAGE_MAX_SIDE = 2000;
export const IMAGE_QUALITY = 0.85;
/** A photo already this small is uploaded as it is. */
export const IMAGE_KEEP_BYTES = 1_000_000;

/** The API's links last an hour; refresh them well before. */
export const LINKS_STALE_MS = 30 * 60 * 1000;

/** Types a browser may leave blank (HEIC on Windows), by extension. */
export const TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};
