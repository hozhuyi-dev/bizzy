import { createLink } from "@tanstack/react-router";
import { cn } from "cn";
import type { ComponentProps } from "react";

/**
 * A link inside text or a table cell: always underlined, so it reads as a
 * link before you hover. The underline darkens on hover.
 */
function Anchor({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

/** The router's Link with the text-link look; takes the same props. */
export const TextLink = createLink(Anchor);
