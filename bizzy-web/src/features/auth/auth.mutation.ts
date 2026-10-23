import { useMutation } from "@tanstack/react-query";
import { AuthService } from "./auth.service";

/** Both leave the app for Google or Cognito and come back signed in or out. */
export const AuthMutation = {
  useSignIn: () => useMutation({ mutationFn: () => AuthService.signIn() }),
  useSignOut: () => useMutation({ mutationFn: () => AuthService.signOut() }),
};
