import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GoogleService } from "./google.service";
import type { SetCalendarRequest } from "./google.types";
import { ContactKeys, GoogleKeys } from "~/core/constants/query-keys.constant";

/** A new account means new contacts, so both are refreshed. */
function useInvalidateGoogle() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: GoogleKeys.all }),
      queryClient.invalidateQueries({ queryKey: ContactKeys.all }),
    ]);
}

export const GoogleMutation = {
  useConnect: () => {
    const invalidate = useInvalidateGoogle();
    return useMutation({
      mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) =>
        GoogleService.connect(code, redirectUri),
      onSuccess: invalidate,
    });
  },

  useDisconnect: () => {
    const invalidate = useInvalidateGoogle();
    return useMutation({
      mutationFn: () => GoogleService.disconnect(),
      onSuccess: invalidate,
    });
  },

  useSetCalendar: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: SetCalendarRequest) => GoogleService.setCalendar(request),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: GoogleKeys.status() }),
    });
  },
};
