import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { PageLoaderProvider } from "./components/PageLoader";
import "./styles/app.css";
import "./styles/app-overrides.css";

(function initTheme() {
  const saved = localStorage.getItem("constech.theme");
  const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PageLoaderProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </PageLoaderProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
