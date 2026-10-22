import { describe, expect, test } from "vitest";
import { qrPayee } from "./duitnow-qr.util";

// A static DuitNow QR as a bank app gives one (made up); see the API's tests.
const QR =
  "00020101021126490014A000000615000101068900530210000012345605030005204809953034585802MY5909PHYSIO CO6012KUALA LUMPUR6304319E";

describe("qrPayee", () => {
  test("is the name the QR pays", () => {
    expect(qrPayee(QR)).toBe("PHYSIO CO");
  });

  test("is unset when the QR names no one, or isn't one", () => {
    expect(qrPayee("000201010211")).toBeUndefined();
    expect(qrPayee("https://example.com")).toBeUndefined();
    expect(qrPayee("")).toBeUndefined();
  });
});
