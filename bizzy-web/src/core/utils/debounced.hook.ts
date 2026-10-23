import { useEffect, useState } from "react";

/** A value as it was once it stopped changing for `ms`: what to ask the API about while the user types. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
    // By content: a value rebuilt on every render is still the same value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return settled;
}
