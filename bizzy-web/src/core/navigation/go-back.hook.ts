import { useNavigate, useRouter } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";

/**
 * Back to the page this one was opened from, as the browser's Back is,
 * so it is found as it was left (its filter, its scroll). Opened from
 * outside the app (a link, a new tab), there is none: `fallback` takes
 * this page's place. `leaving` passes a form's unsaved-changes question,
 * for once it is saved or deleted.
 */
export function useGoBack(fallback: LinkOptions): (options?: { leaving?: boolean }) => void {
  const router = useRouter();
  const navigate = useNavigate();
  return ({ leaving = false } = {}) => {
    if (router.history.canGoBack()) router.history.back({ ignoreBlocker: leaving });
    else void navigate({ ...fallback, replace: true, ignoreBlocker: leaving });
  };
}
