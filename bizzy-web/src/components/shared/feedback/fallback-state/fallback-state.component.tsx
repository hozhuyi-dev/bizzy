import { cn } from "cn";
import type { ReactNode } from "react";

export type FallbackSize = "page" | "section";

interface FallbackStateProps {
  /** An icon or a drawing (BeeArt); sized here. */
  art: ReactNode;
  title: ReactNode;
  /** The plain explanation, and what to do about it. */
  children?: ReactNode;
  /** What to do next: a way back, trying again. */
  actions?: ReactNode;
  /** A whole page's body, or one section of it (a table's body, a card). */
  size?: FallbackSize | undefined;
  role?: "alert" | "status" | undefined;
  /** An error tints its icon; anything else stays quiet. */
  tone?: "neutral" | "error" | undefined;
}

/**
 * What shows in place of content that can't: an unknown address, a page
 * that didn't load, a page loading. One shape everywhere: a drawing, what
 * happened, the plain explanation, and what to do next.
 */
export function FallbackState({ art, title, children, actions, size = "section", role, tone = "neutral" }: FallbackStateProps) {
  const page = size === "page";
  return (
    <div role={role} className={cn("flex flex-col items-center gap-3 text-center", page ? "py-16" : "py-8")}>
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full",
          tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          page ? "size-16 [&_svg]:size-9" : "size-10 [&_svg]:size-5",
        )}
      >
        {art}
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className={page ? "type-section-title" : "text-sm font-medium"}>{title}</p>
        {children && <div className="flex flex-col gap-1 text-sm text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
