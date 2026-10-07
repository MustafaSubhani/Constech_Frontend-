import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { ConfirmProvider } from "./components/ui/Confirm";
import { PageLoaderProvider } from "./components/PageLoader";
import { applyTheme } from "./lib/settings";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/brand.css";
import "./styles/shell.css";
import "./styles/pages.css";
import "./styles/workspace.css";

applyTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PageLoaderProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </PageLoaderProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
