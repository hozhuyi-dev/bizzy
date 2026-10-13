import { useQuery } from "@tanstack/react-query";
import { AuthService } from "./auth.service";
import { AuthKeys } from "~/core/constants/query-keys.constant";

export const AuthQuery = {
  useAuthState: () =>
    useQuery({
      queryKey: AuthKeys.state(),
      queryFn: () => AuthService.getAuthState(),
      staleTime: Infinity,
    }),
};
