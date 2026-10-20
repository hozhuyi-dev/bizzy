import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one query cache. Every read hits a small provisioned table, so
 * data counts as fresh for a while instead of being read again on every
 * mount or focus; mutations still refresh what they change straight away.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
