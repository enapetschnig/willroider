import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "@/pages/Auth";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import Arbeitsplanung from "@/pages/Arbeitsplanung";
import Baustellen from "@/pages/Baustellen";
import BaustelleDetail from "@/pages/BaustelleDetail";
import Mitarbeiter from "@/pages/Mitarbeiter";
import Stunden from "@/pages/Stunden";
import StundenFreigabe from "@/pages/StundenFreigabe";
import Kalender from "@/pages/Kalender";
import Evaluierung from "@/pages/Evaluierung";
import Fahrzeuge from "@/pages/Fahrzeuge";
import MeinTag from "@/pages/MeinTag";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/arbeitsplanung" element={<Arbeitsplanung />} />
              <Route path="/baustellen" element={<Baustellen />} />
              <Route path="/baustellen/:id" element={<BaustelleDetail />} />
              <Route path="/mitarbeiter" element={<Mitarbeiter />} />
              <Route path="/fahrzeuge" element={<Fahrzeuge />} />
              <Route path="/stunden" element={<Stunden />} />
              <Route path="/stunden/freigabe" element={<StundenFreigabe />} />
              <Route path="/kalender" element={<Kalender />} />
              <Route path="/evaluierung" element={<Evaluierung />} />
              <Route path="/mein-tag" element={<MeinTag />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
