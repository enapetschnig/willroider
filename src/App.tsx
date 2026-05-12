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
import Angebote from "@/pages/Angebote";
import AngebotDetail from "@/pages/AngebotDetail";
import Admin from "@/pages/Admin";
import { Navigate } from "react-router-dom";
import Mitarbeiter from "@/pages/Mitarbeiter";
import Stunden from "@/pages/Stunden";
import Stundenauswertung from "@/pages/Stundenauswertung";
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
              <Route path="/angebote" element={<Angebote />} />
              <Route path="/angebote/:id" element={<AngebotDetail />} />
              <Route path="/admin" element={<Admin />} />
              {/* Alte Routen leiten in den Admin-Bereich um (Backwards-Compat) */}
              <Route path="/mitarbeiter" element={<Navigate to="/admin?tab=mitarbeiter" replace />} />
              <Route path="/fahrzeuge" element={<Navigate to="/admin?tab=fahrzeuge" replace />} />
              <Route path="/kalender" element={<Navigate to="/admin?tab=kalender" replace />} />
              <Route path="/evaluierung" element={<Navigate to="/admin?tab=evaluierung" replace />} />
              <Route path="/stunden" element={<Stunden />} />
              <Route path="/stunden/auswertung" element={<Stundenauswertung />} />
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
