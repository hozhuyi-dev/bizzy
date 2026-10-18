import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import { ActionBar } from "~/components/shared/action-bar/action-bar.component";

/**
 * Plain for a notice that asks for something (connect Google); the status
 * tones (tokens in app.css) when it reports a state, so it reads like its chips.
 */
type BannerTone = "plain" | "neutral" | "info" | "waiting" | "attention";

const TONES: Record<BannerTone, string> = {
  plain: "bg-card text-card-foreground",
  neutral: "bg-status-neutral text-status-neutral-foreground",
  info: "bg-status-info text-status-info-foreground",
  waiting: "bg-status-waiting text-status-waiting-foreground",
  attention: "bg-status-attention text-status-attention-foreground",
};

interface BannerProps {
  tone?: BannerTone;
  icon?: LucideIcon;
  /**
   * The gist, in bold, before the text. Keep the two to about 40 characters
   * together, so the banner stays one line on a phone.
   */
  title?: ReactNode;
  children?: ReactNode;
  /**
   * What to do about it, at the end of the line. Give each an icon: on a
   * phone that is all it shows, for room.
   */
  actions?: ReadonlyArray<Action>;
  /** Problems are announced as they appear; notices are not. */
  role?: "alert" | "status";
}

/**
 * A page-wide notice about the page's state, one slim line full width under
 * the page header, its actions at the end. Pass it to PageHeader's banners to
 * keep it in view. On a phone the actions are icons, at full size to tap; on
 * wider screens, small labelled buttons.
 */
export function Banner({ tone = "plain", icon: Icon, title, children, actions, role }: BannerProps) {
  return (
    <div role={role} className={cn("flex items-center gap-3 px-4 py-1.5 text-sm", TONES[tone])}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {Icon && <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
        <p>
          {title && <span className="font-semibold">{title}</span>}
          {title && children && " "}
          {children}
        </p>
      </div>
      <ActionBar
        actions={actions?.map((action) => ({ ...action, iconOnlyOnPhone: true }))}
        // The xs size from md up: one slim line, as tall as the text.
        buttonClassName="md:h-6 md:gap-1 md:rounded-[min(var(--radius-md),10px)] md:px-2 md:text-xs md:[&_svg:not([class*='size-'])]:size-3"
      />
    </div>
  );
}
