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

/**
 * A file's tile shows a thumbnail made before upload (a photo, or a PDF's
 * first page): a JPEG this many pixels on the longer side, some 10-20 KB,
 * so a page of tiles loads at once. The file itself loads when opened.
 */
export const THUMBNAIL_MAX_SIDE = 256;
export const THUMBNAIL_QUALITY = 0.7;

/** Whether photos are shrunk before upload ("on"/"off"), as last chosen on this device. */
export const SHRINK_STORAGE_KEY = "bizzy.shrinkPhotos";

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
