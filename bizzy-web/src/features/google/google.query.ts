import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GoogleCalendar, GoogleConnection } from "./google.types";
import { invoke } from "~/core/lambda/lambda.client";
import { ContactKeys, GoogleKeys } from "~/core/keys.query";

export const GoogleService = {
  /** Null before she connects. */
  status: () => invoke<GoogleConnection | null>("google.status"),
  connect: (code: string, redirectUri: string) =>
    invoke<GoogleConnection>("google.connect", { code, redirectUri }),
  disconnect: () => invoke<null>("google.disconnect"),
  calendars: () => invoke<Array<GoogleCalendar>>("google.calendars"),
  setCalendar: (id: string) => invoke<GoogleConnection>("google.setCalendar", { id }),
};

export const GoogleQuery = {
  useStatus: () =>
    useQuery({
      queryKey: GoogleKeys.status(),
      queryFn: () => GoogleService.status(),
    }),

  useCalendars: (enabled: boolean) =>
    useQuery({
      queryKey: GoogleKeys.calendars(),
      queryFn: () => GoogleService.calendars(),
      enabled,
    }),
};

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
      mutationFn: (id: string) => GoogleService.setCalendar(id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: GoogleKeys.status() }),
    });
  },
};
