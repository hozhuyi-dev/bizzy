import { describe, expect, it } from "vitest";
import { contentTypeOf, fitWithin, formatBytes, isPreviewable, shrunkSize } from "./attachments.util";

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

describe("fitWithin", () => {
  it("brings the longer side down to the most, keeping the shape and at least a pixel", () => {
    expect(fitWithin(4032, 3024, 256)).toEqual({ width: 256, height: 192 });
    expect(fitWithin(595, 842, 256)).toEqual({ width: 181, height: 256 });
    expect(fitWithin(120, 80, 256)).toEqual({ width: 120, height: 80 });
    expect(fitWithin(10_000, 10, 256)).toEqual({ width: 256, height: 1 });
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
