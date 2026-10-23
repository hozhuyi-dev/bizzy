import type { ReactNode } from "react";

/** What went wrong, inline in a form: a save refused, a picker that can't read. A read a page or part waits on fails as an ErrorState. */
export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
