import { QueryClient } from "@tanstack/react-query";
import { isTransient } from "./errors";

/** App-wide react-query client. Lives here (not in the layout) so sign-out can clear it. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Transient failures (offline, 5xx, timeouts) retry quietly with backoff; 4xx do not.
      retry: (count, err) => count < 3 && isTransient(err),
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
  },
});
