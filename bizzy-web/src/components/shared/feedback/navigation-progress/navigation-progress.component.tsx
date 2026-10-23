import { useRouterState } from "@tanstack/react-router";
import { ProgressStripe } from "~/components/shared/feedback/progress-stripe/progress-stripe.component";

/**
 * Along the nav bar's bottom edge while the next page reads its data (see
 * pageData) and the page being left stays on screen.
 */
export function NavigationProgress() {
  const loading = useRouterState({ select: (state) => state.status === "pending" });
  if (!loading) return null;
  return (
    <ProgressStripe
      label="Loading the page"
      className="fixed inset-x-0 top-[calc(var(--nav-height)-0.125rem)] z-(--z-nav)"
    />
  );
}
