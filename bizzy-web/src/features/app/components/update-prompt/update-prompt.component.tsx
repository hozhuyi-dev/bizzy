import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";

/** How often an app left open looks for a new build, besides on coming back to it. */
const CHECK_EVERY_MS = 15 * 60 * 1000;

/**
 * Registers the service worker (vite.config.ts) and, once a deploy's new
 * build is downloaded, offers to reload into it. It never reloads on its
 * own, so nothing half-typed is lost; until then the app runs the build it
 * opened with. An installed app on iOS is resumed rather than reopened, and
 * a desktop window isn't hidden by another one in front, so it looks for a
 * new build each time the page comes back into view or focus too, and
 * offers it again then if the toast was swiped away. Renders nothing.
 *
 * It watches the registration itself rather than relying on workbox-window's
 * `waiting` event: registered once signed in, it often starts after the
 * browser's own check on opening has begun installing the new build, which
 * workbox-window then never reports.
 */
export function UpdatePrompt() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  useRegisterSW({
    onRegisteredSW: (_url, registered) => {
      if (!registered) return;
      registration.current = registered;
      watchForUpdates(registered);
    },
  });

  useEffect(() => {
    const check = () => {
      const registered = registration.current;
      if (!registered) return;
      offerUpdate(registered);
      // Offline or mid-deploy, a check just fails; the next one tries again.
      void registered.update().catch(() => undefined);
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      clearInterval(timer);
    };
  }, []);

  return null;
}

/** Offers a build already waiting, and each one that finishes installing later. */
function watchForUpdates(registered: ServiceWorkerRegistration) {
  const watch = (worker: ServiceWorker | null) =>
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offerUpdate(registered);
    });
  watch(registered.installing);
  registered.addEventListener("updatefound", () => watch(registered.installing));
  offerUpdate(registered);
}

function offerUpdate(registered: ServiceWorkerRegistration) {
  // Only a build waiting behind the running one is an update: the very first
  // install takes over without waiting.
  if (!registered.waiting || !navigator.serviceWorker.controller) return;
  // The same id, so offering it again while shown leaves the one toast.
  toast("A new version of Bizzy is ready", {
    id: "app-update",
    duration: Infinity,
    action: { label: "Reload", onClick: () => reloadIntoUpdate(registered) },
  });
}

/** Lets the waiting build take over (sw.js skips waiting on this message), then reloads into it. */
function reloadIntoUpdate(registered: ServiceWorkerRegistration) {
  const waiting = registered.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
}
