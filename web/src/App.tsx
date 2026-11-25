import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./i18n/config";

// Lazy-loaded routes for code-splitting & performance budget
const LiveWall = lazy(() => import("./pages/LiveWall").then((m) => ({ default: m.LiveWall })));
const AnalyzeView = lazy(() => import("./pages/AnalyzeView").then((m) => ({ default: m.AnalyzeView })));
const FocusView = lazy(() => import("./pages/FocusView").then((m) => ({ default: m.FocusView })));
const ReviewQueue = lazy(() => import("./pages/ReviewQueue").then((m) => ({ default: m.ReviewQueue })));
const IncidentDetail = lazy(() => import("./pages/IncidentDetail").then((m) => ({ default: m.IncidentDetail })));
const AnalyticsView = lazy(() => import("./pages/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));
const CompareView = lazy(() => import("./pages/CompareView").then((m) => ({ default: m.CompareView })));
const CamerasView = lazy(() => import("./pages/CamerasView").then((m) => ({ default: m.CamerasView })));
const SettingsView = lazy(() => import("./pages/SettingsView").then((m) => ({ default: m.SettingsView })));
const EvaluationView = lazy(() => import("./pages/EvaluationView").then((m) => ({ default: m.EvaluationView })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 font-mono text-xs">
                Loading Incident Console...
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<AppShell />}>
                <Route index element={<LiveWall />} />
                <Route path="analyze" element={<AnalyzeView />} />
                <Route path="camera/:id" element={<FocusView />} />
                <Route path="incidents" element={<ReviewQueue />} />
                <Route path="incidents/:id" element={<IncidentDetail />} />
                <Route path="analytics" element={<AnalyticsView />} />
                <Route path="compare" element={<CompareView />} />
                <Route path="cameras" element={<CamerasView />} />
                <Route path="settings" element={<SettingsView />} />
                <Route path="evaluation" element={<EvaluationView />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  );
};

export default App;
