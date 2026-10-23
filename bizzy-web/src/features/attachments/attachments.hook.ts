import { useCallback, useState } from "react";
import { SHRINK_STORAGE_KEY } from "./attachments.constant";

function readShrink(): boolean {
  try {
    return localStorage.getItem(SHRINK_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether photos are shrunk before upload: on unless turned off on this device. */
export function useShrinkPhotos(): [shrink: boolean, setShrink: (shrink: boolean) => void] {
  const [shrink, setState] = useState(readShrink);
  const setShrink = useCallback((next: boolean) => {
    setState(next);
    try {
      localStorage.setItem(SHRINK_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Still applies for this visit.
    }
  }, []);
  return [shrink, setShrink];
}
