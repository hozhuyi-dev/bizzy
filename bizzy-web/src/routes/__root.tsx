import { Outlet, createRootRoute, useMatches } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Amplify } from "aws-amplify";
import { Toaster } from "~/components/ui/sonner";
import { AuthQuery } from "~/features/auth/auth.query";
import { AuthScreen } from "~/features/auth/components/auth-screen/auth-screen.component";
import { NavBar } from "~/features/nav-bar/nav-bar.component";
import { SyncOnLoad } from "~/features/sync/sync-on-load.component";
import "~/styles/app.css";

// Redirects follow whichever origin the app is served from, so localhost and
// each deployed environment work without per-environment config. Every origin
// still has to be in the user pool's CALLBACK_URLS / LOGOUT_URLS.
const { origin } = window.location;

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_AMPLIFY_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_AMPLIFY_USER_POOL_CLIENT_ID,
      identityPoolId: import.meta.env.VITE_AMPLIFY_IDENTITY_POOL_ID,
      loginWith: {
        oauth: {
          domain: import.meta.env.VITE_AMPLIFY_OAUTH_DOMAIN,
          redirectSignIn: [`${origin}/`],
          redirectSignOut: [`${origin}/`],
          responseType: "code",
          scopes: ["email", "openid", "profile"],
        },
      },
    },
  },
});

const queryClient = new QueryClient();

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
