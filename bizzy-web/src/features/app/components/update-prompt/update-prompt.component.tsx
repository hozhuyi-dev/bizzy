import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";

/** How often an app left open looks for a new build, besides on coming back to it. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the service worker (vite.config.ts) and, once a deploy's new
 * build is downloaded, offers to reload into it. It never reloads on its
 * own, so nothing half-typed is lost; until then the app runs the build it
 * opened with. An installed app on iOS is resumed rather than reopened, so
 * it looks for a new build each time it comes back into view too. Renders
 * nothing.
 */
export function UpdatePrompt() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registered) => {
      registration.current = registered;
    },
  });

  useEffect(() => {
    // Offline or mid-deploy, a check just fails; the next one tries again.
    const check = () => void registration.current?.update().catch(() => undefined);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!needRefresh) return;
    toast("A new version of Bizzy is ready", {
      id: "app-update",
      duration: Infinity,
      action: { label: "Reload", onClick: () => void updateServiceWorker() },
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
