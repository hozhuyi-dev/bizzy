import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import { invalidateBilling } from "~/core/utils/query.util";

export const SessionsMutation = {
  useSetIgnored: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ eventId, ignored }: { eventId: string; ignored: boolean }) =>
        SessionsService.setIgnored(eventId, ignored),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },
};
