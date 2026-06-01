import { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Auth from "@/pages/Auth";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import Arbeitsplanung from "@/pages/Arbeitsplanung";
import Tagesplanung from "@/pages/Tagesplanung";
import Baustellen from "@/pages/Baustellen";
import BaustelleDetail from "@/pages/BaustelleDetail";
import Angebote from "@/pages/Angebote";
import AngebotDetail from "@/pages/AngebotDetail";
import Admin from "@/pages/Admin";
import RegistrierungBestaetigung from "@/pages/RegistrierungBestaetigung";
import { Navigate } from "react-router-dom";
import Mitarbeiter from "@/pages/Mitarbeiter";
import Stunden from "@/pages/Stunden";
import Stundenauswertung from "@/pages/Stundenauswertung";
import StundenBericht from "@/pages/StundenBericht";
import StundenBerichteListe from "@/pages/StundenBerichteListe";
import HalleErfassung from "@/pages/HalleErfassung";
import Berichte from "@/pages/Berichte";
import BerichtDetail from "@/pages/BerichtDetail";
import Kalender from "@/pages/Kalender";
import Evaluierung from "@/pages/Evaluierung";
import Fahrzeuge from "@/pages/Fahrzeuge";
import Kalkulator from "@/pages/Kalkulator";
import KalkulatorAnfragen from "@/pages/KalkulatorAnfragen";
import MeinTag from "@/pages/MeinTag";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

/** Rollen-Gate für ganze Seiten. RLS schützt die Daten, dieser Wrapper
 *  verhindert zusätzlich, dass Nicht-Berechtigte die Seite per URL öffnen.
 *  Wird innerhalb von ProtectedRoute gerendert — Auth ist hier bereits geladen. */
function RequireRole({
  role,
  children,
}: {
  role: "admin" | "review" | "gf";
  children: ReactNode;
}) {
  const { isAdmin, canReview, role: userRole } = useAuth();
  const erlaubt =
    role === "admin"
      ? isAdmin
      : role === "review"
        ? canReview
        : userRole === "geschaeftsfuehrung";
  if (!erlaubt) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/registriert" element={<RegistrierungBestaetigung />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route
                path="/arbeitsplanung"
                element={<RequireRole role="admin"><Arbeitsplanung /></RequireRole>}
              />
              <Route
                path="/tagesplanung"
                element={<RequireRole role="admin"><Tagesplanung /></RequireRole>}
              />
              <Route path="/baustellen" element={<Baustellen />} />
              <Route path="/baustellen/:id" element={<BaustelleDetail />} />
              <Route
                path="/angebote"
                element={<RequireRole role="admin"><Angebote /></RequireRole>}
              />
              <Route
                path="/angebote/:id"
                element={<RequireRole role="admin"><AngebotDetail /></RequireRole>}
              />
              <Route
                path="/admin"
                element={<RequireRole role="admin"><Admin /></RequireRole>}
              />
              {/* Alte Routen leiten in den Admin-Bereich um (Backwards-Compat) */}
              <Route path="/mitarbeiter" element={<Navigate to="/admin?tab=mitarbeiter" replace />} />
              <Route path="/fahrzeuge" element={<Navigate to="/admin?tab=fahrzeuge" replace />} />
              <Route path="/kalender" element={<Navigate to="/admin?tab=kalender" replace />} />
              <Route path="/evaluierung" element={<Navigate to="/admin?tab=evaluierung" replace />} />
              <Route path="/stunden" element={<Stunden />} />
              <Route path="/halle" element={<HalleErfassung />} />
              <Route
                path="/stunden/auswertung"
                element={<RequireRole role="review"><Stundenauswertung /></RequireRole>}
              />
              <Route
                path="/stundenberichte"
                element={<RequireRole role="review"><StundenBerichteListe /></RequireRole>}
              />
              <Route path="/stundenbericht/:id" element={<StundenBericht />} />
              <Route path="/berichte" element={<Berichte />} />
              <Route path="/berichte/:id" element={<BerichtDetail />} />
              <Route path="/mein-tag" element={<MeinTag />} />
              <Route
                path="/kalkulator"
                element={<RequireRole role="gf"><Kalkulator /></RequireRole>}
              />
              <Route
                path="/kalkulator/anfragen"
                element={<RequireRole role="gf"><KalkulatorAnfragen /></RequireRole>}
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
