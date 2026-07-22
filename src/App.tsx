import { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PermissionProvider } from "@/contexts/PermissionContext";
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
import Notizen from "@/pages/Notizen";
import Aenderungswuensche from "@/pages/Aenderungswuensche";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import BerichtDetail from "@/pages/BerichtDetail";
import Kalender from "@/pages/Kalender";
import Evaluierung from "@/pages/Evaluierung";
import Fahrzeuge from "@/pages/Fahrzeuge";
import Kalkulator from "@/pages/Kalkulator";
import KalkulatorAnfragen from "@/pages/KalkulatorAnfragen";
import MeinTag from "@/pages/MeinTag";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RequirePermission } from "@/components/RequirePermission";

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
  const { isAdmin, canReview, hasPermission, permissionsLoaded } = useAuth();
  // Während Permissions laden: nicht voreilig redirecten
  if (!permissionsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Lade Berechtigungen …
      </div>
    );
  }
  const erlaubt =
    role === "admin"
      ? isAdmin
      : role === "review"
        ? canReview
        : hasPermission("kalkulator.view");
  if (!erlaubt) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PermissionProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/registriert" element={<RegistrierungBestaetigung />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<RequirePermission perm="dashboard.view"><Dashboard /></RequirePermission>} />
              <Route path="/arbeitsplanung" element={<RequirePermission perm="arbeitsplanung.view"><Arbeitsplanung /></RequirePermission>} />
              <Route path="/tagesplanung" element={<RequirePermission perm="tagesplanung.edit"><Tagesplanung /></RequirePermission>} />
              <Route path="/baustellen" element={<RequirePermission perm="baustellen.view"><Baustellen /></RequirePermission>} />
              <Route path="/baustellen/:id" element={<RequirePermission perm="baustellen.view"><BaustelleDetail /></RequirePermission>} />
              <Route path="/angebote" element={<RequirePermission perm="angebote.view"><Angebote /></RequirePermission>} />
              <Route path="/angebote/:id" element={<RequirePermission perm="angebote.view"><AngebotDetail /></RequirePermission>} />
              <Route path="/admin" element={<RequirePermission perm="admin.view"><Admin /></RequirePermission>} />
              {/* Alte Routen leiten in den Admin-Bereich um (Backwards-Compat) */}
              <Route path="/mitarbeiter" element={<Navigate to="/admin?tab=mitarbeiter" replace />} />
              <Route path="/fahrzeuge" element={<Navigate to="/admin?tab=fahrzeuge" replace />} />
              <Route path="/kalender" element={<Navigate to="/admin?tab=kalender" replace />} />
              {/* Echte Route statt Redirect auf /admin: Poliere/Zimmermeister mit
                  evaluierungen.view haben kein admin.view, und der ?baustelle=-Parameter
                  ging beim Redirect verloren. Der Admin-Tab bleibt daneben bestehen. */}
              <Route path="/evaluierung" element={<RequirePermission perm="evaluierungen.view"><Evaluierung /></RequirePermission>} />
              <Route path="/stunden" element={<RequirePermission perm="stunden.view_eigene"><Stunden /></RequirePermission>} />
              <Route path="/halle" element={<RequirePermission perm="stunden.view_eigene"><HalleErfassung /></RequirePermission>} />
              <Route path="/stunden/auswertung" element={<RequirePermission perm="stunden.view_alle"><Stundenauswertung /></RequirePermission>} />
              <Route path="/stundenberichte" element={<RequirePermission perm="stunden.bsb.bestaetigen"><StundenBerichteListe /></RequirePermission>} />
              <Route path="/stundenbericht/:id" element={<RequirePermission perm="stunden.view_eigene"><StundenBericht /></RequirePermission>} />
              <Route path="/berichte" element={<RequirePermission perm="berichte.view"><Berichte /></RequirePermission>} />
              <Route path="/aenderungswuensche" element={<RequirePermission perm="feedback.view_alle"><Aenderungswuensche /></RequirePermission>} />
              <Route path="/notizen" element={<RequirePermission perm="admin.view"><Notizen /></RequirePermission>} />
              <Route path="/berichte/:id" element={<RequirePermission perm="berichte.view"><BerichtDetail /></RequirePermission>} />
              <Route path="/mein-tag" element={<RequirePermission perm="meintag.view"><MeinTag /></RequirePermission>} />
              <Route path="/kalkulator" element={<RequirePermission perm="kalkulator.view"><Kalkulator /></RequirePermission>} />
              <Route path="/kalkulator/anfragen" element={<RequirePermission perm="kalkulator.anfragen_verwalten"><KalkulatorAnfragen /></RequirePermission>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </PermissionProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
