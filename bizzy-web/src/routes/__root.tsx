import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AuthQuery } from "~/features/auth/auth.query";
import { AuthScreen } from "~/features/auth/components/auth-screen/auth-screen.component";
import { NavBar } from "~/features/nav-bar/components/nav-bar/nav-bar.component";
import { StayCurrent } from "~/features/sync/components/stay-current/stay-current.component";
import { queryClient } from "~/core/config/query-client.config";
import { AppBannerContext } from "~/components/shared/layout/page-header/page-header.hook";
import { PageHeaderSlotsProvider } from "~/components/shared/layout/page-header/page-header-slots.component";
import { PageDock } from "~/components/shared/layout/page-dock/page-dock.component";
import { SetupNotice } from "~/features/settings/components/setup-notice/setup-notice.component";
import { NavigationProgress } from "~/components/shared/feedback/navigation-progress/navigation-progress.component";
import "~/styles/app.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const isPublic = useMatches({ select: (matches) => matches.some((match) => match.staticData.public) });
  return (
    <QueryClientProvider client={queryClient}>
      {/* One provider, so moving from one tooltip to the next shows it at once. */}
      <TooltipProvider>{isPublic ? <Outlet /> : <AuthGate />}</TooltipProvider>
      {/* At the bottom, away from the header's actions on a wide screen, and
          just above a phone's dock, by the thumb that tapped what it is about. */}
      <Toaster
        position="bottom-right"
        offset={{ bottom: "max(1.5rem, var(--dock-height))" }}
        mobileOffset={{ bottom: "max(1rem, var(--dock-height))" }}
      />
    </QueryClientProvider>
  );
}

function AuthGate() {
  const auth = AuthQuery.useAuthState();

  if (auth.isPending) return null;
  if (auth.isError) return <AuthScreen status="signed-out" />;

  const { status } = auth.data;
  if (status !== "signed-in") return <AuthScreen status={status} />;

  return (
    <PageHeaderSlotsProvider>
      <div className="min-h-dvh">
        <StayCurrent />
        <NavBar />
        <NavigationProgress />
        {/* On a phone the page header leaves the page (into the nav bar and the
            dock), so the page keeps its air under the nav bar itself. */}
        <main className="mx-auto max-w-(--content-width) px-(--page-gutter) pb-[calc(var(--page-bottom)+var(--dock-height))] max-md:pt-(--section-gap)">
          {/* What is left to set up, on every page's header. */}
          <AppBannerContext value={<SetupNotice />}>
            <Outlet />
          </AppBannerContext>
        </main>
        <PageDock />
      </div>
    </PageHeaderSlotsProvider>
  );
}
