import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import LoaderApp from "./LoaderApp";
import "./styles/app.css";
import "./styles/loader.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <LoaderApp />
      <Toaster theme="dark" position="top-center" richColors />
    </QueryClientProvider>
  </React.StrictMode>,
);
