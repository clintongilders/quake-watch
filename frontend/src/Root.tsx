import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const App = lazy(() => import("./App"));
const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
export default function Root() {
  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={<p role="status">Loading QuakeWatch…</p>}>
        <App />
      </Suspense>
    </QueryClientProvider>
  );
}
