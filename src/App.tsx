import { Analytics } from "@vercel/analytics/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Taxes from "./pages/Taxes.tsx";
import Charts from "./pages/Charts.tsx";
import Projections from "./pages/Projections.tsx";
import DeploymentPlan from "./pages/DeploymentPlan.tsx";
import PortfolioAI from "./pages/PortfolioAI.tsx";
import GoalTrack from "./pages/GoalTrack.tsx";
import Updates from "./pages/Updates.tsx";
import RollingReturns from "./pages/RollingReturns.tsx";
import Reports from "./pages/Reports.tsx";
import DollarAdjustedReturns from "./pages/DollarAdjustedReturns.tsx";
import Benchmark from "./pages/Benchmark.tsx";
import NotFound from "./pages/NotFound.tsx";
import { SideNav } from "@/components/SideNav";
import { MobileTopNav } from "@/components/MobileTopNav";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Analytics />
        <BrowserRouter>
          <SideNav />
          <MobileTopNav />
          <div className="md:pl-[calc(var(--sidenav-w,16rem)+1.25rem)] transition-[padding] duration-300 ease-out">
            <Routes>
              {/* Single centralized auth gate — every route below requires a real
                  Supabase Auth session. Adding a new page here automatically
                  inherits protection; nothing extra to remember per-page. */}
              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Index />} />
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
              </Route>
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
