import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "~/components/ui/sonner";
import { AuthQuery } from "~/features/auth/auth.query";
import { AuthScreen } from "~/features/auth/components/auth-screen/auth-screen.component";
import { NavBar } from "~/features/nav-bar/components/nav-bar/nav-bar.component";
import { SyncOnLoad } from "~/features/sync/components/sync-on-load/sync-on-load.component";
import { queryClient } from "~/core/config/query-client.config";
import "~/styles/app.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const isPublic = useMatches({ select: (matches) => matches.some((match) => match.staticData.public) });
  return (
    <QueryClientProvider client={queryClient}>
      {isPublic ? <Outlet /> : <AuthGate />}
      <Toaster position="top-center" />
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
    <div className="min-h-dvh">
      <SyncOnLoad />
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 pb-6">
        <Outlet />
      </main>
    </div>
  );
}
