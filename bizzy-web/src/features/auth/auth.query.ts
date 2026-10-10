import { useQuery } from "@tanstack/react-query";
import { AmplifyService } from "./amplify.service";
import { AuthKeys } from "~/core/keys.query";

export const AuthQuery = {
  useAuthState: () =>
    useQuery({
      queryKey: AuthKeys.state(),
      queryFn: () => AmplifyService.getAuthState(),
      staleTime: Infinity,
    }),
};
