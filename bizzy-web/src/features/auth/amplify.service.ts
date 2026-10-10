import { fetchAuthSession, signInWithRedirect, signOut } from "aws-amplify/auth";
import type { AuthState } from "./auth.types";

function claim(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const AmplifyService = {
  async getAuthState(): Promise<AuthState> {
    let session: Awaited<ReturnType<typeof fetchAuthSession>>;
    try {
      session = await fetchAuthSession();
    } catch {
      // Tokens exist but the identity pool's role mapping denied this email.
      return { status: "no-access" };
    }

    const idToken = session.tokens?.idToken;
    if (!idToken) return { status: "signed-out" };
    if (!session.credentials) return { status: "no-access" };

    return {
      status: "signed-in",
      email: claim(idToken.payload.email),
      name: claim(idToken.payload.name),
    };
  },

  signIn: () => signInWithRedirect({ provider: "Google" }),

  signOut: () => signOut(),
};
