import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = createRoot(document.getElementById("root")!);
// ErrorBoundary sits OUTSIDE QueryClientProvider so query-layer crashes are
// also caught. Inside StrictMode so the boundary itself can be reset cleanly.
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          theme="dark"
          position="bottom-right"
          richColors
          toastOptions={{ style: { background: "#0f1530", color: "#e7ecff", border: "1px solid #1c2a55" } }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
