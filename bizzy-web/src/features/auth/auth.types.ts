export type AuthState =
  | { status: "signed-out" }
  // Signed in with Google, but the identity pool refused AWS credentials:
  // not the allowed account for this environment.
  | { status: "no-access" }
  | { status: "signed-in"; email: string | undefined; name: string | undefined };
