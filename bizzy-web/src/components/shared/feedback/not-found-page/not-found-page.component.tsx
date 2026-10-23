import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { FallbackSize } from "~/components/shared/feedback/fallback-state/fallback-state.component";
import { FallbackState } from "~/components/shared/feedback/fallback-state/fallback-state.component";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";
import { BeeArt } from "~/components/shared/feedback/bee-art/bee-art.component";
import { Button } from "~/components/ui/button";
import { QUIPS } from "~/core/constants/quips.constant";

interface NotFoundPageProps {
  /** What isn't there: the API's word for an item gone ("This session was deleted."). */
  message?: ReactNode;
  /** The way back: its list, or Home. */
  back?: { label: string; link: LinkOptions } | undefined;
  size?: FallbackSize | undefined;
}

/** An unknown address, or an item that isn't there any more: a quip, what's missing, and the way back. */
export function NotFoundPage({ message = "Page not found.", back, size = "page" }: NotFoundPageProps) {
  const quip = useQuip(QUIPS.notFound);
  const way = back ?? { label: "Back to Home", link: { to: "/" } };
  return (
    <FallbackState
      role="status"
      size={size}
      art={<BeeArt pool="lost" quip={quip} />}
      title={quip}
      actions={
        <Button variant="outline" size={size === "page" ? "default" : "sm"} render={<Link {...way.link} />} nativeButton={false}>
          {way.label}
        </Button>
      }
    >
      {message}
    </FallbackState>
  );
}
