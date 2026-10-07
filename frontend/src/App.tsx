import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { AppShell } from "./components/shell/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { QuickTakeoffPage } from "./pages/QuickTakeoffPage";
import { ExportsPage } from "./pages/ExportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProjectLayout } from "./pages/project/ProjectLayout";
import { DrawingsPage } from "./pages/project/DrawingsPage";
import { BillPage } from "./pages/project/BillPage";
import { RatesPage } from "./pages/project/RatesPage";
import { InputsPage } from "./pages/project/InputsPage";
import { PipelinePage } from "./pages/project/PipelinePage";

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
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="quick" element={<QuickTakeoffPage />} />
        <Route path="exports" element={<ExportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="p/:projectId" element={<ProjectLayout />}>
          <Route index element={<DrawingsPage />} />
          <Route path="bill" element={<BillPage />} />
          <Route path="rates" element={<RatesPage />} />
          <Route path="inputs" element={<InputsPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
