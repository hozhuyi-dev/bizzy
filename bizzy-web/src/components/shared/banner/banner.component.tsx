import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The status tones (tokens in app.css), so a banner reads like its chips. */
type BannerTone = "neutral" | "info" | "waiting" | "attention";

const TONES: Record<BannerTone, string> = {
  neutral: "bg-status-neutral text-status-neutral-foreground",
  info: "bg-status-info text-status-info-foreground",
  waiting: "bg-status-waiting text-status-waiting-foreground",
  attention: "bg-status-attention text-status-attention-foreground",
};

interface BannerProps {
  tone: BannerTone;
  icon: LucideIcon;
  /**
   * The gist, in bold. Keep title and text to about 40 characters together,
   * so the banner stays one line on a phone.
   */
  title: ReactNode;
  children?: ReactNode;
  /** Problems are announced as they appear; notices are not. */
  role?: "alert" | "status";
}

/**
 * A page-wide notice about the page's state, shown full width under the page
 * header. Pass it to SectionLayout's banner to keep it in view while scrolling.
 */
export function Banner({ tone, icon: Icon, title, children, role }: BannerProps) {
  return (
    <div role={role} className={cn("flex items-start gap-2.5 px-4 py-2.5 text-sm", TONES[tone])}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">{title}</span>
        {children && <> {children}</>}
      </p>
    </div>
  );
}
