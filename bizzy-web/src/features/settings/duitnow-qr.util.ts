/**
 * Reads what a QR in an image says: a screenshot or photo of her DuitNow
 * QR. Tried at a couple of sizes, since a small QR in a large screenshot
 * reads better shrunk less. Undefined when there is no QR to read. The API
 * checks it is a DuitNow QR when the settings are saved.
 */
export async function readQr(file: Blob): Promise<string | undefined> {
  const { default: jsQR } = await import("jsqr");
  const bitmap = await createImageBitmap(file);
  try {
    for (const longest of [1600, 800]) {
      const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, width, height);
      const found = jsQR(context.getImageData(0, 0, width, height).data, width, height, {
        inversionAttempts: "attemptBoth",
      });
      if (found?.data) return found.data;
    }
    return undefined;
  } finally {
    bitmap.close();
  }
}

/**
 * Who a DuitNow QR pays, as it names them (its merchant name, field 59), to
 * show which QR is set; undefined when it names no one.
 */
export function qrPayee(payload: string): string | undefined {
  for (let rest = payload; rest.length >= 4; ) {
    const tag = rest.slice(0, 2);
    const length = Number(rest.slice(2, 4));
    if (!Number.isInteger(length) || rest.length < 4 + length) return undefined;
    if (tag === "59") return rest.slice(4, 4 + length).trim() || undefined;
    rest = rest.slice(4 + length);
  }
  return undefined;
}
