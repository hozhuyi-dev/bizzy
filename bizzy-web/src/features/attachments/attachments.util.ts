import { IMAGE_MAX_SIDE, TYPES_BY_EXTENSION } from "./attachments.constant";

/** The file's type, from its extension when the browser left it blank. */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** Images the browser can show in a tile; HEIC can't be, outside Safari. */
export function isPreviewable(contentType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType);
}

/** "1.2 MB", "340 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** The size it would be shrunk to: the longer side at most IMAGE_MAX_SIDE. */
export function shrunkSize(width: number, height: number): { width: number; height: number } {
  return fitWithin(width, height, IMAGE_MAX_SIDE);
}

/** The size with the longer side at most maxSide, keeping the shape; never larger. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
