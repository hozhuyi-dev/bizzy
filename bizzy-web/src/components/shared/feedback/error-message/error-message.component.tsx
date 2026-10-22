import type { ReactNode } from "react";

/** What went wrong, in place of what would have shown: a page that didn't load, a save refused. */
export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
