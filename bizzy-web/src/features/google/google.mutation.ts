import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GoogleService } from "./google.service";
import type { SetCalendarRequest } from "./google.types";
import { ContactKeys } from "~/core/constants/query-keys.constant";

/** A new account means new contacts, which are Google's: the API can't say they changed. */
function useRefreshContacts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ContactKeys.all });
}

export const GoogleMutation = {
  useConnect: () => {
    const refreshContacts = useRefreshContacts();
    return useMutation({
      mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) =>
        GoogleService.connect(code, redirectUri),
      onSuccess: refreshContacts,
    });
  },

  useDisconnect: () => {
    const refreshContacts = useRefreshContacts();
    return useMutation({
      mutationFn: () => GoogleService.disconnect(),
      onSuccess: refreshContacts,
    });
  },

  useSetCalendar: () =>
    useMutation({
      mutationFn: (request: SetCalendarRequest) => GoogleService.setCalendar(request),
    }),
};
