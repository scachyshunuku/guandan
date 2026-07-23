"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// One QueryClient per browser tab, created lazily in useState so it survives
// re-renders but isn't shared across server-rendered requests (which would
// leak cached data between different users - see TanStack Query's Next.js
// App Router guidance). Every hook that calls useQuery/useMutation
// (useGame/useGameActions, Tasks 4.3/4.4) needs an ancestor provider, so this
// wraps the whole app rather than just the game routes.
export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
