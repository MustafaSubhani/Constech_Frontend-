import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectLayout } from "./pages/ProjectLayout";
import { DrawingsPage } from "./pages/DrawingsPage";
import { BillPage } from "./pages/BillPage";
import { RatesPage } from "./pages/RatesPage";
import { api } from "./api/client";

function RequireAuth({ children }: { children: ReactNode }) {
  if (!api.session()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="p/:projectId" element={<ProjectLayout />}>
          <Route index element={<DrawingsPage />} />
          <Route path="bill" element={<BillPage />} />
          <Route path="rates" element={<RatesPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
