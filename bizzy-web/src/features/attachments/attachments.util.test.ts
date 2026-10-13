import { describe, expect, it } from "vitest";
import { contentTypeOf, formatBytes, isPreviewable, shrunkSize } from "./attachments.util";

describe("contentTypeOf", () => {
  it("uses the browser's type, or the extension when it left it blank", () => {
    expect(contentTypeOf(new File(["x"], "knee.jpg", { type: "image/jpeg" }))).toBe("image/jpeg");
    expect(contentTypeOf(new File(["x"], "IMG_0001.HEIC"))).toBe("image/heic");
    expect(contentTypeOf(new File(["x"], "notes"))).toBe("application/octet-stream");
  });
});

describe("shrunkSize", () => {
  it("brings the longer side down to 2000 pixels, keeping the shape", () => {
    expect(shrunkSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(shrunkSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(shrunkSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("formatBytes", () => {
  it("shows kilobytes or megabytes", () => {
    expect(formatBytes(340_000)).toBe("340 KB");
    expect(formatBytes(1_250_000)).toBe("1.3 MB");
    expect(formatBytes(10)).toBe("1 KB");
  });
});

describe("isPreviewable", () => {
  it("previews what every browser shows, not HEIC or PDF", () => {
    expect(isPreviewable("image/png")).toBe(true);
    expect(isPreviewable("image/heic")).toBe(false);
    expect(isPreviewable("application/pdf")).toBe(false);
  });
});
