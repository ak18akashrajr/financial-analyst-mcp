import { lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import Landing from "./pages/Landing.tsx";
import Login from "./pages/Login.tsx";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Lazy — several of these (Charts, Projections, RollingReturns, Benchmark,
// GoalTrack via GoalProjection) pull in recharts, so eagerly importing all
// 12 pages here shipped every page's code and the charting library in one
// bundle even though most visits only ever touch one page. NotFound stays a
// regular import: it's tiny, has no heavy deps, and is the catch-all route
// most likely to render immediately. See docs/perf-findings.md#5.
const Index = lazy(() => import("./pages/Index.tsx"));
const Taxes = lazy(() => import("./pages/Taxes.tsx"));
const Charts = lazy(() => import("./pages/Charts.tsx"));
const Projections = lazy(() => import("./pages/Projections.tsx"));
const DeploymentPlan = lazy(() => import("./pages/DeploymentPlan.tsx"));
const PortfolioAI = lazy(() => import("./pages/PortfolioAI.tsx"));
const GoalTrack = lazy(() => import("./pages/GoalTrack.tsx"));
const Updates = lazy(() => import("./pages/Updates.tsx"));
const RollingReturns = lazy(() => import("./pages/RollingReturns.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const DollarAdjustedReturns = lazy(() => import("./pages/DollarAdjustedReturns.tsx"));
const Benchmark = lazy(() => import("./pages/Benchmark.tsx"));
const DevZone = lazy(() => import("./pages/DevZone.tsx"));

const queryClient = new QueryClient();

// Same loading style as ProtectedRoute's own auth-resolving state, so a
// lazy chunk load and an auth check look like the same kind of pause to the
// user rather than two different loading UIs.
const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <p className="text-sm text-muted-foreground">Loading...</p>
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Analytics />
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* Public — no session required, and neither renders the sidebar/nav. */}
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />

                {/* Single centralized auth gate — every route below requires a real
                    Supabase Auth session. Adding a new page here automatically
                    inherits protection; nothing extra to remember per-page. AppLayout
                    (sidebar + mobile nav) is nested inside the gate so it only ever
                    renders once a session exists. */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/overview" element={<Index />} />
                    <Route path="/taxes" element={<Taxes />} />
                    <Route path="/charts" element={<Charts />} />
                    <Route path="/projections" element={<Projections />} />
                    <Route path="/deployment-plan" element={<DeploymentPlan />} />
                    <Route path="/ai" element={<PortfolioAI />} />
                    <Route path="/goal-track" element={<GoalTrack />} />
                    <Route path="/updates" element={<Updates />} />
                    <Route path="/rolling-returns" element={<RollingReturns />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/dollar-adjusted-returns" element={<DollarAdjustedReturns />} />
                    <Route path="/benchmark" element={<Benchmark />} />
                    <Route path="/dev-zone" element={<DevZone />} />
                  </Route>
                </Route>
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
